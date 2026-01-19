 // --- конфиг параметров команд ---
    const commandParamsConfig = {
        "SET_FREQ": [
            {name: "freq_hz", label: "Частота, Гц", type: "number", step: "0.000001", placeholder: "Например, 0.001"}
        ],
        "SET_PHASE": [
            {name: "phase_deg", label: "Фаза, градусы", type: "number", step: "0.0001", placeholder: "Например, 90.0"}
        ],
        "SET_FFOF": [
            {name: "ffof", label: "Frac freq", type: "number", step: "1e-12", placeholder: "Например, 2e-10"}
        ],
        "SET_TIME_OFFSET": [
            {name: "toffset_ns", label: "Абсолютный сдвиг, нс", type: "number", step: "0.001", placeholder: "Например, 100.0"}
        ],
        "STEP_FREQ": [
            {name: "step_hz", label: "Шаг по частоте, Гц", type: "number", step: "0.000001", placeholder: "Например, 0.001"}
        ],
        "STEP_PHASE": [
            {name: "step_deg", label: "Шаг по фазе, градусы", type: "number", step: "0.0001", placeholder: "Например, 10.0"}
        ],
        "STEP_TIME_OFFSET": [
            {name: "step_ns", label: "Шаг по времени, нс", type: "number", step: "0.001", placeholder: "Например, 10.0"}
        ],
        "SET_PPS_WIDTH": [
            {name: "pwidth_index", label: "Индекс PPS (0–7)", type: "number", step: "1", placeholder: "Например, 4"}
        ]
    };

    let devices = [];
    let selectedDeviceId = null;   // для команд
    let editingDeviceId = null;    // для формы
    let autoRefreshTimer = null;

    const devicesTableBody = document.getElementById("devices-table-body");
    const devicesCountLabel = document.getElementById("devices-count");
    const selectedDeviceLabel = document.getElementById("selected-device-label");
    const commandForm = document.getElementById("command-form");
    const commandCodeSelect = document.getElementById("command-code");
    const paramsContainer = document.getElementById("params-container");
    const sendButton = document.getElementById("send-button");
    const clearResultButton = document.getElementById("clear-result");
    const statusBar = document.getElementById("status-bar");
    const commandResult = document.getElementById("command-result");
    const lastDuration = document.getElementById("last-duration");

    // поля формы устройств
    const devIdDisplay = document.getElementById("dev-id-display");
    const devNameInput = document.getElementById("dev-name");
    const devHostInput = document.getElementById("dev-host");
    const devPortInput = document.getElementById("dev-port");
    const devDescInput = document.getElementById("dev-desc");
    const devEnabledInput = document.getElementById("dev-enabled");
    const btnNewDevice = document.getElementById("btn-new-device");
    const btnSaveDevice = document.getElementById("btn-save-device");
    const btnDeleteDevice = document.getElementById("btn-delete-device");

    // элементы панели статуса
    const stBaud   = document.getElementById("st-baud");
    const stTemp   = document.getElementById("st-temp");
    const stFreq   = document.getElementById("st-freq");
    const stPhase  = document.getElementById("st-phase");
    const stFfof   = document.getElementById("st-ffof");
    const stToffs  = document.getElementById("st-toffs");

    const stPllOsc  = document.getElementById("st-pll-osc");
    const stPllRef  = document.getElementById("st-pll-ref");
    const stPllLock = document.getElementById("st-pll-lock");
    const stPllPll  = document.getElementById("st-pll-pll");

    const stSreExt   = document.getElementById("st-sre-ext");
    const stSreInt   = document.getElementById("st-sre-int");
    const stSrePll   = document.getElementById("st-sre-pll");
    const stSreTune  = document.getElementById("st-sre-tune");
    const stSreParam = document.getElementById("st-sre-param");
    const stSreCmd   = document.getElementById("st-sre-cmd");

    const autoRefreshCheckbox = document.getElementById("auto-refresh");
    const refreshIntervalInput = document.getElementById("refresh-interval");

    // ---- Загрузка и отрисовка устройств ----
    async function loadDevices() {
        devicesTableBody.innerHTML = "<tr><td colspan='4'>Загрузка...</td></tr>";
        try {
            const resp = await fetch("/devices");
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            devices = await resp.json();
            renderDevicesTable();
        } catch (e) {
            devicesTableBody.innerHTML =
                `<tr><td colspan="4" style="color:#f97373;">Ошибка загрузки устройств: ${e}</td></tr>`;
            devicesCountLabel.textContent = "Ошибка";
        }
    }

    function renderDevicesTable() {
        if (!devices.length) {
            devicesTableBody.innerHTML =
                "<tr><td colspan='4'>Устройств нет. Добавь записи в таблицу devices.</td></tr>";
            devicesCountLabel.textContent = "0 устройств";
            return;
        }

        devicesTableBody.innerHTML = "";
        devices.forEach((dev) => {
            const tr = document.createElement("tr");
            tr.classList.add("device-row");
            tr.dataset.deviceId = dev.id;

            if (dev.id === selectedDeviceId) tr.classList.add("selected");

            tr.innerHTML = `
                <td>${dev.name}</td>
                <td>${dev.moxa_host}</td>
                <td>${dev.moxa_port}</td>
                <td>${dev.is_enabled ? "Да" : "Нет"}</td>
            `;

            tr.addEventListener("click", () => {
                selectDevice(dev.id);
                fillDeviceForm(dev.id);
            });

            devicesTableBody.appendChild(tr);
        });

        devicesCountLabel.textContent = `${devices.length} устройств`;
    }

    function selectDevice(deviceId) {
        selectedDeviceId = deviceId;

        document.querySelectorAll("tr.device-row").forEach((row) => {
            row.classList.toggle("selected", row.dataset.deviceId === deviceId);
        });

        const dev = devices.find(d => d.id === deviceId);
        if (dev) {
            selectedDeviceLabel.textContent = `Выбрано: ${dev.name}`;
            statusBar.innerHTML = `Устройство: <span class="value">${dev.name}</span>`;
        } else {
            selectedDeviceLabel.textContent = "Устройство не выбрано";
            statusBar.innerHTML = `Устройство: <span class="value">не выбрано</span>`;
        }

        sendButton.disabled = !selectedDeviceId;

        // если включено автообновление — сразу дернуть GET_STATUS
        if (autoRefreshCheckbox.checked && selectedDeviceId) {
            pollStatusOnce();
        }
    }

    // ---- Форма устройства ----
    function clearDeviceForm() {
        editingDeviceId = null;
        devIdDisplay.textContent = "ID: – (новое устройство)";
        devNameInput.value = "";
        devHostInput.value = "";
        devPortInput.value = "4002";
        devDescInput.value = "";
        devEnabledInput.checked = true;

        document.querySelectorAll("tr.device-row").forEach((row) => {
            row.classList.remove("selected");
        });
        selectedDeviceLabel.textContent = "Устройство не выбрано";
        statusBar.innerHTML = `Устройство: <span class="value">не выбрано</span>`;
        selectedDeviceId = null;
        sendButton.disabled = true;
    }

    function fillDeviceForm(deviceId) {
        const dev = devices.find(d => d.id === deviceId);
        if (!dev) return;
        editingDeviceId = dev.id;
        devIdDisplay.textContent = "ID: " + dev.id;
        devNameInput.value = dev.name || "";
        devHostInput.value = dev.moxa_host || "";
        devPortInput.value = dev.moxa_port || "";
        devDescInput.value = dev.description || "";
        devEnabledInput.checked = !!dev.is_enabled;
    }

    async function saveDevice() {
        const name = devNameInput.value.trim();
        const host = devHostInput.value.trim();
        const port = Number(devPortInput.value) || 0;
        const desc = devDescInput.value.trim() || null;
        const enabled = devEnabledInput.checked;

        if (!name || !host || !port) {
            alert("Имя, IP и порт обязательны.");
            return;
        }

        const payload = {
            name: name,
            moxa_host: host,
            moxa_port: port,
            description: desc,
            is_enabled: enabled
        };

        try {
            let resp;
            if (editingDeviceId) {
                resp = await fetch(`/devices/${editingDeviceId}`, {
                    method: "PUT",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(payload)
                });
            } else {
                resp = await fetch("/devices", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(payload)
                });
            }

            if (!resp.ok) {
                const text = await resp.text();
                alert("Ошибка сохранения устройства: " + resp.status + " " + text);
                return;
            }

            const dev = await resp.json();
            await loadDevices();
            selectDevice(dev.id);
            fillDeviceForm(dev.id);
        } catch (e) {
            alert("Ошибка сети при сохранении: " + e);
        }
    }

    async function deleteDevice() {
        if (!editingDeviceId) {
            alert("Сначала выбери устройство для удаления.");
            return;
        }
        if (!confirm("Точно удалить это устройство?")) return;

        try {
            const resp = await fetch(`/devices/${editingDeviceId}`, { method: "DELETE" });
            if (!resp.ok) {
                const text = await resp.text();
                alert("Ошибка удаления: " + resp.status + " " + text);
                return;
            }
            await loadDevices();
            clearDeviceForm();
        } catch (e) {
            alert("Ошибка сети при удалении: " + e);
        }
    }

    // ---- Параметры команд ----
    function renderParamsFields() {
        const cmd = commandCodeSelect.value;
        const cfg = commandParamsConfig[cmd];
        paramsContainer.innerHTML = "";
        if (!cfg) return;

        cfg.forEach(field => {
            const wrapper = document.createElement("div");
            wrapper.classList.add("form-row");
            wrapper.innerHTML = `
                <div class="form-field">
                  <label for="param-${field.name}">${field.label}</label>
                  <input
                    id="param-${field.name}"
                    name="${field.name}"
                    type="${field.type}"
                    step="${field.step || "any"}"
                    placeholder="${field.placeholder || ""}"
                    required
                  >
                </div>
            `;
            paramsContainer.appendChild(wrapper);
        });
    }

    // ---- панель статуса ----
    function setStatusValue(el, value, good = null) {
        el.textContent = value;
        el.classList.remove("value-ok", "value-bad");
        if (good === true) el.classList.add("value-ok");
        if (good === false) el.classList.add("value-bad");
    }

    function clearStatusPanel() {
        [
            stBaud, stTemp, stFreq, stPhase, stFfof, stToffs,
            stPllOsc, stPllRef, stPllLock, stPllPll,
            stSreExt, stSreInt, stSrePll, stSreTune, stSreParam, stSreCmd
        ].forEach(el => setStatusValue(el, "–"));
    }

    function updateStatusPanel(data) {
        if (!data) {
            clearStatusPanel();
            return;
        }

        setStatusValue(stBaud,  data.baud ?? "–");
        setStatusValue(stTemp,  data.temperature ?? "–");
        setStatusValue(stFreq,  data.freq ?? "–");
        setStatusValue(stPhase, data.phase ?? "–");
        setStatusValue(stFfof,  data.ffof ?? "–");
        setStatusValue(stToffs, data.time_offset_ns ?? "–");

        const pll = data.pll || {};
        setStatusValue(stPllOsc,  pll.osc_dbm ?? "–");
        setStatusValue(stPllRef,  pll.ref_dbm ?? "–");
        setStatusValue(stPllLock, pll.lock_v ?? "–");
        setStatusValue(stPllPll,  pll.pll_v ?? "–");

        const sre = data.status_register || {};
        // true = ошибка => красным, false = ок => зелёным
        function flag(el, v) {
            if (v === undefined || v === null) {
                setStatusValue(el, "–");
            } else if (v) {
                setStatusValue(el, "Ошибка", false);
            } else {
                setStatusValue(el, "OK", true);
            }
        }

        flag(stSreExt,   sre.ext_ref_error);
        flag(stSreInt,   sre.int_osc_error);
        flag(stSrePll,   sre.pll_lock_error);
        flag(stSreTune,  sre.tuning_voltage_error);
        flag(stSreParam, sre.invalid_parameter);
        flag(stSreCmd,   sre.invalid_command);
    }

    // ---- Выполнение команд ----
    async function executeCommand(event) {
        event.preventDefault();
        if (!selectedDeviceId) {
            alert("Сначала выбери устройство в списке слева.");
            return;
        }

        const cmd = commandCodeSelect.value;
        const userId = null; // авторизация пока не используем

        const params = {};
        const cfg = commandParamsConfig[cmd];
        if (cfg) {
            for (const field of cfg) {
                const input = document.getElementById("param-" + field.name);
                if (!input) continue;
                const raw = input.value;
                if (raw === "") continue;
                if (field.type === "number") {
                    const num = Number(raw);
                    if (isNaN(num)) {
                        alert(`Поле "${field.label}" должно быть числом.`);
                        return;
                    }
                    params[field.name] = num;
                } else {
                    params[field.name] = raw;
                }
            }
        }

        await runCommand(cmd, params, true);
    }

    async function runCommand(cmd, params = {}, fromButton = false) {
        if (!selectedDeviceId) return;

        if (fromButton) {
            sendButton.disabled = true;
            sendButton.textContent = "Выполнение...";
            statusBar.innerHTML = `Выполнение команды <span class="value">${cmd}</span>…`;
        }

        try {
            const body = {
                device_id: selectedDeviceId,
                command_code: cmd,
                params: (params && Object.keys(params).length) ? params : null,
                user_id: null,
            };

            const resp = await fetch("/commands/execute", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(body),
            });

            const json = await resp.json();

            if (!resp.ok) {
                if (fromButton) {
                    commandResult.textContent =
                        "Ошибка HTTP " + resp.status + ":\n" + JSON.stringify(json, null, 2);
                    statusBar.innerHTML = '<span class="error">Ошибка выполнения команды.</span>';
                    lastDuration.textContent = "–";
                }
            } else {
                // для GET_STATUS обновляем панель
                if (cmd === "GET_STATUS") {
                    updateStatusPanel(json.data);
                }

                if (fromButton) {
                    commandResult.textContent =
                        json.data ? JSON.stringify(json.data, null, 2) : "(пусто)";
                    statusBar.innerHTML = 'Статус: <span class="value">' + json.status + '</span>';
                    lastDuration.textContent = json.duration_ms + " ms";
                } else if (cmd === "GET_STATUS") {
                    // автообновление: обновим подпись
                    lastDuration.textContent = json.duration_ms + " ms (auto)";
                }
            }

        } catch (e) {
            if (fromButton) {
                commandResult.textContent = "Ошибка запроса:\n" + e;
                statusBar.innerHTML = '<span class="error">Ошибка сети или сервера.</span>';
                lastDuration.textContent = "–";
            }
        } finally {
            if (fromButton) {
                sendButton.disabled = !selectedDeviceId;
                sendButton.textContent = "Отправить команду";
            }
        }
    }

    async function pollStatusOnce() {
        if (!selectedDeviceId) return;
        await runCommand("GET_STATUS", {}, false);
    }

    function clearResult() {
        commandResult.textContent = "Пока ничего не отправляли.";
        lastDuration.textContent = "–";
    }

    function handleAutoRefreshToggle() {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }

        if (!autoRefreshCheckbox.checked) {
            return;
        }

        const intervalSec = Number(refreshIntervalInput.value) || 0;
        if (intervalSec <= 0) {
            alert("Интервал должен быть >= 1 секунды.");
            autoRefreshCheckbox.checked = false;
            return;
        }

        if (!selectedDeviceId) {
            alert("Сначала выбери устройство для автообновления.");
            autoRefreshCheckbox.checked = false;
            return;
        }

        // первый запрос сразу
        pollStatusOnce();
        autoRefreshTimer = setInterval(pollStatusOnce, intervalSec * 1000);
    }

    // ---- init ----
    window.addEventListener("DOMContentLoaded", () => {
        loadDevices();
        renderParamsFields();
        clearStatusPanel();

        commandCodeSelect.addEventListener("change", renderParamsFields);
        commandForm.addEventListener("submit", executeCommand);
        clearResultButton.addEventListener("click", clearResult);

        btnNewDevice.addEventListener("click", clearDeviceForm);
        btnSaveDevice.addEventListener("click", saveDevice);
        btnDeleteDevice.addEventListener("click", deleteDevice);

        autoRefreshCheckbox.addEventListener("change", handleAutoRefreshToggle);
        refreshIntervalInput.addEventListener("change", () => {
            if (autoRefreshCheckbox.checked) handleAutoRefreshToggle();
        });
    });