"""
moxa_client.py

Модуль для работы с MOXA (RS-232 <-> Ethernet).
Реализует подключение по TCP, отправку/приём байт и авто-переподключение.

Использование (минимальный пример):

    from moxa_client import MoxaClient

    moxa = MoxaClient(host="192.168.0.100", port=4001)
    moxa.connect()

    try:
        # отправляем какие-то байты и читаем ответ
        request = b"*IDN?\r\n"   # пример, реальная команда зависит от протокола HROG-5
        response = moxa.send_and_receive(request)
        print("Ответ от устройства:", response)
    finally:
        moxa.close()
"""

import socket
import time
from typing import Optional


class MoxaConnectionError(Exception):
    """Ошибка уровня подключения к MOXA / сокету."""
    pass


class MoxaClient:
    """
    Клиент для общения с MOXA-адаптером по TCP.

    По сути — тонкая обёртка над socket, умеющая:
    - устанавливать соединение;
    - переподключаться при обрыве;
    - отправлять сырые байты;
    - читать ответ с тайм-аутом.

    ВАЖНО:
        Этот класс ничего не знает о протоколе HROG-5.
        Он просто гоняет байты туда-обратно.
        Протокол лучше реализовать в отдельном модуле (hrog_client.py),
        который будет использовать MoxaClient как "транспорт".
    """

    def __init__(
        self,
        host: str,
        port: int,
        timeout: float = 2.0,
        reconnect_delay: float = 1.0,
        max_retries: int = 1,
    ):
        """
        :param host: IP-адрес MOXA (например, "192.168.0.100")
        :param port: TCP-порт (например, 4001)
        :param timeout: тайм-аут операций чтения/записи (секунды)
        :param reconnect_delay: пауза перед переподключением (секунды)
        :param max_retries: сколько раз пробовать переподключаться при ошибке отправки
        """
        self.host = host
        self.port = port
        self.timeout = timeout
        self.reconnect_delay = reconnect_delay
        self.max_retries = max_retries

        self._sock: Optional[socket.socket] = None

    # ---------------- Внутренняя работа с сокетом ---------------- #

    def _create_socket(self) -> socket.socket:
        """Создать настроенный TCP-сокет."""
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        return s

    def connect(self):
        """Открыть TCP-соединение с MOXA, если ещё не открыто."""
        if self._sock is not None:
            # уже подключены
            return

        s = self._create_socket()
        try:
            s.connect((self.host, self.port))
        except OSError as e:
            s.close()
            raise MoxaConnectionError(
                f"Не удалось подключиться к MOXA {self.host}:{self.port}: {e}"
            )
        self._sock = s
        print(f"[MOXA] Подключено к {self.host}:{self.port}")

    def close(self):
        """Закрыть соединение."""
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            finally:
                self._sock = None
                print("[MOXA] Соединение закрыто")

    def _ensure_connected(self):
        """Убедиться, что соединение открыто, при необходимости подключиться."""
        if self._sock is None:
            self.connect()

    # ---------------- Публичные методы отправки/приёма ---------------- #

    def send_raw(self, data: bytes):
        """
        Отправить сырые байты в устройство через MOXA.

        Не ждёт ответа, просто записывает в сокет.
        При ошибке отправки пытается переподключиться max_retries раз.
        """
        if not isinstance(data, (bytes, bytearray)):
            raise TypeError("send_raw ожидает bytes или bytearray")

        attempt = 0
        while True:
            attempt += 1
            self._ensure_connected()
            try:
                assert self._sock is not None
                self._sock.sendall(data)
                # если дошли до сюда — успех
                return
            except (OSError, socket.error) as e:
                print(f"[MOXA] Ошибка отправки данных: {e}")
                self.close()

                if attempt > self.max_retries:
                    raise MoxaConnectionError(
                        f"Не удалось отправить данные на MOXA после {attempt} попыток"
                    )

                print(f"[MOXA] Пытаемся переподключиться (попытка {attempt})...")
                time.sleep(self.reconnect_delay)
                # в следующем цикле _ensure_connected() сделает connect()

    def receive_raw(self, max_bytes: int = 4096) -> bytes:
        """
        Прочитать данные из сокета (до max_bytes).
        Блокируется до получения данных или истечения тайм-аута.

        :return: bytes (пустые, если тайм-аут)
        """
        self._ensure_connected()
        try:
            assert self._sock is not None
            data = self._sock.recv(max_bytes)
            # Если data == b'', это обычно значит закрытое соединение со стороны сервера
            if data == b"":
                print("[MOXA] Получен пустой ответ (возможно, соединение закрыто)")
            return data
        except socket.timeout:
            # нет данных, это не обязательно ошибка
            return b""
        except (OSError, socket.error) as e:
            self.close()
            raise MoxaConnectionError(f"Ошибка при чтении данных из MOXA: {e}")

    def send_and_receive(
        self,
        request: bytes,
        wait_response: bool = True,
        max_bytes: int = 4096,
        inter_delay: float = 0.05,
    ) -> bytes:
        """
        Типичный сценарий: отправили -> немного подождали -> прочитали.

        :param request: байты команды
        :param wait_response: если False — только отправка, без чтения
        :param max_bytes: максимум байт для чтения
        :param inter_delay: пауза (сек), прежде чем читать ответ
        :return: полученные байты (или b'' если не ждём ответ / тайм-аут)
        """
        self.send_raw(request)

        if not wait_response:
            return b""

        # даём устройству немного времени "подумать"
        if inter_delay > 0:
            time.sleep(inter_delay)

        return self.receive_raw(max_bytes=max_bytes)

    # -------------- Контекстный менеджер (with ...) -------------- #

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()
