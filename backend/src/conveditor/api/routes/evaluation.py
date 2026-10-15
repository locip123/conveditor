from fastapi import APIRouter, Depends

from conveditor.schemas.workflow import EvaluationRequest, EvaluationResponse
from conveditor.services.workflow import Workflow, get_workflow

router = APIRouter()


@router.post("/evaluations", response_model=EvaluationResponse, tags=["workflow"])
async def evaluate(request: EvaluationRequest, workflow: Workflow = Depends(get_workflow)):
    return await workflow.evaluate(request)
