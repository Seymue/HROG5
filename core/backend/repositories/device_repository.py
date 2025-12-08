# core/backend/repositories/device_repository.py

from __future__ import annotations

from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from core.backend.db.models import Device


class DeviceRepository:
    """
    Репозиторий для работы с таблицей устройств (Device).

    Абстрагирует доступ к БД:
      - список устройств
      - поиск по id
      - создание / обновление / удаление
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    # ---- чтение ----

    def get_all(self) -> list[Device]:
        return list(self._session.query(Device).order_by(Device.name).all())

    def get_all_enabled(self) -> list[Device]:
        return (
            self._session
            .query(Device)
            .filter(Device.is_enabled.is_(True))
            .order_by(Device.name)
            .all()
        )

    def get_by_id(self, device_id: UUID) -> Optional[Device]:
        return self._session.get(Device, device_id)

    # ---- запись ----

    def add(self, device: Device) -> Device:
        """
        Добавить уже созданный объект Device в сессию.
        Commit снаружи.
        """
        self._session.add(device)
        return device

    def create(
        self,
        *,
        name: str,
        moxa_host: str,
        moxa_port: int = 4001,
        description: str | None = None,
        is_enabled: bool = True,
    ) -> Device:
        """
        Удобный метод для создания девайса "с нуля".
        Commit снаружи.
        """
        dev = Device(
            name=name,
            description=description,
            moxa_host=moxa_host,
            moxa_port=moxa_port,
            is_enabled=is_enabled,
        )
        self._session.add(dev)
        return dev

    def delete(self, device: Device) -> None:
        self._session.delete(device)

    # ---- утилита для массового создания ----

    def create_many(self, devices: Iterable[Device]) -> None:
        """
        Добавить сразу несколько Device объектов.
        """
        for dev in devices:
            self._session.add(dev)

    def update(
            self,
            device: Device,
            *,
            name: str | None = None,
            moxa_host: str | None = None,
            moxa_port: int | None = None,
            description: str | None = None,
            is_enabled: bool | None = None,
    ) -> Device:
        """
        Обновить поля существующего устройства.
        Commit делается снаружи.
        """
        if name is not None:
            device.name = name
        if moxa_host is not None:
            device.moxa_host = moxa_host
        if moxa_port is not None:
            device.moxa_port = moxa_port
        if description is not None:
            device.description = description
        if is_enabled is not None:
            device.is_enabled = is_enabled
        return device