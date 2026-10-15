import base64
from io import BytesIO
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from conveditor.config import Settings, get_settings
from conveditor.main import app
from conveditor.prompts.workflow import editing_prompt, evaluation_prompt
from conveditor.providers.openai import ProviderError
from conveditor.schemas.workflow import Brief, Critique, Region
from conveditor.services.workflow import Workflow, get_workflow


def png(color="white", size=(32, 32)):
    output = BytesIO()
    Image.new("RGB", size, color).save(output, "PNG")
    return output.getvalue()


def data_url(image):
    return "data:image/png;base64," + base64.b64encode(image).decode()


CRITIQUE = {
    "summary": "角色特征清楚，肩部连接需要调整。",
    "strengths": ["围巾增强角色识别"],
    "suggestions": [
        {"id": "s1", "title": "调整肩部", "priority": "high", "observation": "左肩与躯干断开", "action": "连接左肩轮廓", "reason": "保持动作连续", "region": {"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.3}},
        {"id": "s2", "title": "调整脚部", "priority": "low", "observation": "脚底倾斜", "action": "使脚底平行地面", "reason": "稳定重心", "region": None},
    ],
}


@pytest.fixture
def environment(tmp_path):
    settings = Settings(_env_file=None, openai_api_key="", data_dir=tmp_path)
    workflow = Workflow(settings)
    workflow.provider.evaluate = AsyncMock(return_value=Critique.model_validate(CRITIQUE))
    workflow.provider.edit = AsyncMock(return_value=png("red"))
    app.dependency_overrides[get_workflow] = lambda: workflow
    app.dependency_overrides[get_settings] = lambda: settings
    # health and artifact routes read settings directly.
    import conveditor.api.routes.editing as routes
    original = routes.get_settings
    routes.get_settings = lambda: settings
    with TestClient(app) as client:
        yield client, workflow, settings
    routes.get_settings = original
    app.dependency_overrides.clear()


def evaluate(client, region=None):
    response = client.post("/api/evaluations", json={"image": data_url(png()), "brief": {"stage": "sketch", "goal": "自然的狐狸信使", "preserve": "保留围巾", "region": region}})
    assert response.status_code == 200, response.text
    return response.json()


def test_evaluate_then_edit_uses_saved_source_and_only_selected_advice(environment):
    client, workflow, settings = environment
    result = evaluate(client)
    response = client.post("/api/edits", json={"evaluation_id": result["id"], "suggestion_ids": ["s1"], "instruction": "改动小一点"})
    assert response.status_code == 200, response.text
    candidate = response.json()
    assert "连接左肩轮廓" in candidate["prompt"]
    assert "使脚底平行地面" not in candidate["prompt"]
    assert "保留围巾" in candidate["prompt"]
    assert "改动小一点" in candidate["prompt"]
    assert candidate["scope"] == "instruction"
    assert client.get(candidate["image_url"]).status_code == 200
    original = settings.data_dir / f"{result['id']}.png"
    assert Image.open(original).getpixel((0, 0))[:3] == (255, 255, 255)
    assert workflow.provider.edit.call_args.args[0] == original.read_bytes()
    assert workflow.provider.edit.call_args.kwargs.get("mask") is None


def test_region_edit_uploads_mask_and_preserves_outside_pixels(environment):
    client, workflow, settings = environment
    result = evaluate(client, {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5})
    response = client.post("/api/edits", json={"evaluation_id": result["id"], "suggestion_ids": ["s1"]})
    assert response.status_code == 200
    assert response.json()["scope"] == "masked_region"
    assert workflow.provider.edit.call_args.args[0] == (settings.data_dir / f"{result['id']}.png").read_bytes()
    mask = Image.open(BytesIO(workflow.provider.edit.call_args.kwargs["mask"]))
    assert mask.size == (32, 32)
    assert "遮罩" in response.json()["prompt"]
    image = Image.open(BytesIO(client.get(response.json()["image_url"]).content))
    for y in range(32):
        for x in range(32):
            assert mask.getpixel((x, y))[3] == (0 if 8 <= x < 24 and 8 <= y < 24 else 255)
            assert image.getpixel((x, y)) == ((255, 0, 0, 255) if 8 <= x < 24 and 8 <= y < 24 else (255, 255, 255, 255))


@pytest.mark.parametrize("ids", [[], ["missing"], ["s1", "s1"]])
def test_invalid_selection_never_calls_image_model(environment, ids):
    client, workflow, _ = environment
    result = evaluate(client)
    response = client.post("/api/edits", json={"evaluation_id": result["id"], "suggestion_ids": ids})
    assert response.status_code == 422
    workflow.provider.edit.assert_not_called()


@pytest.mark.parametrize("image", ["https://example.com/image.png", "data:image/png;base64,!!!", data_url(b"not an image")])
def test_invalid_image_never_calls_vision_model(environment, image):
    client, workflow, _ = environment
    response = client.post("/api/evaluations", json={"image": image, "brief": {"stage": "sketch", "goal": "test"}})
    assert response.status_code == 422
    workflow.provider.evaluate.assert_not_called()


def test_invalid_region_rejected(environment):
    client, workflow, _ = environment
    response = client.post("/api/evaluations", json={"image": data_url(png()), "brief": {"stage": "color", "goal": "test", "region": {"x": .9, "y": 0, "width": .2, "height": .5}}})
    assert response.status_code == 422
    assert "base64" not in response.text
    workflow.provider.evaluate.assert_not_called()


def test_model_failure_and_retry_preserve_evaluation(environment):
    client, workflow, settings = environment
    result = evaluate(client)
    workflow.provider.edit.side_effect = ProviderError("模型请求超时", 504)
    body = {"evaluation_id": result["id"], "suggestion_ids": ["s1"]}
    assert client.post("/api/edits", json=body).status_code == 504
    assert len(list(settings.data_dir.glob("*.png"))) == 1
    workflow.provider.edit.side_effect = None
    assert client.post("/api/edits", json=body).status_code == 200


def test_missing_key_returns_configuration_error(environment):
    client, workflow, settings = environment
    from conveditor.providers.openai import OpenAIProvider
    workflow.provider = OpenAIProvider(settings)
    response = client.post("/api/evaluations", json={"image": data_url(png()), "brief": {"stage": "sketch", "goal": "test"}})
    assert response.status_code == 503
    assert "OPENAI_API_KEY" in response.json()["detail"]


def test_unknown_evaluation_and_invalid_generated_image(environment):
    client, workflow, _ = environment
    assert client.post("/api/edits", json={"evaluation_id": "a" * 32, "suggestion_ids": ["s1"]}).status_code == 404
    result = evaluate(client)
    workflow.provider.edit.return_value = b"broken"
    assert client.post("/api/edits", json={"evaluation_id": result["id"], "suggestion_ids": ["s1"]}).status_code == 502


@pytest.mark.parametrize("stage,term", [("sketch", "重心"), ("lineart", "遮挡"), ("color", "光源")])
def test_stage_prompts_preserve_context(stage, term):
    brief = Brief(stage=stage, goal="角色特征鲜明", preserve="围巾不变")
    assert term in evaluation_prompt(brief)
    prompt = editing_prompt(brief, Critique.model_validate(CRITIQUE).suggestions[:1], "")
    assert term in prompt and "围巾不变" in prompt and "使脚底平行地面" not in prompt
    assert "颜色和明度" in prompt and "新增阴影" in prompt


def test_mask_matches_non_square_source_and_reaches_canvas_edge():
    from conveditor.services.images import region_mask
    region = Region(x=.5, y=.5, width=.5, height=.5)
    mask = Image.open(BytesIO(region_mask(png(size=(40, 30)), region)))
    assert mask.size == (40, 30)
    assert mask.getpixel((19, 15))[3] == 255
    assert mask.getpixel((20, 14))[3] == 255
    assert mask.getpixel((20, 15))[3] == 0
    assert mask.getpixel((39, 29))[3] == 0


def test_outside_protection_keeps_source_colors_and_alpha_when_model_changes_them():
    from conveditor.services.images import preserve_outside_region
    source = Image.new("RGBA", (40, 30), (250, 245, 240, 255))
    generated = Image.new("RGBA", (40, 30), (180, 180, 180, 0))
    generated.paste((255, 0, 0, 255), (10, 6, 30, 18))
    original_bytes, generated_bytes = BytesIO(), BytesIO()
    source.save(original_bytes, "PNG")
    generated.save(generated_bytes, "PNG")
    result = Image.open(BytesIO(preserve_outside_region(original_bytes.getvalue(), generated_bytes.getvalue(), Region(x=.25, y=.2, width=.5, height=.4))))
    for y in range(30):
        for x in range(40):
            assert result.getpixel((x, y)) == ((255, 0, 0, 255) if 10 <= x < 30 and 6 <= y < 18 else source.getpixel((x, y)))
