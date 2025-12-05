# core/backend/services/device_pool_init.py

from __future__ import annotations

from sqlalchemy.orm import Session

from core.backend.db.models import Device
from core.backend.devices.device_pool import DevicePool
from core.backend.devices.moxa_client import MoxaClient
from core.backend.devices.hrog_client import Hrog5Client


def init_device_pool_from_db(session: Session) -> DevicePool:
    """
    Инициализирует DevicePool на основе таблицы devices.

    Алгоритм:
      - выбираем все устройства, у которых is_enabled = true;
      - для каждого создаём MoxaClient и Hrog5Client;
      - регистрируем в пуле под device_id = строковый UUID из БД.

    Если устройств в БД нет — вернёт пустой пул.
    """
    pool = DevicePool()

    devices: list[Device] = (
        session.query(Device)
        .filter(Device.is_enabled.is_(True))
        .order_by(Device.name)
        .all()
    )

    for dev in devices:
        # создаём транспорт к MOXA
        moxa = MoxaClient(
            host=dev.moxa_host,
            port=dev.moxa_port,
            timeout=2.0,
            reconnect_delay=1.0,
            max_retries=1,
        )
        # клиент протокола HROG-5
        hrog_client = Hrog5Client(transport=moxa)

        # регистрируем в пуле
        pool.register_device(device_id=str(dev.id), client=hrog_client)

    return pool
