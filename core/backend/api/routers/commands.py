# core/backend/api/routers/commands.py

from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from core.backend.services.command_service import CommandService

router = APIRouter()


class CommandRequest(BaseModel):
    device_id: UUID
    command_code: str
    params: Dict[str, Any] | None = None
    user_id: Optional[str] = None


class CommandResponse(BaseModel):
    success: bool
    status: str
    data: Dict[str, Any] | None
    duration_ms: int


def _get_command_service(request: Request) -> CommandService:
    svc = getattr(request.app.state, "command_service", None)
    if svc is None:
        # это значит, что startup ещё не отработал или что-то не инициализировалось
        raise HTTPException(status_code=500, detail="CommandService is not initialized")
    return svc


@router.post("/execute", response_model=CommandResponse)
def execute_command(request: Request, body: CommandRequest) -> CommandResponse:
    """
    Выполнить команду над устройством HROG-5 через CommandService.

    Пример тела запроса:
    {
      "device_id": "uuid...",
      "command_code": "GET_STATUS",
      "params": null,
      "user_id": "user-123"
    }
    """
    svc = _get_command_service(request)

    result = svc.execute_command(
        device_id=str(body.device_id),
        user_id=body.user_id,
        command_code=body.command_code,
        params=body.params,
    )

    return CommandResponse(
        success=result.success,
        status=result.status,
        data=result.data,
        duration_ms=result.duration_ms,
    )
