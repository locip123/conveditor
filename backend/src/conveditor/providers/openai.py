import base64
import logging

from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI
from pydantic import ValidationError

from conveditor.config import Settings
from conveditor.prompts.workflow import EVALUATION_SYSTEM
from conveditor.prompts.region import REGION_SYSTEM
from conveditor.schemas.workflow import RegionReply
from conveditor.schemas.workflow import Critique

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class OpenAIProvider:
    def __init__(self, settings: Settings):
        self.settings = settings

    def client(self, *, image_edit: bool = False) -> AsyncOpenAI:
        api_key = (self.settings.image_edit_api_key.get_secret_value() if image_edit else "") or self.settings.openai_api_key.get_secret_value()
        base_url = (self.settings.image_edit_base_url if image_edit else "") or self.settings.openai_base_url
        if not api_key:
            raise ProviderError("尚未配置模型密钥。请在项目根目录 .env 设置 OPENAI_API_KEY，然后重启后端。", 503)
        return AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=self.settings.model_timeout_seconds,
            max_retries=0,
        )

    async def evaluate(self, image: bytes, prompt: str) -> Critique:
        try:
            async with self.client() as client:
                response = await client.responses.parse(
                    model=self.settings.evaluation_model,
                    instructions=EVALUATION_SYSTEM,
                    input=[{"role": "user", "content": [
                        {"type": "input_text", "text": prompt},
                        {"type": "input_image", "image_url": "data:image/png;base64," + base64.b64encode(image).decode(), "detail": "high"},
                    ]}],
                    text_format=Critique,
                    store=False,
                    max_output_tokens=3500,
                )
                if response.status != "completed" or response.output_parsed is None:
                    raise ProviderError("模型未完成评估或拒绝了请求，请调整画稿/目标后重试。")
                return response.output_parsed
        except (APITimeoutError, APIConnectionError, APIStatusError) as exc:
            raise map_error(exc) from exc
        except (ValidationError, ValueError) as exc:
            raise ProviderError("模型评估格式不符合约定，请重新评估。") from exc

    async def converse(self, image: bytes, crop: bytes, context: str, history: list[dict], message: str) -> RegionReply:
        try:
            async with self.client() as client:
                response = await client.responses.parse(
                    model=self.settings.evaluation_model,
                    instructions=REGION_SYSTEM + "\n" + context,
                    input=[
                        {"role": "user", "content": [
                            {"type": "input_text", "text": "完整画稿与选区裁图（按此顺序）"},
                            *[{"type": "input_image", "image_url": "data:image/png;base64," + base64.b64encode(data).decode(), "detail": "high"} for data in (image, crop)],
                        ]},
                        *history[-20:],
                        {"role": "user", "content": message},
                    ],
                    text_format=RegionReply,
                    store=False,
                    max_output_tokens=2500,
                )
                if response.status != "completed" or response.output_parsed is None:
                    raise ProviderError("模型未能完成本轮对话，请调整问题后重试。")
                return response.output_parsed
        except (APITimeoutError, APIConnectionError, APIStatusError) as exc:
            raise map_error(exc) from exc
        except (ValidationError, ValueError) as exc:
            raise ProviderError("模型对话格式不符合约定，请重试。") from exc

    async def edit(self, image: bytes, prompt: str, *, mask: bytes | None = None, size: str = "1024x1024") -> bytes:
        try:
            async with self.client(image_edit=True) as client:
                response = await client.images.edit(
                    model=self.settings.image_edit_model,
                    image=("drawing.png", image, "image/png"),
                    **({"mask": ("mask.png", mask, "image/png")} if mask is not None else {}),
                    prompt=prompt,
                    n=1,
                    size=size,
                    quality="medium",
                    output_format="png",
                    background="opaque",
                )
                if not response.data or not response.data[0].b64_json:
                    raise ProviderError("图像模型没有返回可用图片，请重试。")
                return base64.b64decode(response.data[0].b64_json, validate=True)
        except (APITimeoutError, APIConnectionError, APIStatusError) as exc:
            raise map_error(exc) from exc
        except ValueError as exc:
            raise ProviderError("图像模型返回了无法解码的图片。") from exc


def map_error(exc: Exception) -> ProviderError:
    if isinstance(exc, APITimeoutError):
        return ProviderError("模型请求超时，画稿已保留。重试可能再次计费，请稍后再试。", 504)
    if isinstance(exc, APIConnectionError):
        return ProviderError("无法连接模型服务，请检查网络和模型接口地址。")
    if isinstance(exc, APIStatusError):
        logger.warning("Model API failure: status=%s request_id=%s", exc.status_code, exc.request_id)
        if isinstance(exc.body, dict) and exc.body.get("code") in {"insufficient_user_quota", "insufficient_quota"}:
            return ProviderError("模型服务额度不足，请检查账户余额或配额后重试。", 429)
        if exc.status_code in {401, 403}:
            return ProviderError("模型服务拒绝访问，请检查后端密钥和模型权限。")
        if exc.status_code == 429:
            return ProviderError("模型服务限流或额度不足，请检查账户额度后重试。", 429)
        if exc.status_code in {400, 404, 422}:
            return ProviderError("模型服务未接受请求，请检查模型名称、接口兼容性或调整画稿内容。")
    return ProviderError("模型服务暂时不可用，请稍后重试。")
