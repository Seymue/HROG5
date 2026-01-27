/* core/frontend/static/js/control_panel.js */
/* global fetch */

const API = {
  devices: "/devices/",
  execute: "/commands/execute",
};

let devices = [];
let selectedId = null;
let lastPollOkById = new Map(); // device_id -> boolean
let errorsCount = 0;

// device modal state
let deviceModalMode = "create"; // "create" | "edit"
let deviceModalId = null;

const el = (id) => document.getElementById(id);

function on(id, evt, handler, opts) {
  const node = el(id);
  if (!node) {
    console.warn(`[control_panel] element #${id} not found (skip ${evt})`);
    return;
  }
  node.addEventListener(evt, handler, opts);
}

function nowTimeStr() {
  const d = new Date();
  return d.toLocaleTimeString("ru-RU", { hour12: false });
}
function nowDateStr() {
  const d = new Date();
  return d.toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  });
}

/* -------------------- Topbar menu -------------------- */

function wireMenu() {
  const btn = el("btn-menu");
  const menu = el("app-menu");
  if (!btn || !menu) return;

  function openMenu(open) {
    menu.hidden = !open;
  }

  function isClickInsideMenu(target) {
    return menu.contains(target) || btn.contains(target);
  }

  // set active item based on current path
  const path = window.location.pathname || "";
  menu.querySelectorAll(".menu-item").forEach((b) => {
    const href = b.getAttribute("data-href") || "";
    const active = href && (path === href || path.startsWith(href + "/"));
    b.classList.toggle("active", !!active);
  });

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu(menu.hidden); // toggle
  });

  menu.querySelectorAll(".menu-item").forEach((b) => {
    b.addEventListener("click", () => {
      const href = b.getAttribute("data-href");
      if (href) window.location.href = href;
    });
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !isClickInsideMenu(e.target)) openMenu(false);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") openMenu(false);
  });
}

/* -------------------- Connection/status helpers -------------------- */

function setConn(ok, text) {
  const dot = el("conn-dot");
  const t = el("conn-text");
  if (!dot || !t) return;

  dot.classList.remove("ok", "bad");
  if (ok === true) dot.classList.add("ok");
  if (ok === false) dot.classList.add("bad");
  t.textContent = text;
}

function setEnabledUI(enabled) {
  // quick buttons
  const ids = [
    "btn-sync",
    "btn-reset-phase",
    "btn-clear-status",
    "freq-input",
    "phase-input",
    "toffs-input",
    "freq-minus",
    "freq-plus",
    "phase-minus",
    "phase-plus",
    "toffs-minus",
    "toffs-plus",
    "btn-refresh",
  ];
  ids.forEach((id) => {
    const n = el(id);
    if (n) n.disabled = !enabled;
  });

  // chips
  document.querySelectorAll(".chip").forEach((b) => {
    b.disabled = !enabled;
  });
}

function setDeviceActionsEnabled() {
  const hasSel = !!selectedId;
  const edit = el("btn-device-edit");
  const del = el("btn-device-delete");
  if (edit) edit.disabled = !hasSel;
  if (del) del.disabled = !hasSel;
}

/* -------------------- API helpers -------------------- */

async function apiGetJson(url) {
  const resp = await fetch(url, { method: "GET" });

  // важно: backend может вернуть HTML при 500, чтобы не падать на resp.json()
  const json = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  }
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

/* -------------------- Render -------------------- */

function renderDevices() {
  const list = el("devices-list");
  if (!list) return;

  list.innerHTML = "";

  devices.forEach((d) => {
    const item = document.createElement("div");
    item.className = "device-item";
    if (d.id === selectedId) item.classList.add("selected");

    const enabled = !!d.is_enabled;
    const dot = document.createElement("div");
    dot.className = "dot";

    if (!enabled) {
      dot.classList.add("off");
    } else {
      const polled = lastPollOkById.get(d.id);
      if (polled === false) dot.classList.add("bad");
      else dot.classList.add("ok"); // по умолчанию зелёный
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

  const sub = el("devices-subtitle");
  if (sub) sub.textContent = `Всего: ${devices.length}`;

  const sysCount = el("sys-count");
  if (sysCount) sysCount.textContent = `Устройств: ${devices.length}`;

  const sysErrors = el("sys-errors");
  if (sysErrors) sysErrors.textContent = `Ошибок: ${errorsCount}`;

  setDeviceActionsEnabled();
}

function setDevicePill() {
  const pill = el("device-pill");
  const hint = el("selected-device-hint");
  if (!pill || !hint) return;

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
  const l = el("last-command-label");
  const log = el("result-log");
  if (l) l.textContent = label;
  if (log) log.textContent = payload;
}

function clearStatusView() {
  const ids = [
    "st-temp",
    "st-freq",
    "st-phase",
    "st-ffof",
    "st-toffs",
    "st-sre-badge",
    "sre-ext",
    "sre-int",
    "sre-pll",
    "sre-tune",
    "sre-param",
    "sre-cmd",
    "status-updated",
    "last-duration",
    "pll-badge",
    "pll-osc",
    "pll-ref",
    "pll-lock",
    "pll-tune",
  ];
  ids.forEach((id) => {
    const n = el(id);
    if (n) n.textContent = "—";
  });

  const updated = el("status-updated");
  if (updated) updated.textContent = "Нет данных";

  const inputs = ["freq-input", "phase-input", "toffs-input"];
  inputs.forEach((id) => {
    const n = el(id);
    if (n) n.value = "";
  });
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
  const stTemp = el("st-temp");
  const stFreq = el("st-freq");
  const stPhase = el("st-phase");
  const stFfof = el("st-ffof");
  const stToffs = el("st-toffs");

  if (stTemp) stTemp.textContent = formatMaybe(data.temperature, " °C");
  if (stFreq) stFreq.textContent = formatMaybe(data.freq, " Hz");
  if (stPhase) stPhase.textContent = formatMaybe(data.phase, " °");
  if (stFfof) stFfof.textContent = formatMaybe(data.ffof, "");
  if (stToffs) stToffs.textContent = formatMaybe(data.time_offset_ns, " ns");

  // also fill big inputs
  if (el("freq-input") && data.freq !== null && data.freq !== undefined) el("freq-input").value = data.freq;
  if (el("phase-input") && data.phase !== null && data.phase !== undefined) el("phase-input").value = data.phase;
  if (el("toffs-input") && data.time_offset_ns !== null && data.time_offset_ns !== undefined) el("toffs-input").value = data.time_offset_ns;

  const sre = data.status_register || {};
  const pll = data.pll || null;

  const anyErr = !!(
    sre.ext_ref_error ||
    sre.int_osc_error ||
    sre.pll_lock_error ||
    sre.tuning_voltage_error ||
    sre.invalid_parameter ||
    sre.invalid_command
  );

  const sreBadge = el("st-sre-badge");
  if (sreBadge) sreBadge.textContent = anyErr ? "Есть ошибки" : "OK";

  const mapFlags = [
    ["sre-ext", sre.ext_ref_error],
    ["sre-int", sre.int_osc_error],
    ["sre-pll", sre.pll_lock_error],
    ["sre-tune", sre.tuning_voltage_error],
    ["sre-param", sre.invalid_parameter],
    ["sre-cmd", sre.invalid_command],
  ];
  mapFlags.forEach(([id, val]) => {
    const n = el(id);
    if (n) n.textContent = flagText(val);
  });

  const upd = el("status-updated");
  if (upd) upd.textContent = `Обновлено: ${nowTimeStr()}`;

  const dur = el("last-duration");
  if (dur) dur.textContent = durationMs ? `${durationMs} ms` : "—";

  // PLL
  const pllBadge = el("pll-badge");
  if (!pll) {
    if (pllBadge) pllBadge.textContent = "нет данных";
    ["pll-osc", "pll-ref", "pll-lock", "pll-tune"].forEach((id) => {
      const n = el(id);
      if (n) n.textContent = "—";
    });
  } else {
    if (pllBadge) pllBadge.textContent = "OK";
    const osc = el("pll-osc");
    const ref = el("pll-ref");
    const lock = el("pll-lock");
    const tune = el("pll-tune");

    if (osc) osc.textContent = (pll.osc_dbm ?? "—") + (pll.osc_dbm != null ? " dBm" : "");
    if (ref) ref.textContent = (pll.ref_dbm ?? "—") + (pll.ref_dbm != null ? " dBm" : "");
    if (lock) lock.textContent = (pll.lock_v ?? "—") + (pll.lock_v != null ? " V" : "");
    if (tune) tune.textContent = (pll.pll_v ?? "—") + (pll.pll_v != null ? " V" : "");
  }
}

/* -------------------- Actions -------------------- */

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

  const btnRefresh = el("btn-refresh");
  if (btnRefresh) btnRefresh.disabled = true;

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

    setLastCommand(`GET_STATUS • ошибка • ${nowTimeStr()}`, String(e));
    setConn(false, `Ошибка обновления статуса: ${e}`);
  } finally {
    if (btnRefresh) btnRefresh.disabled = false;
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
  const n = el(id);
  const raw = n ? n.value : "";
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
  if (!bd) return;
  bd.hidden = !open;
}

/* -------------------- Device modal (CRUD) -------------------- */

function openDeviceModal(open) {
  const bd = el("device-backdrop");
  if (!bd) return;

  bd.hidden = !open;

  const errBox = el("device-form-error");
  if (open && errBox) {
    errBox.style.display = "none";
    errBox.textContent = "";
  }
}

function fillDeviceForm(dev) {
  const name = el("dev-name");
  const desc = el("dev-desc");
  const host = el("dev-host");
  const port = el("dev-port");
  const en = el("dev-enabled");

  if (name) name.value = dev?.name ?? "";
  if (desc) desc.value = dev?.description ?? "";
  if (host) host.value = dev?.moxa_host ?? "";
  if (port) port.value = dev?.moxa_port ?? 4001;
  if (en) en.checked = dev?.is_enabled ?? true;

  const meta = el("device-form-meta");
  if (!meta) return;

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

  const title = el("device-modal-title");
  const sub = el("device-modal-sub");

  if (mode === "create") {
    if (title) title.textContent = "Добавить устройство";
    if (sub) sub.textContent = "Создание записи + регистрация в DevicePool (если enabled)";
    fillDeviceForm(null);
  } else {
    if (title) title.textContent = "Изменить устройство";
    if (sub) sub.textContent = "Обновление записи + перерегистрация в DevicePool";
    fillDeviceForm(dev);
  }

  openDeviceModal(true);
  setTimeout(() => el("dev-name")?.focus(), 0);
}

function getDeviceFormPayload() {
  const name = el("dev-name")?.value?.trim() ?? "";
  const description = el("dev-desc")?.value?.trim() ?? "";
  const host = el("dev-host")?.value?.trim() ?? "";
  const port = Number(el("dev-port")?.value);
  const enabled = !!el("dev-enabled")?.checked;

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
  if (!box) return;
  box.style.display = "";
  box.textContent = String(err);
}

async function createDevice(payload) {
  return await apiSendJson("POST", API.devices, payload);
}

async function updateDevice(id, payload) {
  return await apiSendJson("PUT", `${API.devices}${id}`, payload);
}

async function deleteDevice(id) {
  await apiDelete("DELETE", `${API.devices}${id}`);
}

async function reloadDevices(preserveSelection = true) {
  const prevSelected = selectedId;
  devices = await apiGetJson(API.devices);

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

      await reloadDevices(true);
      if (selectedId) await selectDevice(selectedId);
    }
  } catch (err) {
    showDeviceFormError(err);
  }
}

/* -------------------- Wiring -------------------- */

function wireUI() {
  wireMenu();

  // system time
  const sysDate = el("sys-date");
  const sysTime = el("sys-time");
  if (sysDate) sysDate.textContent = nowDateStr();
  if (sysTime) sysTime.textContent = nowTimeStr();
  setInterval(() => {
    if (sysTime) sysTime.textContent = nowTimeStr();
  }, 250);

  // topbar
  on("btn-refresh", "click", refreshStatus);
  on("btn-help", "click", () => openHelp(true));

  // help modal
  on("btn-help-close", "click", () => openHelp(false));
  on("btn-help-ok", "click", () => openHelp(false));
  on("help-backdrop", "click", (e) => {
    if (e.target === el("help-backdrop")) openHelp(false);
  });

  // device CRUD buttons
  on("btn-device-add", "click", onDeviceAdd);
  on("btn-device-edit", "click", onDeviceEdit);
  on("btn-device-delete", "click", onDeviceDelete);

  // device modal close
  on("btn-device-close", "click", () => openDeviceModal(false));
  on("btn-device-cancel", "click", () => openDeviceModal(false));
  on("device-backdrop", "click", (e) => {
    if (e.target === el("device-backdrop")) openDeviceModal(false);
  });

  const form = el("device-form");
  if (form) form.addEventListener("submit", onDeviceFormSubmit);

  // quick commands
  on("btn-sync", "click", async () => {
    try {
      const res = await runCommand("SYNC", null);
      setLastCommand(`SYNC • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
      await refreshStatus();
    } catch (e) {
      setLastCommand(`SYNC • ошибка • ${nowTimeStr()}`, String(e));
    }
  });

  on("btn-reset-phase", "click", async () => {
    try {
      const res = await runCommand("RESET_PHASE_COUNTER", null);
      setLastCommand(`*RPHS • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
      await refreshStatus();
    } catch (e) {
      setLastCommand(`*RPHS • ошибка • ${nowTimeStr()}`, String(e));
    }
  });

  on("btn-clear-status", "click", async () => {
    try {
      const res = await runCommand("CLEAR_STATUS", null);
      setLastCommand(`*CLS • ${nowTimeStr()}`, JSON.stringify(res, null, 2));
      await refreshStatus();
    } catch (e) {
      setLastCommand(`*CLS • ошибка • ${nowTimeStr()}`, String(e));
    }
  });

  // params +/- (default steps)
  on("freq-minus", "click", () => doStep("freq", -0.001));
  on("freq-plus", "click", () => doStep("freq", 0.001));
  on("phase-minus", "click", () => doStep("phase", -1));
  on("phase-plus", "click", () => doStep("phase", 1));
  on("toffs-minus", "click", () => doStep("toffs", -1));
  on("toffs-plus", "click", () => doStep("toffs", 1));

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
  on("btn-clear-log", "click", () => {
    const log = el("result-log");
    const lbl = el("last-command-label");
    if (log) log.textContent = "Лог очищен.";
    if (lbl) lbl.textContent = "—";
  });

  // hotkeys
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      openHelp(false);
      openDeviceModal(false);
    }
    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      const bd = el("help-backdrop");
      if (bd) openHelp(bd.hidden);
    }
    if (e.key.toLowerCase() === "r") {
      const b = el("btn-refresh");
      if (b && !b.disabled) refreshStatus();
    }
  });
}

async function loadDevices() {
  const sub = el("devices-subtitle");
  if (sub) sub.textContent = "Загрузка…";

  try {
    devices = await apiGetJson(API.devices);
    errorsCount = 0;

    renderDevices();
    setDeviceActionsEnabled();

    setEnabledUI(false);
    setConn(null, "Выбери устройство слева.");
    clearStatusView();
  } catch (e) {
    if (sub) sub.textContent = "Ошибка загрузки";
    const list = el("devices-list");
    if (list) {
      list.innerHTML = `<div class="muted-note" style="color:var(--bad);">Ошибка: ${e}</div>`;
    }
    setConn(false, `Ошибка загрузки устройств: ${e}`);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  wireUI();
  await loadDevices();
  setDevicePill();
});
