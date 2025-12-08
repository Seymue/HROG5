from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.backend.api.deps import get_db
from core.backend.db.models import Device
from core.backend.repositories.device_repository import DeviceRepository
from core.backend.devices.device_pool import DevicePool, DeviceNotFoundError
from core.backend.services.device_pool_init import create_hrog_client_for_device

router = APIRouter()


# ======= Pydantic-схемы =======

class DeviceBase(BaseModel):
    name: str
    description: str | None = None
    moxa_host: str
    moxa_port: int = 4001
    is_enabled: bool = True


class DeviceCreate(DeviceBase):
    pass


class DeviceUpdate(BaseModel):
    # все поля опциональные, чтобы можно было частично обновлять
    name: str | None = None
    description: str | None = None
    moxa_host: str | None = None
    moxa_port: int | None = None
    is_enabled: bool | None = None


class DeviceOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    moxa_host: str
    moxa_port: int
    is_enabled: bool

    class Config:
        from_attributes = True  # pydantic v2


def _get_device_pool_from_app(request: Request) -> DevicePool | None:
    """
    Утилита: достать DevicePool из app.state, если он инициализирован.
    """
    pool = getattr(request.app.state, "device_pool", None)
    if isinstance(pool, DevicePool):
        return pool
    return None


# ======= эндпоинты =======

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


@router.post("/", response_model=DeviceOut, status_code=201)
def create_device(
    request: Request,
    body: DeviceCreate,
    db: Session = Depends(get_db),
) -> DeviceOut:
    """
    Создать новое устройство + зарегистрировать его в DevicePool, если оно включено.
    """
    repo = DeviceRepository(db)
    dev = repo.create(
        name=body.name,
        description=body.description,
        moxa_host=body.moxa_host,
        moxa_port=body.moxa_port,
        is_enabled=body.is_enabled,
    )
    db.commit()
    db.refresh(dev)

    pool = _get_device_pool_from_app(request)
    if pool is not None and dev.is_enabled:
        client = create_hrog_client_for_device(dev)
        pool.register_device(str(dev.id), client)

    return dev


@router.put("/{device_id}", response_model=DeviceOut)
def update_device(
    request: Request,
    device_id: UUID,
    body: DeviceUpdate,
    db: Session = Depends(get_db),
) -> DeviceOut:
    """
    Обновить устройство (полное или частичное обновление)
    и синхронизировать изменения с DevicePool.
    """
    repo = DeviceRepository(db)
    dev: Device | None = repo.get_by_id(device_id)
    if dev is None:
        raise HTTPException(status_code=404, detail="Device not found")

    was_enabled = dev.is_enabled

    repo.update(
        dev,
        name=body.name,
        description=body.description,
        moxa_host=body.moxa_host,
        moxa_port=body.moxa_port,
        is_enabled=body.is_enabled,
    )
    db.commit()
    db.refresh(dev)

    pool = _get_device_pool_from_app(request)
    if pool is not None:
        dev_id_str = str(dev.id)

        # Если устройство стало disabled — убираем из пула
        if not dev.is_enabled:
            try:
                pool.unregister_device(dev_id_str)
            except DeviceNotFoundError:
                pass
        else:
            # Устройство включено (или было и осталось включенным) —
            # пересоздаём клиента и перерегистрируем в пуле.
            client = create_hrog_client_for_device(dev)
            pool.register_device(dev_id_str, client)

    return dev


@router.delete("/{device_id}", status_code=204)
def delete_device(
    request: Request,
    device_id: UUID,
    db: Session = Depends(get_db),
) -> None:
    """
    Удалить устройство из БД и из DevicePool (если оно там есть).
    """
    repo = DeviceRepository(db)
    dev: Device | None = repo.get_by_id(device_id)
    if dev is None:
        raise HTTPException(status_code=404, detail="Device not found")

    dev_id_str = str(dev.id)

    repo.delete(dev)
    db.commit()

    pool = _get_device_pool_from_app(request)
    if pool is not None:
        try:
            pool.unregister_device(dev_id_str)
        except DeviceNotFoundError:
            pass
    # 204 No Content — тело ответа пустое
