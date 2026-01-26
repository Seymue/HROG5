# core/backend/repositories/command_history_repo.py

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import sessionmaker

from core.backend.db.models import CommandHistory


class SqlAlchemyCommandHistoryRepository:
    """
    Репозиторий "записать выполнение команды" (открывает свою сессию сам).
    Подходит для использования из app.state / фоновых задач.
    """

    def __init__(self, session_factory: sessionmaker) -> None:
        self._Session = session_factory

    def save_execution(
        self,
        *,
        device_id: str,
        user_id: Optional[str],
        command_code: str,
        params: Dict[str, Any] | None,
        success: bool,
        status: str,
        result_data: Dict[str, Any] | None,
        started_at: datetime,
        finished_at: datetime,
        duration_ms: int,
    ) -> None:
        dev_uuid = uuid.UUID(device_id)

        row = CommandHistory(
            device_id=dev_uuid,
            user_id=user_id,
            command_code=command_code,
            params=params,
            success=success,
            status=status,
            result_data=result_data,
            started_at=started_at,
            finished_at=finished_at,
            duration_ms=duration_ms,
        )

        with self._Session() as session:
            session.add(row)
            session.commit()
