from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.backend.api.deps import get_db
from core.backend.db.models import CommandHistory, StatusSnapshot

router = APIRouter()


# ---------- Pydantic схемы ----------

class StatusSnapshotOut(BaseModel):
    id: UUID
    device_id: UUID
    source: str
    success: bool
    status: str
    data: dict[str, Any] | None
    collected_at: datetime
    duration_ms: int

    class Config:
        from_attributes = True


class CommandHistoryOut(BaseModel):
    id: UUID
    device_id: UUID
    user_id: str | None
    command_code: str
    params: dict[str, Any] | None
    success: bool
    status: str
    result_data: dict[str, Any] | None
    started_at: datetime
    finished_at: datetime
    duration_ms: int
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- Endpoints ----------

@router.get("/status_snapshots", response_model=List[StatusSnapshotOut])
def list_status_snapshots(
    device_id: UUID = Query(..., description="UUID устройства"),
    limit: int = Query(200, ge=1, le=2000),
    source: Optional[str] = Query(None, description="poller/manual/etc"),
    db: Session = Depends(get_db),
) -> list[StatusSnapshot]:
    """
    Вернуть последние N снимков статуса по устройству (из таблицы status_snapshots).
    """
    q = (
        db.query(StatusSnapshot)
        .filter(StatusSnapshot.device_id == device_id)
        .order_by(StatusSnapshot.collected_at.desc())
    )
    if source:
        q = q.filter(StatusSnapshot.source == source)

    return list(q.limit(limit).all())


@router.get("/command_history", response_model=List[CommandHistoryOut])
def list_command_history(
    device_id: UUID = Query(..., description="UUID устройства"),
    limit: int = Query(200, ge=1, le=2000),
    db: Session = Depends(get_db),
) -> list[CommandHistory]:
    """
    Вернуть последние N записей истории команд (write/action команды).
    """
    q = (
        db.query(CommandHistory)
        .filter(CommandHistory.device_id == device_id)
        .order_by(CommandHistory.created_at.desc())
        .limit(limit)
    )
    return list(q.all())
