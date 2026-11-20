// Isolated extension context. Only the controller layout crosses the page boundary.
(() => {
  "use strict";
  const ids = new Set("a b x y lb rb lt rt view menu ls rs up down left right guide touchpad lxLeft lxRight lyUp lyDown rxLeft rxRight ryUp ryDown".split(" "));
  function valid(map) {
    return map !== null && typeof map === "object" && !Array.isArray(map) &&
      Object.entries(map).every(([key, codes]) => ids.has(key) && Array.isArray(codes) &&
        codes.length <= 32 && codes.every(code => typeof code === "string" && /^[A-Za-z][A-Za-z0-9]{0,47}$/.test(code)));
  }
  window.addEventListener("remote-pad-layout-request", async event => {
    if (typeof event.detail !== "string" || event.detail.length > 160000) return;
    let request;
    try { request = JSON.parse(event.detail); } catch { return; }
    if (!request || typeof request.id !== "string" || request.id.length > 64) return;
    const { id, op, layout, stamp } = request;
    const reply = body => window.dispatchEvent(new CustomEvent("remote-pad-layout-reply", { detail: JSON.stringify({ id, ...body }) }));
    try {
      let result;
      if (op === "get") result = (await chrome.storage.local.get("layout")).layout || {};
      else if (op === "set" && valid(layout)) {
        await chrome.storage.local.set({ layout }); result = layout;
      } else if (op === "import" && valid(layout) && typeof stamp === "string" && stamp.length <= 80000) {
        const current = await chrome.storage.local.get(["layout", "lastAppLayout"]);
        if (current.lastAppLayout === stamp) result = current.layout || {};
        else {
          await chrome.storage.local.set({ layout, lastAppLayout: stamp }); result = layout;
        }
      } else throw Error("Unsupported controller layout.");
      reply({ layout: result });
    } catch { reply({ error: "Could not save or read the Chrome controller layout. Reload the extension and try again." }); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.layout) {
      window.dispatchEvent(new CustomEvent("remote-pad-layout-changed", { detail: JSON.stringify(changes.layout.newValue || {}) }));
    }
  });
  window.dispatchEvent(new Event("remote-pad-layout-ready"));
})();
