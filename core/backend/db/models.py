# core/backend/db/models.py

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    String,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,
    func,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
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


class CommandHistory(Base):
    """
    История "отправленных" команд (SET/STEP/SYNC/RESET/...).
    Запросы вида TEMP?, FREQ?, GET_STATUS и т.п. сюда НЕ пишем.
    """
    __tablename__ = "command_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    user_id: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    command_code: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    params: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    success: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    status: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        default="",
    )

    result_data: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    finished_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    duration_ms: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )


class StatusSnapshot(Base):
    """
    Периодические (и/или ручные) снимки GET_STATUS.
    """
    __tablename__ = "status_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    source: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="poller",  # poller/manual/etc
    )

    success: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    status: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        default="",
    )

    data: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )

    duration_ms: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
