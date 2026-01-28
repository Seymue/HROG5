"""
moxa_client.py

Модуль для работы с MOXA (RS-232 <-> Ethernet).
Реализует подключение по TCP, отправку/приём байт и авто-переподключение.

+ Добавлен встроенный "sniffer" (TX/RX логирование).
  Включается через env: HROG_SNIFF=1
"""

from __future__ import annotations

import os
import socket
import sys
import time
from datetime import datetime
from typing import Optional


class MoxaConnectionError(Exception):
    """Ошибка уровня подключения к MOXA / сокету."""
    pass


def _env_flag(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "y", "on")


def _fmt_bytes(data: bytes, max_len: int = 200) -> str:
    """
    Удобный вывод:
    - ASCII-часть (с видимыми \r \n)
    - HEX (обрезка до max_len)
    """
    if data is None:
        return "<None>"

    shown = data[:max_len]
    ascii_part = shown.decode("ascii", errors="replace")
    ascii_part = ascii_part.replace("\r", "\\r").replace("\n", "\\n")

    hex_part = " ".join(f"{b:02X}" for b in shown)
    suffix = ""
    if len(data) > max_len:
        suffix = f" …(+{len(data) - max_len} bytes)"

    return f'ASCII="{ascii_part}" | HEX={hex_part}{suffix} | LEN={len(data)}'


class MoxaClient:
    """
    Клиент для общения с MOXA-адаптером по TCP.

    По сути — тонкая обёртка над socket, умеющая:
    - устанавливать соединение;
    - переподключаться при обрыве;
    - отправлять сырые байты;
    - читать ответ с тайм-аутом.

    Встроенный sniffer:
      - логирует CONNECT / CLOSE / TX / RX / ERR
      - по умолчанию включается через env HROG_SNIFF=1
    """

    def __init__(
        self,
        host: str,
        port: int,
        timeout: float = 0.3,
        reconnect_delay: float = 0.3,
        max_retries: int = 1,
        *,
        sniff: Optional[bool] = None,
        sniff_max_bytes: int = 200,
        sniff_timeouts: bool = False,
    ):
        """
        :param host: IP-адрес MOXA (например, "192.168.0.100")
        :param port: TCP-порт (например, 4001)
        :param timeout: тайм-аут операций чтения/записи (секунды)
        :param reconnect_delay: пауза перед переподключением (секунды)
        :param max_retries: сколько раз пробовать переподключаться при ошибке отправки

        :param sniff: включить лог TX/RX (None -> берём из env HROG_SNIFF)
        :param sniff_max_bytes: сколько байт показывать в логах (остальное режется)
        :param sniff_timeouts: логировать ли "пустые RX" при socket.timeout
        """
        self.host = host
        self.port = port
        self.timeout = timeout
        self.reconnect_delay = reconnect_delay
        self.max_retries = max_retries

        self._sock: Optional[socket.socket] = None

        self._sniff = _env_flag("HROG_SNIFF", False) if sniff is None else sniff
        self._sniff_max_bytes = sniff_max_bytes
        self._sniff_timeouts = sniff_timeouts

    # ---------------- Sniffer ---------------- #

    def _sn(self, event: str, data: Optional[bytes] = None, note: str = "") -> None:
        if not self._sniff:
            return
        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        base = f"[{ts}] {event:<7} {self.host}:{self.port}"
        if note:
            base += f" | {note}"
        if data is not None:
            base += f" | {_fmt_bytes(data, self._sniff_max_bytes)}"
        sys.stdout.write(base + "\n")
        sys.stdout.flush()

    # ---------------- Внутренняя работа с сокетом ---------------- #

    def _create_socket(self) -> socket.socket:
        """Создать настроенный TCP-сокет."""
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        return s

    def connect(self) -> None:
        """Открыть TCP-соединение с MOXA, если ещё не открыто."""
        if self._sock is not None:
            return

        self._sn("CONNECT", note=f"timeout={self.timeout}")
        s = self._create_socket()
        try:
            s.connect((self.host, self.port))
        except OSError as e:
            s.close()
            self._sn("ERR", note=f"connect failed: {e}")
            raise MoxaConnectionError(
                f"Не удалось подключиться к MOXA {self.host}:{self.port}: {e}"
            )
        self._sock = s

    def close(self) -> None:
        """Закрыть соединение."""
        if self._sock is not None:
            self._sn("CLOSE")
            try:
                self._sock.close()
            except OSError:
                pass
            finally:
                self._sock = None

    def _ensure_connected(self) -> None:
        """Убедиться, что соединение открыто, при необходимости подключиться."""
        if self._sock is None:
            self.connect()

    # ---------------- Публичные методы отправки/приёма ---------------- #

    def send_raw(self, data: bytes) -> None:
        """
        Отправить сырые байты в устройство через MOXA.
        При ошибке отправки пытается переподключиться max_retries раз.
        """
        if not isinstance(data, (bytes, bytearray)):
            raise TypeError("send_raw ожидает bytes или bytearray")

        attempt = 0
        last_error: Optional[Exception] = None

        while True:
            attempt += 1
            self._ensure_connected()
            try:
                assert self._sock is not None
                self._sn("TX", data)
                self._sock.sendall(data)
                return
            except (OSError, socket.error) as e:
                last_error = e
                self._sn("ERR", note=f"send failed (attempt {attempt}): {e}")
                self.close()

                if attempt > self.max_retries:
                    raise MoxaConnectionError(
                        f"Не удалось отправить данные на MOXA после {attempt} попыток: {last_error}"
                    )

                time.sleep(self.reconnect_delay)

    def receive_raw(self, max_bytes: int = 4096) -> bytes:
        """
        Прочитать данные из сокета (до max_bytes).
        Блокируется до получения данных или истечения тайм-аута.

        :return: bytes (пустые, если тайм-аут или соединение закрыто)
        """
        self._ensure_connected()
        try:
            assert self._sock is not None
            data = self._sock.recv(max_bytes)

            # b'' обычно означает, что удалённая сторона закрыла соединение
            if data == b"":
                self._sn("RX", data, note="EOF/closed by peer")
                return data

            self._sn("RX", data)
            return data

        except socket.timeout:
            if self._sniff_timeouts:
                self._sn("RX", b"", note="timeout")
            return b""
        except (OSError, socket.error) as e:
            self._sn("ERR", note=f"recv failed: {e}")
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
        """
        self.send_raw(request)

        if not wait_response:
            return b""

        if inter_delay > 0:
            time.sleep(inter_delay)

        return self.receive_raw(max_bytes=max_bytes)

    # -------------- Контекстный менеджер (with ...) -------------- #

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()
