# core/backend/api/main.py

from __future__ import annotations

import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from core.backend.db.session import init_db, SessionLocal
from core.backend.services.command_service import CommandService
from core.backend.services.device_pool_init import init_device_pool_from_db
from core.backend.devices.device_pool import DevicePool

from .routers import devices, commands


def create_app() -> FastAPI:
    app = FastAPI(
        title="HROG-5 Control API",
        version="0.1.0",
    )

    # Роутеры API
    app.include_router(devices.router, prefix="/devices", tags=["devices"])
    app.include_router(commands.router, prefix="/commands", tags=["commands"])

    # ---- Статический фронтенд ----
    # Находим путь к директории core/frontend относительно этого файла
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(current_dir, "..", ".."))
    frontend_dir = os.path.join(project_root, "frontend")

    if os.path.isdir(frontend_dir):
        # /ui -> core/frontend/index.html
        app.mount(
            "/ui",
            StaticFiles(directory=frontend_dir, html=True),
            name="ui",
        )

    # Глобальное состояние приложения (пул устройств + сервис команд)
    app.state.device_pool = None
    app.state.command_service = None

    @app.on_event("startup")
    def on_startup() -> None:
        """
        При запуске приложения:
          - создаём таблицы (если ещё не созданы);
          - инициализируем DevicePool из БД;
          - создаём CommandService.
        """
        init_db()

        with SessionLocal() as session:
            device_pool: DevicePool = init_device_pool_from_db(session)

        app.state.device_pool = device_pool
        app.state.command_service = CommandService(
            device_pool=device_pool,
            command_repo=None,  # репозиторий команд добавим позже
        )

    return app


app = create_app()
