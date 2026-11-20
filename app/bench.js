(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const api = window.RemotePadController;
  if (!api || !window.RemotePadUI) {
    $("connection").textContent = "Unavailable";
    $("notice").textContent = "Open the input test from the Remote Pad app.";
    $("capture").disabled = true;
    return;
  }
  const names = api.ps5 ? ["×","○","□","△","L1","R1","L2","R2","Create","Options","L3","R3","↑","↓","←","→","PS","Touchpad"] :
    ["A","B","X","Y","LB","RB","LT","RT","View","Menu","LS","RS","↑","↓","←","→","Guide"];
  if (api.ps5) {
    $("lt-label").textContent = "L2";
    $("rt-label").textContent = "R2";
    $("edit-layout").href = "mapper.html?console=ps5";
  }
  const indicators = names.map(name => {
    const label = document.createElement("span");
    label.textContent = name;
    $("pad-buttons").append(label);
    return label;
  });
  $("capture").addEventListener("click", window.RemotePadUI.capture);
  const sensitivity = $("sensitivity");
  sensitivity.addEventListener("input", () => {
    window.RemotePadUI.setSensitivity(sensitivity.value);
  });
  const minimum = $("look-minimum");
  minimum.addEventListener("input", () => window.RemotePadUI.setLookDeadzone(minimum.value));
  window.addEventListener("remotepadnotice", event => { $("notice").textContent = event.detail; });
  function showMode() {
    const state = api.getState();
    sensitivity.value = state.sensitivity;
    $("gain").textContent = state.sensitivity.toFixed(2) + "×";
    minimum.value = state.lookDeadzone;
    $("minimum-value").textContent = Math.round(state.lookDeadzone * 100) + "%";
    $("capture").textContent = state.capturing ? "Release inputs (Esc)" : "Capture inputs";
    $("connection").textContent = state.capturing ? "Capturing" : state.connected ? "Connected" : "Disconnected";
    $("connection").classList.toggle("live", state.connected);
  }
  showMode();
  window.addEventListener("remotepadstatechange", showMode);
  // Read the same browser API that the streaming page sees.
  const sticks = ["left","right"].map((id,i) => ({ face: $(id+"-stick"), value: $(id+"-value"), axis: 2*i }));
  let previous;
  function draw() {
    const pad = navigator.getGamepads()[api.getState().index];
    if (pad && pad.timestamp !== previous) {
      previous = pad.timestamp;
      for (const { face, value, axis } of sticks) {
        const [x,y] = pad.axes.slice(axis,axis+2);
        face.style.setProperty("--x", x*42+"%");
        face.style.setProperty("--y", y*42+"%");
        value.textContent = x.toFixed(2) + " / " + y.toFixed(2);
      }
      indicators.forEach((label,i) => label.classList.toggle("on", pad.buttons[i].pressed));
      $("lt").style.setProperty("--level", pad.buttons[6].value);
      $("rt").style.setProperty("--level", pad.buttons[7].value);
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
