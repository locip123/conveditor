from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Region(Contract):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def within_canvas(self):
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("选区必须在画布内")
        return self


class Brief(Contract):
    stage: Literal["sketch", "lineart", "color"]
    goal: str = Field(min_length=1, max_length=1500)
    preserve: str = Field(default="保持角色身份、构图与个人画风", max_length=1500)
    region: Region | None = None


class EvaluationRequest(Contract):
    image: str = Field(max_length=16_000_000)
    brief: Brief


class Suggestion(Contract):
    id: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=100)
    priority: Literal["high", "medium", "low"]
    observation: str = Field(min_length=1, max_length=1000)
    action: str = Field(min_length=1, max_length=1000)
    reason: str = Field(min_length=1, max_length=1000)
    region: Region | None


class Critique(Contract):
    summary: str = Field(min_length=1, max_length=2000)
    strengths: list[str] = Field(max_length=5)
    suggestions: list[Suggestion] = Field(max_length=5)

    @field_validator("suggestions")
    @classmethod
    def unique_ids(cls, suggestions):
        if len({item.id for item in suggestions}) != len(suggestions):
            raise ValueError("建议 ID 必须唯一")
        return suggestions


class EvaluationResponse(Critique):
    id: str
    model: str
    prompt_version: str


class EditRequest(Contract):
    evaluation_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    suggestion_ids: list[str] = Field(min_length=1, max_length=5)
    instruction: str = Field(default="", max_length=1500)


class CandidateResponse(Contract):
    id: str
    evaluation_id: str | None = None
    session_id: str | None = None
    image_url: str
    model: str
    prompt: str
    prompt_version: str
    scope: Literal["instruction", "masked_region"]


class RegionBrief(Brief):
    region: Region


class RegionSessionRequest(EvaluationRequest):
    brief: RegionBrief


class RegionSessionResponse(Contract):
    id: str


class RegionMessageRequest(Contract):
    message: str = Field(min_length=1, max_length=2000)
    mode: Literal["chat", "edit"] = "chat"


class RegionReply(Contract):
    reply: str = Field(min_length=1, max_length=4000)
    edit_instruction: str | None = Field(max_length=4000)


class RegionMessageResponse(Contract):
    reply: str
    candidate: CandidateResponse | None = None
