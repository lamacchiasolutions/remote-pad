"use strict";
const homeActions = window.RemotePadWindows?.action || window.webkit?.messageHandlers?.remotePad;
document.getElementById("chrome-setup").hidden = !window.webkit?.messageHandlers?.remotePad;
document.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (homeActions) { homeActions.postMessage(action); return; }
  if (action === "bench" || action === "map") { location.href = action === "map" ? "mapper.html" : "bench.html"; return; }
  const status = document.getElementById("action-status");
  status.hidden = false;
  status.textContent = "Open the Remote Pad app to launch a session.";
  status.scrollIntoView({ block: "nearest" });
});

window.RemotePadModel.mount(document.getElementById("home-model"), {
  onSelect: id => { location.href = "mapper.html#" + encodeURIComponent(id); }
});
const rows = [["lyUp","Left stick up"],["ryUp","Right stick up"],["rt","Right trigger"],["lt","Left trigger"],["a","A button"],["b","B button"],["menu","Menu"]];
function showBindings() {
  const layout = window.RemotePadController.getBindings();
  const list = document.getElementById("current-bindings");
  list.replaceChildren();
  for (const [id,label] of rows) {
    const row = document.createElement("div");
    const term = document.createElement("dt");term.textContent = label;
    const inputs = document.createElement("dd");
    if (!layout[id].length) inputs.textContent = "Unassigned";
    for (const token of layout[id]) {
      const key = document.createElement("kbd");
      key.textContent = window.RemotePadMapper.pretty(token); inputs.append(key);
    }
    row.append(term,inputs);list.append(row);
  }
}
showBindings();
function loadHomeLayout() {
  window.RemotePadBindings.load().then(showBindings).catch(error => {
    const status = document.getElementById("action-status");
    status.hidden = false;
    status.textContent = "Could not read your saved controller layout. " + error.message;
  });
}
loadHomeLayout();
window.addEventListener("remotepadbindingschange", showBindings);
