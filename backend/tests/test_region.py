from io import BytesIO
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from conveditor.config import Settings
from conveditor.main import app
from conveditor.providers.openai import ProviderError
from conveditor.schemas.workflow import RegionReply
from conveditor.services.region import RegionConversation, get_region_conversation
from test_workflow import data_url, png


@pytest.fixture
def region_environment(tmp_path):
    conversation = RegionConversation(Settings(_env_file=None, openai_api_key="", data_dir=tmp_path))
    conversation.provider.converse = AsyncMock(return_value=RegionReply(reply="这里可以保留轮廓并调整颜色。", edit_instruction="把选区内围巾改成蓝色，保留线条。"))
    conversation.provider.edit = AsyncMock(return_value=png("blue"))
    app.dependency_overrides[get_region_conversation] = lambda: conversation
    with TestClient(app) as client:
        yield client, conversation
    app.dependency_overrides.clear()


def start(client):
    response = client.post("/api/region-sessions", json={"image": data_url(png(size=(40, 32))), "brief": {"stage": "color", "goal": "温暖的信使", "preserve": "保留线稿", "region": {"x": .25, "y": .25, "width": .5, "height": .25}}})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_chat_keeps_history_and_never_generates_even_if_model_requests_it(region_environment):
    client, conversation = region_environment
    identifier = start(client)
    url = f"/api/region-sessions/{identifier}/messages"
    response = client.post(url, json={"message": "这块配色合适吗？"})
    assert response.status_code == 200
    assert response.json()["candidate"] is None
    conversation.provider.edit.assert_not_called()
    args = conversation.provider.converse.call_args.args
    assert Image.open(BytesIO(args[0])).size == (40, 32)
    assert Image.open(BytesIO(args[1])).size == (20, 8)
    assert "当前模式：chat" in args[2]
    assert args[3] == []
    client.post(url, json={"message": "具体换成什么蓝？"})
    history = conversation.provider.converse.call_args.args[3]
    assert history == [{"role": "user", "content": "这块配色合适吗？"}, {"role": "assistant", "content": response.json()["reply"]}]


def test_local_edit_sends_full_image_and_mask_and_preserves_outside_pixels(region_environment):
    client, conversation = region_environment
    identifier = start(client)
    original, _ = conversation.storage.load(identifier)
    conversation.provider.edit.return_value = png("blue", size=(40, 32))
    response = client.post(f"/api/region-sessions/{identifier}/messages", json={"message": "把围巾改成蓝色", "mode": "edit"})
    assert response.status_code == 200, response.text
    candidate = response.json()["candidate"]
    assert candidate["session_id"] == identifier
    assert candidate["evaluation_id"] is None
    assert candidate["scope"] == "masked_region"
    image, prompt = conversation.provider.edit.call_args.args
    assert image == original
    assert Image.open(BytesIO(image)).size == (40, 32)
    assert "保留线稿" in prompt and "围巾改成蓝色" in prompt
    assert "完整原图" in prompt and "遮罩" in prompt
    assert "颜色和明度" in prompt and "新增阴影" in prompt
    assert "贴回" not in prompt and "仅输出这张裁图" not in prompt
    mask = Image.open(BytesIO(conversation.provider.edit.call_args.kwargs["mask"]))
    assert mask.size == (40, 32)
    output, _ = conversation.storage.load(candidate["id"])
    result = Image.open(BytesIO(output))
    assert result.size == (40, 32)
    for y in range(32):
        for x in range(40):
            assert mask.getpixel((x, y))[3] == (0 if 10 <= x < 30 and 8 <= y < 16 else 255)
            assert result.getpixel((x, y)) == ((0, 0, 255, 255) if 10 <= x < 30 and 8 <= y < 16 else (255, 255, 255, 255))
    assert conversation.storage.load(identifier)[0] == original


def test_ambiguous_edit_asks_question_without_generating(region_environment):
    client, conversation = region_environment
    identifier = start(client)
    conversation.provider.converse.return_value = RegionReply(reply="希望改成哪种颜色？", edit_instruction=None)
    response = client.post(f"/api/region-sessions/{identifier}/messages", json={"message": "改一下", "mode": "edit"})
    assert response.status_code == 200
    assert response.json()["candidate"] is None
    conversation.provider.edit.assert_not_called()


def test_failed_generation_keeps_session_and_can_retry(region_environment):
    client, conversation = region_environment
    identifier = start(client)
    conversation.provider.edit.side_effect = ProviderError("服务暂不可用", 502)
    body = {"message": "改成蓝色", "mode": "edit"}
    url = f"/api/region-sessions/{identifier}/messages"
    assert client.post(url, json=body).status_code == 502
    assert conversation.storage.load(identifier)[1]["history"] == []
    conversation.provider.edit.side_effect = None
    assert client.post(url, json=body).status_code == 200


@pytest.mark.parametrize("region", [None, {"x": .9, "y": 0, "width": .5, "height": .5}, {"x": 0, "y": 0, "width": .00001, "height": .00001}])
def test_session_requires_a_usable_region(region_environment, region):
    client, conversation = region_environment
    response = client.post("/api/region-sessions", json={"image": data_url(png()), "brief": {"stage": "color", "goal": "test", "region": region}})
    assert response.status_code == 422
    conversation.provider.converse.assert_not_called()


def test_invalid_messages_and_missing_sessions(region_environment):
    client, conversation = region_environment
    identifier = start(client)
    url = f"/api/region-sessions/{identifier}/messages"
    for message in ["", "   ", "x" * 2001]:
        assert client.post(url, json={"message": message}).status_code == 422
    assert client.post(url, json={"message": "test", "mode": "auto"}).status_code == 422
    assert client.post(f"/api/region-sessions/{'f' * 32}/messages", json={"message": "test"}).status_code == 404
    conversation.provider.converse.assert_not_called()
