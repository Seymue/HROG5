# core/backend/services/command_service.py

"""
command_service.py

Сервис для выполнения команд над генераторами HROG-5.

Главная идея:
  - снаружи вызываем метод execute_command(...)
  - внутри:
      * находим нужное устройство по device_id
      * вызываем соответствующий метод Hrog5Client
      * (опционально) логируем выполнение в БД

Этот слой:
  UI / API  <---> CommandService  <---> DevicePool + Hrog5Client
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional, Protocol, Dict

from core.backend.devices.device_pool import DevicePool, DeviceNotFoundError
from core.backend.devices.hrog_client import Hrog5Client


# ---------- Протокол репозитория (интерфейс для БД) ----------

class CommandRepository(Protocol):
    """
    Интерфейс репозитория команд.
    Реальная реализация будет работать с PostgreSQL.
    """

    def save_execution(
        self,
        *,
        device_id: str,
        user_id: Optional[str],
        command_code: str,
        params: Dict[str, Any] | None,
        success: bool,
        status: str,
        result_data: Dict[str, Any] | None,
        started_at: datetime,
        finished_at: datetime,
        duration_ms: int,
    ) -> None:
        ...


# ---------- Результат выполнения команды ----------

@dataclass
class CommandExecutionResult:
    success: bool
    status: str
    data: Optional[Dict[str, Any]]
    started_at: datetime
    finished_at: datetime

    @property
    def duration_ms(self) -> int:
        return int((self.finished_at - self.started_at).total_seconds() * 1000)


# ---------- Сам сервис ----------

class CommandService:
    """
    Основной сервис для выполнения команд.

    Примеры command_code:
        "GET_STATUS"
        "TEMP?"
        "FREQ?"
        "SET_FREQ"
        "SET_PHASE"
        "SET_FFOF"
        "GET_PLL"
        ...
    """

    _READ_COMMANDS = {
        "GET_STATUS",
        "TEMP?",
        "FREQ?",
        "PHAS?",
        "FFOF?",
        "PLL?",
        "TIME?",
        "DATE?",
        "PPSW?",
        "SRE?",
    }

    def __init__(
        self,
        device_pool: DevicePool,
        command_repo: Optional[CommandRepository] = None,
    ) -> None:
        self._pool = device_pool
        self._repo = command_repo

    @staticmethod
    def _utcnow() -> datetime:
        return datetime.now(timezone.utc)

    @classmethod
    def _should_log_command(cls, command_code: str) -> bool:
        """
        Логируем только "отправляемые" команды.
        Любые запросы (?...), а также GET_STATUS — НЕ логируем в историю команд.
        """
        cmd = (command_code or "").strip().upper()
        if not cmd:
            return False
        if cmd in cls._READ_COMMANDS:
            return False
        if cmd.endswith("?"):
            return False
        return True

    # ---- публичный метод, который дергает UI / API ----

    def execute_command(
        self,
        *,
        device_id: str,
        user_id: Optional[str],
        command_code: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> CommandExecutionResult:
        """
        Выполнить команду над конкретным устройством.
        """
        params = params or {}
        started = self._utcnow()

        try:
            client = self._pool.get_client(device_id)
        except DeviceNotFoundError as e:
            finished = self._utcnow()
            result = CommandExecutionResult(
                success=False,
                status=str(e),
                data=None,
                started_at=started,
                finished_at=finished,
            )
            self._save_if_needed(
                device_id=device_id,
                user_id=user_id,
                command_code=command_code,
                params=params,
                result=result,
            )
            return result

        try:
            data = self._run_command(client, command_code, params)
            status = "ok"
            success = True
        except Exception as e:
            data = None
            status = f"error: {e}"
            success = False

        finished = self._utcnow()
        result = CommandExecutionResult(
            success=success,
            status=status,
            data=data,
            started_at=started,
            finished_at=finished,
        )

        self._save_if_needed(
            device_id=device_id,
            user_id=user_id,
            command_code=command_code,
            params=params,
            result=result,
        )

        return result

    # ---- маршрутизация команд (внутри сервиса) ----

    def _run_command(
        self,
        client: Hrog5Client,
        command_code: str,
        params: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Здесь мы мапим "логические" команды на конкретные вызовы Hrog5Client.
        """

        cmd = command_code.upper()

        # --- базовые чтения ---
        if cmd == "GET_STATUS":
            return client.get_basic_status()

        if cmd == "TEMP?":
            return {"temperature": client.get_temp()}

        if cmd == "FREQ?":
            return {"freq": client.get_freq()}

        if cmd == "PHAS?":
            return {"phase": client.get_phase()}

        if cmd == "FFOF?":
            return {"ffof": client.get_ffof()}

        if cmd == "PLL?":
            pll = client.get_pll()
            return {"pll": pll.__dict__ if pll else None}

        if cmd == "TIME?":
            return {"time": client.get_time()}

        if cmd == "DATE?":
            return {"date": client.get_date()}

        if cmd == "PPSW?":
            p = client.get_ppsw()
            return {"ppsw": p.__dict__ if p else None}

        if cmd == "SRE?":
            sre = client.get_status_register()
            return {"status_register": sre.__dict__ if sre else None}

        # --- команды установки ---

        if cmd == "SET_FREQ":
            freq = float(params["freq_hz"])
            client.set_freq(freq)
            return {"freq": client.get_freq()}

        if cmd == "SET_PHASE":
            phase = float(params["phase_deg"])
            client.set_phase(phase)
            return {"phase": client.get_phase()}

        if cmd == "SET_FFOF":
            ff = float(params["ffof"])
            client.set_ffof(ff)
            return {"ffof": client.get_ffof()}

        if cmd == "SET_TIME_OFFSET":
            offs = float(params["toffset_ns"])
            client.set_time_offset(offs)
            return {"time_offset_ns": client.get_time_offset()}

        if cmd == "STEP_FREQ":
            step = float(params["step_hz"])
            client.step_freq(step)
            return {"last_freq_step": client.get_last_freq_step()}

        if cmd == "STEP_PHASE":
            step = float(params["step_deg"])
            client.step_phase(step)
            return {"last_phase_step": client.get_last_phase_step()}

        if cmd == "STEP_TIME_OFFSET":
            step = float(params["step_ns"])
            client.step_time_offset(step)
            return {"last_time_step": client.get_last_time_step()}

        if cmd == "SET_PPS_WIDTH":
            idx = int(params["pwidth_index"])
            client.set_ppsw(idx)
            p = client.get_ppsw()
            return {"ppsw": p.__dict__ if p else None}

        if cmd == "SYNC":
            client.sync()
            res = client.get_sync_result()
            return {"sync": res.__dict__ if res else None}

        if cmd == "RESET_PHASE_COUNTER":
            client.reset_phase_counter()
            return {"reset_phase_counter": True}

        if cmd == "CLEAR_STATUS":
            client.clear_status_register()
            sre = client.get_status_register()
            return {"status_register": sre.__dict__ if sre else None}

        raise ValueError(f"Неизвестная команда: {command_code!r}")

    # ---- запись в репозиторий ----

    def _save_if_needed(
        self,
        *,
        device_id: str,
        user_id: Optional[str],
        command_code: str,
        params: Dict[str, Any],
        result: CommandExecutionResult,
    ) -> None:
        if self._repo is None:
            return

        # ВАЖНО: пишем только "write/action" команды
        if not self._should_log_command(command_code):
            return

        self._repo.save_execution(
            device_id=device_id,
            user_id=user_id,
            command_code=command_code,
            params=params,
            success=result.success,
            status=result.status,
            result_data=result.data,
            started_at=result.started_at,
            finished_at=result.finished_at,
            duration_ms=result.duration_ms,
        )
