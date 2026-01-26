# core/backend/services/status_poller.py

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

from fastapi import FastAPI

from core.backend.devices.device_pool import DevicePool
from core.backend.repositories.status_snapshot_repo import SqlAlchemyStatusSnapshotRepository


async def run_status_poller(app: FastAPI, interval_sec: int = 300) -> None:
    stop: asyncio.Event = app.state.status_poller_stop
    pool: DevicePool = app.state.device_pool
    repo: SqlAlchemyStatusSnapshotRepository = app.state.status_snapshot_repo

    while not stop.is_set():
        device_ids = pool.list_device_ids()

        for device_id in device_ids:
            t0 = time.perf_counter()
            collected_at = datetime.now(timezone.utc)

            try:
                client = pool.get_client(device_id)
                data = client.get_basic_status()
                success = True
                status = "ok"
            except Exception as e:
                data = None
                success = False
                status = f"error: {e}"

            duration_ms = int((time.perf_counter() - t0) * 1000)

            repo.save_snapshot(
                device_id=device_id,
                data=data,
                success=success,
                status=status,
                duration_ms=duration_ms,
                source="poller",
                collected_at=collected_at,
            )

        # сон с возможностью мгновенно остановиться
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_sec)
        except asyncio.TimeoutError:
            pass
