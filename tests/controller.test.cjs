const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../app/controller.js"), "utf8");

function browser() {
  const window = new EventTarget();
  const document = new EventTarget();
  document.pointerLockElement = null;
  document.exitPointerLock = () => {
    document.pointerLockElement = null;
    document.dispatchEvent(new Event("pointerlockchange"));
  };
  const physical = [null, null, null, null];
  class Navigator {
    getGamepads() { return physical.slice(); }
  }
  const navigator = new Navigator();
  window.Gamepad = class Gamepad {};
  window.GamepadButton = class GamepadButton {};
  window.GamepadEvent = class GamepadEvent extends Event {};
  let time = 1000;
  const context = vm.createContext({ window, document, navigator, Event, performance: { now: () => time } });
  const unpatched = navigator.getGamepads;
  vm.runInContext(source, context);
  const api = window.RemotePadController;
  return {
    window, document, physical, navigator, api, unpatched,
    pad: () => navigator.getGamepads()[api.getState().index],
    advance: ms => { time += ms; },
    send(type, fields = {}) {
      const event = new Event(type, { cancelable: true });
      Object.defineProperty(event, "timeStamp", { value: time });
      Object.assign(event, fields);
      window.dispatchEvent(event);
      return event;
    }
  };
}

test("explicit installation precedes site method caching, connection events and neutral polling", () => {
  const b = browser();
  assert.equal(b.navigator.getGamepads, b.unpatched);
  b.api.install();
  const poll = b.navigator.getGamepads.bind(b.navigator);
  assert.ok(poll().every(pad => pad === null));
  let connected;
  b.window.addEventListener("gamepadconnected", event => { connected = event; });
  b.api.connect();
  assert.ok(connected instanceof b.window.GamepadEvent);
  assert.ok(connected.gamepad instanceof b.window.Gamepad);
  assert.equal(connected.gamepad, poll()[0]);
  assert.equal(connected.gamepad.mapping, "standard");
  assert.equal(poll()[0].buttons.length, 17);
  assert.ok(poll()[0].buttons[0] instanceof b.window.GamepadButton);
  assert.deepEqual(Array.from(poll()[0].axes), [0, 0, 0, 0]);
  assert.equal(b.send("keydown", { code: "Space" }).defaultPrevented, false);
  assert.equal(poll()[0].buttons[0].value, 0);
});

test("reports every mapped Xbox button as pressed, touched, and released while capturing", () => {
  const b = browser();
  b.api.start();
  const inputs = ["Space", "KeyC", "KeyR", "KeyF", "KeyQ", "KeyE", null, null,
    "Tab", "Enter", "ShiftLeft", "KeyV", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyG"];
  for (const [index, code] of inputs.entries()) {
    const down = code ? b.send("keydown", { code }) : b.send("mousedown", { button: index === 6 ? 2 : 0 });
    assert.ok(down.defaultPrevented);
    const pressed = b.pad().buttons[index];
    assert.equal(pressed.value, 1);
    assert.ok(pressed.pressed && pressed.touched);
    if (code) b.send("keyup", { code });
    else b.send("mouseup", { button: index === 6 ? 2 : 0 });
    assert.equal(b.pad().buttons[index].value, 0);
    assert.equal(pressed.value, 1, "earlier poll remains a snapshot");
  }
});

test("late listeners receive one live pad on first capture and can keep reading it without polling", () => {
  const b = browser();
  b.api.connect();
  const initial = b.navigator.getGamepads()[0];
  const received = [];
  b.window.addEventListener("gamepadconnected", event => received.push(event.gamepad));
  b.api.start();
  assert.deepEqual(received, [initial]);
  const pad = received[0];
  b.advance(10);
  b.send("keydown", { code: "Space" });
  b.send("keydown", { code: "KeyA" });
  b.send("mousemove", { movementX: 7, movementY: 3 });
  assert.equal(pad.buttons[0].pressed, true);
  assert.equal(pad.axes[0], -1);
  assert.ok(pad.axes[2] > 0);
  assert.equal(pad.timestamp, 1010);
  assert.equal(b.navigator.getGamepads()[0], pad);
  b.api.stop();
  b.api.start();
  assert.equal(received.length, 1);
  b.send("keydown", { code: "KeyC" });
  b.physical[0] = { index: 0 };
  const relocated = b.navigator.getGamepads()[1];
  assert.deepEqual(received, [pad, relocated]);
  assert.equal(pad.connected, false);
  assert.equal(pad.index, 0);
  assert.ok(pad.axes.every(value => value === 0));
  assert.ok(pad.buttons.every(button => !button.pressed));
  assert.equal(relocated.buttons[1].pressed, true);
  b.api.disconnect();
  assert.equal(relocated.connected, false);
  assert.equal(relocated.buttons[1].pressed, false);
});

test("opposing keys cancel, diagonals respect the unit circle and releasing a key restores its opposite", () => {
  const b = browser();
  b.api.start();
  b.send("keydown", { code: "KeyW" });
  b.send("keydown", { code: "KeyD" });
  const diagonal = b.pad().axes;
  assert.ok(Math.abs(Math.hypot(diagonal[0], diagonal[1]) - 1) < 1e-9);
  assert.ok(diagonal[0] > 0 && diagonal[1] < 0);
  b.send("keydown", { code: "KeyS" });
  assert.deepEqual(Array.from(b.pad().axes), [1, 0, 0, 0]);
  b.send("keyup", { code: "KeyS" });
  assert.deepEqual(Array.from(b.pad().axes), Array.from(diagonal));
});

test("mouse movement is signed, accumulates between polls, saturates radially and recenters while idle", () => {
  const b = browser();
  b.api.setLookDeadzone(0); // Exercise the linear response independently of game deadzone compensation.
  b.api.start();
  b.send("mousemove", { movementX: 4, movementY: -2 });
  const x = b.pad().axes[2];
  assert.ok(x > 0 && b.pad().axes[3] < 0);
  b.send("mousemove", { movementX: 4, movementY: -2 });
  assert.equal(b.pad().axes[2], 2 * x);
  b.api.setSensitivity(2);
  assert.equal(b.pad().axes[2], 4 * x);
  b.send("mousemove", { movementX: 500, movementY: -500 });
  assert.ok(Math.abs(Math.hypot(...b.pad().axes.slice(2)) - 1) < 1e-9);
  b.advance(118);
  assert.ok(Math.hypot(...b.pad().axes.slice(2)) < 1);
  b.advance(17);
  assert.deepEqual(Array.from(b.pad().axes), [0, 0, 0, 0]);
  assert.equal(b.api.setSensitivity(999).sensitivity, 3);
  assert.equal(b.api.setSensitivity(-1).sensitivity, 0.25);
  assert.equal(b.api.setSensitivity(NaN).sensitivity, 0.25);
});

test("locked hover and drag aim equally with pointer events, mouse events, or a compatibility pair", () => {
  for (const mask of [0, 1]) {
    for (const types of [["pointermove"], ["mousemove"], ["pointermove", "mousemove"]]) {
      const b = browser();
      b.api.setLookDeadzone(0); // Exercise the linear response independently of game deadzone compensation.
      b.document.pointerLockElement = {};
      b.api.start();
      const sample = () => {
        for (const type of types) {
          const event = b.send(type, { pointerType: "mouse", buttons: mask, movementX: 3, movementY: -1 });
          assert.ok(event.defaultPrevented, type);
        }
      };
      sample();
      const pad = b.pad();
      assert.deepEqual(Array.from(pad.axes.slice(2)), [3 / 23, -1 / 23], types.join(", "));
      assert.equal(pad.buttons[7].pressed, mask === 1);
      assert.equal(pad.buttons[6].pressed, false);
      // Consecutive real samples can have identical timestamps and deltas.
      sample();
      assert.deepEqual(Array.from(pad.axes.slice(2)), [6 / 23, -2 / 23]);
      b.advance(136);
      assert.deepEqual(Array.from(pad.axes.slice(2)), [0, 0]);
    }
  }
});

test("falls back to mouse deltas when the pointer sample is stationary and ignores touch", () => {
  const b = browser();
  b.api.setLookDeadzone(0); // Exercise the linear response independently of game deadzone compensation.
  b.api.start();
  b.send("pointermove", { pointerType: "touch", buttons: 1, movementX: 6 });
  assert.deepEqual(Array.from(b.pad().axes), [0, 0, 0, 0]);
  assert.equal(b.pad().buttons[7].pressed, false);
  b.send("pointermove", { pointerType: "mouse", buttons: 0, movementX: 0 });
  b.send("mousemove", { buttons: 0, movementX: -3, movementY: 2 });
  assert.deepEqual(Array.from(b.pad().axes.slice(2)), [-3 / 23, 2 / 23]);
  b.advance(136);
  b.send("pointermove", { pointerType: "mouse", buttons: 1, movementX: 4 });
  b.send("mousemove", { buttons: 1, movementX: 4 });
  assert.deepEqual(Array.from(b.pad().axes.slice(2)), [4 / 23, 0]);
  assert.equal(b.pad().buttons[7].pressed, true);
});

test("clears held inputs on Escape, blur, page hide, visibility change and pointer unlock", () => {
  const b = browser();
  const endCapture = [
    () => b.send("keydown", { code: "Escape" }), () => b.send("blur"), () => b.send("pagehide"),
    () => { b.document.hidden = true; b.document.dispatchEvent(new Event("visibilitychange")); b.document.hidden = false; },
    () => b.document.exitPointerLock()
  ];
  for (const end of endCapture) {
    b.document.pointerLockElement = {};
    b.api.start();
    b.send("keydown", { code: "Space" });
    b.send("keydown", { code: "KeyW" });
    b.send("mousedown", { button: 0 });
    b.send("mousemove", { movementX: 20, movementY: -10 });
    end();
    assert.equal(b.api.getState().capturing, false);
    assert.ok(b.pad().buttons.every(button => !button.pressed));
    assert.ok(b.pad().axes.every(axis => axis === 0));
    assert.equal(b.document.pointerLockElement, null);
    assert.equal(b.send("keydown", { code: "KeyD" }).defaultPrevented, false);
  }
});

test("leaves ordinary typing and Mac shortcuts available without latching controls", () => {
  const b = browser();
  b.api.start();
  b.send("keydown", { code: "KeyW" });
  assert.equal(b.send("keydown", { code: "KeyR", metaKey: true }).defaultPrevented, false);
  assert.ok(b.pad().axes.every(axis => axis === 0));
  b.document.activeElement = { closest: () => ({}) };
  assert.equal(b.send("keydown", { code: "Space" }).defaultPrevented, false);
  assert.equal(b.send("mousedown", { button: 0 }).defaultPrevented, false);
  b.send("focusin");
  assert.equal(b.api.getState().capturing, false);
});

test("tracks simultaneous triggers even when the browser delivers changes as pointer moves", () => {
  const b = browser();
  b.api.start();
  b.send("pointerdown", { pointerType: "mouse", button: 2, buttons: 2 });
  b.send("pointermove", { pointerType: "mouse", buttons: 3 });
  assert.deepEqual(Array.from(b.pad().buttons.slice(6, 8), button => button.value), [1, 1]);
  b.send("pointermove", { pointerType: "mouse", buttons: 1 });
  assert.deepEqual(Array.from(b.pad().buttons.slice(6, 8), button => button.value), [0, 1]);
  b.send("pointerup", { pointerType: "mouse", button: 0, buttons: 0 });
  assert.deepEqual(Array.from(b.pad().buttons.slice(6, 8), button => button.value), [0, 0]);
});

test("preserves native controllers, relocates and announces an occupied slot, then disconnects cleanly", () => {
  const b = browser();
  const seen = [];
  for (const type of ["gamepadconnected", "gamepaddisconnected"]) {
    b.window.addEventListener(type, event => seen.push([type, event.gamepad.index, event.gamepad.connected]));
  }
  b.physical[0] = { index: 0 };
  b.api.connect();
  assert.equal(b.api.getState().index, 1);
  b.physical[1] = { index: 1 };
  const polled = b.navigator.getGamepads();
  assert.equal(b.api.getState().index, 2);
  assert.equal(polled[0], b.physical[0]);
  assert.equal(polled[1], b.physical[1]);
  assert.equal(polled[2].mapping, "standard");
  b.api.disconnect();
  assert.equal(b.navigator.getGamepads()[2], null);
  assert.deepEqual(seen, [
    ["gamepadconnected", 1, true], ["gamepaddisconnected", 1, false],
    ["gamepadconnected", 2, true], ["gamepaddisconnected", 2, false]
  ]);
});

test("remaps, shares and unbinds inputs; changing a profile releases held buttons and a reset restores defaults", () => {
  const b = browser();
  const profile = { a: ["KeyK", "Mouse1", "KeyK"], b: ["KeyK"], rt: [], lyUp: ["KeyI"] };
  const applied = b.api.setBindings(profile);
  assert.deepEqual(Array.from(applied.a), ["KeyK", "Mouse1"]);
  assert.equal(b.api.getBindings().lyDown[0], "KeyS");
  applied.a.pop();
  profile.a.length = 0;
  b.api.getDefaultBindings().rt.length = 0;
  assert.deepEqual(Array.from(b.api.getBindings().a), ["KeyK", "Mouse1"]);

  b.api.start();
  const pad = b.pad();
  assert.equal(b.send("keydown", { code: "Space" }).defaultPrevented, false);
  b.send("mousedown", { button: 0 });
  assert.equal(pad.buttons[7].pressed, false);
  b.send("keydown", { code: "KeyK" });
  assert.ok(pad.buttons[0].pressed && pad.buttons[1].pressed);
  b.api.setBindings(b.api.getBindings());
  assert.ok(pad.buttons[0].pressed, "unchanged preference sync preserves held controls");
  b.send("mousedown", { button: 1 });
  b.send("keyup", { code: "KeyK" });
  assert.ok(pad.buttons[0].pressed && !pad.buttons[1].pressed);
  b.send("keydown", { code: "KeyI" });
  assert.equal(pad.axes[1], -1);
  b.api.setBindings({});
  assert.equal(pad.buttons[0].pressed, false);
  assert.equal(pad.axes[1], 0);
  assert.equal(b.send("keydown", { code: "KeyI" }).defaultPrevented, false);
  b.send("mousedown", { button: 0 });
  b.send("keydown", { code: "Space" });
  assert.ok(pad.buttons[0].pressed && pad.buttons[7].pressed);
});

test("rejects malformed and reserved bindings atomically", () => {
  const b = browser();
  b.api.setBindings({ a: ["KeyH"] });
  const invalid = [null, [], { unknown: [] }, { a: "Space" }, { a: [4] }, { a: ["Mouse5"] },
    { a: ["MouseMoveDiagonal"] }, { a: ["Key H"] }, { a: ["Escape"] }, { a: ["X".repeat(49)] },
    { a: Array.from({ length: 33 }, (_, i) => "Input" + i) },
    { a: ["Unidentified"] }, { a: ["KeyQ"], b: ["MetaLeft"] }, JSON.parse('{"__proto__":[]}')];
  for (const profile of invalid) {
    assert.throws(() => b.api.setBindings(profile), { name: "TypeError" });
    assert.deepEqual(Array.from(b.api.getBindings().a), ["KeyH"]);
  }
});

test("F8 is bindable, and profiles accept 32 inputs per control and 48 ASCII characters per token", () => {
  const b = browser();
  const tokens = ["F8", "X".repeat(48), ...Array.from({ length: 30 }, (_, i) => "Input" + i)];
  const profile = b.api.setBindings({ a: tokens });
  assert.deepEqual(Array.from(profile.a), tokens);
  b.api.start();
  assert.ok(b.send("keydown", { code: "F8" }).defaultPrevented);
  assert.ok(b.pad().buttons[0].pressed);
  b.send("keyup", { code: "F8" });
  assert.equal(b.pad().buttons[0].pressed, false);
  assert.ok(b.api.getState().capturing);
});

test("maps physical modifier sides, punctuation, digits and function keys during chords; Command stays available", () => {
  const b = browser();
  b.api.setBindings({ a: ["AltLeft"], b: ["ControlRight"], x: ["ShiftRight"],
    y: ["F14"], lb: ["Semicolon"], rb: ["Digit9"], lt: ["Mouse2"], rt: [] });
  b.api.start();
  const pad = b.pad();
  const keys = ["AltLeft", "ControlRight", "ShiftRight", "F14", "Semicolon", "Digit9"];
  keys.forEach(code => b.send("keydown", { code, altKey: true, ctrlKey: true, shiftKey: true }));
  b.send("mousedown", { button: 2, altKey: true, ctrlKey: true });
  assert.ok(pad.buttons.slice(0, 7).every(button => button.pressed));
  b.send("keyup", { code: "ControlRight", altKey: true, shiftKey: true });
  assert.equal(pad.buttons[1].pressed, false);
  assert.ok(pad.buttons[0].pressed && pad.buttons[2].pressed && pad.buttons[6].pressed);
  assert.equal(b.send("keydown", { code: "F14", metaKey: true }).defaultPrevented, false);
  assert.ok(pad.buttons.every(button => !button.pressed));
});

test("all five remapped mouse buttons report independent switches and chorded masks", () => {
  const b = browser();
  b.api.setBindings({ a: ["Mouse0"], b: ["Mouse1"], x: ["Mouse2"], y: ["Mouse3"],
    rb: ["Mouse4"], lt: [], rt: [] });
  b.api.start();
  const pad = b.pad();
  for (const [button, mask] of [1, 4, 2, 8, 16].entries()) {
    const index = [0, 1, 2, 3, 5][button];
    b.send("pointerdown", { pointerType: "mouse", button, buttons: mask });
    assert.ok(pad.buttons[index].pressed);
    assert.equal(pad.buttons.filter(value => value.pressed).length, 1);
    assert.ok(b.send("auxclick", { button, buttons: 0 }).defaultPrevented);
    b.send("pointerup", { pointerType: "mouse", button, buttons: 0 });
    assert.equal(pad.buttons[index].pressed, false);
  }
  b.send("pointermove", { pointerType: "mouse", buttons: 28 });
  assert.deepEqual(Array.from(pad.buttons.slice(0, 6), v => v.value), [0, 1, 0, 1, 0, 1]);
  b.send("pointermove", { pointerType: "mouse", buttons: 0 });
  assert.ok(pad.buttons.every(button => !button.pressed));
});

test("combines proportional mouse directions with buttons or keys on either normalized stick", () => {
  const b = browser();
  b.api.setLookDeadzone(0); // Exercise the linear response independently of game deadzone compensation.
  b.api.setBindings({ lxLeft: ["KeyU"], lxRight: ["MouseMoveUp"], lyUp: ["Mouse3"], lyDown: [],
    rxLeft: ["MouseMoveRight"], rxRight: ["Period"], ryUp: [], ryDown: ["MouseMoveDown", "Mouse4"] });
  b.api.start();
  const pad = b.pad();
  b.send("mousemove", { movementX: 0, movementY: -10, buttons: 0 });
  assert.deepEqual(Array.from(pad.axes), [10 / 23, 0, 0, 0]);
  b.send("mousedown", { button: 3, buttons: 8 });
  assert.ok(pad.axes[0] > 0 && pad.axes[1] < 0);
  assert.ok(Math.abs(Math.hypot(...pad.axes.slice(0, 2)) - 1) < 1e-9);
  b.advance(136);
  assert.deepEqual(Array.from(pad.axes), [0, -1, 0, 0]);
  b.send("mouseup", { button: 3, buttons: 0 });
  b.send("keydown", { code: "KeyU" });
  b.send("keydown", { code: "Period" });
  b.send("mousedown", { button: 4, buttons: 16 });
  assert.equal(pad.axes[0], -1);
  assert.ok(Math.abs(Math.hypot(...pad.axes.slice(2)) - 1) < 1e-9);
  b.send("keyup", { code: "Period" });
  b.send("mouseup", { button: 4, buttons: 0 });
  b.send("mousemove", { movementX: 2, movementY: 4, buttons: 0 });
  assert.deepEqual(Array.from(pad.axes.slice(2)), [-2 / 23, 4 / 23]);
  b.advance(136);
  b.send("keyup", { code: "KeyU" });
  assert.deepEqual(Array.from(pad.axes), [0, 0, 0, 0]);
});

test("mouse direction bound to a button has an activation threshold, a short hold and independent release", () => {
  const b = browser();
  b.api.setBindings({ a: ["MouseMoveLeft", "KeyA"], b: ["MouseMoveUp"], lxLeft: [] });
  b.api.start();
  const pad = b.pad();
  b.send("mousemove", { movementX: -1, movementY: -1 });
  assert.equal(pad.buttons[0].pressed, false);
  assert.equal(pad.buttons[1].pressed, false);
  b.advance(136);
  b.send("mousemove", { movementX: -12, movementY: -8 });
  b.advance(80);
  assert.ok(pad.buttons[0].pressed && pad.buttons[1].pressed);
  b.send("keydown", { code: "KeyA" });
  b.advance(10);
  assert.ok(pad.buttons[0].pressed && !pad.buttons[1].pressed);
  b.send("keyup", { code: "KeyA" });
  assert.equal(pad.buttons[0].pressed, false);
  b.send("mousemove", { movementX: -12, movementY: -8 });
  b.api.stop();
  assert.ok(pad.buttons.every(button => !button.pressed));
});

test("slow irregular reports deliver steady stick velocity at 30 and 60 Hz, with or without the trigger", () => {
  function stream(reportSteps, pollHz, held) {
    const b = browser();
    b.api.setSensitivity(2.5);
    b.api.start();
    const pad = b.pad();
    const samples = [];
    const events = [];
    const rate = 0.05; // 50 relative pixels per second.
    for (let t = 0, i = 0; t < 600; i++) {
      const dt = reportSteps[i % reportSteps.length];
      t += dt;
      events.push({ t, distance: rate * dt });
    }
    for (let frame = 1; frame / pollHz <= 0.6; frame++) events.push({ t: frame * 1000 / pollHz });
    events.sort((a, b) => a.t - b.t);
    let last = 0;
    for (const e of events) {
      b.advance(e.t - last);
      if (e.distance !== undefined) {
        b.send("mousemove", { movementX: e.distance, movementY: 0, buttons: Number(held) });
      } else if (e.t >= 200) {
        const axis = pad.axes[2];
        assert.equal(pad.buttons[7].pressed, held);
        assert.equal(pad.axes[3], 0);
        assert.ok(pad.buttons.every((btn, i) => i === 7 || !btn.pressed));
        samples.push(axis);
      }
      last = e.t;
    }
    return samples;
  }
  const expected = 0.27 + 0.73 * (0.05 * 30 / 23 * 2.5);
  for (const steps of [[7, 13, 29, 42, 11], [8], [32]]) {
    for (const hz of [30, 60]) {
      const free = stream(steps, hz, false);
      assert.ok(free.length > 10 && free.every(x => Math.abs(x - expected) < 0.001),
        "slow movement stays above the game deadzone on every stream poll");
      assert.deepEqual(stream(steps, hz, true), free);
    }
  }
});

test("holds input between reports then smoothly reaches exact center, even with deadzone compensation", () => {
  const b = browser();
  assert.equal(b.api.getState().lookDeadzone, 0.27);
  b.api.setBindings({ a: ["MouseMoveRight"] });
  b.api.start();
  const pad = b.pad();
  b.send("mousemove", { movementX: 1, movementY: 1, buttons: 0 });
  const first = pad.axes.slice(2);
  assert.ok(Math.hypot(...first) > 0.27);
  assert.equal(pad.buttons[0].pressed, false, "minimum stick radius does not trigger a gesture button");
  b.advance(55);
  assert.deepEqual(pad.axes.slice(2), first);
  b.advance(40);
  assert.ok(Math.abs(pad.axes[2] / first[0] - 0.5) < 1e-9);
  b.advance(40);
  assert.deepEqual(Array.from(pad.axes), [0, 0, 0, 0]);
  assert.equal(b.api.setLookDeadzone(-0.5).lookDeadzone, 0);
  assert.equal(b.api.setLookDeadzone(0.75).lookDeadzone, 0.5);
  assert.equal(b.api.setLookDeadzone(NaN).lookDeadzone, 0.5);
  b.send("mousemove", { movementX: 300, movementY: -300 });
  assert.ok(Math.abs(Math.hypot(...pad.axes.slice(2)) - 1) < 1e-9);
});

test("Xbox-style timestamp polling sees distinct axis-only and digital states on a single coarse clock tick", () => {
  const b = browser();
  b.api.start();
  const pad = b.pad();
  let seen = pad.timestamp;
  for (const [type, fields] of [
    ["mousemove", { movementX: 5, movementY: 2, buttons: 0 }],
    ["mousemove", { movementX: 5, movementY: 2, buttons: 0 }],
    ["keydown", { code: "Space" }], ["keyup", { code: "Space" }]
  ]) {
    b.send(type, fields);
    const timestamp = pad.timestamp;
    assert.ok(timestamp > seen, "new report has a strictly greater timestamp");
    assert.equal(pad.timestamp, timestamp);
    seen = timestamp;
  }
});

test("AppKit motion is exclusive to its capture and never synthesizes or swallows trigger events", () => {
  const b = browser();
  const api = b.api;
  api.setLookDeadzone(0);
  assert.ok(api.setNativeMouseRouting("first"));
  assert.equal(api.nativeMouseMove("first", 5, 0), false);
  api.start();
  assert.equal(api.nativeMouseMove("first", 5, 0), false);
  b.document.pointerLockElement = {};
  const pad = b.pad();
  assert.equal(api.nativeMouseMove("other", 5, 0), false);
  assert.equal(api.nativeMouseMove("first", Infinity, 0), false);
  assert.ok(api.nativeMouseMove("first", 5, -2));
  b.send("pointermove", { pointerType: "mouse", movementX: 5, movementY: -2, buttons: 0 });
  b.send("mousemove", { movementX: 5, movementY: -2, buttons: 0 });
  assert.deepEqual(Array.from(pad.axes.slice(2)), [5 / 23, -2 / 23]);
  assert.ok(pad.buttons.every(button => !button.pressed));
  b.send("mousedown", { button: 0, buttons: 1 });
  api.nativeMouseMove("first", 2, 0);
  assert.equal(pad.buttons[7].pressed, true);
  b.send("mouseup", { button: 0, buttons: 0 });
  assert.equal(pad.buttons[7].pressed, false);
  api.stop();
  assert.equal(api.nativeMouseMove("first", 5, 0), false);
  assert.ok(api.setNativeMouseRouting("second"));
  b.document.pointerLockElement = {};
  api.start();
  assert.equal(api.endNativeMouseRouting("first"), false);
  assert.ok(api.nativeMouseMove("second", 2, 0));
  assert.ok(api.endNativeMouseRouting("second"));
  b.send("mousemove", { movementX: 3, movementY: 1, buttons: 0 });
  assert.deepEqual(Array.from(pad.axes.slice(2)), [3 / 23, 1 / 23]);
  b.send("blur");
  assert.ok(pad.axes.every(value => value === 0));
});

test("supported browsers emit coalesced raw axis events without polling and finish with an explicit neutral report", () => {
  const b = browser();
  b.window.ongamepadrawinputchanged = null;
  b.window.GamepadRawInputChangeEvent = class extends b.window.GamepadEvent {};
  const pending = new Map();
  let id = 0;
  b.window.requestAnimationFrame = fn => { pending.set(++id, fn); return id; };
  b.window.cancelAnimationFrame = frame => pending.delete(frame);
  function tick(dt) {
    b.advance(dt);
    const frames = Array.from(pending.values());
    pending.clear();
    frames.forEach(fn => fn());
  }
  const reports = [];
  b.window.addEventListener("gamepadrawinputchanged", e => {
    assert.ok(e instanceof b.window.GamepadRawInputChangeEvent);
    reports.push({ changed: Array.from(e.axesChanged), pressed: Array.from(e.buttonsPressed),
      released: Array.from(e.buttonsReleased), axes: Array.from(e.gamepad.axes), rt: e.gamepad.buttons[7].pressed });
  });
  b.api.start();
  b.send("mousemove", { movementX: 3, movementY: -1, buttons: 0 });
  b.send("mousemove", { movementX: 1, movementY: -2, buttons: 0 });
  assert.equal(pending.size, 1);
  tick(16);
  assert.deepEqual(reports[0].changed, [2, 3]);
  assert.equal(reports[0].rt, false);
  assert.ok(reports[0].axes[2] > 0 && reports[0].axes[3] < 0);
  tick(16);
  assert.equal(reports.length, 1, "holding a stable stick produces no duplicate raw events");
  b.send("mousedown", { button: 0, buttons: 1 });
  tick(16);
  assert.deepEqual(reports.at(-1).pressed, [7]);
  tick(90);
  assert.deepEqual(reports.at(-1).axes, [0, 0, 0, 0]);
  assert.equal(pending.size, 0);
  b.api.stop();
  assert.deepEqual(reports.at(-1).released, [7]);
});

test("Xbox timestamp-gated 60 Hz polling keeps a slow diagonal outside the right-stick deadzone while ADS and firing", () => {
  const b = browser();
  b.api.setSensitivity(2.5);
  b.api.start();
  b.send("mousedown", { button: 2, buttons: 2 });
  const frames = [];
  const steps = [17, 29, 12, 40, 22, 33, 14, 31];
  for (let t = 0, i = 0; t < 1080;) {
    t += steps[i++ % steps.length];
    frames.push({ t, type: "move" });
  }
  for (let frame = 1; frame <= 66; frame++) frames.push({ t: frame * 1000 / 60, type: "poll" });
  frames.push({ t: 347, type: "fire" }, { t: 736, type: "releaseFire" });
  frames.sort((a, b) => a.t - b.t);
  let held = false;
  let time = 0;
  let lastTimestamp = -1;
  let reported;
  let moving = false;
  let samples = 0;
  for (const frame of frames) {
    b.advance(frame.t - time);
    time = frame.t;
    if (frame.type === "move") {
      moving = true;
      b.send("mousemove", { movementX: 0.5, movementY: -0.3, buttons: held ? 3 : 2 });
    } else if (frame.type === "poll") {
      // Match the Xbox reader's strict timestamp gate and the console look deadzone.
      const pad = b.navigator.getGamepads()[0];
      if (pad.timestamp > lastTimestamp) {
        reported = { x: pad.axes[2], y: pad.axes[3], lt: pad.buttons[6].pressed, rt: pad.buttons[7].pressed };
        lastTimestamp = pad.timestamp;
      }
      if (!moving) continue;
      assert.ok(reported.x > 0 && reported.y < 0);
      assert.ok(Math.hypot(reported.x, reported.y) > 0.2652);
      assert.ok(reported.lt);
      assert.equal(reported.rt, held);
      samples++;
    } else {
      held = frame.type === "fire";
      b.send(held ? "mousedown" : "mouseup", { button: 0, buttons: held ? 3 : 2 });
    }
  }
  assert.ok(samples >= 64);
  b.advance(136);
  const idle = b.navigator.getGamepads()[0];
  assert.ok(idle.timestamp > lastTimestamp);
  assert.deepEqual(Array.from(idle.axes), [0, 0, 0, 0]);
  assert.ok(idle.buttons[6].pressed && !idle.buttons[7].pressed);
});
