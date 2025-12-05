# core/backend/api/routers/devices.py

from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.backend.api.deps import get_db
from core.backend.db.models import Device
from core.backend.repositories.device_repository import DeviceRepository

router = APIRouter()


class DeviceOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    moxa_host: str
    moxa_port: int
    is_enabled: bool

    class Config:
        orm_mode = True


@router.get("/", response_model=List[DeviceOut])
def list_devices(db: Session = Depends(get_db)) -> list[DeviceOut]:
    """
    Получить список всех устройств (включая выключенные).
    """
    repo = DeviceRepository(db)
    devices = repo.get_all()
    return devices


@router.get("/{device_id}", response_model=DeviceOut)
def get_device(device_id: UUID, db: Session = Depends(get_db)) -> DeviceOut:
    """
    Получить одно устройство по ID.
    """
    repo = DeviceRepository(db)
    dev: Device | None = repo.get_by_id(device_id)
    if dev is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return dev
