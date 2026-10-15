"""FastAPI 应用入口，组装 API 路由。"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from conveditor.api.routes.health import router as health_router
from conveditor.api.routes.evaluation import router as evaluation_router
from conveditor.api.routes.editing import router as editing_router
from conveditor.api.routes.region import router as region_router
from conveditor.providers.openai import ProviderError
from conveditor.config import ROOT

app = FastAPI(title="Conveditor API")
app.include_router(health_router, prefix="/api")
app.include_router(evaluation_router, prefix="/api")
app.include_router(editing_router, prefix="/api")
app.include_router(region_router, prefix="/api")

if (ROOT / "frontend" / "dist").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "frontend" / "dist", html=True), name="frontend")


@app.exception_handler(ProviderError)
async def provider_error(request: Request, exc: ProviderError):
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "输入格式不正确，请检查目标、画稿及选区。", "fields": [".".join(str(part) for part in error["loc"]) for error in exc.errors()]})
