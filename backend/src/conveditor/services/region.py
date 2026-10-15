from uuid import uuid4

from fastapi import HTTPException

from conveditor.config import Settings, get_settings
from conveditor.prompts.region import REGION_PROMPT_VERSION, region_context, region_edit_prompt
from conveditor.providers.openai import OpenAIProvider, ProviderError
from conveditor.schemas.workflow import CandidateResponse, RegionBrief, RegionMessageRequest, RegionMessageResponse, RegionSessionRequest, RegionSessionResponse
from conveditor.services.images import crop_region, decode_image, normalize_image, preserve_outside_region, region_mask
from conveditor.storage.artifacts import Artifacts


class RegionConversation:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.provider = OpenAIProvider(settings)
        self.storage = Artifacts(settings.data_dir)

    def start(self, request: RegionSessionRequest) -> RegionSessionResponse:
        try:
            image = decode_image(request.image)
            crop_region(image, request.brief.region)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        identifier = uuid4().hex
        self.storage.save(identifier, image, {"kind": "region_conversation", "brief": request.brief.model_dump(), "history": []})
        return RegionSessionResponse(id=identifier)

    async def message(self, identifier: str, request: RegionMessageRequest) -> RegionMessageResponse:
        try:
            image, record = self.storage.load(identifier)
        except FileNotFoundError as exc:
            raise HTTPException(404, "选区对话已不存在，请重新框选。") from exc
        if record.get("kind") != "region_conversation":
            raise HTTPException(422, "需要有效的选区对话。")
        brief = RegionBrief.model_validate(record["brief"])
        crop = crop_region(image, brief.region)
        plan = await self.provider.converse(image, crop, region_context(brief, request.mode), record["history"], request.message)
        candidate = None
        # The explicit user action controls generation, never the model's inference of intent.
        if request.mode == "edit" and plan.edit_instruction and plan.edit_instruction.strip():
            prompt = region_edit_prompt(brief, plan.edit_instruction)
            generated = await self.provider.edit(image, prompt, mask=region_mask(image, brief.region))
            try:
                result = normalize_image(generated)
                result = preserve_outside_region(image, result, brief.region)
            except ValueError as exc:
                raise ProviderError("图像模型返回了无效图片，请重试。") from exc
            candidate_id = uuid4().hex
            candidate = CandidateResponse(
                id=candidate_id, session_id=identifier, image_url=f"/api/artifacts/{candidate_id}.png",
                model=self.settings.image_edit_model, prompt=prompt, prompt_version=REGION_PROMPT_VERSION,
                scope="masked_region",
            )
            self.storage.save(candidate_id, result, candidate.model_dump())
        reply = plan.reply
        if candidate:
            reply += "\n局部候选已生成，请在对比窗口检查后决定是否采纳。"
        record["history"] = [*record["history"], {"role": "user", "content": request.message}, {"role": "assistant", "content": reply}][-20:]
        self.storage.save(identifier, image, record)
        return RegionMessageResponse(reply=reply, candidate=candidate)


def get_region_conversation() -> RegionConversation:
    return RegionConversation(get_settings())
