# core/backend/api/deps.py

from __future__ import annotations

from typing import Generator

from sqlalchemy.orm import Session

from core.backend.db.session import SessionLocal


def get_db() -> Generator[Session, None, None]:
    """
    Зависимость FastAPI для получения сессии БД.
    На каждом запросе открывает SessionLocal и закрывает её по завершении.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
