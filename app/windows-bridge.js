// The Windows host injects this script before page scripts on its own screens and the Xbox player.
(() => {
  "use strict";
  const webview = window.chrome?.webview;
  if (!webview || window !== window.top || window.RemotePadWindows) return;

  const pending = new Map();
  webview.addEventListener("message", event => {
    const reply = event.data;
    const request = pending.get(reply?.id);
    if (!request) return;
    pending.delete(reply.id);
    clearTimeout(request.timer);
    if (typeof reply.error === "string") request.reject(new Error(reply.error));
    else request.resolve(reply.value);
  });

  function setting(channel) {
    return Object.freeze({
      postMessage(value) {
        return new Promise((resolve, reject) => {
          const id = crypto.randomUUID();
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("Remote Pad did not respond to the settings request."));
          }, 10000);
          pending.set(id, { resolve, reject, timer });
          try { webview.postMessage({ id, channel, value }); }
          catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
        });
      }
    });
  }

  window.RemotePadWindows = Object.freeze({
    bindings: setting("bindings"),
    sensitivity: setting("sensitivity"),
    lookDeadzone: setting("lookDeadzone"),
    action: Object.freeze({
      postMessage(value) { webview.postMessage({ id: crypto.randomUUID(), channel: "action", value }); }
    })
  });
})();
