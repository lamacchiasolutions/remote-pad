(() => {
  "use strict";
  if (window.RemotePadUI) return;

  const lookSettings = {
    sensitivity: { key: "remote-pad.look-sensitivity.v1", bridge: "remotePadSensitivity", method: "setSensitivity", min: .25, max: 3, step: .05,
      label: "Mouse sensitivity", display: value => value.toFixed(2) + "×" },
    lookDeadzone: { key: "remote-pad.look-minimum.v1", bridge: "remotePadLookDeadzone", method: "setLookDeadzone", min: 0, max: .5, step: .01,
      label: "Minimum look strength", display: value => Math.round(value * 100) + "%" }
  };
  const controls = () => window.RemotePadController;
  let active = false;
  let pending = false;
  let timer;
  let host;
  let shadow;
  let captureButton;
  let status;
  let settings;
  let settingButton;
  let dialog;
  let editor;
  let error = "";
  const revisions = { sensitivity: 0, lookDeadzone: 0 };
  let monitorTimer;
  let monitorEnabled = false;
  let monitor;
  let stickDot;
  let triggerLights = [];

  const styles = `
    :host { all:initial!important; position:fixed!important; bottom:16px!important; left:16px!important; z-index:2147483647!important; color-scheme:dark; }
    .dock { font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif; color:#edf3e9; max-width:min(340px,calc(100vw - 40px)); }
    .row,.panel { background:#17221d; border:1px solid #536256; box-shadow:0 4px 18px #0005; border-radius:12px; }
    .row { display:flex; gap:3px; width:max-content; align-items:center; padding:4px; }
    button { font:inherit; color:inherit; border:0; background:transparent; border-radius:8px; cursor:pointer; min-height:32px; }
    button:focus-visible, input:focus-visible { outline:2px solid white; outline-offset:2px; }
    .capture { padding:5px 11px; color:#182519; background:#c1ed91; font-weight:650; }
    .toggle { font:600 17px/1 system-ui; width:34px; }
    .panel { margin-bottom:6px; padding:13px; width:236px; }
    label { display:flex; justify-content:space-between; }
    input { width:100%; margin:10px 0 0; accent-color:#c1ed91; }
    .range-row + .range-row { margin-top:13px; }
    .monitor-switch { display:flex; justify-content:flex-start; align-items:center; gap:7px; margin-top:10px; }
    .monitor-switch input { width:auto; margin:0; }
    .monitor { display:flex; align-items:center; gap:6px; width:fit-content; margin:0 0 4px; padding:5px 7px; border-radius:7px; background:#17221df2; color:#e4eee6; font-size:11px; }
    .scope { position:relative; width:20px; height:20px; border-radius:50%; border:1px solid #9aaf98; background:#28382d; }
    .scope i { position:absolute; top:50%; left:50%; width:5px; height:5px; margin:-2.5px; background:#c1ed91; border-radius:50%; }
    .monitor b { font:600 10px/1.4 ui-monospace,monospace; padding:2px 4px; border:1px solid #667c66; color:#b8c5b9; border-radius:4px; }
    .monitor b.on { color:#152516; background:#c1ed91; border-color:#c1ed91; }
    .hint { margin:9px 0 0; color:#c3d0c6; font-size:12px; }
    .message { max-width:284px; width:fit-content; margin:0 0 6px; padding:7px 10px; border-radius:8px; background:#17221df7; }
    .edit-map { width:100%; border:1px solid #5d735d; background:#2b392e; margin-top:10px; }
    dialog { box-sizing:border-box; width:min(920px,calc(100vw - 32px)); max-height:calc(100vh - 32px); overflow:auto; background:#151d18; color:#ecf1e5; border:1px solid #516453; border-radius:16px; padding:20px; font:14px/1.45 -apple-system,system-ui,sans-serif; }
    dialog::backdrop { background:#07110ac9; }
    .dialog-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
    .dialog-head h2 { margin:0; font:650 24px/1.15 -apple-system,system-ui,sans-serif; }
    .dialog-head button { border:1px solid #667a63; padding:4px 12px; }
    [hidden] { display:none!important; }
    .playing { color:#e4eee6; background:#19271fd9; padding:4px 9px; border-radius:7px; font:500 11px/1.4 -apple-system,sans-serif; opacity:.72; pointer-events:none; }
    @media (prefers-reduced-motion:no-preference) { .playing { animation:quiet 4s forwards; } @keyframes quiet { 0%,60% {opacity:.85} 100% {opacity:.27} } }
  `;
  const element = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };

  function report(message) {
    error = message;
    if (status) {
      status.textContent = message;
      status.hidden = !message;
    }
    window.dispatchEvent(new CustomEvent("remotepadnotice", { detail: message }));
  }

  function setLookSetting(id, value) {
    const option = lookSettings[id];
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    revisions[id]++;
    controls()[option.method](parsed);
    const saved = controls().getState()[id];
    try { localStorage.setItem(option.key, String(saved)); } catch {}
    const bridge = window.webkit?.messageHandlers?.[option.bridge];
    if (bridge) bridge.postMessage(saved).catch(() => {});
  }

  function restoreLookSettings() {
    for (const [id, option] of Object.entries(lookSettings)) {
      const revision = ++revisions[id];
      const valid = value => Number.isFinite(value) && value >= option.min && value <= option.max;
      try {
        const stored = localStorage.getItem(option.key);
        if (stored !== null && valid(Number(stored))) controls()[option.method](Number(stored));
      } catch {}
      const bridge = window.webkit?.messageHandlers?.[option.bridge];
      if (bridge) bridge.postMessage("get").then(value => {
        if (active && revisions[id] === revision && valid(value)) controls()[option.method](value);
      }).catch(() => {});
    }
  }

  function makeRange(id) {
    const option = lookSettings[id];
    const wrapper = element("div", null, "range-row");
    const label = element("label", option.label);
    label.htmlFor = id;
    const value = element("output");
    const slider = element("input");
    slider.type = "range"; slider.id = id; slider.min = option.min; slider.max = option.max; slider.step = option.step;
    value.setAttribute("for", id);
    slider.addEventListener("input", () => setLookSetting(id, slider.value));
    label.append(value); wrapper.append(label,slider);
    return wrapper;
  }

  function updateMonitor() {
    if (!monitor) return;
    const { axes, buttons } = controls().getState();
    stickDot.style.transform = "translate(" + (axes[2] * 7) + "px," + (axes[3] * 7) + "px)";
    triggerLights.forEach((light, index) => light.classList.toggle("on", buttons[6 + index] > 0));
  }

  function setMonitorVisible(visible) {
    if (monitor) monitor.hidden = !visible;
    if (visible && !monitorTimer) {
      updateMonitor();
      monitorTimer = setInterval(updateMonitor, 50);
    } else if (!visible && monitorTimer) {
      clearInterval(monitorTimer); monitorTimer = undefined;
    }
  }

  function releasePending() {
    pending = false;
    clearTimeout(timer);
  }

  function lockChanged() {
    if (!active || !pending || !document.pointerLockElement) return;
    releasePending();
    controls().start();
    report("");
    render();
  }

  function lockFailed() {
    if (!pending) return;
    releasePending();
    controls().stop();
    report("Mouse capture was declined. Click Capture inputs to try again.");
    render();
  }

  function capture() {
    if (!active || pending) return;
    if (controls().getState().capturing) { controls().stop(); return; }
    const target = document.fullscreenElement || document.body || document.documentElement;
    if (typeof target?.requestPointerLock !== "function") {
      report("This window cannot capture the mouse. Use the Chrome option on the app’s home screen.");
      return;
    }
    if (shadow?.activeElement instanceof HTMLElement) shadow.activeElement.blur();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    pending = true;
    report("");
    timer = setTimeout(lockFailed, 3500);
    try {
      if (document.pointerLockElement) { lockChanged(); return; }
      const request = target.requestPointerLock();
      if (request && typeof request.then === "function") request.then(lockChanged, lockFailed);
    } catch { lockFailed(); }
  }

  function mount() {
    if (!active || !host) return;
    const full = document.fullscreenElement;
    // Replaced elements (such as <video>) do not paint child controls. F8 still works.
    const container = full && !["VIDEO","CANVAS","IFRAME"].includes(full.tagName)
      ? full : (document.body || document.documentElement);
    if (container && host.parentNode !== container) container.append(host);
  }

  function render() {
    if (!host || !active) return;
    const state = controls().getState();
    const playing = state.capturing;
    for (const [id, option] of Object.entries(lookSettings)) {
      settings.querySelector("#" + id).value = state[id];
      settings.querySelector('output[for="' + id + '"]').textContent = option.display(state[id]);
    }
    setMonitorVisible(playing && monitorEnabled);
    captureButton.parentElement.hidden = playing;
    shadow.querySelector(".playing").hidden = !playing;
    host.style.setProperty("pointer-events", playing ? "none" : "auto", "important");
    if (playing) { settings.hidden = true; settingButton.setAttribute("aria-expanded", "false"); }
  }

  function openMapper() {
    if (dialog) return;
    controls().stop();
    dialog = element("dialog");
    dialog.setAttribute("aria-label", "Controller layout");
    const header = element("div", null, "dialog-head");
    const done = element("button", "Done");
    done.addEventListener("click", () => dialog.close());
    header.append(element("h2", "Controller layout"), done);
    const panel = element("div");
    dialog.append(header, panel); shadow.append(dialog);
    for (const type of ["click","keydown","keyup","pointerdown","pointerup"]) {
      dialog.addEventListener(type, event => event.stopPropagation());
    }
    dialog.addEventListener("close", closeMapper, {once:true});
    dialog.showModal();
    editor = window.RemotePadMapper.mount(panel);
  }

  function closeMapper() {
    if (!dialog) return;
    editor?.destroy(); editor = undefined;
    dialog.remove(); dialog = undefined;
    settingButton?.focus();
  }

  function makeDock() {
    host = element("div");
    host.id = "remote-pad-controls";
    shadow = host.attachShadow({ mode: "open" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(styles);
      shadow.adoptedStyleSheets = [sheet];
    } catch { shadow.append(element("style", styles)); }
    const dock = element("div", null, "dock");
    status = element("p", null, "message");
    status.hidden = true;
    status.setAttribute("role", "status");
    settings = element("div", null, "panel");
    settings.hidden = true;
    const monitorSwitch = element("label", null, "monitor-switch");
    const showMonitor = element("input");
    showMonitor.type = "checkbox";
    try { monitorEnabled = localStorage.getItem("remote-pad.show-look.v1") === "1"; } catch {}
    showMonitor.checked = monitorEnabled;
    showMonitor.addEventListener("change", () => {
      monitorEnabled = showMonitor.checked;
      try { localStorage.setItem("remote-pad.show-look.v1", monitorEnabled ? "1" : "0"); } catch {}
    });
    monitorSwitch.append(showMonitor, document.createTextNode("Show stick and triggers during play"));
    const mapButton = element("button", "Map controls", "edit-map");
    mapButton.addEventListener("click", openMapper);
    settings.append(makeRange("sensitivity"), makeRange("lookDeadzone"),
      element("p", "Raise the minimum if a game ignores small mouse movements.", "hint"),
      monitorSwitch, mapButton, element("p", "Esc releases your inputs.", "hint"));
    const row = element("div", null, "row");
    captureButton = element("button", "Capture inputs", "capture");
    captureButton.addEventListener("click", capture);
    settingButton = element("button", "⋯", "toggle");
    settingButton.setAttribute("aria-label", "Controller settings");
    settingButton.setAttribute("aria-expanded", "false");
    settingButton.addEventListener("click", () => {
      settings.hidden = !settings.hidden;
      settingButton.setAttribute("aria-expanded", String(!settings.hidden));
    });
    row.append(captureButton, settingButton);
    const playing = element("div", "Remote Pad   ·   Esc to release", "playing");
    playing.hidden = true;
    monitor = element("div", null, "monitor");
    monitor.hidden = true;
    const scope = element("span", null, "scope");
    stickDot = element("i"); scope.append(stickDot);
    triggerLights = [element("b", "LT"), element("b", "RT")];
    monitor.append(element("span", "Right stick"), scope, ...triggerLights);
    dock.append(status, settings, row, monitor, playing); shadow.append(dock);
    mount(); render();
  }

  function shortcut(event) {
    if (!active || dialog || event.code !== "F8" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (Object.values(controls().getBindings()).some(codes => codes.includes("F8"))) return;
    if (event.composedPath().some(n => n instanceof HTMLElement && (n.isContentEditable || n.matches("input,textarea,select")))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    capture();
  }

  function enable(bench) {
    if (active) { mount(); return; }
    active = true;
    const pad = controls();
    restoreLookSettings();
    window.RemotePadBindings.load().catch(error => report(error.message));
    pad.connect();
    document.addEventListener("pointerlockchange", lockChanged);
    document.addEventListener("pointerlockerror", lockFailed);
    document.addEventListener("fullscreenchange", mount);
    window.addEventListener("keydown", shortcut, true);
    window.addEventListener("remotepadstatechange", render);
    if (!bench) makeDock();
  }

  function disable() {
    if (!active) return;
    active = false;
    closeMapper();
    releasePending();
    controls().disconnect();
    document.removeEventListener("pointerlockchange", lockChanged);
    document.removeEventListener("pointerlockerror", lockFailed);
    document.removeEventListener("fullscreenchange", mount);
    window.removeEventListener("keydown", shortcut, true);
    window.removeEventListener("remotepadstatechange", render);
    setMonitorVisible(false); monitor = stickDot = null; triggerLights = [];
    host?.remove(); host = shadow = captureButton = status = settingButton = settings = null;
  }

  window.RemotePadUI = Object.freeze({ enable, disable, capture,
    wantsMouseRouting: () => active && (pending || controls().getState().capturing),
    setSensitivity: value => setLookSetting("sensitivity", value),
    setLookDeadzone: value => setLookSetting("lookDeadzone", value),
    getNotice: () => error
  });
})();
