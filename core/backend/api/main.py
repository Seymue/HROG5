from __future__ import annotations

import os
import asyncio

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from core.backend.db.session import init_db, SessionLocal
from core.backend.services.command_service import CommandService
from core.backend.services.device_pool_init import init_device_pool_from_db
from core.backend.devices.device_pool import DevicePool

from core.backend.repositories.command_history_repo import SqlAlchemyCommandHistoryRepository
from core.backend.repositories.status_snapshot_repo import SqlAlchemyStatusSnapshotRepository
from core.backend.services.status_poller import run_status_poller

from .routers import devices, commands, monitoring


def create_app() -> FastAPI:
    app = FastAPI(
        title="HROG-5 Control API",
        version="0.1.0",
    )

    # Роутеры API
    app.include_router(devices.router, prefix="/devices", tags=["devices"])
    app.include_router(commands.router, prefix="/commands", tags=["commands"])
    app.include_router(monitoring.router, prefix="/monitoring", tags=["monitoring"])

    # ---- Пути к фронтенду: core/frontend ----
    current_dir = os.path.dirname(os.path.abspath(__file__))              # core/backend/api
    project_root = os.path.abspath(os.path.join(current_dir, "..", "..")) # core
    frontend_dir = os.path.join(project_root, "frontend")                 # core/frontend

    templates_dir = os.path.join(frontend_dir, "templates")
    static_dir = os.path.join(frontend_dir, "static")

    templates: Jinja2Templates | None = None

    # 1) Если есть шаблоны — включаем Jinja2 + статику
    if os.path.isdir(templates_dir):
        templates = Jinja2Templates(directory=templates_dir)

        if os.path.isdir(static_dir):
            app.mount(
                "/static",
                StaticFiles(directory=static_dir),
                name="static",
            )

        @app.get("/", include_in_schema=False)
        def root_redirect():
            return RedirectResponse(url="/ui")

        @app.get("/ui", response_class=HTMLResponse, include_in_schema=False)
        def ui_page(request: Request):
            return templates.TemplateResponse(
                "pages/control_panel.html",
                {"request": request},
            )

        @app.get("/ui/monitor", response_class=HTMLResponse, include_in_schema=False)
        def ui_monitor_page(request: Request):
            return templates.TemplateResponse(
                "pages/monitoring.html",
                {"request": request},
            )

    # 2) Иначе — старый режим: раздача index.html как статического файла
    elif os.path.isdir(frontend_dir):
        app.mount(
            "/ui",
            StaticFiles(directory=frontend_dir, html=True),
            name="ui",
        )

    # Глобальное состояние приложения
    app.state.device_pool = None
    app.state.command_service = None

    app.state.status_snapshot_repo = None
    app.state.status_poller_stop = None
    app.state.status_poller_task = None

    @app.on_event("startup")
    async def on_startup() -> None:
        init_db()

        with SessionLocal() as session:
            device_pool: DevicePool = init_device_pool_from_db(session)

        # репозитории, которые сами открывают сессии
        cmd_repo = SqlAlchemyCommandHistoryRepository(SessionLocal)
        status_repo = SqlAlchemyStatusSnapshotRepository(SessionLocal)

        app.state.device_pool = device_pool
        app.state.status_snapshot_repo = status_repo

        app.state.command_service = CommandService(
            device_pool=device_pool,
            command_repo=cmd_repo,
        )

        # фоновый поллер статуса (каждые 5 минут)
        app.state.status_poller_stop = asyncio.Event()
        app.state.status_poller_task = asyncio.create_task(
            run_status_poller(app, interval_sec=300)
        )

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        stop = getattr(app.state, "status_poller_stop", None)
        task = getattr(app.state, "status_poller_task", None)

        if stop is not None:
            stop.set()

        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    return app


app = create_app()
