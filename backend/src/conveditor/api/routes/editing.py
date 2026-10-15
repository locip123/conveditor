from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import FileResponse

from conveditor.config import get_settings
from conveditor.schemas.workflow import CandidateResponse, EditRequest
from conveditor.services.workflow import Workflow, get_workflow

router = APIRouter()


@router.post("/edits", response_model=CandidateResponse, tags=["workflow"])
async def edit(request: EditRequest, workflow: Workflow = Depends(get_workflow)):
    return await workflow.edit(request)


@router.get("/artifacts/{identifier}.png", tags=["workflow"])
def artifact(identifier: str = Path(pattern=r"^[a-f0-9]{32}$")):
    path = get_settings().data_dir / f"{identifier}.png"
    if not path.is_file():
        raise HTTPException(404, "图片不存在")
    return FileResponse(path, media_type="image/png")
