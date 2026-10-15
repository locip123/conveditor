from fastapi import APIRouter, Depends, Path

from conveditor.schemas.workflow import RegionMessageRequest, RegionMessageResponse, RegionSessionRequest, RegionSessionResponse
from conveditor.services.region import RegionConversation, get_region_conversation

router = APIRouter()


@router.post("/region-sessions", response_model=RegionSessionResponse, tags=["region"])
def start(request: RegionSessionRequest, conversation: RegionConversation = Depends(get_region_conversation)):
    return conversation.start(request)


@router.post("/region-sessions/{identifier}/messages", response_model=RegionMessageResponse, tags=["region"])
async def message(request: RegionMessageRequest, identifier: str = Path(pattern=r"^[a-f0-9]{32}$"), conversation: RegionConversation = Depends(get_region_conversation)):
    return await conversation.message(identifier, request)
