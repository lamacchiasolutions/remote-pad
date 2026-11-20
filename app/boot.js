(() => {
  "use strict";
  if (window !== window.top || !window.RemotePadController || !window.RemotePadUI) return;
  const bench = location.protocol === "file:" && location.pathname.endsWith("/bench.html");
  const xbox = location.protocol === "https:" && ["xbox.com", "www.xbox.com", "play.xbox.com"].includes(location.hostname);
  if (!bench && !xbox) return;

  let lastPath;
  function sync() {
    const path = location.pathname;
    const allowed = bench || location.hostname === "play.xbox.com" ||
      /^\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})*\/)?(?:remoteplay|play)(?:\/|$)/i.test(path);
    if (allowed) {
      if (lastPath !== path) window.RemotePadController.install();
      window.RemotePadUI.enable(bench);
    } else if (lastPath !== path) {
      window.RemotePadUI.disable();
    }
    lastPath = path;
  }
  sync();
  document.addEventListener("DOMContentLoaded", sync, { once: true });
  window.addEventListener("pageshow", sync);
  window.addEventListener("pagehide", () => { window.RemotePadUI.disable(); lastPath = undefined; });
  window.addEventListener("popstate", sync);
  if (window.navigation) window.navigation.addEventListener("currententrychange", sync);
  // Handles pushState on older WebKit and replaces the dock after a streaming UI remount.
  if (!bench) setInterval(sync, 700);
})();
