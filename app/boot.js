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
  // Label the setup and playback controls in the bundled launcher's pinned ps5web interface.
  // Host names, addresses, chat, logs and form values remain owned by the companion.
  function labelPS5Controls() {
    const selectors = [
      "#btn-take-control", "#btn-hud-take", "#btn-admin", "#btn-watch-refresh", "#btn-watch-start", "#watch-cover-text",
      "#login-form .field > span", "#login-form > .muted", "#login-form button", "#login-error",
      "#view-home .section-head > h2", "#btn-discover", "#btn-back-watch", "#btn-resume", "#btn-resume-stop",
      "#add-form button", "#add-address", "#add-name", "#host-empty",
      "#host-list .hc-actions > button", "#discovered-list .hc-actions > button", "#host-list .hc-state",
      "#modal-root .modal-actions > button", "#modal-root .quality-row > span", "#modal-root input[placeholder]",
      "#modal-root .modal-body:has(input[inputmode=numeric]) p",
      "#btn-stop", "#btn-overlay-cancel", "#overlay-title", "#toast-root .toast.error"
    ].join(", ");
    const translations = new Map(Object.entries({
      "我要操控":"Take control", "管理":"Manage", "刷新":"Refresh", "开始观战":"Watch", "解锁并开播":"Unlock and stream",
      "房主还没有配对 PS5，暂时没有内容可看。":"Choose Take control to pair your first PS5.",
      "连不上服务器，稍后自动重试…":"Cannot reach the companion. Retrying…",
      "操控需要密码，输入访问密码解锁。":"Enter the password shown by the Start PS5 Player launcher.",
      "访问密码":"Access password", "解锁操控":"Unlock", "返回观战":"Back to watching", "密码错误":"Incorrect password",
      "我的主机":"My consoles", "局域网里发现":"Nearby consoles", "手动添加":"Add manually",
      "扫描局域网":"Scan network", "扫描中…":"Scanning…", "继续接入":"Resume", "结束它":"End session",
      "还没有主机。可以点「扫描局域网」，或者手动填 PS5 的 IP 添加。":"Scan the network or add your PS5 by its IP address.",
      "PS5 的 IP，例如 192.168.1.50":"PS5 IP address, e.g. 192.168.1.50", "备注名（可选）":"Console name (optional)",
      "添加":"Add", "添加并配对":"Add and pair", "已配对":"Paired", "未配对":"Unpaired", "配对":"Pair",
      "PS5 上显示的 8 位数字":"8-digit PIN from your PS5", "PSN Account-ID（base64，8 字节）":"PSN Account ID (Base64, 8 bytes)",
      "1. 在 PS5 上打开「设置 → 系统 → 远程游玩 → 关联设备」，屏幕会显示 8 位 PIN。":"On your PS5, open Settings → System → Remote Play → Pair Device to see the PIN.",
      "2. 用电脑或手机打开 psn.flipscreen.games，登录后复制 Account-ID（base64 那串）。":"Enter your PSN Account ID in Base64. See the PS5 setup guide for help finding it.",
      "配对只需要做一次，凭据保存在 NAS 本地。":"Pair once. The companion saves the pairing on this computer.",
      "开始配对":"Pair console", "PIN 应该是 8 位数字":"Enter the 8-digit PIN.", "请填写 PSN Account-ID":"Enter the PSN Account ID.",
      "唤醒":"Wake", "删除":"Delete", "开始串流":"Start stream", "开始":"Start", "取消":"Cancel", "返回":"Back",
      "分辨率":"Resolution", "帧率":"Frame rate", "码率":"Bitrate", "结束串流":"Stop stream",
      "正在连接 PS5…":"Connecting to PS5…", "无法开始串流":"Could not start stream", "视频解码不可用":"Video decoding unavailable",
      "结束这个会话":"End this session", "取消串流":"Cancel stream", "提交":"Submit", "8 位数字":"8-digit PIN",
      "PS5 屏幕上显示了 PIN，请输入。":"Enter the PIN shown on your PS5.",
      "上次的 PIN 不正确。请重新查看 PS5 屏幕上的「关联设备」PIN。":"Incorrect PIN. Check the Pair Device screen on your PS5."
    }));
    function label(node) {
      if (!node.matches(selectors) || node.isContentEditable) return;
      const attribute = node.tagName === "INPUT" ? "placeholder" : node.id === "btn-stop" ? "title" : null;
      const text = node.firstChild;
      if (!attribute && (text?.nodeType !== 3 || node.childNodes.length !== 1)) return;
      const original = (attribute ? node.getAttribute(attribute) : text.data)?.trim();
      const english = translations.get(original);
      if (!english) return;
      const value = original.length <= 8 && !attribute ? english + " · " + original : english;
      if (attribute) {
        node.setAttribute(attribute, value);
        if (attribute === "title") node.setAttribute("aria-label", value);
      } else text.data = value;
    }
    document.querySelectorAll(selectors).forEach(label);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "characterData") {
          if (record.target.parentElement) label(record.target.parentElement);
          continue;
        }
        label(record.target);
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          label(node);
          node.querySelectorAll(selectors).forEach(label);
        }
      }
    });
    const changing = "#watch-cover-text, #btn-watch-start, #btn-discover, #login-error, #host-list, #discovered-list, #modal-root, #btn-overlay-cancel, #overlay-title, #toast-root";
    for (const region of document.querySelectorAll(changing)) {
      observer.observe(region, { childList: true, characterData: true, subtree: true });
    }
  }
  sync();
  if (ps5) {
    document.addEventListener("DOMContentLoaded", () => {
      if (window.RemotePadWindows || window.webkit?.messageHandlers?.remotePadBindings) labelPS5Controls();
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
