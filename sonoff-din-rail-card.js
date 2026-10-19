/* Sonoff DIN Rail Card — dependency-free Lovelace card */
const DIN_CARD_VERSION = "2.18";
const DIN_CARD_IMAGE = new URL(`./sonoff-din-rail-card.svg?v=${DIN_CARD_VERSION}`, import.meta.url).href;
const DIN_CARD_COMPACT_IMAGE = new URL(`./sonoff-din-rail-card-compact.svg?v=${DIN_CARD_VERSION}`, import.meta.url).href;

function dinItems(config) {
  const source = Array.isArray(config?.entities) ? config.entities : [];
  return source.map((item) => typeof item === "string" ? { entity: item, name: "" } : {
    ...item, entity: String(item?.entity || ""), name: String(item?.name || ""),
  });
}

function dinEscape(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

const DIN_METRICS = {
  voltage: { unit: "В", digits: 0 },
  current: { unit: "А", digits: 2 },
  power: { unit: "Вт", digits: 0 },
};

function dinMetric(hass, item, kind) {
  const source = item[`${kind}_entity`];
  const raw = source ? hass?.states?.[source]?.state : hass?.states?.[item.entity]?.attributes?.[kind];
  if (raw === undefined || raw === null || raw === "" || ["unknown", "unavailable", "none"].includes(String(raw).toLowerCase())) return "—";
  const number = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(number)) return "—";
  const unit = source ? hass?.states?.[source]?.attributes?.unit_of_measurement : null;
  const allowed = { voltage: ["V", "В"], current: ["A", "А", "mA"], power: ["W", "Вт", "kW"] };
  if (unit && !allowed[kind].includes(unit)) return "—";
  const normalized = unit === "kW" && kind === "power" ? number * 1000 : unit === "mA" && kind === "current" ? number / 1000 : number;
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: DIN_METRICS[kind].digits }).format(normalized);
}

function dinTelemetry(hass, item) {
  return Object.keys(DIN_METRICS).map((kind) => {
    const value = dinMetric(hass, item, kind);
    const unit = DIN_METRICS[kind].unit;
    return { value, unit, text: `${value} ${unit}` };
  });
}

class SonoffDinRailCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { title: "DIN-реле", entities: [] };
    this._pending = new Map();
  }

  setConfig(config) {
    const scale = Number(config?.scale);
    this._config = { ...config, entities: dinItems(config), scale: Number.isFinite(scale) && scale >= .25 && scale <= 1.5 ? scale : 1, fit: config?.fit !== false };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    for (const [entity, oldState] of this._pending) {
      if (hass.states[entity]?.state !== oldState) this._pending.delete(entity);
    }
    if (this._rendered) this._updateStates();
    else this._render();
  }

  getCardSize() { return 5; }

  static getConfigElement() { return document.createElement("sonoff-din-rail-card-editor"); }

  static getStubConfig() { return { type: "custom:sonoff-din-rail-card", entities: [] }; }

  async _toggle(entity) {
    const state = this._hass?.states?.[entity]?.state;
    const domain = entity.split(".")[0];
    if (!this._hass || this._pending.has(entity) || !["switch", "light"].includes(domain) || !["on", "off"].includes(state)) return;
    this._pending.set(entity, state);
    this._updateStates();
    try {
      await this._hass.callService(domain, state === "on" ? "turn_off" : "turn_on", { entity_id: entity });
    } catch (error) {
      this._pending.delete(entity);
      this._error = `${entity}: ${error?.message || "Не удалось переключить"}`;
      this._updateStates();
      this._showError();
      return;
    }
    // HA normally pushes the new state. Do not leave the button locked if it doesn't.
    setTimeout(() => {
      if (this._pending.has(entity)) {
        this._pending.delete(entity);
        this._updateStates();
      }
    }, 5000);
  }

  _showError() {
    const el = this.shadowRoot.querySelector(".error");
    if (el) el.textContent = this._error || "";
  }

  _updateStates() {
    const items = dinItems(this._config);
    const units = this.shadowRoot.querySelectorAll(".unit");
    if (units.length !== items.length) { this._render(); return; }
    const fingerprint = items.map((item) => `${item.entity}:${this._hass?.states?.[item.entity]?.state || "missing"}:${this._pending.has(item.entity)}:${dinTelemetry(this._hass, item).map((reading) => reading.text).join("/")}`).join("|");
    if (fingerprint === this._stateFingerprint) return;
    this._stateFingerprint = fingerprint;
    units.forEach((unit, index) => {
      const entity = items[index].entity;
      const state = this._hass?.states?.[entity]?.state;
      const available = ["on", "off"].includes(state) && ["switch", "light"].includes(entity.split(".")[0]);
      const busy = this._pending.has(entity);
      const status = !entity ? "Не выбрано" : !this._hass?.states?.[entity] ? "Не найдено" : state === "on" ? "Включено" : state === "off" ? "Выключено" : "Недоступно";
      const name = items[index].name || this._hass?.states?.[entity]?.attributes?.friendly_name || entity || `Реле ${index + 1}`;
      unit.classList.toggle("is-on", state === "on");
      unit.classList.toggle("is-available", available);
      unit.classList.toggle("is-unavailable", !available);
      unit.querySelector(".status-label").textContent = busy ? "Переключение…" : status;
      const button = unit.querySelector(".power");
      button.title = `${name} — ${status}`;
      button.setAttribute("aria-label", `${name}: ${status}`);
      const [voltage, current, power] = dinTelemetry(this._hass, items[index]);
      for (const [kind, reading] of [["voltage", voltage], ["current", current], ["power", power]]) {
        unit.querySelector(`.reading-${kind} .reading-number`).textContent = reading.value;
      }
      unit.querySelector(".telemetry").title = `Напряжение ${voltage.text}; ток ${current.text}; мощность ${power.text}`;
    });
  }

  _action(item, gesture) {
    const fallback = gesture === "tap" ? "toggle" : gesture === "hold" ? "more-info" : "none";
    return item[`${gesture}_action`] || this._config[`${gesture}_action`] || { action: fallback };
  }

  async _runAction(item, gesture) {
    const config = this._action(item, gesture);
    const entity = item.entity;
    if (config.action === "none") return;
    if (config.confirmation && !window.confirm(typeof config.confirmation === "object" ? config.confirmation.text || "Выполнить действие?" : "Выполнить действие?")) return;
    try {
      switch (config.action) {
        case "toggle": await this._toggle(entity); break;
        case "more-info": this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: config.entity || entity }, bubbles: true, composed: true })); break;
        case "navigate": {
          if (!config.navigation_path) return;
          if (config.navigation_replace) history.replaceState(null, "", config.navigation_path);
          else history.pushState(null, "", config.navigation_path);
          window.dispatchEvent(new Event("location-changed"));
          break;
        }
        case "url": {
          if (config.url_path && /^(https?:\/\/|\/)/i.test(config.url_path)) window.open(config.url_path, "_blank", "noopener,noreferrer");
          break;
        }
        case "perform-action":
        case "call-service": {
          const parts = (config.perform_action || config.service || "").split(".");
          if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Укажи действие в формате domain.service");
          await this._hass.callService(parts[0], parts[1], config.data || config.service_data || {}, config.target);
          break;
        }
        case "assist": {
          if (this._hass?.auth?.external?.config?.hasAssist) this._hass.auth.external.fireMessage({ type: "assist/show", payload: { pipeline_id: config.pipeline_id || "last_used", start_listening: config.start_listening ?? true } });
          else { history.pushState(null, "", "/conversation"); window.dispatchEvent(new Event("location-changed")); }
          break;
        }
        case "fire-dom-event": this.dispatchEvent(new CustomEvent("ll-custom", { detail: config, bubbles: true, composed: true })); break;
      }
    } catch (error) {
      this._error = error?.message || "Не удалось выполнить действие";
      this._showError();
    }
  }

  _bindButton(button, item) {
    let pressStarted = null, pressId = null, holdTimer = null, held = false;
    let tapTimer = null, lastPointerUp = 0;
    const clearHold = () => { if (holdTimer) clearTimeout(holdTimer); holdTimer = null; };
    const hold = () => {
      if (pressStarted === null || held) return;
      held = true;
      clearHold();
      if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
      this._runAction(item, "hold");
    };
    const tap = () => {
      if (this._action(item, "double_tap").action === "none") { this._runAction(item, "tap"); return; }
      if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; this._runAction(item, "double_tap"); }
      else tapTimer = setTimeout(() => { tapTimer = null; this._runAction(item, "tap"); }, 280);
    };
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      if (pressStarted !== null) return;
      pressStarted = Date.now(); pressId = event.pointerId; held = false;
      if (event.pointerType !== "mouse") button.setPointerCapture?.(event.pointerId);
      holdTimer = setTimeout(hold, 500);
    });
    button.addEventListener("pointerup", (event) => {
      if (pressStarted === null || event.pointerId !== pressId) return;
      event.stopPropagation();
      const duration = Date.now() - pressStarted;
      clearHold();
      if (duration >= 500) hold();
      const wasHeld = held;
      pressStarted = null; pressId = null;
      lastPointerUp = Date.now();
      if (!wasHeld) tap();
    });
    button.addEventListener("pointercancel", () => { clearHold(); pressStarted = null; pressId = null; });
    button.addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "mouse" || pressStarted === null) return;
      clearHold(); pressStarted = null; pressId = null;
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault(); event.stopPropagation();
      if (pressStarted !== null) hold();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      if (event.detail === 0 && Date.now() - lastPointerUp > 700) tap();
    });
  }

  _render() {
    const scrollLeft = this.shadowRoot.querySelector(".rail-scroll")?.scrollLeft || 0;
    const items = dinItems(this._config);
    const compact = this._config.design === "compact";
    const image = dinEscape(this._config.image || (compact ? DIN_CARD_COMPACT_IMAGE : DIN_CARD_IMAGE));
    const title = dinEscape(this._config.title || "DIN-реле");
    const scale = this._config.scale || 1;
    const baseWidth = 112 * items.length + 5 * Math.max(0, items.length - 1);
    const naturalWidth = Math.round((112 * items.length * scale + 5 * Math.max(0, items.length - 1)) * 100) / 100;
    const modules = items.map((item, index) => {
      const entity = item.entity;
      const obj = this._hass?.states?.[entity];
      const state = obj?.state;
      const available = ["on", "off"].includes(state) && ["switch", "light"].includes(entity.split(".")[0]);
      const busy = this._pending.has(entity);
      const name = dinEscape(item.name || obj?.attributes?.friendly_name || entity || `Реле ${index + 1}`);
      const status = !entity ? "Не выбрано" : !obj ? "Не найдено" : state === "on" ? "Включено" : state === "off" ? "Выключено" : "Недоступно";
      const [voltage, current, power] = dinTelemetry(this._hass, item);
      return `<div class="unit ${compact ? "compact" : ""} ${state === "on" ? "is-on" : ""} ${available ? "is-available" : "is-unavailable"}">
        <div class="module">
          <img class="product" src="${image}" alt="" draggable="false">
          <span class="device-name" title="${name}">${name}</span>
          <span class="led led-out" aria-hidden="true"></span>
          <span class="led led-zigbee" aria-hidden="true"></span>
          <button class="power" type="button" aria-label="${name}: ${status}" title="${name} — ${status}">
            <span class="power-face"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 5v17M10 10a15 15 0 1 0 20 0"/></svg></span>
          </button>
          <div class="telemetry" title="Напряжение ${voltage.text}; ток ${current.text}; мощность ${power.text}">
            <div class="reading reading-voltage"><span class="reading-label">НАПР.</span><span class="reading-value"><span class="reading-number">${voltage.value}</span> <span class="reading-unit">${voltage.unit}</span></span></div>
            <div class="reading reading-current"><span class="reading-label">ТОК</span><span class="reading-value"><span class="reading-number">${current.value}</span> <span class="reading-unit">${current.unit}</span></span></div>
            <div class="reading reading-power"><span class="reading-label">МОЩНОСТЬ</span><span class="reading-value"><span class="reading-number">${power.value}</span> <span class="reading-unit">${power.unit}</span></span></div>
          </div>
        </div>
        <div class="status"><span class="dot"></span><span class="status-label">${busy ? "Переключение…" : status}</span></div>
      </div>`;
    }).join("");
    this.shadowRoot.innerHTML = `<style>
      :host { display: block; }
      ha-card { display: block; padding: 16px 12px 18px; color: var(--primary-text-color); overflow: hidden; }
      .title { font-size: 18px; font-weight: 600; margin: 0 4px 15px; }
      .rail-scroll { overflow-x: auto; padding: 3px 4px 11px; scrollbar-width: thin; }
      .rail { display: grid; grid-template-columns: repeat(var(--count), minmax(0, 1fr)); gap: 5px; width: min(calc(100% * var(--scale)), calc(var(--base-width) * var(--scale))); }
      .rail.no-fit { width: var(--natural-width); }
      .rail.has-telemetry { min-width: calc(var(--count) * 112px + (var(--count) - 1) * 5px); }
      .unit { min-width: 0; text-align: center; container-type: inline-size; }
      .module { width: 100%; aspect-ratio: 112 / 514; position: relative; overflow: hidden; border-radius: 4px; box-shadow: 0 2px 8px #0003; background: #eee; }
      .compact .module { aspect-ratio: 108 / 300; }
      .product { position: absolute; width: 100%; height: 100%; max-width: none; left: 0; top: 0; pointer-events: none; user-select: none; }
      .device-name { position: absolute; top: 23.7%; left: 9%; width: 82%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; color: #53595b; font: 800 clamp(5px, 13cqw, 17px)/1.2 Arial,sans-serif; pointer-events: none; }
      .compact .device-name { top: 6.4%; }
      .power { position: absolute; left: 25.9%; top: 56%; width: 48.2%; aspect-ratio: 1; border: 0; background: transparent; color: #a94d12; cursor: pointer; display: block; padding: 0; touch-action: none; clip-path: polygon(27% 0,73% 0,100% 27%,100% 73%,73% 100%,27% 100%,0 73%,0 27%); }
      .power-face { position: absolute; inset: 0; width: 100%; height: 100%; background: linear-gradient(135deg,#f6ad52,#e78328 65%,#cd641b); display: grid; place-items: center; filter: drop-shadow(1px 2px 2px #5556); }
      .compact .power { left: 24.5%; top: 56.3%; width: 51%; height: 18.3%; aspect-ratio: auto; }
      .telemetry { position: absolute; top: 67.6%; left: 10%; width: 80%; height: 9.9%; display: grid; grid-template-columns: 48% 52%; grid-template-rows: 1fr 1fr; color: #233b42; font-family: Arial,sans-serif; font-variant-numeric: tabular-nums; pointer-events: none; }
      .compact .telemetry { top: 77%; left: 9%; width: 82%; height: 17%; }
      .reading { min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; white-space: nowrap; }
      .reading-current { border-left: 1px solid #bdd2d6; }
      .reading-power { grid-column: 1 / -1; border-top: 1px solid #bdd2d6; }
      .reading-label { color: #607b82; font-size: clamp(6.5px, 6.5cqw, 8px); font-weight: 700; letter-spacing: .02em; line-height: 1.05; }
      .reading-value { color: #233b42; display: inline-flex; align-items: baseline; justify-content: center; gap: .38em; font-size: clamp(10px, 10cqw, 11.5px); font-weight: 800; line-height: 1.08; }
      .reading-power .reading-value { color: #086b80; font-size: clamp(11px, 11.8cqw, 13px); }
      .power svg { width: 65%; height: 65%; fill: none; stroke: currentColor; stroke-width: 3.5; stroke-linecap: round; pointer-events: none; }
      .power:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -2px; }
      .power:hover:not(:disabled) .power-face { filter: brightness(1.1) drop-shadow(1px 2px 2px #5556); }
      .power:active:not(:disabled) .power-face { filter: brightness(.9); }
      .power:disabled { cursor: not-allowed; }
      .led { position: absolute; right: 11.607%; width: 9.821%; height: 2.282%; border-radius: 2px; background: #777; opacity: .4; pointer-events: none; }
      .led-out { top: 39.1%; }
      .led-zigbee { top: 44.2%; }
      .compact .led { right: 14.815%; width: 11.111%; height: 4.545%; }
      .compact .led-out { top: 29.7%; }
      .compact .led-zigbee { top: 37.7%; }
      .is-on .led-out { background: #ed3cdb; opacity: 1; box-shadow: 0 0 7px #ed3cdb; }
      .is-available .led-zigbee { background: #29d7ff; opacity: 1; box-shadow: 0 0 7px #29d7ff; }
      .is-unavailable .module { opacity: .6; }
      .status { margin-top: 10px; font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; }
      .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #888; margin-right: 5px; }
      .is-on .dot { background: #20ca77; }
      @container (max-width: 65px) { .status-label { display: none; } .dot { margin-right: 0; } }
      .empty { color: var(--secondary-text-color); padding: 28px 8px; text-align: center; }
      .error { color: var(--error-color, #db4437); font-size: 12px; margin: 6px 4px 0; }
      @media (prefers-reduced-motion: reduce) { .power { transition: none; } }
    </style><ha-card><div class="title">${title}</div>${items.length ? `<div class="rail-scroll"><div class="rail has-telemetry ${this._config.fit === false ? "no-fit" : ""}" style="--count:${items.length};--base-width:${baseWidth}px;--natural-width:${naturalWidth}px;--scale:${scale}">${modules}</div></div>` : `<div class="empty">Добавь реле в настройках карточки</div>`}<div class="error">${dinEscape(this._error || "")}</div></ha-card>`;
    const scroll = this.shadowRoot.querySelector(".rail-scroll");
    if (scroll) scroll.scrollLeft = scrollLeft;
    this.shadowRoot.querySelectorAll(".power").forEach((button, index) => this._bindButton(button, items[index]));
    this._rendered = true;
    this._stateFingerprint = null;
  }
}

class SonoffDinRailCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._showAllMetrics = new Set(); }
  setConfig(config) { this._config = { ...config, entities: dinItems(config), scale: Number(config?.scale) || 1, fit: config?.fit !== false }; this._render(); }
  set hass(hass) {
    const firstHass = !this._hass;
    this._hass = hass;
    if (this._config && (firstHass || !this._rendered)) this._render();
    if (hass?.connection && this._registryConnection !== hass.connection) {
      this._registryConnection = hass.connection;
      this._entityDeviceIds = null;
      this._loadEntityRegistry(hass.connection);
    }
  }
  async _loadEntityRegistry(connection) {
    try {
      const entities = await connection.sendMessagePromise({ type: "config/entity_registry/list" });
      if (connection !== this._registryConnection) return;
      this._entityDeviceIds = new Map(entities.map(({ entity_id, device_id }) => [entity_id, device_id]));
    } catch {
      if (connection !== this._registryConnection) return;
      this._entityDeviceIds = new Map();
    }
    this._refreshMetricOptions();
  }
  _metricOptions(kind, current, item, index) {
    const units = { voltage: ["V", "В"], current: ["A", "А", "mA"], power: ["W", "Вт", "kW"] };
    const deviceId = this._entityDeviceIds?.get(item.entity);
    const all = Object.values(this._hass?.states || {}).filter((s) => s.entity_id.startsWith("sensor.") && (s.attributes.device_class === kind || units[kind].includes(s.attributes.unit_of_measurement)));
    const sensors = deviceId && !this._showAllMetrics.has(index) ? all.filter((s) => this._entityDeviceIds.get(s.entity_id) === deviceId) : all;
    sensors.sort((a, b) => (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id, "ru"));
    return `<option value="">Атрибут реле / не задано</option>${sensors.map((s) => `<option value="${dinEscape(s.entity_id)}" ${s.entity_id === current ? "selected" : ""}>${dinEscape(s.attributes.friendly_name || s.entity_id)} (${dinEscape(s.entity_id)})</option>`).join("")}${current && !sensors.some((s) => s.entity_id === current) ? `<option value="${dinEscape(current)}" selected>${dinEscape(current)} (сохранённый датчик вне списка)</option>` : ""}`;
  }
  _refreshMetricOptions() {
    this.shadowRoot.querySelectorAll(".row").forEach((row) => {
      const index = Number(row.dataset.index);
      const item = this._config?.entities[index];
      if (!item) return;
      row.querySelectorAll(".metric-source").forEach((select) => {
        const refresh = () => { select.innerHTML = this._metricOptions(select.dataset.kind, item[`${select.dataset.kind}_entity`], item, index); };
        if (this.shadowRoot.activeElement === select) select.addEventListener("blur", refresh, { once: true });
        else refresh();
      });
      const scope = row.querySelector(".scope-hint");
      if (scope) scope.textContent = this._entityDeviceIds?.get(item.entity) ? this._showAllMetrics.has(index) ? "Показаны все подходящие датчики." : "Показаны датчики выбранного устройства." : "Привязка к устройству недоступна — показаны все подходящие датчики.";
      const toggle = row.querySelector(".scope-toggle");
      if (toggle) toggle.hidden = !this._entityDeviceIds?.get(item.entity);
    });
  }
  _update() {
    this._openRows = [...this.shadowRoot.querySelectorAll("details.actions[open]")].map((el) => Number(el.closest(".row").dataset.index));
    this._openTelemetryRows = [...this.shadowRoot.querySelectorAll("details.readings[open]")].map((el) => Number(el.closest(".row").dataset.index));
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
    this._render();
  }
  _render() {
    if (!this._config) return;
    this._rendered = true;
    const available = Object.values(this._hass?.states || {}).filter((s) => /^(switch|light)\./.test(s.entity_id)).sort((a, b) => (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id, "ru"));
    const options = (current) => `<option value="">Выбрать реле…</option>${available.map((s) => `<option value="${dinEscape(s.entity_id)}" ${s.entity_id === current ? "selected" : ""}>${dinEscape(s.attributes.friendly_name || s.entity_id)} (${dinEscape(s.entity_id)})</option>`).join("")}${current && !available.some((s) => s.entity_id === current) ? `<option value="${dinEscape(current)}" selected>${dinEscape(current)} (не найдено)</option>` : ""}`;
    const actionFields = (item, gesture, label) => {
      const a = item[`${gesture}_action`] || { action: gesture === "tap" ? "toggle" : gesture === "hold" ? "more-info" : "none" };
      const choices = [["toggle","Переключить"],["more-info","Подробнее"],["navigate","Перейти"],["url","Открыть URL"],["perform-action","Выполнить действие"],["assist","Assist"],["none","Ничего"],["fire-dom-event","Событие DOM"]];
      const field = a.action === "navigate" ? `<input class="action-param" data-key="navigation_path" placeholder="/lovelace/0" value="${dinEscape(a.navigation_path || "")}">` : a.action === "url" ? `<input class="action-param" data-key="url_path" placeholder="https://…" value="${dinEscape(a.url_path || "")}">` : a.action === "perform-action" || a.action === "call-service" ? `<input class="action-param" data-key="perform_action" placeholder="domain.service" value="${dinEscape(a.perform_action || a.service || "")}"><textarea class="action-json" data-key="data" placeholder='Данные JSON, например {"brightness":100}'>${dinEscape(JSON.stringify(a.data || {}))}</textarea><textarea class="action-json" data-key="target" placeholder='Цель JSON, например {"entity_id":"light.room"}'>${dinEscape(JSON.stringify(a.target || {}))}</textarea>` : "";
      return `<label>${label}<select class="action-type" data-gesture="${gesture}">${choices.map(([value,text]) => `<option value="${value}" ${a.action === value || (value === "perform-action" && a.action === "call-service") ? "selected" : ""}>${text}</option>`).join("")}</select></label><div class="action-extra" data-gesture="${gesture}">${field}</div>`;
    };
    this.shadowRoot.innerHTML = `<style>
      :host { display: block; color: var(--primary-text-color); }
      .wrap { display: grid; gap: 12px; padding: 8px 0; }
      label { display: grid; gap: 4px; font-size: 13px; }
      input, select, button { font: inherit; color: var(--primary-text-color); background: var(--card-background-color, white); border: 1px solid var(--divider-color, #aaa); border-radius: 7px; min-height: 38px; box-sizing: border-box; padding: 6px; }
      .row { display: grid; grid-template-columns: 1fr 40px; gap: 5px; }
      .row select { min-width: 0; }
      .row .name, .row .actions, .row .readings { grid-column: 1 / -1; }
      .actions, .readings { border: 1px solid var(--divider-color, #aaa); border-radius: 7px; padding: 6px; }
      .scope-toggle[hidden] { display: none; }
      .actions summary, .readings summary { cursor: pointer; }
      .actions label, .readings label { margin-top: 8px; }
      .action-extra { display: grid; gap: 4px; }
      .action-extra:empty { display: none; }
      textarea { width: 100%; min-height: 48px; box-sizing: border-box; resize: vertical; font: inherit; }
      .add { cursor: pointer; }
      .remove { cursor: pointer; }
      .hint { color: var(--secondary-text-color); font-size: 12px; }
    </style><div class="wrap"><label>Заголовок<input class="title" value="${dinEscape(this._config.title || "DIN-реле")}"></label>
      <label>Вид реле<select class="design"><option value="full" ${this._config.design !== "compact" ? "selected" : ""}>С клеммами и винтами</option><option value="compact" ${this._config.design === "compact" ? "selected" : ""}>Компактный, без винтов</option></select></label>
      <label>Масштаб реле: ${Math.round(this._config.scale * 100)}%<input class="scale" type="range" min="0.25" max="1.5" step="0.05" value="${this._config.scale}"></label>
      <label><span><input class="fit" type="checkbox" ${this._config.fit ? "checked" : ""}> Подогнать ряд по ширине при масштабе 100%</span></label>
      ${this._config.entities.map((item, index) => `<div class="row" data-index="${index}"><select class="entity">${options(item.entity)}</select><button class="remove" type="button" title="Удалить реле" aria-label="Удалить реле">×</button><input class="name" placeholder="Подпись (необязательно)" value="${dinEscape(item.name)}"><details class="readings" ${this._openTelemetryRows?.includes(index) ? "open" : ""}><summary>Показания под кнопкой</summary><label>Напряжение, В<select class="metric-source" data-kind="voltage">${this._metricOptions("voltage", item.voltage_entity, item, index)}</select></label><label>Ток, А<select class="metric-source" data-kind="current">${this._metricOptions("current", item.current_entity, item, index)}</select></label><label>Мощность, Вт<select class="metric-source" data-kind="power">${this._metricOptions("power", item.power_entity, item, index)}</select></label><label class="scope-toggle" ${this._entityDeviceIds?.get(item.entity) ? "" : "hidden"}><span><input class="show-all-metrics" type="checkbox" ${this._showAllMetrics.has(index) ? "checked" : ""}> Показать все датчики</span></label><div class="hint scope-hint">${this._entityDeviceIds?.get(item.entity) ? this._showAllMetrics.has(index) ? "Показаны все подходящие датчики." : "Показаны датчики выбранного устройства." : "Привязка к устройству недоступна — показаны все подходящие датчики."}</div><div class="hint">Если у реле есть одноимённые атрибуты, они используются без выбора сенсора.</div></details><details class="actions" ${this._openRows?.includes(index) ? "open" : ""}><summary>Действия оранжевой кнопки</summary>${actionFields(item,"tap","Короткое нажатие")}${actionFields(item,"hold","Долгое нажатие")}${actionFields(item,"double_tap","Двойное нажатие")}</details></div>`).join("")}
      <button class="add" type="button">+ Добавить реле</button><div class="hint">Версия ${DIN_CARD_VERSION}. Количество модулей равно числу строк. Поддерживаются сущности switch и light.</div></div>`;
    this.shadowRoot.querySelector(".title").addEventListener("change", (e) => { this._config.title = e.target.value; this._update(); });
    this.shadowRoot.querySelector(".design").addEventListener("change", (e) => { this._config.design = e.target.value; this._update(); });
    this.shadowRoot.querySelector(".scale").addEventListener("change", (e) => { this._config.scale = Number(e.target.value); this._update(); });
    this.shadowRoot.querySelector(".fit").addEventListener("change", (e) => { this._config.fit = e.target.checked; this._update(); });
    this.shadowRoot.querySelector(".add").addEventListener("click", () => { this._config.entities.push({ entity: "", name: "" }); this._update(); });
    this.shadowRoot.querySelectorAll(".row").forEach((row) => {
      const index = Number(row.dataset.index);
      row.querySelector(".entity").addEventListener("change", (e) => { this._config.entities[index].entity = e.target.value; this._showAllMetrics.delete(index); this._update(); });
      row.querySelector(".name").addEventListener("change", (e) => { this._config.entities[index].name = e.target.value; this._update(); });
      row.querySelectorAll(".metric-source").forEach((select) => select.addEventListener("change", () => { this._config.entities[index][`${select.dataset.kind}_entity`] = select.value; this._update(); }));
      row.querySelector(".show-all-metrics").addEventListener("change", (e) => { if (e.target.checked) this._showAllMetrics.add(index); else this._showAllMetrics.delete(index); this._refreshMetricOptions(); });
      row.querySelector(".remove").addEventListener("click", () => { this._config.entities.splice(index, 1); this._showAllMetrics.clear(); this._update(); });
      row.querySelectorAll(".action-type").forEach((select) => select.addEventListener("change", () => { this._config.entities[index][`${select.dataset.gesture}_action`] = { action: select.value }; this._update(); }));
      row.querySelectorAll(".action-param").forEach((input) => input.addEventListener("change", () => { const gesture = input.closest(".action-extra").dataset.gesture; this._config.entities[index][`${gesture}_action`][input.dataset.key] = input.value; this._update(); }));
      row.querySelectorAll(".action-json").forEach((input) => input.addEventListener("change", () => { try { const value = JSON.parse(input.value || "{}"); const gesture = input.closest(".action-extra").dataset.gesture; this._config.entities[index][`${gesture}_action`][input.dataset.key] = value; input.setCustomValidity(""); this._update(); } catch { input.setCustomValidity("Нужен корректный JSON"); input.reportValidity(); } }));
    });
  }
}

customElements.define("sonoff-din-rail-card", SonoffDinRailCard);
customElements.define("sonoff-din-rail-card-editor", SonoffDinRailCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({ type: "sonoff-din-rail-card", name: "Sonoff DIN Rail Card", description: "Несколько DIN-реле в ряд с управлением прямо из карточки" });
