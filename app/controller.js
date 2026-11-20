/* Page-world input bridge. The host calls install() only on its selected game pages. */
(() => {
  "use strict";
  if (window.RemotePadController) return;
  const here = window.location;
  const ps5Player = here?.origin === "http://127.0.0.1:17365";
  const localEditor = (here?.protocol === "file:" || here?.origin === "https://remote-pad.invalid") &&
    /\/(?:bench|mapper)\.html$/.test(here.pathname);
  const ps5 = ps5Player || (localEditor && new URLSearchParams(here.search).get("console") === "ps5");

  // First 17 controls follow the W3C standard gamepad button order.
  const defaults = {
    a: ["Space"], b: ["KeyC"], x: ["KeyR"], y: ["KeyF"], lb: ["KeyQ"], rb: ["KeyE"],
    lt: ["Mouse2"], rt: ["Mouse0"], view: ["Tab"], menu: ["Enter"], ls: ["ShiftLeft"], rs: ["KeyV"],
    up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"], guide: ["KeyG"],
    lxLeft: ["KeyA"], lxRight: ["KeyD"], lyUp: ["KeyW"], lyDown: ["KeyS"],
    rxLeft: ["MouseMoveLeft"], rxRight: ["MouseMoveRight"], ryUp: ["MouseMoveUp"], ryDown: ["MouseMoveDown"],
    touchpad: ["KeyT"]
  };
  const buttonControls = Object.keys(defaults).slice(0, 17);
  if (ps5) buttonControls.push("touchpad");
  const sticks = [
    ["lxLeft", "lxRight", "lyUp", "lyDown"], ["rxLeft", "rxRight", "ryUp", "ryDown"]
  ];
  const motionDirections = new Map(["MouseMoveLeft", "MouseMoveRight", "MouseMoveUp", "MouseMoveDown"]
    .map((token, direction) => [token, direction]));
  const mouseMasks = [1, 4, 2, 8, 16]; // MouseEvent.buttons uses a different order than button.
  const pressed = new Set();
  const motion = [0, 0, 0, 0];
  const motionHeldUntil = Array(4).fill(-Infinity);
  let bindings = defaults;
  const activeControls = [...buttonControls, ...sticks.flat()];
  const mappedInputs = layout => new Set(activeControls.flatMap(id => layout[id]));
  let boundInputs = mappedInputs(bindings);
  let inputsDirty = true;
  let lastSampledAt = -Infinity;
  const buttonValues = Array(buttonControls.length).fill(0);
  const forwardedKeys = new WeakSet();
  const pageKeys = new Set();
  const axes = [0, 0, 0, 0];
  const syntheticEvents = new WeakSet();
  // Full stick at ~767 px/s at 1x. Retain the user's established sensitivity scale.
  const velocityWindowMs = 30;
  const fullStickDistance = 23;
  const motionHoldMs = 55;
  const motionEndMs = 135;

  let installed = false;
  let index = -1;
  let capturing = false;
  let hadPointerLock = false;
  let sensitivity = 1;
  let lookDeadzone = 0.27;
  let nativeMouseSession = null;
  let nativeGetGamepads;
  let mouseX = 0;
  let mouseY = 0;
  let lastMotion = -Infinity;
  let sampleGain = 1;
  let lastMotionEvent;
  let timestamp = 0;
  let connection;
  let captureAnnounced = false;
  let cachedAxes;
  let cachedButtons;
  let rawFrame = null;
  let rawAxes = axes.slice();
  let rawButtons = buttonValues.slice();

  function changed() {
    // Xbox compares with ">" and macOS can deliver several reports on the same
    // browser clock tick. Give each distinct report a strictly newer timestamp.
    timestamp = Math.max(performance.now(), timestamp + 0.001);
  }

  function readPhysicalPads() {
    return nativeGetGamepads ? nativeGetGamepads.call(navigator) : [null, null, null, null];
  }

  function notify() {
    window.dispatchEvent(new Event("remotepadstatechange"));
  }

  function cloneBindings(map) {
    return Object.fromEntries(Object.entries(map).map(([name, inputs]) => [name, inputs.slice()]));
  }

  function validInput(token) {
    // Accept physical codes reported by keyboards, including vendor and international
    // keys. The Mouse namespace is restricted to the switches and motion we handle.
    if (typeof token !== "string" || !/^[A-Z][A-Za-z0-9]{0,47}$/.test(token)) return false;
    if (token.startsWith("Mouse")) return /^Mouse[0-4]$/.test(token) || motionDirections.has(token);
    return !["Escape", "Meta", "MetaLeft", "MetaRight", "OSLeft", "OSRight", "Unidentified"].includes(token);
  }

  function setBindings(map) {
    if (Object.prototype.toString.call(map) !== "[object Object]") {
      throw new TypeError("Bindings must be an object.");
    }
    const next = cloneBindings(defaults);
    for (const [control, tokens] of Object.entries(map)) {
      if (!Object.hasOwn(defaults, control)) throw new TypeError("Unknown controller input: " + control);
      if (!Array.isArray(tokens) || tokens.length > 32 || Array.from(tokens).some(token => !validInput(token))) {
        throw new TypeError("Invalid or reserved binding for " + control);
      }
      next[control] = [...new Set(tokens)];
    }
    // A storage sync or a settings window can send the same profile during play.
    const same = Object.entries(next).every(([control, tokens]) =>
      tokens.length === bindings[control].length && tokens.every((token, i) => token === bindings[control][i]));
    if (same) return cloneBindings(bindings);
    neutralize();
    bindings = next;
    boundInputs = mappedInputs(bindings);
    notify();
    return cloneBindings(bindings);
  }

  function setPressed(token, down) {
    if (pressed.has(token) === down) return;
    if (down) pressed.add(token);
    else pressed.delete(token);
    inputsDirty = true;
    scheduleRawInput();
  }

  function decay(at) {
    const age = Math.max(0, at - lastMotion);
    if (age <= motionHoldMs) return 1;
    if (age >= motionEndMs) return 0;
    const t = (age - motionHoldMs) / (motionEndMs - motionHoldMs);
    return 1 - t * t * (3 - 2 * t);
  }

  function sampleMotion(at, minimum = lookDeadzone) {
    const scale = sensitivity / fullStickDistance;
    let x = mouseX * scale;
    let y = mouseY * scale;
    const radius = Math.hypot(x, y);
    if (radius < 0.001) {
      x = y = 0;
    } else if (radius > 1) {
      x /= radius;
      y /= radius;
    } else if (minimum > 0) {
      const gain = (minimum + (1 - minimum) * radius) / radius;
      x *= gain;
      y *= gain;
    }
    // Fade the compensated vector too, so true idle always reaches exact center.
    const fade = decay(at);
    x *= fade;
    y *= fade;
    motion[0] = Math.max(0, -x);
    motion[1] = Math.max(0, x);
    motion[2] = Math.max(0, -y);
    motion[3] = Math.max(0, y);
  }

  function controlValue(control, isButton, at) {
    let value = 0;
    for (const token of bindings[control]) {
      if (pressed.has(token)) return 1;
      const direction = motionDirections.get(token);
      if (direction !== undefined) {
        const level = isButton ? Number(at < motionHeldUntil[direction]) : motion[direction];
        value = Math.max(value, level);
      }
    }
    return value;
  }

  function sampleInputs(at) {
    if (!inputsDirty && (lastSampledAt === at || lastSampledAt >= lastMotion + motionEndMs)) return;
    inputsDirty = false;
    lastSampledAt = at;
    sampleMotion(at);
    let reportChanged = false;
    for (const [i, control] of buttonControls.entries()) {
      const value = controlValue(control, true, at);
      if (buttonValues[i] === value) continue;
      buttonValues[i] = value;
      if (ps5Player && control === "touchpad") sendPageKey("Tab", value);
      cachedButtons = undefined;
      reportChanged = true;
    }
    for (const [stick, [left, right, up, down]] of sticks.entries()) {
      const x = controlValue(right, false, at) - controlValue(left, false, at);
      const y = controlValue(down, false, at) - controlValue(up, false, at);
      const radius = Math.max(1, Math.hypot(x, y));
      const i = stick * 2;
      if (axes[i] === x / radius && axes[i + 1] === y / radius) continue;
      axes[i] = x / radius;
      axes[i + 1] = y / radius;
      cachedAxes = undefined;
      reportChanged = true;
    }
    if (reportChanged) changed();
  }

  function resetMotion() {
    motion.fill(0);
    motionHeldUntil.fill(-Infinity);
    mouseX = mouseY = 0;
    sampleGain = 1;
    lastMotion = -Infinity;
    lastMotionEvent = undefined;
    inputsDirty = true;
    scheduleRawInput();
  }

  function neutralize() {
    pressed.clear();
    resetMotion();
    if (ps5Player && buttonValues[17]) sendPageKey("Tab", false);
    buttonValues.fill(0);
    axes.fill(0);
    cachedAxes = undefined;
    cachedButtons = undefined;
    changed();
  }

  function getState() {
    sampleInputs(performance.now());
    return { connected: index >= 0, capturing, sensitivity, lookDeadzone, index,
      buttons: buttonValues.slice(), axes: axes.slice() };
  }

  function makeButton(value) {
    const button = Object.create(window.GamepadButton?.prototype || Object.prototype);
    return Object.freeze(Object.defineProperties(button, {
      pressed: { value: value === 1, enumerable: true },
      touched: { value: value === 1, enumerable: true },
      value: { value, enumerable: true }
    }));
  }

  const buttons = [makeButton(0), makeButton(1)];
  const neutralButtons = Object.freeze(buttonValues.map(() => buttons[0]));
  const neutralAxes = Object.freeze(axes.slice());

  // Some streaming clients retain the pad from gamepadconnected, others poll.
  // Both get the same object. Stored button and axis arrays remain snapshots.
  function makeConnection(slot) {
    let disconnectedAt = null;
    const fields = {
      id: ps5 ? "Remote Pad PS5 Controller" : "Xbox 360 Controller (XInput STANDARD GAMEPAD)", index: slot, mapping: "standard",
      get connected() { return disconnectedAt === null; },
      get timestamp() {
        if (disconnectedAt !== null) return disconnectedAt;
        sampleInputs(performance.now());
        return timestamp;
      },
      get axes() {
        if (disconnectedAt !== null) return neutralAxes;
        sampleInputs(performance.now());
        return cachedAxes ||= Object.freeze(axes.slice());
      },
      get buttons() {
        if (disconnectedAt !== null) return neutralButtons;
        sampleInputs(performance.now());
        return cachedButtons ||= Object.freeze(buttonValues.map(value => buttons[value]));
      },
      vibrationActuator: null, hapticActuators: Object.freeze([]), touchEvents: Object.freeze([])
    };
    const pad = Object.create(window.Gamepad?.prototype || Object.prototype, Object.getOwnPropertyDescriptors(fields));
    return { pad: Object.freeze(pad), retire() { disconnectedAt = performance.now(); } };
  }

  function announce(type, pad, details) {
    // Native GamepadEvent constructors reject virtual Gamepad objects. Retain the
    // Event's DOM dispatch behavior and supply the standard event.gamepad property.
    const event = new Event(type);
    const EventClass = details ? window.GamepadRawInputChangeEvent || window.GamepadEvent : window.GamepadEvent;
    if (EventClass) Object.setPrototypeOf(event, EventClass.prototype);
    Object.defineProperty(event, "gamepad", { value: pad, enumerable: true });
    if (details) for (const [key, value] of Object.entries(details)) {
      Object.defineProperty(event, key, { value: Object.freeze(value), enumerable: true });
    }
    syntheticEvents.add(event);
    window.dispatchEvent(event);
  }

  // Xbox can select event-driven input on browsers with GamepadRawInputChangeEvent.
  // Coalesce reports per display frame and keep sampling through the final recenter.
  function sendRawChanges() {
    if (!connection || !("ongamepadrawinputchanged" in window)) return;
    sampleInputs(performance.now());
    const axesChanged = [];
    const buttonsValueChanged = [];
    for (let i = 0; i < axes.length; i++) if (axes[i] !== rawAxes[i]) axesChanged.push(i);
    for (let i = 0; i < buttonValues.length; i++) if (buttonValues[i] !== rawButtons[i]) buttonsValueChanged.push(i);
    if (!axesChanged.length && !buttonsValueChanged.length) return;
    rawAxes = axes.slice();
    rawButtons = buttonValues.slice();
    announce("gamepadrawinputchanged", connection.pad, {
      axesChanged, buttonsValueChanged, buttonsPressed: buttonsValueChanged.filter(i => buttonValues[i]),
      buttonsReleased: buttonsValueChanged.filter(i => !buttonValues[i]), touchesChanged: []
    });
  }

  function scheduleRawInput() {
    if (!capturing || rawFrame !== null || !("ongamepadrawinputchanged" in window)) return;
    rawFrame = window.requestAnimationFrame(() => {
      rawFrame = null;
      sendRawChanges();
      if (performance.now() < lastMotion + motionEndMs) scheduleRawInput();
    });
  }

  function freeSlot(physical) {
    for (let slot = 0; slot < physical.length; slot++) {
      if (!physical[slot]) return slot;
    }
    return physical.length;
  }

  function reconcile(physical) {
    if (index < 0 || !physical[index]) return;
    const previous = connection;
    previous.retire();
    index = freeSlot(physical);
    connection = makeConnection(index);
    changed();
    announce("gamepaddisconnected", previous.pad);
    announce("gamepadconnected", connection.pad);
    notify();
  }

  function install() {
    if (installed) return;
    // Patch the method where the browser defines it, before the stream can cache it.
    let owner = navigator;
    while (owner && !Object.hasOwn(owner, "getGamepads")) owner = Object.getPrototypeOf(owner);
    owner ||= navigator;
    nativeGetGamepads = navigator.getGamepads;
    const original = Object.getOwnPropertyDescriptor(owner, "getGamepads");
    Object.defineProperty(owner, "getGamepads", {
      configurable: original?.configurable ?? true,
      writable: original?.writable ?? true,
      enumerable: original?.enumerable ?? false,
      value: function getGamepads() {
        const physical = nativeGetGamepads ? nativeGetGamepads.apply(this, arguments) : readPhysicalPads();
        if (index < 0) return physical;
        reconcile(physical);
        const result = Array.from(physical);
        result[index] = connection.pad;
        return Object.freeze(result);
      }
    });
    installed = true;
    const active = { capture: true, passive: false };
    window.addEventListener("gamepadconnected", event => {
      if (!syntheticEvents.has(event) && index >= 0) reconcile(readPhysicalPads());
    }, true);
    for (const type of ["keydown", "keyup"]) window.addEventListener(type, keyInput, active);
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) {
      window.addEventListener(type, mouseButton, active);
    }
    for (const type of ["pointermove", "mousemove"]) window.addEventListener(type, mouseMove, active);
    for (const type of ["click", "dblclick", "auxclick", "contextmenu"]) {
      window.addEventListener(type, event => {
        if (captureMouse(event) && boundInputs.has("Mouse" + event.button)) consume(event);
      }, active);
    }
    window.addEventListener("blur", () => stop(), false);
    window.addEventListener("pagehide", () => stop(), false);
    window.addEventListener("focusin", event => {
      if (capturing && editable(event)) stop();
    }, true);
    window.addEventListener("pointercancel", () => { if (capturing) neutralize(); }, true);
    document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
    document.addEventListener("pointerlockchange", () => {
      const locked = Boolean(document.pointerLockElement);
      if (!locked && hadPointerLock && capturing) stop();
      hadPointerLock = locked;
    });
  }

  function connect() {
    install();
    if (index < 0) {
      index = freeSlot(readPhysicalPads());
      connection = makeConnection(index);
      captureAnnounced = false;
      changed();
      announce("gamepadconnected", connection.pad);
      notify();
    }
    return getState();
  }

  function start() {
    const wasConnected = index >= 0;
    connect();
    if (!capturing) {
      // Release keys the companion saw before the pointer was captured.
      for (const code of pageKeys) sendPageKey(code, false);
      pageKeys.clear();
      hadPointerLock = Boolean(document.pointerLockElement);
      capturing = true;
      // A page can add listeners after our document-start connection announcement.
      const replay = wasConnected && !captureAnnounced;
      captureAnnounced = true;
      if (replay) announce("gamepadconnected", connection.pad);
      notify();
    }
    return getState();
  }

  function stop() {
    pageKeys.clear();
    nativeMouseSession = null;
    if (capturing) {
      capturing = false;
      neutralize();
      if (rawFrame !== null) window.cancelAnimationFrame(rawFrame);
      rawFrame = null;
      sendRawChanges();
      if (document.pointerLockElement) document.exitPointerLock?.();
      notify();
    }
    return getState();
  }

  function disconnect() {
    stop();
    if (index >= 0) {
      const previous = connection;
      previous.retire();
      index = -1;
      connection = undefined;
      changed();
      announce("gamepaddisconnected", previous.pad);
      notify();
    }
    return getState();
  }

  function setSensitivity(value) {
    if (Number.isFinite(value)) {
      sensitivity = Math.min(3, Math.max(0.25, value));
      inputsDirty = true;
      scheduleRawInput();
      notify();
    }
    return getState();
  }

  function setLookDeadzone(value) {
    if (Number.isFinite(value)) {
      lookDeadzone = Math.min(0.5, Math.max(0, value));
      inputsDirty = true;
      scheduleRawInput();
      notify();
    }
    return getState();
  }

  // The embedder can arm at pointer-lock approval, before the page enters capture.
  // Matching tokens keep queued native deltas or teardown from an old lock harmless.
  function setNativeMouseRouting(session) {
    if (typeof session !== "string" || !session.length) return false;
    if (nativeMouseSession !== session) resetMotion();
    nativeMouseSession = session;
    return true;
  }

  function endNativeMouseRouting(session) {
    if (!nativeMouseSession || nativeMouseSession !== session) return false;
    nativeMouseSession = null;
    resetMotion();
    return true;
  }

  function nativeMouseMove(session, dx, dy) {
    if (!nativeMouseSession || session !== nativeMouseSession || !capturing ||
        !document.pointerLockElement || document.hidden || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    if (dx || dy) recordMotion(dx, dy);
    return true;
  }

  function editable(event) {
    const selector = "input, textarea, select, [role=textbox], [contenteditable]:not([contenteditable=false])";
    return (event.composedPath?.() || [event.target]).some(node =>
      node?.isContentEditable || node?.closest?.(selector)
    ) || Boolean(document.activeElement?.closest?.(selector));
  }

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // ps5web polls the standard buttons, and accepts its touchpad click through Tab.
  function sendPageKey(code, down) {
    const event = new KeyboardEvent(down ? "keydown" : "keyup", { code, key: code === "Tab" ? "Tab" : "", cancelable: true });
    forwardedKeys.add(event);
    window.dispatchEvent(event);
  }

  function keyInput(event) {
    if (forwardedKeys.has(event)) return;
    if (!capturing) {
      if (ps5Player && document.body?.classList.contains("mode-control")) {
        if (event.type === "keyup") pageKeys.delete(event.code);
        else if (event.code && !event.metaKey && !editable(event)) pageKeys.add(event.code);
      }
      return;
    }
    if (event.code === "Escape" && event.type === "keydown") {
      consume(event);
      stop();
      return;
    }
    if (event.metaKey || event.isComposing || editable(event)) {
      neutralize();
      return;
    }
    if (!boundInputs.has(event.code)) {
      // The PS5 companion also has its own key mappings. During capture our layout owns these keys.
      if (ps5Player && event.code !== "F8") consume(event);
      return;
    }
    consume(event);
    setPressed(event.code, event.type === "keydown");
  }

  function captureMouse(event) {
    return capturing && !event.metaKey && !editable(event);
  }

  // Pointer Events reports chorded mouse buttons as pointermove. A bitmask also
  // repairs missed button-up events on the next physical mouse event.
  function syncMouseButtons(event) {
    if (!Number.isInteger(event.buttons)) return;
    for (const [button, mask] of mouseMasks.entries()) {
      const token = "Mouse" + button;
      if (boundInputs.has(token)) setPressed(token, Boolean(event.buttons & mask));
    }
  }

  function mouseButton(event) {
    if (event.pointerType && event.pointerType !== "mouse") return;
    const token = "Mouse" + event.button;
    if (!captureMouse(event)) {
      if (capturing && event.type.endsWith("up")) setPressed(token, false);
      return;
    }
    syncMouseButtons(event);
    if (!boundInputs.has(token)) return;
    // Cancelling pointerdown suppresses compatibility mousemove while dragging,
    // including the relative coordinates used for aim. Cancel the mouse event.
    if (event.type.startsWith("pointer") && event.button < 3) event.stopImmediatePropagation();
    else consume(event);
    setPressed(token, event.type.endsWith("down"));
  }

  function mouseMove(event) {
    if (event.type === "pointermove" && event.pointerType !== "mouse") return;
    if (!captureMouse(event)) return;
    consume(event);
    syncMouseButtons(event);
    if (nativeMouseSession) return;
    const dx = event.movementX || 0;
    const dy = event.movementY || 0;
    if (!dx && !dy) return;
    // WebKit and Chromium use the source sample's timestamp for both events.
    // Process either event independently when a locked view emits only one.
    // Match only one corresponding pair, even with a coarse browser clock.
    const previous = lastMotionEvent;
    if (previous && previous.type !== event.type && previous.timeStamp === event.timeStamp &&
        previous.buttons === event.buttons) {
      lastMotionEvent = undefined;
      return;
    }
    lastMotionEvent = event;
    recordMotion(dx, dy);
  }

  function recordMotion(dx, dy) {
    const now = performance.now();
    const gap = now - lastMotion;
    // Exponentially smooth velocity using elapsed report time. Group same-tick
    // deltas, and hold the estimate unchanged between regularly spaced reports.
    if (gap > motionHoldMs) {
      mouseX = mouseY = 0;
      sampleGain = 1;
    } else if (gap > 0) {
      const weight = -Math.expm1(-gap / velocityWindowMs);
      const carry = (1 - weight) * decay(now);
      mouseX *= carry;
      mouseY *= carry;
      sampleGain = velocityWindowMs * weight / gap;
    }
    mouseX += dx * sampleGain;
    mouseY += dy * sampleGain;
    const excess = Math.hypot(mouseX, mouseY) * sensitivity / fullStickDistance;
    if (excess > 1) {
      mouseX /= excess;
      mouseY /= excess;
    }
    lastMotion = now;
    inputsDirty = true;
    sampleMotion(now, 0);
    // Ignore tiny drift when motion is bound to a button. Renew while purposeful
    // movement continues; the short hold gives even a single flick time to be polled.
    for (let direction = 0; direction < motion.length; direction++) {
      const threshold = now < motionHeldUntil[direction] ? 0.12 : 0.22;
      if (motion[direction] >= threshold) motionHeldUntil[direction] = now + 85;
    }
    scheduleRawInput();
  }

  window.RemotePadController = Object.freeze({
    ps5, ps5Player, isMapped: code => boundInputs.has(code),
    install, connect, start, stop, disconnect, setSensitivity, setLookDeadzone, getState, setBindings,
    setNativeMouseRouting, endNativeMouseRouting, nativeMouseMove,
    getDefaultBindings: () => cloneBindings(defaults),
    getBindings: () => cloneBindings(bindings)
  });
})();
