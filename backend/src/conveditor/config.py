from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    openai_api_key: SecretStr = SecretStr("")
    openai_base_url: str = "https://api.openai.com/v1"
    image_edit_api_key: SecretStr = SecretStr("")
    image_edit_base_url: str = ""
    evaluation_model: str = "gpt-4.1-mini"
    image_edit_model: str = "gpt-image-2"
    model_timeout_seconds: float = Field(default=180, ge=10, le=600)
    data_dir: Path = ROOT / "data"


@lru_cache
def get_settings() -> Settings:
    return Settings()
