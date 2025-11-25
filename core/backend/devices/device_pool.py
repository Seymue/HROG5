"""
device_pool.py

Менеджер нескольких устройств (HROG-5 через MOXA).
Хранит все подключения и предоставляет удобный доступ
к каждому устройству по его ID.
"""

from typing import Dict, Optional
from moxa_client import MoxaClient
from hrog_client import Hrog5Client


class DeviceEntry:
    """
    Контейнер одного устройства:
    - конфигурация
    - MoxaClient (TCP)
    - Hrog5Client (команды)
    - состояние (online/offline)
    """

    def __init__(self, device_id: str, host: str, port: int):
        self.device_id = device_id
        self.host = host
        self.port = port

        self.moxa = MoxaClient(host=host, port=port, timeout=1.0)
        self.hrog = Hrog5Client(self.moxa)

        self.online = False

    def connect(self) -> bool:
        """Подключиться к устройству."""
        try:
            self.moxa.connect()
            self.online = True
            return True
        except Exception as e:
            print(f"[DeviceEntry] Ошибка подключения к {self.device_id}: {e}")
            self.online = False
            return False

    def disconnect(self):
        """Отключить устройство."""
        self.moxa.close()
        self.online = False

    def ensure_connected(self) -> bool:
        """Если соединение разорвано — переподключиться."""
        if self.online:
            return True
        return self.connect()


class DevicePool:
    """
    Менеджер всех устройств.
    Позволяет:
    - регистрировать устройства;
    - получать доступ к клиентам;
    - следить за состоянием;
    - переподключаться при обрыве.
    """

    def __init__(self):
        self._devices: Dict[str, DeviceEntry] = {}

    # ---------- Управление устройствами ----------

    def add_device(self, device_id: str, host: str, port: int) -> bool:
        if device_id in self._devices:
            print(f"[DevicePool] Устройство '{device_id}' уже существует.")
            return False

        entry = DeviceEntry(device_id, host, port)
        ok = entry.connect()
        self._devices[device_id] = entry

        print(f"[DevicePool] Добавлено устройство: {device_id}, online={ok}")
        return ok

    def remove_device(self, device_id: str):
        entry = self._devices.get(device_id)
        if not entry:
            return
        entry.disconnect()
        del self._devices[device_id]
        print(f"[DevicePool] Устройство удалено: {device_id}")

    def list_devices(self):
        """Вернуть статус всех устройств."""
        return {
            device_id: {
                "host": entry.host,
                "port": entry.port,
                "online": entry.online
            }
            for device_id, entry in self._devices.items()
        }

    # ---------- Получение клиентов ----------

    def get_entry(self, device_id: str) -> Optional[DeviceEntry]:
        return self._devices.get(device_id)

    def get_hrog(self, device_id: str) -> Optional[Hrog5Client]:
        entry = self.get_entry(device_id)
        if not entry:
            print(f"[DevicePool] Нет устройства '{device_id}'")
            return None
        if not entry.ensure_connected():
            print(f"[DevicePool] Не удалось переподключиться к '{device_id}'")
            return None
        return entry.hrog

    def get_moxa(self, device_id: str) -> Optional[MoxaClient]:
        entry = self.get_entry(device_id)
        if not entry:
            return None
        if not entry.ensure_connected():
            return None
        return entry.moxa
