"""
device_pool.py

Простейший пул устройств HROG-5.

Задача:
- держать в памяти соответствие device_id -> Hrog5Client
- давать по device_id готовый клиент
"""

from typing import Dict

from .hrog_client import Hrog5Client


class DeviceNotFoundError(Exception):
    pass


class DevicePool:
    """
    Пока что простой in-memory пул.
    В реальном приложении можно:
      - поднимать клиентов на основе данных из БД (IP, порт MOXA)
      - следить за состоянием подключений и переподключениями
    """

    def __init__(self) -> None:
        self._devices: Dict[str, Hrog5Client] = {}

    def register_device(self, device_id: str, client: Hrog5Client) -> None:
        """
        Зарегистрировать (или перерегистрировать) устройство в пуле.
        device_id — логический ID (может быть UUID из БД).
        """
        self._devices[device_id] = client

    def unregister_device(self, device_id: str) -> None:
        """
        Убрать устройство из пула.
        Если устройства нет — бросает DeviceNotFoundError.
        """
        try:
            del self._devices[device_id]
        except KeyError:
            raise DeviceNotFoundError(f"Устройство {device_id!r} не найдено в пуле")

    def get_client(self, device_id: str) -> Hrog5Client:
        """
        Получить Hrog5Client по ID устройства.
        """
        try:
            return self._devices[device_id]
        except KeyError:
            raise DeviceNotFoundError(f"Устройство {device_id!r} не найдено в пуле")

    def list_device_ids(self) -> list[str]:
        """
        Вернуть список зарегистрированных ID устройств.
        """
        return list(self._devices.keys())
