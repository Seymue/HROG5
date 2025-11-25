"""
hrog_client.py

Высокоуровневый клиент генератора HROG-5.
Работает поверх MoxaClient (tcp -> MOXA -> RS-232).

Реализованы все команды из раздела "ASCII Command Set" руководства:
BAUD / BAUD?, DATE / DATE?, FFOF / FFOF?, FREQ / FREQ?,
HELP, LOCL, PHAS / PHAS?, PPSW / PPSW?, PLL?,
SFFOF / SFFOF?, SFREQ / SFREQ?, SPHAS / SPHAS?,
STOFFS / STOFFS?, SYNC / SYNC?, TEMP?, TIME / TIME?,
TOFFS / TOFFS?, *RPHS, *SRE, *CLS.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, time as dtime
from typing import Optional, Dict, Any, Tuple

from moxa_client import MoxaClient


# --------- Вспомогательные структуры для некоторых команд ---------


@dataclass
class PpsWidth:
    index: int           # код 0..7
    width_us: float      # ширина импульса в микросекундах


@dataclass
class PllStatus:
    osc_dbm: float       # мощность внутреннего генератора, dBm
    ref_dbm: float       # мощность внешнего опорника, dBm
    lock_v: float        # напряжение детектора захвата, V
    pll_v: float         # управляющее напряжение, V
    raw: str             # сырая строка ответа


@dataclass
class SyncResult:
    ok: bool             # True - успешно, False - timeout/ошибка
    code: int            # 0 или 1
    message: str         # "OK" или "TIMEOUT" / другое


@dataclass
class StatusRegister:
    raw: int             # целое значение регистра
    ext_ref_error: bool
    int_osc_error: bool
    pll_lock_error: bool
    tuning_voltage_error: bool
    invalid_parameter: bool
    invalid_command: bool
    reserved1: bool
    reserved2: bool


# ------------------------------------------------------------------


class Hrog5Client:
    """
    Клиент HROG-5:
    - формирует ASCII-команды (ВСЕ из каталога);
    - отправляет их через MoxaClient;
    - парсит ответы в удобные Python-типы.
    """

    def __init__(self, transport: MoxaClient):
        self.t = transport

    # ------------------ базовые утилиты ------------------ #

    def _drain_input(self, idle_timeout: float = 0.1, max_bytes: int = 4096) -> None:
        """
        Вычитать всё, что осталось в сокете, пока нет новых данных idle_timeout секунд.
        Нужно, чтобы хвост предыдущих ответов не мешал следующим командам.
        """
        end_time = time.time() + idle_timeout
        while True:
            chunk = self.t.receive_raw(max_bytes=max_bytes)
            if chunk:
                end_time = time.time() + idle_timeout
            else:
                if time.time() > end_time:
                    break

    def _query(self, cmd: bytes, idle_timeout: float = 0.3, max_bytes: int = 4096) -> str:
        """
        Отправить команду и собрать ВСЁ, что пришло по сокету,
        пока линия не замолчит на idle_timeout секунд.

        Возвращает последнюю непустую строку ответа.
        (обычно вида 'TEMP? 32.8C', 'FREQ? 0.001 Hz', 'SRE 16' и т.п.)
        """
        self._drain_input()
        self.t.send_raw(cmd)

        data = b""
        end_time = time.time() + idle_timeout

        while True:
            chunk = self.t.receive_raw(max_bytes=max_bytes)
            if chunk:
                data += chunk
                end_time = time.time() + idle_timeout
            else:
                if time.time() > end_time:
                    break

        return self._clean_response(data)

    @staticmethod
    def _clean_response(resp: bytes) -> str:
        """
        Перевод байтов в строку + уборка \r\n + разбивка по строкам.
        Берём последнюю непустую строку.
        """
        if not resp:
            return ""
        text = resp.decode(errors="replace")
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        return lines[-1] if lines else ""

    @staticmethod
    def _value_from_pair(text: str) -> Optional[str]:
        """
        'TEMP? 32.8C'  -> '32.8C'
        'BAUD? 9600'   -> '9600'
        """
        parts = text.split()
        if len(parts) < 2:
            return None
        return parts[1]

    # ------------------ BAUD / BAUD? ------------------ #

    def set_baud(self, baud: int) -> None:
        """
        BAUD [baud]
        Допустимые значения: 9600, 14400, 19200, 28800, 38400, 57600, 115200.
        """
        allowed = {9600, 14400, 19200, 28800, 38400, 57600, 115200}
        if baud not in allowed:
            raise ValueError(f"Недопустимый baudrate: {baud}")
        cmd = f"BAUD {baud}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_baud(self) -> Optional[int]:
        """
        BAUD? -> 'BAUD? 9600'
        """
        line = self._query(b"BAUD?\r")
        val = self._value_from_pair(line)
        try:
            return int(val) if val is not None else None
        except ValueError:
            return None

    # ------------------ DATE / DATE? ------------------ #

    def set_date(self, dt: date) -> None:
        """
        DATE [mo/day/year]
        """
        cmd = f"DATE {dt.month:02d}/{dt.day:02d}/{dt.year:04d}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_date(self) -> Optional[date]:
        """
        DATE? -> 'DATE? 02/02/2001'
        """
        line = self._query(b"DATE?\r")
        val = self._value_from_pair(line)
        if not val:
            return None
        try:
            mo_s, d_s, y_s = val.split("/")
            return date(int(y_s), int(mo_s), int(d_s))
        except Exception:
            return None

    # ------------------ TIME / TIME? ------------------ #

    def set_time(self, tm: dtime) -> None:
        """
        TIME [hr:min:sec]
        """
        cmd = f"TIME {tm.hour:02d}:{tm.minute:02d}:{tm.second:02d}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_time(self) -> Optional[dtime]:
        """
        TIME? -> 'TIME? 12:01:31'
        """
        line = self._query(b"TIME?\r")
        val = self._value_from_pair(line)
        if not val:
            return None
        try:
            h_s, m_s, s_s = val.split(":")
            return dtime(int(h_s), int(m_s), int(s_s))
        except Exception:
            return None

    # ------------------ FFOF / FFOF? ------------------ #

    def set_ffof(self, frac_freq: float) -> None:
        """
        FFOF [frac_freq]
        диапазон 0 .. 2.0E-7, шаг 1.0E-18 (по мануалу).
        """
        cmd = f"FFOF {frac_freq:.12E}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_ffof(self) -> Optional[float]:
        """
        FFOF? -> 'FFOF? 2.0E-10'
        """
        line = self._query(b"FFOF?\r")
        val = self._value_from_pair(line)
        if not val:
            return None
        try:
            return float(val)
        except ValueError:
            return None

    # ------------------ FREQ / FREQ? ------------------ #

    def set_freq(self, hz: float) -> None:
        """
        FREQ [freq]  (0 .. 1.0 Hz)
        """
        cmd = f"FREQ {hz:.12f}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_freq(self) -> Optional[float]:
        """
        FREQ? -> 'FREQ? 0.001 Hz'
        """
        line = self._query(b"FREQ?\r")
        val = self._value_from_pair(line)
        if not val:
            return None
        # может быть "0.001" или "0.001 Hz"
        val = val.replace("Hz", "").strip()
        try:
            return float(val)
        except ValueError:
            return None

    # ------------------ HELP ------------------ #

    def get_help(self) -> str:
        """
        HELP -> возвращает текст справки по ASCII-командам.
        Мы возвращаем всё, что пришло, одной строкой (с переводами строк).
        """
        self._drain_input()
        self.t.send_raw(b"HELP\r")
        # читаем чуть подольше
        data = b""
        end_time = time.time() + 0.5
        while True:
            chunk = self.t.receive_raw()
            if chunk:
                data += chunk
                end_time = time.time() + 0.5
            else:
                if time.time() > end_time:
                    break
        return data.decode(errors="replace")

    # ------------------ LOCL ------------------ #

    def local_control(self) -> None:
        """
        LOCL — возврат в локальное управление (отключение RS-232).
        """
        self.t.send_raw(b"LOCL\r")

    # ------------------ PHAS / PHAS? ------------------ #

    def set_phase(self, degrees: float) -> None:
        """
        PHAS [phase]  (в градусах)
        """
        cmd = f"PHAS {degrees:.12f}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_phase(self) -> Optional[float]:
        """
        PHAS? -> 'PHAS? 360 deg'
        """
        line = self._query(b"PHAS?\r")
        val = self._value_from_pair(line)
        if not val:
            return None
        val = val.replace("deg", "").strip()
        try:
            return float(val)
        except ValueError:
            return None

    # ------------------ PPSW / PPSW? ------------------ #

    PPS_WIDTHS_US = {
        0: 0.8,
        1: 3.2,
        2: 12.8,
        3: 51.2,
        4: 102.4,
        5: 204.8,
        6: 409.6,
        7: 819.2,
    }

    def set_ppsw(self, pwidth_index: int) -> None:
        """
        PPSW [pwidth] — установка ширины 1PPS (индекс 0..7).
        """
        if pwidth_index not in self.PPS_WIDTHS_US:
            raise ValueError(f"Недопустимый индекс PPSW: {pwidth_index}")
        cmd = f"PPSW {pwidth_index}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_ppsw(self) -> Optional[PpsWidth]:
        """
        PPSW? -> 'PPSW? 4 102.4 uS'
        """
        line = self._query(b"PPSW?\r")
        # ожидаем минимум 3 токена: PPSW?, idx, width
        parts = line.split()
        if len(parts) < 3:
            return None
        try:
            idx = int(parts[1])
        except ValueError:
            return None
        width = self.PPS_WIDTHS_US.get(idx)
        if width is None:
            # попытаемся вытащить из текста
            try:
                width = float(parts[2])
            except ValueError:
                width = 0.0
        return PpsWidth(index=idx, width_us=width)

    # ------------------ PLL? ------------------ #

    def get_pll(self) -> Optional[PllStatus]:
        """
        PLL? -> 'PLL? Osc: 12.0dBm Ref: 15.0dBm Lock: 0.3V PLL: -0.2V'
        Парсим четыре величины.
        """
        line = self._query(b"PLL?\r")
        if not line:
            return None
        try:
            # грубый парсинг по ключевым словам
            # разбиваем на токены, ищем после 'Osc:', 'Ref:', 'Lock:', 'PLL:'
            tokens = line.replace(",", " ").split()
            def after(label: str) -> str:
                if label in tokens:
                    i = tokens.index(label)
                    if i + 1 < len(tokens):
                        return tokens[i + 1]
                return "0"

            osc_s = after("Osc:")
            ref_s = after("Ref:")
            lock_s = after("Lock:")
            pll_s = after("PLL:")

            def num(x: str) -> float:
                return float(x.replace("dBm", "").replace("V", ""))

            osc = num(osc_s)
            ref = num(ref_s)
            lock = num(lock_s)
            pll = num(pll_s)
            return PllStatus(osc_dbm=osc, ref_dbm=ref, lock_v=lock, pll_v=pll, raw=line)
        except Exception:
            return PllStatus(osc_dbm=0.0, ref_dbm=0.0, lock_v=0.0, pll_v=0.0, raw=line)

    # ------------------ SFFOF / SFFOF? ------------------ #

    def step_ffof(self, ffstep: float) -> None:
        """
        SFFOF [ffstep] — сделать шаг по frac_freq.
        """
        cmd = f"SFFOF {ffstep:.12E}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_last_ffof_step(self) -> Optional[float]:
        """
        SFFOF? -> 'SFFOF? 1.0E-14'
        """
        line = self._query(b"SFFOF?\r")
        val = self._value_from_pair(line)
        if not val:
            return None
        try:
            return float(val)
        except ValueError:
            return None

    # ------------------ SFREQ / SFREQ? ------------------ #

    def step_freq(self, fstep: float) -> None:
        """
        SFREQ [fstep] — сделать шаг по частоте (Hz).
        """
        cmd = f"SFREQ {fstep:.12f}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_last_freq_step(self) -> Optional[float]:
        """
        SFREQ? -> 'SFREQ? 0.001 Hz'
        """
        line = self._query(b"SFREQ?\r")
        val = self._value_from_pair(line)
        if not val:
            return None
        val = val.replace("Hz", "").strip()
        try:
            return float(val)
        except ValueError:
            return None

    # ------------------ SPHAS / SPHAS? ------------------ #

    def step_phase(self, pstep_deg: float) -> None:
        """
        SPHAS [pstep] — сделать фазовый шаг (deg).
        """
        cmd = f"SPHAS {pstep_deg:.12f}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_last_phase_step(self) -> Optional[float]:
        """
        SPHAS? -> 'SPHAS? 10 deg'
        """
        line = self._query(b"SPHAS?\r")
        val = self._value_from_pair(line)
        if not val:
            return None
        val = val.replace("deg", "").strip()
        try:
            return float(val)
        except ValueError:
            return None

    # ------------------ STOFFS / STOFFS? ------------------ #

    def step_time_offset(self, tstep_ns: float) -> None:
        """
        STOFFS [tstep] — сделать шаг по временному сдвигу (ns).
        """
        cmd = f"STOFFS {tstep_ns:.6f}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_last_time_step(self) -> Optional[float]:
        """
        STOFFS? -> 'STOFFS? 10.0 ns'
        """
        line = self._query(b"STOFFS?\r")
        val = self._value_from_pair(line)
        if not val:
            return None
        val = val.replace("ns", "").strip()
        try:
            return float(val)
        except ValueError:
            return None

    # ------------------ SYNC / SYNC? ------------------ #

    def sync(self) -> None:
        """
        SYNC — запустить синхронизацию 1PPS с внешним 1PPS.
        (результат потом читаем SYNC?)
        """
        self.t.send_raw(b"SYNC\r")

    def get_sync_result(self) -> Optional[SyncResult]:
        """
        SYNC? -> 'SYNC? 1 OK' или 'SYNC? 0 TIMEOUT'
        """
        line = self._query(b"SYNC?\r")
        parts = line.split()
        if len(parts) < 3:
            return None
        try:
            code = int(parts[1])
        except ValueError:
            return None
        msg = parts[2]
        return SyncResult(ok=(code == 1), code=code, message=msg)

    # ------------------ TEMP? ------------------ #

    def get_temp(self) -> Optional[float]:
        """
        TEMP? -> 'TEMP? 40.1C'
        """
        line = self._query(b"TEMP?\r")
        val = self._value_from_pair(line)
        if not val:
            return None
        if val.endswith("C"):
            val = val[:-1]
        try:
            return float(val)
        except ValueError:
            return None

    # ------------------ TOFFS / TOFFS? ------------------ #

    def set_time_offset(self, toffset_ns: float) -> None:
        """
        TOFFS [toffset] — абсолютный временной сдвиг (ns).
        """
        cmd = f"TOFFS {toffset_ns:.6f}\r".encode("ascii")
        self.t.send_raw(cmd)

    def get_time_offset(self) -> Optional[float]:
        """
        TOFFS? -> 'TOFFS? 100.0ns'
        """
        line = self._query(b"TOFFS?\r")
        val = self._value_from_pair(line)
        if not val:
            return None
        val = val.replace("ns", "").strip()
        try:
            return float(val)
        except ValueError:
            return None

    # ------------------ *RPHS ------------------ #

    def reset_phase_counter(self) -> None:
        """
        *RPHS — сброс счётчиков фазы и временного смещения в 0.
        На выходной сигнал не влияет.
        """
        self.t.send_raw(b"*RPHS\r")

    # ------------------ *SRE / *CLS ------------------ #

    def get_status_register(self) -> Optional[StatusRegister]:
        """
        *SRE -> 'SRE 16'
        8-битовый регистр ошибок, см. руководство.
        """
        line = self._query(b"*SRE\r")
        parts = line.split()
        if len(parts) < 2:
            return None
        try:
            value = int(parts[1])
        except ValueError:
            return None

        def bit(mask: int) -> bool:
            return bool(value & mask)

        return StatusRegister(
            raw=value,
            ext_ref_error=bit(0x01),
            int_osc_error=bit(0x02),
            pll_lock_error=bit(0x04),
            tuning_voltage_error=bit(0x08),
            invalid_parameter=bit(0x10),
            invalid_command=bit(0x20),
            reserved1=bit(0x40),
            reserved2=bit(0x80),
        )

    def clear_status_register(self) -> None:
        """
        *CLS — очистка регистра статуса и гашение STATUS LED.
        """
        self.t.send_raw(b"*CLS\r")

    # ------------------ Сводный статус ------------------ #

    def get_basic_status(self) -> Dict[str, Any]:
        """
        Упрощённый статус, пригодный для быстрого мониторинга.
        """
        pll = self.get_pll()
        sre = self.get_status_register()

        return {
            "baud": self.get_baud(),
            "temperature": self.get_temp(),
            "freq": self.get_freq(),
            "phase": self.get_phase(),
            "ffof": self.get_ffof(),
            "time_offset_ns": self.get_time_offset(),
            "pll": pll.__dict__ if pll else None,
            "status_register": sre.__dict__ if sre else None,
        }
