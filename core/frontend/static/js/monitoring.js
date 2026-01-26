/* global fetch */

const API = {
  devices: "/devices/",
  status: "/monitoring/status_snapshots",
  commands: "/monitoring/command_history",
};

let devices = [];
let selectedId = null;
let limit = 200;

let autoTimer = null;

const el = (id) => document.getElementById(id);

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

function renderDevices() {
  const list = el("mon-devices-list");
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

  el("mon-devices-sub").textContent = `Всего: ${devices.length}`;
}

function setSelectedHint() {
  const hint = el("mon-selected-hint");
  if (!selectedId) {
    hint.textContent = "Не выбрано";
    return;
  }
  const dev = devices.find((x) => x.id === selectedId);
  hint.textContent = dev ? dev.name : "—";
}

function setDetail(title, payload) {
  el("mon-detail-title").textContent = title;
  el("mon-detail-log").textContent = payload;
}

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
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  el("mon-status-count").textContent = rows ? `${rows.length}` : "0";

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

function renderCmdTable(rows) {
  const table = el("mon-cmd-table");
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  el("mon-cmd-count").textContent = rows ? `${rows.length}` : "0";

  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="muted">История команд пуста.</td>`;
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((r) => {
    const ok = !!r.success;
    const okDot = ok ? "ok" : "bad";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${fmtIsoToTime(r.created_at)}</td>
      <td class="mono">${r.command_code}</td>
      <td><span class="badge-ok"><span class="badge-dot ${okDot}"></span><span class="mono">${ok ? "OK" : "ERR"}</span></span></td>
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

async function loadMonitoringData() {
  if (!selectedId) return;

  el("mon-limit-badge").textContent = String(limit);

  const statusUrl = `${API.status}?device_id=${encodeURIComponent(selectedId)}&limit=${limit}`;
  const cmdUrl = `${API.commands}?device_id=${encodeURIComponent(selectedId)}&limit=${limit}`;

  const [snapshots, commands] = await Promise.all([
    apiGetJson(statusUrl),
    apiGetJson(cmdUrl),
  ]);

  renderStatusTable(snapshots);
  renderCmdTable(commands);

  el("mon-updated").textContent = nowTimeStr();
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

function setAuto(on) {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  if (on) {
    autoTimer = setInterval(async () => {
      try {
        await loadMonitoringData();
      } catch (e) {
        // не спамим алертами, просто показываем в деталях
        setDetail("Ошибка автообновления", String(e));
      }
    }, 5000);
  }
}

function wireUI() {
  el("btn-mon-refresh").addEventListener("click", async () => {
    try {
      await loadMonitoringData();
    } catch (e) {
      setDetail("Ошибка", String(e));
    }
  });

  el("mon-auto").addEventListener("change", (e) => {
    setAuto(!!e.target.checked);
  });

  document.querySelectorAll("[data-limit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      limit = Number(btn.getAttribute("data-limit") || "200");
      el("mon-limit-badge").textContent = String(limit);
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
      el("btn-mon-refresh").click();
    }
  });
}

async function loadDevices() {
  el("mon-devices-sub").textContent = "Загрузка…";
  devices = await apiGetJson(API.devices);
  renderDevices();
  setSelectedHint();
}

window.addEventListener("DOMContentLoaded", async () => {
  wireUI();
  try {
    await loadDevices();
  } catch (e) {
    el("mon-devices-sub").textContent = "Ошибка загрузки";
    setDetail("Ошибка", String(e));
  }
});
