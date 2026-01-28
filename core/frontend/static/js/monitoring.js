/* global fetch */

const API = {
  devices: "/devices/",
  status: "/monitoring/status_snapshots",
  commands: "/monitoring/command_history",
};

let devices = [];
let selectedId = null;
let limit = 200;

const el = (id) => document.getElementById(id);

function on(id, evt, handler) {
  const node = el(id);
  if (!node) return;
  node.addEventListener(evt, handler);
}

function nowTimeStr() {
  const d = new Date();
  return d.toLocaleTimeString("ru-RU", { hour12: false });
}

function fmtIsoToTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { hour12: false });
}

async function apiGetJson(url) {
  const resp = await fetch(url, { method: "GET" });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  return json;
}

/* -------------------- Menu (popover navigation) -------------------- */

function wireMenu() {
  const btn = el("btn-menu");
  const menu = el("app-menu");
  if (!btn || !menu) return;

  const items = Array.from(menu.querySelectorAll(".menu-item[data-href]"));

  function normPath(p) {
    try {
      const u = new URL(p, window.location.origin);
      return u.pathname.replace(/\/+$/, "") || "/";
    } catch {
      return (p || "").replace(/\/+$/, "") || "/";
    }
  }

  function syncActive() {
    const cur = normPath(window.location.pathname);
    items.forEach((it) => {
      const href = it.getAttribute("data-href") || "/";
      const isActive = normPath(href) === cur;
      it.classList.toggle("active", isActive);
      it.disabled = isActive;
    });
  }

  function openMenu() {
    syncActive();
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    if (menu.hidden) openMenu();
    else closeMenu();
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  items.forEach((it) => {
    it.addEventListener("click", () => {
      const href = it.getAttribute("data-href");
      if (!href) return;
      closeMenu();
      window.location.href = href;
    });
  });

  document.addEventListener("click", (e) => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    closeMenu();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  closeMenu();
  syncActive();
}

/* -------------------- Devices list -------------------- */

function renderDevices() {
  const list = el("mon-devices-list");
  if (!list) return;
  list.innerHTML = "";

  devices.forEach((d) => {
    const item = document.createElement("div");
    item.className = "device-item";
    if (d.id === selectedId) item.classList.add("selected");

    const dot = document.createElement("div");
    dot.className = "dot";
    if (!d.is_enabled) dot.classList.add("off");
    else dot.classList.add("ok");

    const left = document.createElement("div");
    left.className = "device-left";

    const textWrap = document.createElement("div");
    textWrap.style.minWidth = "0";

    const name = document.createElement("div");
    name.className = "device-name";
    name.textContent = d.name;

    const sub = document.createElement("div");
    sub.className = "device-sub";
    sub.textContent = `${d.moxa_host}:${d.moxa_port}${d.is_enabled ? "" : " • disabled"}`;

    textWrap.appendChild(name);
    textWrap.appendChild(sub);

    left.appendChild(dot);
    left.appendChild(textWrap);

    const meta = document.createElement("div");
    meta.className = "device-meta";
    meta.innerHTML = `<div class="mono" style="font-weight:800;">${d.is_enabled ? "ON" : "OFF"}</div>
                      <div class="device-sub">${d.is_enabled ? "готово" : "выкл."}</div>`;

    item.appendChild(left);
    item.appendChild(meta);

    item.addEventListener("click", () => selectDevice(d.id));

    list.appendChild(item);
  });

  if (el("mon-devices-sub")) el("mon-devices-sub").textContent = `Всего: ${devices.length}`;
}

function setSelectedHint() {
  const hint = el("mon-selected-hint");
  if (!hint) return;
  if (!selectedId) {
    hint.textContent = "Не выбрано";
    return;
  }
  const dev = devices.find((x) => x.id === selectedId);
  hint.textContent = dev ? dev.name : "—";
}

function setDetail(title, payload) {
  if (el("mon-detail-title")) el("mon-detail-title").textContent = title;
  if (el("mon-detail-log")) el("mon-detail-log").textContent = payload;
}

/* -------------------- Tables -------------------- */

function anySreError(sre) {
  if (!sre) return false;
  return !!(
    sre.ext_ref_error ||
    sre.int_osc_error ||
    sre.pll_lock_error ||
    sre.tuning_voltage_error ||
    sre.invalid_parameter ||
    sre.invalid_command
  );
}

function renderStatusTable(rows) {
  const table = el("mon-status-table");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (el("mon-status-count")) el("mon-status-count").textContent = rows ? `${rows.length}` : "0";

  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8" class="muted">Нет данных в БД.</td>`;
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((r) => {
    const data = r.data || {};
    const sre = data.status_register || null;
    const sreBad = anySreError(sre);

    const ok = !!r.success;
    const okDot = ok ? "ok" : "bad";

    const temp = data.temperature ?? null;
    const freq = data.freq ?? null;
    const phas = data.phase ?? null;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${fmtIsoToTime(r.collected_at)}</td>
      <td><span class="badge-ok"><span class="badge-dot ${okDot}"></span><span class="mono">${ok ? "OK" : "ERR"}</span></span></td>
      <td class="mono">${temp ?? "—"}</td>
      <td class="mono">${freq ?? "—"}</td>
      <td class="mono">${phas ?? "—"}</td>
      <td class="mono">${sre ? (sreBad ? "BAD" : "OK") : "—"}</td>
      <td class="mono">${r.duration_ms ?? "—"}</td>
      <td class="mono">${r.source ?? "—"}</td>
    `;

    tr.addEventListener("click", () => {
      setDetail(
        `StatusSnapshot • ${fmtIsoToTime(r.collected_at)}`,
        JSON.stringify(r, null, 2)
      );
    });

    tbody.appendChild(tr);
  });
}

/* --- NEW: compact params/result helpers --- */

function toOneLine(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function compact(value, maxLen = 90) {
  if (value === null || value === undefined) return "—";
  let s;
  if (typeof value === "string") s = value;
  else {
    try { s = JSON.stringify(value); }
    catch { s = String(value); }
  }
  s = toOneLine(s);
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}

function extractParams(row) {
  if (!row) return null;

  // прямые варианты
  if (row.params != null) return row.params;
  if (row.command_params != null) return row.command_params;

  // если бек хранит request body целиком
  const rb = row.request_body || row.body || row.request || row.payload;
  if (rb && typeof rb === "object") {
    if (rb.params != null) return rb.params;

    // иногда параметры лежат "плоско"
    const { device_id, command_code, user_id, ...rest } = rb;
    if (Object.keys(rest).length) return rest;
  }

  return null;
}

function extractResult(row) {
  if (!row) return null;

  // Частые варианты ответа/результата
  if (row.data != null) return row.data;
  if (row.response != null) return row.response;
  if (row.result != null) return row.result;

  // Ошибка
  if (row.error != null) return row.error;
  if (row.detail != null) return row.detail;

  return null;
}

function renderCmdTable(rows) {
  const table = el("mon-cmd-table");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (el("mon-cmd-count")) el("mon-cmd-count").textContent = rows ? `${rows.length}` : "0";

  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="muted">История команд пуста.</td>`;
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((r) => {
    const ok = !!r.success;
    const okDot = ok ? "ok" : "bad";

    const params = extractParams(r);
    const result = extractResult(r);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${fmtIsoToTime(r.created_at)}</td>
      <td class="mono">${r.command_code}</td>
      <td><span class="badge-ok"><span class="badge-dot ${okDot}"></span><span class="mono">${ok ? "OK" : "ERR"}</span></span></td>
      <td class="mono">${compact(params)}</td>
      <td class="mono">${compact(result)}</td>
      <td class="mono">${r.duration_ms ?? "—"}</td>
    `;

    tr.addEventListener("click", () => {
      setDetail(
        `CommandHistory • ${r.command_code} • ${fmtIsoToTime(r.created_at)}`,
        JSON.stringify(r, null, 2)
      );
    });

    tbody.appendChild(tr);
  });
}

/* -------------------- Data load -------------------- */

async function loadMonitoringData() {
  if (!selectedId) return;

  if (el("mon-limit-badge")) el("mon-limit-badge").textContent = String(limit);

  const statusUrl = `${API.status}?device_id=${encodeURIComponent(selectedId)}&limit=${limit}`;
  const cmdUrl = `${API.commands}?device_id=${encodeURIComponent(selectedId)}&limit=${limit}`;

  const [snapshots, commands] = await Promise.all([
    apiGetJson(statusUrl),
    apiGetJson(cmdUrl),
  ]);

  renderStatusTable(snapshots);
  renderCmdTable(commands);

  if (el("mon-updated")) el("mon-updated").textContent = nowTimeStr();
}

async function selectDevice(id) {
  selectedId = id;
  setSelectedHint();
  renderDevices();

  setDetail("—", "Кликни по строке таблицы, чтобы увидеть JSON.");

  try {
    await loadMonitoringData();
  } catch (e) {
    setDetail("Ошибка", String(e));
  }
}

/* -------------------- Wiring -------------------- */

function wireUI() {
  wireMenu();

  on("btn-mon-refresh", "click", async () => {
    try {
      await loadMonitoringData();
    } catch (e) {
      setDetail("Ошибка", String(e));
    }
  });

  document.querySelectorAll("[data-limit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      limit = Number(btn.getAttribute("data-limit") || "200");
      if (el("mon-limit-badge")) el("mon-limit-badge").textContent = String(limit);

      if (selectedId) {
        try {
          await loadMonitoringData();
        } catch (e) {
          setDetail("Ошибка", String(e));
        }
      }
    });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "r") {
      const b = el("btn-mon-refresh");
      if (b) b.click();
    }
  });
}

async function loadDevices() {
  if (el("mon-devices-sub")) el("mon-devices-sub").textContent = "Загрузка…";
  devices = await apiGetJson(API.devices);
  renderDevices();
  setSelectedHint();
}

window.addEventListener("DOMContentLoaded", async () => {
  wireUI();
  try {
    await loadDevices();
  } catch (e) {
    if (el("mon-devices-sub")) el("mon-devices-sub").textContent = "Ошибка загрузки";
    setDetail("Ошибка", String(e));
  }
});
