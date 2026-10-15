from uuid import uuid4

from fastapi import HTTPException

from conveditor.config import Settings, get_settings
from conveditor.prompts.workflow import PROMPT_VERSION, editing_prompt, evaluation_prompt
from conveditor.providers.openai import OpenAIProvider, ProviderError
from conveditor.schemas.workflow import Brief, CandidateResponse, EditRequest, EvaluationRequest, EvaluationResponse
from conveditor.services.images import decode_image, normalize_image, preserve_outside_region, region_mask
from conveditor.storage.artifacts import Artifacts


class Workflow:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.provider = OpenAIProvider(settings)
        self.storage = Artifacts(settings.data_dir)

    async def evaluate(self, request: EvaluationRequest) -> EvaluationResponse:
        try:
            image = decode_image(request.image)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        prompt = evaluation_prompt(request.brief)
        critique = await self.provider.evaluate(image, prompt)
        result = EvaluationResponse(**critique.model_dump(), id=uuid4().hex, model=self.settings.evaluation_model, prompt_version=PROMPT_VERSION)
        self.storage.save(result.id, image, {"brief": request.brief.model_dump(), "result": result.model_dump(), "prompt": prompt})
        return result

    async def edit(self, request: EditRequest) -> CandidateResponse:
        try:
            image, record = self.storage.load(request.evaluation_id)
        except FileNotFoundError as exc:
            raise HTTPException(404, "评估记录不存在，请重新评估画稿。") from exc
        if "result" not in record:
            raise HTTPException(422, "需要有效的评估记录。")
        result = EvaluationResponse.model_validate(record["result"])
        selected_ids = set(request.suggestion_ids)
        if len(selected_ids) != len(request.suggestion_ids) or not selected_ids.issubset({s.id for s in result.suggestions}):
            raise HTTPException(422, "请选择本次评估中有效且不重复的建议。")
        selected = [s for s in result.suggestions if s.id in selected_ids]
        brief = Brief.model_validate(record["brief"])
        prompt = editing_prompt(brief, selected, request.instruction)
        try:
            mask = region_mask(image, brief.region) if brief.region else None
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        generated = await self.provider.edit(image, prompt, mask=mask)
        try:
            candidate = normalize_image(generated)
            if brief.region:
                candidate = preserve_outside_region(image, candidate, brief.region)
        except ValueError as exc:
            raise ProviderError("图像模型返回了无效图片，请重新生成。") from exc
        identifier = uuid4().hex
        response = CandidateResponse(
            id=identifier, evaluation_id=result.id, image_url=f"/api/artifacts/{identifier}.png",
            model=self.settings.image_edit_model, prompt=prompt, prompt_version=PROMPT_VERSION,
            scope="masked_region" if brief.region else "instruction",
        )
        self.storage.save(identifier, candidate, response.model_dump())
        return response


def get_workflow() -> Workflow:
    return Workflow(get_settings())
