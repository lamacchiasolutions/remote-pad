const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

function load(context, filename) {
  const source = fs.readFileSync(path.join(__dirname, "../app", filename), "utf8");
  vm.runInContext(source, context, { filename });
}

function windowsPage(url, receive) {
  const window = new EventTarget();
  const document = new EventTarget();
  const webview = new EventTarget();
  webview.postMessage = message => receive(structuredClone(message), data => {
    webview.dispatchEvent(new MessageEvent("message", { data: structuredClone(data) }));
  });
  window.chrome = { webview };
  window.top = window;
  window.location = new URL(url);
  const navigator = { platform: "Win32", getGamepads: () => [null, null, null, null] };
  const local = new Map();
  const localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) };
  const context = vm.createContext({ window, document, navigator, location: window.location, crypto: webcrypto,
    performance, setTimeout, clearTimeout, Event, CustomEvent, localStorage, URLSearchParams });
  for (const filename of ["windows-bridge.js", "controller.js", "bindings-store.js", "mapper-ui.js"]) load(context, filename);
  return { window, navigator, context };
}

test("WebView2 settings replies reach their requesting page calls even out of order", async () => {
  const requests = [];
  const { window } = windowsPage("https://remote-pad.invalid/bench.html", (message, reply) => requests.push({ message, reply }));
  const bridge = window.RemotePadWindows;
  const sensitivity = bridge.sensitivity.postMessage("get");
  const deadzone = bridge.lookDeadzone.postMessage("get");
  assert.deepEqual(requests.map(({ message }) => message.channel), ["sensitivity", "lookDeadzone"]);
  assert.notEqual(requests[0].message.id, requests[1].message.id);
  requests[1].reply({ id: requests[1].message.id, value: 0 });
  requests[0].reply({ id: requests[0].message.id, value: 1.5 });
  assert.deepEqual(await Promise.all([sensitivity, deadzone]), [1.5, 0]);
  bridge.action.postMessage("play");
  assert.equal(requests[2].message.channel, "action");
  assert.equal(requests[2].message.value, "play");
});

test("Windows layout edits carry between the local mapper and Xbox, and failed saves restore the previous mapping", async () => {
  let saved = {};
  let fail = false;
  function receive({ id, channel, value }, reply) {
    assert.equal(channel, "bindings");
    if (fail) return reply({ id, error: "Settings could not be saved." });
    if (value !== "get") saved = value;
    reply({ id, value: saved });
  }
  const mapper = windowsPage("https://remote-pad.invalid/mapper.html", receive).window;
  assert.equal(mapper.RemotePadMapper.pretty("AltLeft"), "Left Alt");
  await mapper.RemotePadBindings.save({ a: ["KeyK"] });
  const player = windowsPage("https://play.xbox.com/remoteplay", receive).window;
  assert.deepEqual(Array.from((await player.RemotePadBindings.load()).a), ["KeyK"]);
  fail = true;
  await assert.rejects(player.RemotePadBindings.save({ a: ["AltLeft"] }), /could not be saved/);
  assert.deepEqual(Array.from(player.RemotePadController.getBindings().a), ["KeyK"]);
  fail = false;
  await player.RemotePadBindings.save({ a: ["KeyP"] });
  assert.deepEqual(Array.from((await mapper.RemotePadBindings.refresh()).a), ["KeyP"]);
});

test("the HTTPS Windows input test starts a gamepad and restores shared look settings without a network connection", async () => {
  const settings = { bindings: {}, sensitivity: 1.75, lookDeadzone: 0 };
  const { context, window, navigator } = windowsPage("https://remote-pad.invalid/bench.html", ({ id, channel, value }, reply) => {
    if (value !== "get") settings[channel] = value;
    reply({ id, value: settings[channel] });
  });
  load(context, "overlay.js");
  load(context, "boot.js");
  await window.RemotePadBindings.load();
  const state = window.RemotePadController.getState();
  assert.equal(state.connected, true);
  assert.equal(navigator.getGamepads()[state.index].mapping, "standard");
  assert.equal(state.sensitivity, 1.75);
  assert.equal(state.lookDeadzone, 0);
  window.RemotePadUI.setLookDeadzone(0.4);
  assert.equal(settings.lookDeadzone, 0.4);
});
