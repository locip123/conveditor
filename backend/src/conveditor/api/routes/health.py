"""用于验证服务启动的健康检查。"""

from fastapi import APIRouter
from conveditor.config import get_settings

router = APIRouter()


@router.get("/health", tags=["health"])
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "configured": bool(settings.openai_api_key.get_secret_value()),
        "evaluation_model": settings.evaluation_model,
        "image_edit_model": settings.image_edit_model,
    }
