import asyncio
import base64
import json
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from conveditor.config import Settings
from conveditor.providers.openai import OpenAIProvider, ProviderError


@pytest.fixture
def model_server():
    calls = []
    response = {"status": 200, "body": {}}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            calls.append((self.path, self.headers, body))
            self.send_response(response["status"])
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response["body"]).encode())

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    provider = OpenAIProvider(Settings(_env_file=None, openai_api_key="local-test-only", openai_base_url=f"http://127.0.0.1:{server.server_port}/v1"))
    yield provider, calls, response
    server.shutdown()
    server.server_close()
    thread.join()


def test_real_sdk_sends_vision_and_strict_schema(model_server):
    provider, calls, response = model_server
    critique = {"summary": "可以继续细化动作", "strengths": ["剪影清晰"], "suggestions": []}
    response["body"] = {
        "id": "resp_test", "object": "response", "created_at": 0, "model": "gpt-4.1-mini", "status": "completed",
        "output": [{"id": "msg_test", "type": "message", "role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": json.dumps(critique), "annotations": []}]}],
    }
    result = asyncio.run(provider.evaluate(b"test-image", "测试阶段约束"))
    assert result.summary == critique["summary"]
    path, headers, raw = calls[0]
    body = json.loads(raw)
    assert path == "/v1/responses"
    assert headers["Authorization"] == "Bearer local-test-only"
    assert body["text"]["format"]["strict"] is True
    assert body["store"] is False
    assert body["input"][0]["content"][1]["image_url"] == "data:image/png;base64," + base64.b64encode(b"test-image").decode()
    assert "动画作画指导" in body["instructions"]


@pytest.mark.parametrize("with_mask", [False, True])
def test_real_sdk_uploads_full_image_and_optional_mask_to_edit_endpoint(model_server, with_mask):
    provider, calls, response = model_server
    response["body"] = {"created": 0, "data": [{"b64_json": base64.b64encode(b"generated-image").decode()}]}
    options = {"mask": b"edit-mask"} if with_mask else {}
    assert asyncio.run(provider.edit(b"source-image", "只改肩部", **options)) == b"generated-image"
    path, headers, raw = calls[0]
    assert path == "/v1/images/edits"
    assert "multipart/form-data" in headers["Content-Type"]
    multipart = BytesParser(policy=default).parsebytes(f"Content-Type: {headers['Content-Type']}\r\n\r\n".encode() + raw)
    parts = {part.get_param("name", header="content-disposition"): part for part in multipart.iter_parts()}
    assert parts["image"].get_payload(decode=True) == b"source-image"
    assert parts["image"].get_filename() == "drawing.png"
    assert parts["prompt"].get_payload(decode=True) == "只改肩部".encode()
    assert parts["model"].get_payload(decode=True) == b"gpt-image-2"
    assert parts["background"].get_payload(decode=True) == b"opaque"
    if with_mask:
        assert parts["mask"].get_payload(decode=True) == b"edit-mask"
        assert parts["mask"].get_filename() == "mask.png"
        assert parts["mask"].get_content_type() == "image/png"
    else:
        assert "mask" not in parts


def test_image_edit_credentials_do_not_change_evaluation_requests(model_server):
    original, calls, response = model_server
    provider = OpenAIProvider(Settings(
        _env_file=None,
        openai_api_key="evaluation-test-only",
        openai_base_url=original.settings.openai_base_url,
        image_edit_api_key="image-test-only",
        image_edit_base_url=original.settings.openai_base_url + "/image",
    ))
    critique = {"summary": "可以继续细化动作", "strengths": [], "suggestions": []}
    response["body"] = {
        "id": "resp_test", "object": "response", "created_at": 0, "model": "gpt-4.1-mini", "status": "completed",
        "output": [{"id": "msg_test", "type": "message", "role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": json.dumps(critique), "annotations": []}]}],
    }
    asyncio.run(provider.evaluate(b"source-image", "测试阶段约束"))
    response["body"] = {"created": 0, "data": [{"b64_json": base64.b64encode(b"generated-image").decode()}]}
    assert asyncio.run(provider.edit(b"source-image", "只改帽子")) == b"generated-image"
    assert [call[0] for call in calls] == ["/v1/responses", "/v1/image/images/edits"]
    assert [call[1]["Authorization"] for call in calls] == ["Bearer evaluation-test-only", "Bearer image-test-only"]


@pytest.mark.parametrize("status,expected", [(401, 502), (403, 502), (429, 429), (500, 502)])
def test_upstream_errors_are_safe_and_not_automatically_retried(model_server, status, expected):
    provider, calls, response = model_server
    response.update(status=status, body={"error": {"message": "sensitive upstream content", "type": "error", "code": "error"}})
    with pytest.raises(ProviderError) as caught:
        asyncio.run(provider.evaluate(b"test", "test"))
    assert caught.value.status_code == expected
    assert "sensitive" not in str(caught.value)
    if status in {401, 403}:
        assert "密钥和模型权限" in str(caught.value)
    assert len(calls) == 1


@pytest.mark.parametrize("code", ["insufficient_user_quota", "insufficient_quota"])
def test_region_conversation_reports_quota_when_upstream_returns_403(model_server, code):
    provider, calls, response = model_server
    response.update(status=403, body={"error": {"message": "sensitive upstream content", "type": "new_api_error", "code": code}})
    with pytest.raises(ProviderError) as caught:
        asyncio.run(provider.converse(b"full-image", b"crop", "当前模式：edit", [], "耳朵小一点"))
    assert caught.value.status_code == 429
    assert "额度不足" in str(caught.value)
    assert "sensitive" not in str(caught.value)
    assert len(calls) == 1
    assert calls[0][0] == "/v1/responses"


def test_refusal_is_explicit_failure(model_server):
    provider, _, response = model_server
    response["body"] = {"id": "resp_test", "object": "response", "created_at": 0, "model": "gpt-4.1-mini", "status": "completed", "output": [{"id": "msg_test", "type": "message", "role": "assistant", "status": "completed", "content": [{"type": "refusal", "refusal": "Cannot evaluate"}]}]}
    with pytest.raises(ProviderError, match="未完成评估或拒绝"):
        asyncio.run(provider.evaluate(b"test", "test"))


def test_region_conversation_sends_both_images_and_prior_turns(model_server):
    provider, calls, response = model_server
    plan = {"reply": "可以改成蓝色。", "edit_instruction": "只把围巾改成蓝色。"}
    response["body"] = {"id": "resp_test", "object": "response", "created_at": 0, "model": "test", "status": "completed", "output": [{"id": "msg_test", "type": "message", "role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": json.dumps(plan), "annotations": []}]}]}
    history = [{"role": "user", "content": "想换颜色"}, {"role": "assistant", "content": "蓝色如何？"}]
    result = asyncio.run(provider.converse(b"full-image", b"crop", "当前模式：edit", history, "好，改吧"))
    assert result.edit_instruction == plan["edit_instruction"]
    body = json.loads(calls[0][2])
    assert "当前模式：edit" in body["instructions"]
    assert body["input"][1:3] == history
    assert body["input"][-1]["content"] == "好，改吧"
    images = body["input"][0]["content"][1:]
    assert [base64.b64decode(item["image_url"].split(",")[1]) for item in images] == [b"full-image", b"crop"]
    assert body["text"]["format"]["strict"] is True
