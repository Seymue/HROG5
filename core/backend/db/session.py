# core/backend/db/session.py

from __future__ import annotations

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .base import Base

DATABASE_URL = os.getenv(
    "DATABASE_URL",
)

engine = create_engine(
    DATABASE_URL,
    echo=False,
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    future=True,
)


def init_db() -> None:
    """
    Создать все таблицы в БД на основе ORM-моделей.
    """
    # важно: чтобы Base "узнал" про все модели (Device, CommandExecution и т.д.)
    from core.backend.db import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
