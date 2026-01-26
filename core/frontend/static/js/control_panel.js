/* global fetch */

const API = {
  devices: "/devices/",
  execute: "/commands/execute",
};

let devices = [];
let selectedId = null;
let lastPollOkById = new Map();   // device_id -> boolean
let errorsCount = 0;

// device modal state
let deviceModalMode = "create";   // "create" | "edit"
let deviceModalId = null;

const el = (id) => document.getElementById(id);

function nowTimeStr() {
  const d = new Date();
  return d.toLocaleTimeString("ru-RU", { hour12: false });
}
function nowDateStr() {
  const d = new Date();
  return d.toLocaleDateString("ru-RU", { year: "numeric", month: "long", day: "2-digit" });
}

function setConn(ok, text) {
  const dot = el("conn-dot");
  const t = el("conn-text");
  dot.classList.remove("ok", "bad");
  if (ok === true) dot.classList.add("ok");
  if (ok === false) dot.classList.add("bad");
  t.textContent = text;
}

function setEnabledUI(enabled) {
  // quick buttons
  el("btn-sync").disabled = !enabled;
  el("btn-reset-phase").disabled = !enabled;
  el("btn-clear-status").disabled = !enabled;

  // inputs
  el("freq-input").disabled = !enabled;
  el("phase-input").disabled = !enabled;
  el("toffs-input").disabled = !enabled;

  // plus/minus
  el("freq-minus").disabled = !enabled;
  el("freq-plus").disabled = !enabled;
  el("phase-minus").disabled = !enabled;
  el("phase-plus").disabled = !enabled;
  el("toffs-minus").disabled = !enabled;
  el("toffs-plus").disabled = !enabled;

  // chips
  document.querySelectorAll(".chip").forEach((b) => (b.disabled = !enabled));
  el("btn-refresh").disabled = !enabled;
}

function setDeviceActionsEnabled() {
  const hasSel = !!selectedId;
  el("btn-device-edit").disabled = !hasSel;
  el("btn-device-delete").disabled = !hasSel;
}

async function apiGetJson(url) {
  const resp = await fetch(url, { method: "GET" });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  return json;
}

async function apiSendJson(method, url, body) {
  const resp = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : null,
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  return json;
}

async function apiDelete(method, url) {
  const resp = await fetch(url, { method });
  if (!resp.ok) {
    const json = await resp.json().catch(() => ({}));
    throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  }
}

async function runCommand(command_code, params = null) {
  if (!selectedId) throw new Error("Устройство не выбрано");

  const body = {
    device_id: selectedId,
    command_code,
    params,
    user_id: null,
  };

  const resp = await fetch(API.execute, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  }
  return json; // CommandResponse
}

function renderDevices() {
  const list = el("devices-list");
  list.innerHTML = "";

  devices.forEach((d) => {
    const item = document.createElement("div");
    item.className = "device-item";
    if (d.id === selectedId) item.classList.add("selected");

    const enabled = !!d.is_enabled;
    const dot = document.createElement("div");
    dot.className = "dot";
    if (!enabled) dot.classList.add("off");
    else {
      const polled = lastPollOkById.get(d.id);
      if (polled === false) dot.classList.add("bad");
      else dot.classList.add("ok");
    }

    const left = document.createElement("div");
    left.className = "device-left";

    const textWrap = document.createElement("div");
    textWrap.style.minWidth = "0";

    const name = document.createElement("div");
    name.className = "device-name";
    name.textContent = d.name;

    const sub = document.createElement("div");
    sub.className = "device-sub";
    sub.textContent = `${d.moxa_host}:${d.moxa_port}${enabled ? "" : " • disabled"}`;

    textWrap.appendChild(name);
    textWrap.appendChild(sub);

    left.appendChild(dot);
    left.appendChild(textWrap);

    const meta = document.createElement("div");
    meta.className = "device-meta";
    meta.innerHTML = `<div class="mono" style="font-weight:800;">${enabled ? "ON" : "OFF"}</div>
                      <div class="device-sub">${enabled ? "готово" : "выкл."}</div>`;

    item.appendChild(left);
    item.appendChild(meta);

    item.addEventListener("click", () => selectDevice(d.id));

    list.appendChild(item);
  });

  el("devices-subtitle").textContent = `Всего: ${devices.length}`;
  el("sys-count").textContent = `Устройств: ${devices.length}`;
  el("sys-errors").textContent = `Ошибок: ${errorsCount}`;

  setDeviceActionsEnabled();
}

function setDevicePill() {
  const pill = el("device-pill");
  const hint = el("selected-device-hint");

  if (!selectedId) {
    pill.textContent = "Нет устройства";
    hint.textContent = "Не выбрано";
    return;
  }
  const dev = devices.find((x) => x.id === selectedId);
  if (!dev) return;

  pill.textContent = dev.name;
  hint.textContent = dev.name;
}

function setLastCommand(label, payload) {
  el("last-command-label").textContent = label;
  el("result-log").textContent = payload;
}

function clearStatusView() {
  el("st-temp").textContent = "—";
  el("st-freq").textContent = "—";
  el("st-phase").textContent = "—";
  el("st-ffof").textContent = "—";
  el("st-toffs").textContent = "—";

  el("st-sre-badge").textContent = "—";
  el("sre-ext").textContent = "—";
  el("sre-int").textContent = "—";
  el("sre-pll").textContent = "—";
  el("sre-tune").textContent = "—";
  el("sre-param").textContent = "—";
  el("sre-cmd").textContent = "—";

  el("status-updated").textContent = "Нет данных";
  el("last-duration").textContent = "—";

  el("freq-input").value = "";
  el("phase-input").value = "";
  el("toffs-input").value = "";

  el("pll-badge").textContent = "—";
  el("pll-osc").textContent = "—";
  el("pll-ref").textContent = "—";
  el("pll-lock").textContent = "—";
  el("pll-tune").textContent = "—";
}

function formatMaybe(v, suffix = "") {
  if (v === null || v === undefined) return "—";
  return `${v}${suffix}`;
}

function flagText(v) {
  if (v === null || v === undefined) return "—";
  return v ? "Ошибка" : "OK";
}

function updateStatusUI(data, durationMs) {
  el("st-temp").textContent = formatMaybe(data.temperature, " °C");
  el("st-freq").textContent = formatMaybe(data.freq, " Hz");
  el("st-phase").textContent = formatMaybe(data.phase, " °");
  el("st-ffof").textContent = formatMaybe(data.ffof, "");
  el("st-toffs").textContent = formatMaybe(data.time_offset_ns, " ns");

  // also fill big inputs
  if (data.freq !== null && data.freq !== undefined) el("freq-input").value = data.freq;
  if (data.phase !== null && data.phase !== undefined) el("phase-input").value = data.phase;
  if (data.time_offset_ns !== null && data.time_offset_ns !== undefined) el("toffs-input").value = data.time_offset_ns;

  const sre = data.status_register || {};
  const pll = data.pll || null;
  const anyErr = !!(
    sre.ext_ref_error || sre.int_osc_error || sre.pll_lock_error ||
    sre.tuning_voltage_error || sre.invalid_parameter || sre.invalid_command
  );

  el("st-sre-badge").textContent = anyErr ? "Есть ошибки" : "OK";
  el("sre-ext").textContent = flagText(sre.ext_ref_error);
  el("sre-int").textContent = flagText(sre.int_osc_error);
  el("sre-pll").textContent = flagText(sre.pll_lock_error);
  el("sre-tune").textContent = flagText(sre.tuning_voltage_error);
  el("sre-param").textContent = flagText(sre.invalid_parameter);
  el("sre-cmd").textContent = flagText(sre.invalid_command);

  el("status-updated").textContent = `Обновлено: ${nowTimeStr()}`;
  el("last-duration").textContent = durationMs ? `${durationMs} ms` : "—";

  if (!pll) {
    el("pll-badge").textContent = "нет данных";
    el("pll-osc").textContent = "—";
    el("pll-ref").textContent = "—";
    el("pll-lock").textContent = "—";
    el("pll-tune").textContent = "—";
  } else {
    el("pll-badge").textContent = "OK";
    el("pll-osc").textContent = (pll.osc_dbm ?? "—") + (pll.osc_dbm != null ? " dBm" : "");
    el("pll-ref").textContent = (pll.ref_dbm ?? "—") + (pll.ref_dbm != null ? " dBm" : "");
    el("pll-lock").textContent = (pll.lock_v ?? "—") + (pll.lock_v != null ? " V" : "");
    el("pll-tune").textContent = (pll.pll_v ?? "—") + (pll.pll_v != null ? " V" : "");
  }
}

async function refreshStatus() {
  if (!selectedId) return;

  const dev = devices.find((x) => x.id === selectedId);
  if (!dev) return;

  if (!dev.is_enabled) {
    setConn(false, "Устройство выключено (disabled).");
    clearStatusView();
    lastPollOkById.set(selectedId, false);
    renderDevices();
    return;
  }

  el("btn-refresh").disabled = true;
  setConn(null, "Обновление статуса…");

  try {
    const res = await runCommand("GET_STATUS", null);
    lastPollOkById.set(selectedId, true);

    updateStatusUI(res.data || {}, res.duration_ms);
    setLastCommand(`GET_STATUS • ${nowTimeStr()}`, JSON.stringify(res, null, 2));

    setConn(true, "Связь OK. Статус обновлён.");
  } catch (e) {
    lastPollOkById.set(selectedId, false);
    errorsCount += 1;
    el("sys-errors").textContent = `Ошибок: ${errorsCount}`;

    setLastCommand(`GET_STATUS • ошибка • ${nowTimeStr()}`, String(e));
    setConn(false, `Ошибка обновления статуса: ${e}`);
  } finally {
    el("btn-refresh").disabled = false;
    renderDevices();
  }
}

async function selectDevice(id) {
  selectedId = id;
  setDevicePill();
  renderDevices();

  const dev = devices.find((x) => x.id === selectedId);
  if (!dev) return;

  if (!dev.is_enabled) {
    setEnabledUI(false);
    clearStatusView();
    setConn(false, "Выбрано disabled устройство. Включи его в /devices.");
    return;
  }

  setEnabledUI(true);
  setConn(null, `Выбрано: ${dev.name}. Нажми «Обновить статус» или R.`);
  await refreshStatus();
}

function parseNumberInput(id) {
  const raw = el(id).value;
  const num = Number(raw);
  if (!Number.isFinite(num)) throw new Error("Некорректное число");
  return num;
}

async function doSet(type) {
  if (!selectedId) return;
  if (type === "freq") {
    const v = parseNumberInput("freq-input");
    const res = await runCommand("SET_FREQ", { freq_hz: v });
    setLastCommand(`SET_FREQ • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
    await refreshStatus();
  } else if (type === "phase") {
    const v = parseNumberInput("phase-input");
    const res = await runCommand("SET_PHASE", { phase_deg: v });
    setLastCommand(`SET_PHASE • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
    await refreshStatus();
  } else if (type === "toffs") {
    const v = parseNumberInput("toffs-input");
    const res = await runCommand("SET_TIME_OFFSET", { toffset_ns: v });
    setLastCommand(`SET_TIME_OFFSET • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
    await refreshStatus();
  }
}

async function doStep(type, delta) {
  if (!selectedId) return;
  if (type === "freq") {
    const res = await runCommand("STEP_FREQ", { step_hz: Number(delta) });
    setLastCommand(`STEP_FREQ (${delta}) • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
    await refreshStatus();
  } else if (type === "phase") {
    const res = await runCommand("STEP_PHASE", { step_deg: Number(delta) });
    setLastCommand(`STEP_PHASE (${delta}) • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
    await refreshStatus();
  } else if (type === "toffs") {
    const res = await runCommand("STEP_TIME_OFFSET", { step_ns: Number(delta) });
    setLastCommand(`STEP_TIME_OFFSET (${delta}) • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
    await refreshStatus();
  }
}

/* -------------------- Help modal -------------------- */

function openHelp(open) {
  const bd = el("help-backdrop");
  if (open) bd.hidden = false;
  else bd.hidden = true;
}

/* -------------------- Device modal (CRUD) -------------------- */

function openDeviceModal(open) {
  const bd = el("device-backdrop");
  bd.hidden = !open;
  if (open) {
    el("device-form-error").style.display = "none";
    el("device-form-error").textContent = "";
  }
}

function fillDeviceForm(dev) {
  el("dev-name").value = dev?.name ?? "";
  el("dev-desc").value = dev?.description ?? "";
  el("dev-host").value = dev?.moxa_host ?? "";
  el("dev-port").value = dev?.moxa_port ?? 4001;
  el("dev-enabled").checked = dev?.is_enabled ?? true;

  const meta = el("device-form-meta");
  if (dev?.id) {
    meta.style.display = "";
    meta.textContent = `ID: ${dev.id}`;
  } else {
    meta.style.display = "none";
    meta.textContent = "";
  }
}

function setDeviceModalMode(mode, dev) {
  deviceModalMode = mode;
  deviceModalId = dev?.id ?? null;

  if (mode === "create") {
    el("device-modal-title").textContent = "Добавить устройство";
    el("device-modal-sub").textContent = "Создание записи + регистрация в DevicePool (если enabled)";
    fillDeviceForm(null);
  } else {
    el("device-modal-title").textContent = "Изменить устройство";
    el("device-modal-sub").textContent = "Обновление записи + перерегистрация в DevicePool";
    fillDeviceForm(dev);
  }

  openDeviceModal(true);
  setTimeout(() => el("dev-name").focus(), 0);
}

function getDeviceFormPayload() {
  const name = el("dev-name").value.trim();
  const description = el("dev-desc").value.trim();
  const host = el("dev-host").value.trim();
  const port = Number(el("dev-port").value);
  const enabled = !!el("dev-enabled").checked;

  if (!name) throw new Error("Имя устройства обязательно");
  if (!host) throw new Error("MOXA host обязателен");
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error("Некорректный MOXA port");

  return {
    name,
    description: description ? description : null,
    moxa_host: host,
    moxa_port: port,
    is_enabled: enabled,
  };
}

function showDeviceFormError(err) {
  const box = el("device-form-error");
  box.style.display = "";
  box.textContent = String(err);
}

async function createDevice(payload) {
  return await apiSendJson("POST", API.devices, payload);
}

async function updateDevice(id, payload) {
  // PUT /devices/{id}
  return await apiSendJson("PUT", `${API.devices}${id}`, payload);
}

async function deleteDevice(id) {
  // DELETE /devices/{id}
  await apiDelete("DELETE", `${API.devices}${id}`);
}

async function reloadDevices(preserveSelection = true) {
  const prevSelected = selectedId;
  devices = await apiGetJson(API.devices);

  // если выбранное исчезло (удалили) — сбрасываем
  if (preserveSelection && prevSelected) {
    const stillThere = devices.some((d) => d.id === prevSelected);
    if (!stillThere) selectedId = null;
  }

  renderDevices();
  setDevicePill();

  if (!selectedId) {
    setEnabledUI(false);
    clearStatusView();
    setConn(null, "Выбери устройство слева.");
  }
}

async function onDeviceAdd() {
  setDeviceModalMode("create", null);
}

async function onDeviceEdit() {
  if (!selectedId) return;
  const dev = devices.find((d) => d.id === selectedId);
  if (!dev) return;
  setDeviceModalMode("edit", dev);
}

async function onDeviceDelete() {
  if (!selectedId) return;
  const dev = devices.find((d) => d.id === selectedId);
  if (!dev) return;

  const ok = window.confirm(`Удалить устройство "${dev.name}"?\n\nЭто удалит запись из БД и уберёт из DevicePool.`);
  if (!ok) return;

  try {
    await deleteDevice(dev.id);
    setLastCommand(`DELETE /devices/${dev.id} • ${nowTimeStr()}`, "Удалено");

    // сброс выбора
    selectedId = null;
    setDevicePill();
    setDeviceActionsEnabled();

    await reloadDevices(false);
  } catch (e) {
    errorsCount += 1;
    renderDevices();
    setLastCommand(`DELETE • ошибка • ${nowTimeStr()}`, String(e));
    setConn(false, `Ошибка удаления: ${e}`);
  }
}

async function onDeviceFormSubmit(e) {
  e.preventDefault();

  try {
    const payload = getDeviceFormPayload();

    if (deviceModalMode === "create") {
      const created = await createDevice(payload);
      openDeviceModal(false);

      setLastCommand(`POST /devices • ${nowTimeStr()}`, JSON.stringify(created, null, 2));

      // обновляем список и выбираем созданное
      await reloadDevices(false);
      selectedId = created.id;
      setDevicePill();
      renderDevices();
      await selectDevice(created.id);
    } else {
      if (!deviceModalId) throw new Error("Нет ID для обновления");
      const updated = await updateDevice(deviceModalId, payload);
      openDeviceModal(false);

      setLastCommand(`PUT /devices/${deviceModalId} • ${nowTimeStr()}`, JSON.stringify(updated, null, 2));

      // обновляем список и остаёмся на том же устройстве
      await reloadDevices(true);
      if (selectedId) await selectDevice(selectedId);
    }
  } catch (err) {
    showDeviceFormError(err);
  }
}

/* -------------------- Wiring -------------------- */

function wireUI() {
  // system time
  el("sys-date").textContent = nowDateStr();
  setInterval(() => (el("sys-time").textContent = nowTimeStr()), 250);
  el("sys-time").textContent = nowTimeStr();

  // topbar
  el("btn-refresh").addEventListener("click", refreshStatus);
  el("btn-help").addEventListener("click", () => openHelp(true));

  // help modal
  el("btn-help-close").addEventListener("click", () => openHelp(false));
  el("btn-help-ok").addEventListener("click", () => openHelp(false));
  el("help-backdrop").addEventListener("click", (e) => {
    if (e.target === el("help-backdrop")) openHelp(false);
  });

  // device CRUD buttons
  el("btn-device-add").addEventListener("click", onDeviceAdd);
  el("btn-device-edit").addEventListener("click", onDeviceEdit);
  el("btn-device-delete").addEventListener("click", onDeviceDelete);

  // device modal close
  el("btn-device-close").addEventListener("click", () => openDeviceModal(false));
  el("btn-device-cancel").addEventListener("click", () => openDeviceModal(false));
  el("device-backdrop").addEventListener("click", (e) => {
    if (e.target === el("device-backdrop")) openDeviceModal(false);
  });
  el("device-form").addEventListener("submit", onDeviceFormSubmit);

  // quick commands
  el("btn-sync").addEventListener("click", async () => {
    try {
      const res = await runCommand("SYNC", null);
      setLastCommand(`SYNC • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
      await refreshStatus();
    } catch (e) {
      setLastCommand(`SYNC • ошибка • ${nowTimeStr()}`, String(e));
    }
  });

  el("btn-reset-phase").addEventListener("click", async () => {
    try {
      const res = await runCommand("RESET_PHASE_COUNTER", null);
      setLastCommand(`*RPHS • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
      await refreshStatus();
    } catch (e) {
      setLastCommand(`*RPHS • ошибка • ${nowTimeStr()}`, String(e));
    }
  });

  el("btn-clear-status").addEventListener("click", async () => {
    try {
      const res = await runCommand("CLEAR_STATUS", null);
      setLastCommand(`*CLS • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
      await refreshStatus();
    } catch (e) {
      setLastCommand(`*CLS • ошибка • ${nowTimeStr()}`, String(e));
    }
  });

  // params +/- (default steps)
  el("freq-minus").addEventListener("click", () => doStep("freq", -0.001));
  el("freq-plus").addEventListener("click", () => doStep("freq", 0.001));
  el("phase-minus").addEventListener("click", () => doStep("phase", -1));
  el("phase-plus").addEventListener("click", () => doStep("phase", 1));
  el("toffs-minus").addEventListener("click", () => doStep("toffs", -1));
  el("toffs-plus").addEventListener("click", () => doStep("toffs", 1));

  // chips
  document.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const stepType = btn.getAttribute("data-step-type");
      const step = btn.getAttribute("data-step");
      const setType = btn.getAttribute("data-set-type");
      try {
        if (stepType && step !== null) await doStep(stepType, step);
        if (setType) await doSet(setType);
      } catch (e) {
        setLastCommand(`Ошибка • ${nowTimeStr()}`, String(e));
      }
    });
  });

  // log clear
  el("btn-clear-log").addEventListener("click", () => {
    el("result-log").textContent = "Лог очищен.";
    el("last-command-label").textContent = "—";
  });

  // hotkeys
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      openHelp(false);
      openDeviceModal(false);
    }
    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      const bd = el("help-backdrop");
      openHelp(bd.hidden);
    }
    if (e.key.toLowerCase() === "r") {
      if (!el("btn-refresh").disabled) refreshStatus();
    }
  });
}

async function loadDevices() {
  el("devices-subtitle").textContent = "Загрузка…";
  try {
    devices = await apiGetJson(API.devices);
    errorsCount = 0;

    renderDevices();
    setDeviceActionsEnabled();

    setEnabledUI(false);
    setConn(null, "Выбери устройство слева.");
    clearStatusView();
  } catch (e) {
    el("devices-subtitle").textContent = "Ошибка загрузки";
    el("devices-list").innerHTML = `<div class="muted-note" style="color:var(--bad);">Ошибка: ${e}</div>`;
    setConn(false, `Ошибка загрузки устройств: ${e}`);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  wireUI();
  await loadDevices();
  setDevicePill();
});
