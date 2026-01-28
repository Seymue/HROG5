from __future__ import annotations

from sqlalchemy.orm import Session

from core.backend.db.models import Device
from core.backend.devices.device_pool import DevicePool
from core.backend.devices.moxa_client import MoxaClient
from core.backend.devices.hrog_client import Hrog5Client

def create_hrog_client_for_device(dev: Device) -> Hrog5Client:
    moxa = MoxaClient(
        host=dev.moxa_host,
        port=dev.moxa_port,
        timeout=0.05,
        reconnect_delay=0.05,
        max_retries=1,
        sniff=None,  # None => читаем env HROG_SNIFF
    )
    return Hrog5Client(transport=moxa)


def create_hrog_client_for_device(dev: Device) -> Hrog5Client:
    """
    Создать Hrog5Client для конкретного устройства из БД.

    Здесь фиксируем настройки таймаутов / ретраев для всего приложения.
    Если понадобится — правим только здесь.
    """
    moxa = MoxaClient(
        host=dev.moxa_host,
        port=dev.moxa_port,
        timeout=0.05,
        reconnect_delay=0.05,
        max_retries=1,
    )
    return Hrog5Client(transport=moxa)


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
        hrog_client = create_hrog_client_for_device(dev)
        pool.register_device(device_id=str(dev.id), client=hrog_client)

    return pool
