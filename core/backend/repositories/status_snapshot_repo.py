# core/backend/repositories/status_snapshot_repo.py

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import sessionmaker

from core.backend.db.models import StatusSnapshot


class SqlAlchemyStatusSnapshotRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._Session = session_factory

    def save_snapshot(
        self,
        *,
        device_id: str,
        data: Optional[Dict[str, Any]],
        success: bool,
        status: str,
        duration_ms: int,
        source: str = "poller",
        collected_at: Optional[datetime] = None,
    ) -> None:
        dev_uuid = uuid.UUID(device_id)

        row = StatusSnapshot(
            device_id=dev_uuid,
            source=source,
            success=success,
            status=status,
            data=data,
            duration_ms=duration_ms,
            collected_at=collected_at or datetime.utcnow(),
        )

        with self._Session() as session:
            session.add(row)
            session.commit()
