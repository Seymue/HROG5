# core/backend/db/models.py

import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Boolean, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Device(Base):
    """
    ORM-модель таблицы устройств HROG-5 / MOXA-каналов.

    Связь с остальным кодом:
      - Device.id (UUID) -> device_id в DevicePool / CommandService
      - moxa_host, moxa_port -> параметры для MoxaClient
    """
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,   # генерируется на стороне приложения
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
        doc="Человеко-читаемое имя устройства (для UI).",
    )

    description: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        doc="Описание: место установки, комментарии и т.п.",
    )

    moxa_host: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        doc="IP-адрес MOXA, например 192.168.1.141.",
    )

    moxa_port: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=4001,
        doc="TCP-порт MOXA, например 4002 или 4001.",
    )

    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
        doc="Признак логической активации устройства в системе.",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        doc="Время создания записи.",
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        doc="Время последнего обновления записи.",
    )
