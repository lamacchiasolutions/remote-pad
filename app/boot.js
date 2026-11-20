(() => {
  "use strict";
  if (window !== window.top || !window.RemotePadController || !window.RemotePadUI) return;
  const bench = (location.protocol === "file:" && location.pathname.endsWith("/bench.html")) ||
    (Boolean(window.RemotePadWindows) && location.origin === "https://remote-pad.invalid" && location.pathname === "/bench.html");
  const xbox = location.protocol === "https:" && ["xbox.com", "www.xbox.com", "play.xbox.com"].includes(location.hostname);
  const ps5 = window.RemotePadController.ps5Player;
  if (!bench && !xbox && !ps5) return;

  let lastPath;
  function sync() {
    const path = location.pathname;
    const allowed = ps5 ? document.body?.classList.contains("mode-control") :
      bench || location.hostname === "play.xbox.com" ||
      /^\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})*\/)?(?:remoteplay|play)(?:\/|$)/i.test(path);
    if (allowed) {
      if (lastPath !== path) window.RemotePadController.install();
      window.RemotePadUI.enable(bench);
    } else {
      window.RemotePadUI.disable();
    }
    lastPath = path;
  }
  sync();
  if (ps5) {
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }, { once: true });
  }
  document.addEventListener("DOMContentLoaded", sync, { once: true });
  window.addEventListener("pageshow", sync);
  window.addEventListener("pagehide", () => { window.RemotePadUI.disable(); lastPath = undefined; });
  window.addEventListener("popstate", sync);
  if (window.navigation) window.navigation.addEventListener("currententrychange", sync);
  // Handles pushState on older WebKit and replaces the dock after a streaming UI remount.
  if (!bench) setInterval(sync, 700);
})();
