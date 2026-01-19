# core/backend/api/main.py

from __future__ import annotations

import os

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

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

    # ---- Пути к фронтенду: core/frontend ----
    current_dir = os.path.dirname(os.path.abspath(__file__))           # core/backend/api
    project_root = os.path.abspath(os.path.join(current_dir, "..", ".."))  # core
    frontend_dir = os.path.join(project_root, "frontend")              # core/frontend

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
            # pages/control_panel.html — главный "конструктор"
            return templates.TemplateResponse(
                "pages/control_panel.html",
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

    @app.on_event("startup")
    def on_startup() -> None:
        init_db()
        with SessionLocal() as session:
            device_pool: DevicePool = init_device_pool_from_db(session)

        app.state.device_pool = device_pool
        app.state.command_service = CommandService(
            device_pool=device_pool,
            command_repo=None,
        )

    return app


app = create_app()
