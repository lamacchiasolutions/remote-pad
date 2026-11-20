(() => {
  "use strict";
  if (window.RemotePadBindings) return;
  const storageKey = "remote-pad.bindings.v1";
  const api = window.RemotePadController;
  let initial;
  let writes = Promise.resolve();

  function update(layout) {
    const current = api.getBindings();
    if (JSON.stringify(current) !== JSON.stringify(layout)) {
      api.setBindings(layout);
      window.dispatchEvent(new Event("remotepadbindingschange"));
    }
    return api.getBindings();
  }

  function extension(op, layout, stamp) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const payload = JSON.stringify({ id, op, layout, stamp });
      function send() { window.dispatchEvent(new CustomEvent("remote-pad-layout-request", { detail: payload })); }
      function done() {
        clearTimeout(timer);
        window.removeEventListener("remote-pad-layout-reply", reply);
        window.removeEventListener("remote-pad-layout-ready", send);
      }
      function reply(event) {
        if (typeof event.detail !== "string") return;
        let data;
        try { data = JSON.parse(event.detail); } catch { return; }
        if (data.id !== id) return;
        done();
        if (data.error) reject(new Error(data.error)); else resolve(data.layout);
      }
      const timer = setTimeout(() => { done(); reject(new Error("Reload the Remote Pad extension, then refresh this tab.")); }, 3000);
      window.addEventListener("remote-pad-layout-reply", reply);
      window.addEventListener("remote-pad-layout-ready", send);
      send();
    });
  }

  function nativeBridge() { return window.RemotePadWindows?.bindings || window.webkit?.messageHandlers?.remotePadBindings; }
  function readChromeHandoff() {
    const prefix = "#remote-pad-layout=";
    if (!location.hash.startsWith(prefix)) return;
    const stamp = location.hash.slice(prefix.length);
    history.replaceState(history.state, "", location.pathname + location.search);
    if (stamp.length > 80000 || !/^[A-Za-z0-9_-]+$/.test(stamp)) return;
    const text = atob(stamp.replace(/-/g, "+").replace(/_/g, "/"));
    return { layout: JSON.parse(text), stamp };
  }
  async function read() {
    const native = nativeBridge();
    if (native) return update(await native.postMessage("get"));
    if (location.protocol === "https:") {
      const handoff = readChromeHandoff();
      return update(await (handoff ? extension("import", handoff.layout, handoff.stamp) : extension("get")));
    }
    const stored = localStorage.getItem(storageKey);
    return update(stored ? JSON.parse(stored) : {});
  }
  function load() {
    if (!initial) initial = read().catch(error => { initial = undefined; throw error; });
    return initial;
  }
  function save(layout) {
    const next = writes.then(async () => {
      await load();
      const previous = api.getBindings();
      const canonical = api.setBindings(layout);
      try {
        const native = nativeBridge();
        if (native) await native.postMessage(canonical);
        else if (location.protocol === "https:") await extension("set", canonical);
        else localStorage.setItem(storageKey, JSON.stringify(canonical));
      } catch (error) { api.setBindings(previous); throw error; }
      window.dispatchEvent(new Event("remotepadbindingschange"));
      return canonical;
    });
    writes = next.catch(() => {});
    return next;
  }
  window.addEventListener("remote-pad-layout-changed", event => {
    if (location.protocol !== "https:" || nativeBridge() || typeof event.detail !== "string") return;
    try { update(JSON.parse(event.detail)); } catch {}
  });
  function refresh() {
    initial = undefined;
    return load();
  }
  window.addEventListener("pageshow", event => {
    if (event.persisted && initial) refresh().catch(() => {});
  });
  window.RemotePadBindings = Object.freeze({ load, save, refresh });
})();
