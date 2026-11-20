import AppKit
import GameController
import WebKit

private let playURL = URL(string: "https://www.xbox.com/remoteplay")!
private let xboxHosts: Set<String> = ["www.xbox.com", "xbox.com", "play.xbox.com"]

// One instance per pointer lock. Late callbacks from a previous capture can
// neither change the active input source nor deliver movement to a new document.
@MainActor private final class MouseCapture {
    enum Source: Hashable { case appKit, hardware }
    let token = UUID().uuidString
    var ready = false
    var busy = false
    var source: Source?
    var lastSample = [Source: TimeInterval]()
    var pending = [Source: CGPoint]()
    var mice = [GCMouseInput]()
    var observers = [NSObjectProtocol]()
}

@MainActor
final class RemotePad: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate,
                       WKUIDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply {
    private let assets = Bundle.main.resourceURL!.appendingPathComponent("app", isDirectory: true)
    private var home: URL { assets.appendingPathComponent("home.html") }
    private var bench: URL { assets.appendingPathComponent("bench.html") }
    private var mapper: URL { assets.appendingPathComponent("mapper.html") }
    private let checkingInput = CommandLine.arguments.contains("--check-input")
    private let checkingPlayer = CommandLine.arguments.contains("--check-player")
    private let checkingLayout = CommandLine.arguments.contains("--check-layout")
    private var isChecking: Bool { checkingInput || checkingPlayer || checkingLayout }
    private let checkPreferencesSuite = "local.remotepad.check." + UUID().uuidString
    private lazy var settings: UserDefaults = isChecking ? UserDefaults(suiteName: checkPreferencesSuite)! : .standard
    private var mainView: WKWebView!
    private var mainWindow: NSWindow!
    private var popupWindows = [NSWindow]()
    private let backButton = NSButton()
    private var observations: [NSKeyValueObservation] = []
    private var capture: MouseCapture?
    private var motionMonitor: Any?
    private weak var motionWindow: NSWindow?
    private var previouslyAcceptedMovement = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        do {
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = isChecking ? .nonPersistent() : .default()
            configuration.preferences.isElementFullscreenEnabled = true
            configuration.mediaTypesRequiringUserActionForPlayback = []
            configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
            configuration.defaultWebpagePreferences.preferredContentMode = .desktop
            // WKWebView supplies the platform and WebKit tokens. Add the installed Safari
            // version so the player can select its matching desktop WebKit code path.
            let safari = Bundle(url: URL(fileURLWithPath: "/Applications/Safari.app"))
            let version = safari?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "16.0"
            configuration.applicationNameForUserAgent = "Version/\(version) Safari/605.1.15"
            try addInputScripts(to: configuration)
            configuration.userContentController.add(self, name: "remotePad")
            configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "remotePadSensitivity")
            configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "remotePadLookDeadzone")
            configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "remotePadBindings")
            mainView = makeView(configuration)
            mainWindow = makeWindow(for: mainView, size: NSSize(width: 1060, height: 750))
            mainWindow.minSize = NSSize(width: 620, height: 480)
            addNavigationButtons()
            observations = [
                mainView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] view, _ in
                    self?.backButton.isEnabled = view.canGoBack
                },
                mainView.observe(\.fullscreenState, options: [.new]) { [weak self] _, _ in
                    DispatchQueue.main.async { self?.updateMotionWindow() }
                }
            ]
            mainWindow.setFrameAutosaveName("RemotePadMainWindow")
            mainWindow.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            showHome()
            if isChecking {
                DispatchQueue.main.asyncAfter(deadline: .now() + 40) {
                    self.finishCheck(false, "Timed out waiting for the page or its capture controls.")
                }
            }
        } catch {
            if isChecking { finishCheck(false, error.localizedDescription) }
            showMessage("Remote Pad could not open", error.localizedDescription)
            NSApp.terminate(nil)
        }
    }

    private func addInputScripts(to configuration: WKWebViewConfiguration) throws {
        let benchLiteral = String(decoding: try JSONEncoder().encode(bench.absoluteString), as: UTF8.self)
        let mapperLiteral = String(decoding: try JSONEncoder().encode(mapper.absoluteString), as: UTF8.self)
        let hosts = String(decoding: try JSONEncoder().encode(xboxHosts.sorted()), as: UTF8.self)
        let guardSource = """
            const benchURL = new URL(\(benchLiteral));
            const isBench = location.protocol === "file:" && location.host === benchURL.host &&
                            location.pathname === benchURL.pathname;
            const mapperURL = new URL(\(mapperLiteral));
            const isMapper = location.protocol === "file:" && location.host === mapperURL.host &&
                             location.pathname === mapperURL.pathname;
            const isXbox = location.protocol === "https:" && !location.port &&
                          \(hosts).includes(location.hostname);
            """
        for file in ["controller.js", "bindings-store.js", "controller-model.js", "mapper-ui.js", "overlay.js", "boot.js"] {
            let contents = try String(contentsOf: assets.appendingPathComponent(file), encoding: .utf8)
            let local: String
            switch file {
            case "controller.js", "bindings-store.js": local = "isBench || isMapper"
            case "controller-model.js", "mapper-ui.js": local = "false"
            default: local = "isBench"
            }
            let script = "(() => {\n\(guardSource)\nif (!(isXbox || \(local))) return;\n\(contents)\n})();"
            configuration.userContentController.addUserScript(WKUserScript(
                source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page
            ))
        }
    }

    private func makeView(_ configuration: WKWebViewConfiguration) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.underPageBackgroundColor = .windowBackgroundColor
        return view
    }

    private func makeWindow(for view: WKWebView, size: NSSize) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Remote Pad"
        window.contentView = view
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        return window
    }

    private func addNavigationButtons() {
        let stack = NSStackView()
        stack.spacing = 5
        for (button, label, symbol, action) in [
            (backButton, "Back", "chevron.backward", #selector(back)),
            (NSButton(), "Home", "house", #selector(showHome)),
            (NSButton(), "Reload", "arrow.clockwise", #selector(reload))
        ] {
            button.title = ""
            button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
            button.bezelStyle = .texturedRounded
            button.toolTip = label
            button.setAccessibilityLabel(label)
            button.target = self
            button.action = action
            stack.addArrangedSubview(button)
        }
        stack.edgeInsets = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 8)
        stack.frame.size = stack.fittingSize
        let accessory = NSTitlebarAccessoryViewController()
        accessory.layoutAttribute = .right
        accessory.view = stack
        mainWindow.addTitlebarAccessoryViewController(accessory)
    }

    private func buildMenu() {
        let menu = NSMenu()
        func submenu(_ name: String) -> NSMenu {
            let item = NSMenuItem()
            menu.addItem(item)
            let sub = NSMenu(title: name)
            item.submenu = sub
            return sub
        }
        let appMenu = submenu("Remote Pad")
        appMenu.addItem(withTitle: "About Remote Pad", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Remote Pad", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = submenu("Edit")
        for (title, selector, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"),
                                        ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        let navigate = submenu("Go")
        for (title, selector, key) in [("Home", #selector(showHome), "1"),
                                       ("Back", #selector(back), "["),
                                       ("Reload", #selector(reload), "r")] {
            navigate.addItem(withTitle: title, action: selector, keyEquivalent: key).target = self
        }
        let window = submenu("Window")
        window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        NSApp.windowsMenu = window
        let help = submenu("Help")
        for (title, file) in [("End-User License Agreement", "EULA.md"), ("License", "LICENSE"),
                              ("Privacy Notice", "PRIVACY.md"), ("Support Guide", "SUPPORT.md")] {
            let item = help.addItem(withTitle: title, action: #selector(showDocument(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = file
        }
        NSApp.mainMenu = menu
    }

    private var documentWindow: NSWindow?

    @objc private func showDocument(_ item: NSMenuItem) {
        guard let name = item.representedObject as? String,
              let url = Bundle.main.resourceURL?.appendingPathComponent("Documentation").appendingPathComponent(name),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        let window = documentWindow ?? NSWindow(contentRect: NSRect(x: 0, y: 0, width: 650, height: 540),
                                                styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        if documentWindow == nil { window.center() }
        window.title = item.title
        window.isReleasedWhenClosed = false
        let scroll = NSTextView.scrollableTextView()
        guard let view = scroll.documentView as? NSTextView else { return }
        view.isEditable = false
        view.textContainerInset = NSSize(width: 22, height: 18)
        view.font = .systemFont(ofSize: 14)
        view.string = text
        window.contentView = scroll
        documentWindow = window
        window.makeKeyAndOrderFront(nil)
    }

    @objc private func showHome() {
        mainWindow.makeKeyAndOrderFront(nil)
        mainView.loadFileURL(home, allowingReadAccessTo: assets)
    }
    private var keyView: WKWebView { (NSApp.keyWindow?.contentView as? WKWebView) ?? mainView }
    @objc private func back() { keyView.goBack() }
    @objc private func reload() { keyView.reload() }

    private func isLocal(_ url: URL?, _ expected: URL) -> Bool {
        guard let url, url.isFileURL, url.host == expected.host else { return false }
        return url.standardizedFileURL.path == expected.standardizedFileURL.path
    }

    private func isPlayer(_ url: URL?) -> Bool {
        if isLocal(url, bench) { return true }
        guard let url, url.scheme == "https", let host = url.host?.lowercased(),
              xboxHosts.contains(host), (url.port ?? 443) == 443 else { return false }
        let route = #"^/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})*/)?(?:remoteplay|play)(?:/|$)"#
        return host == "play.xbox.com" || url.path.range(of: route, options: [.regularExpression, .caseInsensitive]) != nil
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.webView === mainView, message.frameInfo.isMainFrame else {
            replyHandler(nil, "This page cannot change controller settings.")
            return
        }
        let sender = message.frameInfo.request.url
        let current = mainView.url
        let onPlayer = isPlayer(sender) && isPlayer(current)
        if message.name == "remotePadBindings" {
            let reading = (message.body as? String) == "get"
            let onMapper = isLocal(sender, mapper) && isLocal(current, mapper)
            let onHome = isLocal(sender, home) && isLocal(current, home)
            guard onPlayer || onMapper || (onHome && reading) else {
                replyHandler(nil, "This page cannot change the control layout.")
                return
            }
            if reading {
                replyHandler(settings.dictionary(forKey: "controlBindings") ?? [:], nil)
                return
            }
            let ids: Set<String> = ["a", "b", "x", "y", "lb", "rb", "lt", "rt", "view", "menu", "ls", "rs",
                                    "up", "down", "left", "right", "guide", "lxLeft", "lxRight", "lyUp", "lyDown",
                                    "rxLeft", "rxRight", "ryUp", "ryDown"]
            guard let layout = message.body as? [String: [String]], layout.count <= ids.count,
                  layout.allSatisfy({ ids.contains($0.key) && $0.value.count <= 32 &&
                      $0.value.allSatisfy { !$0.isEmpty && $0.utf8.count <= 48 } }) else {
                replyHandler(nil, "This control layout has an invalid control or input.")
                return
            }
            settings.set(layout, forKey: "controlBindings")
            replyHandler(layout, nil)
            return
        }
        let deadzone = message.name == "remotePadLookDeadzone"
        guard deadzone || message.name == "remotePadSensitivity", onPlayer else {
            replyHandler(nil, "This page cannot change controller settings.")
            return
        }
        let key = deadzone ? "lookDeadzone" : "lookSensitivity"
        let bounds = deadzone ? 0.0...0.5 : 0.25...3.0
        if (message.body as? String) == "get" {
            let value = settings.object(forKey: key) as? Double
            replyHandler(value.flatMap { bounds.contains($0) ? $0 : nil } ?? (deadzone ? 0.27 : 1.0), nil)
        } else if let number = message.body as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue.isFinite, bounds.contains(number.doubleValue) {
            settings.set(number.doubleValue, forKey: key)
            replyHandler(number.doubleValue, nil)
        } else { replyHandler(nil, "The value is outside the supported range.") }
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.webView === mainView, message.frameInfo.isMainFrame,
              isLocal(message.frameInfo.request.url, home), isLocal(mainView.url, home),
              let action = message.body as? String else { return }
        do {
            switch action {
            case "play":
                mainView.load(URLRequest(url: playURL))
            case "bench":
                mainView.loadFileURL(bench, allowingReadAccessTo: assets)
            case "map":
                mainView.loadFileURL(mapper, allowingReadAccessTo: assets)
            case "chromeSetup":
                let folder = try prepareChromeExtension()
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(folder.path, forType: .string)
                try openInChrome(URL(string: "chrome://extensions/")!)
            case "chromePlay":
                try openInChrome(chromePlayURL())
            case "revealExtension":
                let folder = try prepareChromeExtension()
                NSWorkspace.shared.activateFileViewerSelecting([folder])
            default: break
            }
        } catch {
            showMessage("Chrome setup", error.localizedDescription)
        }
    }

    private func chromePlayURL() throws -> URL {
        guard let bindings = settings.dictionary(forKey: "controlBindings") else { return playURL }
        let json = try JSONSerialization.data(withJSONObject: bindings, options: [.sortedKeys])
        let encoded = json.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        var url = URLComponents(url: playURL, resolvingAgainstBaseURL: false)!
        url.fragment = "remote-pad-layout=" + encoded
        return url.url!
    }

    private func prepareChromeExtension() throws -> URL {
        let files = FileManager.default
        let support = try files.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let destination = support.appendingPathComponent("Remote Pad/Chrome Extension", isDirectory: true)
        let source = Bundle.main.resourceURL!.appendingPathComponent("chrome", isDirectory: true)
        try files.createDirectory(at: destination, withIntermediateDirectories: true)
        // Replace only the files supplied by Remote Pad. Keep the extension's persistent path.
        let names = try files.subpathsOfDirectory(atPath: source.path)
        for name in names.filter({ $0 != "manifest.json" }) + ["manifest.json"] {
            let bundled = source.appendingPathComponent(name)
            guard try bundled.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else { continue }
            let target = destination.appendingPathComponent(name)
            try files.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            let bytes = try Data(contentsOf: bundled)
            if (try? Data(contentsOf: target)) != bytes { try bytes.write(to: target, options: .atomic) }
        }
        return destination
    }

    private func openInChrome(_ url: URL) throws {
        guard let chrome = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome") else {
            throw NSError(domain: "RemotePad", code: 1, userInfo: [NSLocalizedDescriptionKey:
                "Google Chrome could not be found. Install Chrome or choose Play in the app."])
        }
        NSWorkspace.shared.open([url], withApplicationAt: chrome, configuration: .init()) { [weak self] _, error in
            if let error {
                DispatchQueue.main.async { self?.showMessage("Could not open Chrome", error.localizedDescription) }
            }
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, !checkingInput else { return nil }
        let popup = makeView(configuration)
        let window = makeWindow(for: popup, size: NSSize(width: 660, height: 720))
        popupWindows.append(window)
        window.makeKeyAndOrderFront(nil)
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        if webView !== mainView { webView.window?.close() }
    }
    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        if window === mainWindow { NSApp.terminate(nil) }
        else { popupWindows.removeAll { $0 === window } }
    }

    private func beginMouseRouting(in view: WKWebView) {
        endMouseRouting()
        let session = MouseCapture()
        capture = session
        view.callAsyncJavaScript("return window.RemotePadUI?.wantsMouseRouting() === true && window.RemotePadController?.setNativeMouseRouting(token) === true",
                                 arguments: ["token": session.token], in: nil, in: .page) { [weak self, weak session] result in
            guard let self, let session, self.capture === session else { return }
            guard case .success(let accepted) = result, accepted as? Bool == true else {
                self.endMouseRouting()
                return
            }
            session.ready = true
            self.installMouseSources(session)
        }
    }

    private func installMouseSources(_ session: MouseCapture) {
        updateMotionWindow()
        let moves: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
        motionMonitor = NSEvent.addLocalMonitorForEvents(matching: moves) { [weak self, weak session] event in
            guard let self, let session, self.capture === session, let window = self.focusedPlayerWindow,
                  !event.modifierFlags.contains(.command) else { return event }
            // Locked motion can have no window, or identify the original host during WebKit fullscreen.
            if let source = event.window, source !== window && source !== self.mainWindow { return event }
            self.recordMotion(.appKit, dx: event.deltaX, dy: event.deltaY, in: session)
            // The native bridge owns motion only. Button presses/releases
            // continue through the normal WebKit and DOM event path.
            return nil
        }
        // macOS 13 could report broken GCMouse movement on MacBooks. AppKit
        // relative deltas also work with trackpads and remote pointing devices.
        if #available(macOS 14, *) {
            let center = NotificationCenter.default
            let attached = center.addObserver(forName: .GCMouseDidConnect, object: nil, queue: .main) { [weak self, weak session] note in
                MainActor.assumeIsolated {
                    if let mouse = note.object as? GCMouse, let session { self?.attachMouse(mouse, to: session) }
                }
            }
            session.observers.append(attached)
            for mouse in GCMouse.mice() { attachMouse(mouse, to: session) }
        }
        let keyChange = NotificationCenter.default.addObserver(forName: NSWindow.didBecomeKeyNotification,
            object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.updateMotionWindow() } }
        session.observers.append(keyChange)
    }

    private var focusedPlayerWindow: NSWindow? {
        guard NSApp.isActive, let window = mainView?.window, window.isKeyWindow,
              window.attachedSheet == nil else { return nil }
        return window
    }

    private func updateMotionWindow() {
        guard capture?.ready == true, let window = mainView.window, window !== motionWindow else { return }
        motionWindow?.acceptsMouseMovedEvents = previouslyAcceptedMovement
        motionWindow = window
        previouslyAcceptedMovement = window.acceptsMouseMovedEvents
        window.acceptsMouseMovedEvents = true
    }

    private func attachMouse(_ mouse: GCMouse, to session: MouseCapture) {
        guard capture === session, let input = mouse.mouseInput, input.mouseMovedHandler == nil else { return }
        session.mice.append(input)
        // GameController's default handler queue is main. This is a foreground
        // physical-device callback, independent of the cursor or view hit tests.
        input.mouseMovedHandler = { [weak self, weak session] _, dx, dy in
            let receive = { @MainActor in
                guard let self, let session, self.capture === session, self.focusedPlayerWindow != nil,
                      !NSEvent.modifierFlags.contains(.command) else { return }
                self.recordMotion(.hardware, dx: CGFloat(dx), dy: CGFloat(-dy), in: session)
            }
            if Thread.isMainThread { MainActor.assumeIsolated { receive() } }
            else { DispatchQueue.main.async { receive() } }
        }
    }

    private func recordMotion(_ source: MouseCapture.Source, dx: CGFloat, dy: CGFloat, in session: MouseCapture) {
        guard dx.isFinite, dy.isFinite, dx != 0 || dy != 0 else { return }
        let now = ProcessInfo.processInfo.systemUptime
        // Select a single source for each movement burst. If the chosen source
        // stops delivering, reselect after a short gap (e.g., switching devices).
        if let selected = session.source, now - (session.lastSample[selected] ?? 0) > 0.08 {
            session.source = nil
        }
        session.lastSample[source] = now
        guard session.source == nil || session.source == source else { return }
        let current = session.pending[source] ?? .zero
        session.pending[source] = CGPoint(x: current.x + dx, y: current.y + dy)
        scheduleDelivery(session)
    }

    private func scheduleDelivery(_ session: MouseCapture) {
        guard session.ready, !session.busy, !session.pending.isEmpty else { return }
        session.busy = true
        // Coalesce high-DPI mouse reports and keep at most one WebKit call in
        // flight. Four milliseconds is below one display frame at 120 Hz.
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(4)) { [weak self, weak session] in
            guard let self, let session, self.capture === session else { return }
            let source = session.source ?? (session.pending[.hardware] != nil ? .hardware : .appKit)
            session.source = source
            let delta = session.pending[source] ?? .zero
            session.pending.removeAll(keepingCapacity: true)
            guard self.focusedPlayerWindow != nil, delta != .zero else { session.busy = false; return }
            self.mainView.callAsyncJavaScript("return window.RemotePadController?.nativeMouseMove(token, dx, dy)",
                arguments: ["token": session.token, "dx": delta.x, "dy": delta.y], in: nil, in: .page) { result in
                guard self.capture === session else { return }
                if case .failure = result { self.endMouseRouting(); return }
                session.busy = false
                self.scheduleDelivery(session)
            }
        }
    }

    private func endMouseRouting() {
        guard let session = capture else { return }
        capture = nil
        if let motionMonitor { NSEvent.removeMonitor(motionMonitor) }
        motionMonitor = nil
        for input in session.mice { input.mouseMovedHandler = nil }
        for observer in session.observers { NotificationCenter.default.removeObserver(observer) }
        motionWindow?.acceptsMouseMovedEvents = previouslyAcceptedMovement
        motionWindow = nil
        mainView.callAsyncJavaScript("window.RemotePadController?.endNativeMouseRouting(token)",
                                     arguments: ["token": session.token], in: nil, in: .page, completionHandler: nil)
    }

    func applicationDidResignActive(_ notification: Notification) { endMouseRouting() }

    func windowDidResignKey(_ notification: Notification) {
        guard let session = capture else { return }
        // DOM fullscreen hands the same WKWebView to a different NSWindow. No
        // samples are sent while neither is key. WebKit also reports lock loss.
        DispatchQueue.main.async { [weak self] in
            guard let self, self.capture === session else { return }
            self.updateMotionWindow()
            if self.focusedPlayerWindow == nil && self.mainView.fullscreenState == .notInFullscreen {
                self.endMouseRouting()
            }
        }
    }

    @objc(_webViewDidLosePointerLock:)
    func lostPointerLock(_ view: WKWebView) {
        if view === mainView { endMouseRouting() }
    }

    // WebKit's macOS embedder callback for the DOM Pointer Lock API. WebKit checks
    // the user gesture and releases on Escape. Restrict capture to an active player.
    @objc(_webViewDidRequestPointerLock:completionHandler:)
    func requestPointerLock(_ view: WKWebView, completionHandler: @escaping (Bool) -> Void) {
        guard view === mainView, view.window?.isKeyWindow == true, let url = view.url else {
            completionHandler(false)
            return
        }
        let allowed = isPlayer(url)
        if allowed { beginMouseRouting(in: view) }
        completionHandler(allowed)
    }

    func webView(_ view: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        let isBundledPage = isLocal(url, home) || isLocal(url, bench) || isLocal(url, mapper)
        let safeLocalNavigation = isBundledPage && view === mainView &&
            (view.url == nil || action.targetFrame?.isMainFrame == true)
        let embeddedDocument = action.targetFrame?.isMainFrame == false && ["blob", "data"].contains(url.scheme ?? "")
        decisionHandler(url.scheme == "https" || url.scheme == "about" || embeddedDocument || safeLocalNavigation ? .allow : .cancel)
    }

    private func updateTitle(_ view: WKWebView) {
        if let url = view.url, url.scheme == "https", let host = url.host {
            view.window?.title = "Remote Pad  ·  " + host
        } else if isLocal(view.url, bench) {
            view.window?.title = "Remote Pad  ·  Input Test"
        } else if isLocal(view.url, mapper) {
            view.window?.title = "Remote Pad  ·  Control Layout"
        } else { view.window?.title = "Remote Pad" }
    }

    func webView(_ view: WKWebView, didCommit navigation: WKNavigation!) {
        if view === mainView { endMouseRouting() }
        updateTitle(view)
    }
    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
        updateTitle(view)
        guard view === mainView else { return }
        if checkingInput { checkPackagedInput() }
        if checkingPlayer { checkPlayerLanding() }
        if checkingLayout { checkPackagedLayout() }
    }

    func webView(_ view: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationFailed(view, error)
    }
    func webView(_ view: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        navigationFailed(view, error)
    }
    private func navigationFailed(_ view: WKWebView, _ error: Error) {
        let cause = error as NSError
        if cause.domain == NSURLErrorDomain && cause.code == NSURLErrorCancelled { return }
        if cause.domain == WKError.errorDomain && cause.code == 102 { return } // Navigation replaced.
        if isChecking { finishCheck(false, cause.localizedDescription) }
        showMessage("Could not load the page", cause.localizedDescription +
                    "\nReturn Home to reopen Remote Play or use the Chrome option.", in: view.window)
    }
    func webViewWebContentProcessDidTerminate(_ view: WKWebView) {
        if view === mainView { endMouseRouting() }
        if isChecking { finishCheck(false, "Web view stopped") }
        showMessage("The player stopped", "Use Reload to reopen this page.", in: view.window)
    }

    private func showMessage(_ title: String, _ detail: String, in window: NSWindow? = nil) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        if let parent = window ?? mainWindow { alert.beginSheetModal(for: parent) }
        else { alert.runModal() }
    }

    private func checkPackagedInput() {
        if isLocal(mainView.url, home) {
            mainView.evaluateJavaScript("window.webkit.messageHandlers.remotePad.postMessage('bench')")
            return
        }
        guard isLocal(mainView.url, bench) else { finishCheck(false, "Wrong check page") }
        Task { @MainActor in
            do {
                // An Xbox page can lock the mouse for its own native mouse mode.
                // Exercise this before Remote Pad's Capture control is activated.
                _ = try await mainView.callAsyncJavaScript("""
                    await document.body.requestPointerLock();
                    for (let i = 0; i < 60 && !document.pointerLockElement; i++)
                        await new Promise(resolve => setTimeout(resolve, 20));
                    if (!document.pointerLockElement) throw Error('Unrelated page lock was declined');
                    """, in: nil, contentWorld: .page)
                try await Task.sleep(nanoseconds: 60_000_000)
                guard motionMonitor == nil, capture == nil else { finishCheck(false, "Claimed a website-owned lock") }
                _ = try await mainView.evaluateJavaScript("document.exitPointerLock(); true")
                try await Task.sleep(nanoseconds: 350_000_000)
                try await captureForCheck()
                try await checkMouse(.mouseMoved, dx: 13, dy: 11,
                                     expecting: "p.axes[2] > 0 && p.axes[3] > 0 && !p.buttons[7].pressed")
                let steadyRange = try await checkSteadyTurn()
                let paired = try await checkPairedMotion()
                try await checkMouse(.leftMouseDown, expecting: "p.buttons[7].pressed")
                // WebKit obtains DOM buttons from the system's physical pressed
                // mask. App-local NSEvents intentionally cannot change that mask.
                // Supply the chord transitions here; drag still enters through AppKit.
                try await testChordEvent("mousedown", button: 2, mask: 3)
                try await checkMouse(.leftMouseDragged, dx: -32, dy: -28,
                                     expecting: "p.axes[2] < 0 && p.axes[3] < 0 && p.buttons[6].pressed && p.buttons[7].pressed")
                try await testChordEvent("mouseup", button: 0, mask: 2)
                try await checkMouse(.rightMouseDragged, dx: 65, dy: -35, outside: true,
                                     expecting: "p.axes[2] > 0 && p.axes[3] < 0 && p.buttons[6].pressed")
                try await testChordEvent("mouseup", button: 2, mask: 0)
                try await checkMouse(.leftMouseUp, expecting: "!p.buttons[7].pressed")
                try await checkMouse(.rightMouseDown, expecting: "p.buttons[6].pressed")
                try await checkMouse(.rightMouseUp, expecting: "!p.buttons[6].pressed && !p.buttons[7].pressed")
                try await checkMouse(.mouseMoved, dx: -140, dy: 110, outside: true, windowless: true,
                                     expecting: "p.axes[2] < 0 && p.axes[3] > 0 && !p.buttons[7].pressed && !p.buttons[6].pressed")
                let controls = """
                    const controller = window.RemotePadController;
                    const key = code => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles:true }));
                    const pad = () => navigator.getGamepads()[controller.getState().index];
                    key('KeyW');
                    key('Space');
                    if (!pad().connected || pad().mapping !== 'standard' || pad().axes[1] !== -1 ||
                        !pad().buttons[0].pressed) throw Error('Keyboard mapping');
                    key('Escape');
                    if (controller.getState().capturing || pad().buttons.some(b => b.pressed) ||
                        pad().axes.some(v => v !== 0)) throw Error('Escape release');
                    const settings = window.webkit.messageHandlers.remotePadSensitivity;
                    await settings.postMessage(1.5);
                    if (await settings.postMessage('get') !== 1.5) throw Error('Mouse sensitivity');
                    const deadzone = window.webkit.messageHandlers.remotePadLookDeadzone;
                    if (await deadzone.postMessage('get') !== 0.27) throw Error('Default minimum look strength');
                    await deadzone.postMessage(0);
                    if (await deadzone.postMessage('get') !== 0) throw Error('Explicit zero minimum look strength');
                    const bindings = window.webkit.messageHandlers.remotePadBindings;
                    await bindings.postMessage({ a: ['KeyK'] });
                    if ((await bindings.postMessage('get')).a[0] !== 'KeyK') throw Error('Saved layout');
                    """
                _ = try await mainView.callAsyncJavaScript(controls, in: nil, contentWorld: .page)
                try await checkMouse(.mouseMoved, dx: 18, dy: 18,
                                     expecting: "!window.RemotePadController.getState().capturing && p.axes.every(v => v === 0)")
                guard motionMonitor == nil else { finishCheck(false, "Mouse routing remained active after Escape") }
                // Give the system time to complete pointer reassociation before
                // beginning an independent capture to check key-window loss.
                try await Task.sleep(nanoseconds: 350_000_000)
                _ = try await mainView.callAsyncJavaScript("await document.documentElement.requestFullscreen()",
                                                            in: nil, contentWorld: .page)
                for _ in 0..<80 {
                    if mainView.fullscreenState == .inFullscreen && focusedPlayerWindow != nil { break }
                    try await Task.sleep(nanoseconds: 50_000_000)
                }
                guard mainView.fullscreenState == .inFullscreen, mainView.window !== mainWindow else {
                    finishCheck(false, "WebKit did not transfer the game surface to its fullscreen window")
                }
                try await captureForCheck()
                try await checkMouse(.mouseMoved, dx: -15, dy: 12, outside: true,
                                     expecting: "p.axes[2] < 0 && p.axes[3] > 0 && !p.buttons[6].pressed && !p.buttons[7].pressed")
                _ = try await mainView.callAsyncJavaScript("window.RemotePadController.stop(); await document.exitFullscreen()",
                                                            in: nil, contentWorld: .page)
                for _ in 0..<80 {
                    if mainView.window === mainWindow && mainView.fullscreenState == .notInFullscreen { break }
                    try await Task.sleep(nanoseconds: 50_000_000)
                }
                try await Task.sleep(nanoseconds: 350_000_000)
                try await captureForCheck()
                mainWindow.orderOut(nil)
                let blurCheck = """
                    for (let i = 0; i < 40 && window.RemotePadController.getState().capturing; i++)
                        await new Promise(resolve => setTimeout(resolve, 25));
                    const state = window.RemotePadController.getState();
                    if (state.capturing || state.axes.some(v => v !== 0) || state.buttons.some(Boolean)) throw Error('Focus loss');
                    """
                _ = try await mainView.callAsyncJavaScript(blurCheck, in: nil, contentWorld: .page)
                guard motionMonitor == nil else { finishCheck(false, "Mouse routing remained active after focus loss") }
                finishCheck(true, "Native relative X/Y, both triggers and chord, mouse-up, windowless and off-edge movement, WebKit fullscreen, Escape, focus loss and settings. Steady turn: \(steadyRange). Paired-source check: \(paired)")
            } catch { finishCheck(false, String(describing: error as NSError)) }
        }
    }

    private func captureForCheck() async throws {
        NSApp.activate(ignoringOtherApps: true)
        guard let window = mainView.window else { finishCheck(false, "No player window") }
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(mainView)
        var focused = false
        for _ in 0..<60 {
            if NSApp.isActive && window.isKeyWindow && window.occlusionState.contains(.visible) {
                focused = try await mainView.evaluateJavaScript("document.hasFocus() && !document.hidden") as? Bool == true
                if focused { break }
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        guard focused else { finishCheck(false, "Input test window did not receive focus") }
        // Start the same capture shortcut as the player, with an app-local
        // keyboard event so WebKit can authenticate the user activation.
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            let f8 = "\u{F70B}"
            guard let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: [.function],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, characters: f8, charactersIgnoringModifiers: f8, isARepeat: false, keyCode: 100)
            else { finishCheck(false, "Cannot create capture shortcut event") }
            NSApp.sendEvent(event)
        }
        _ = try await mainView.callAsyncJavaScript("""
            for (let i = 0; i < 45 && !window.RemotePadController.getState().capturing; i++)
                await new Promise(resolve => setTimeout(resolve, 45));
            if (!document.pointerLockElement || !window.RemotePadController.getState().capturing)
                throw Error('Pointer lock: ' + window.RemotePadUI.getNotice());
            """, in: nil, contentWorld: .page)
        for _ in 0..<60 {
            if capture?.ready == true { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        finishCheck(false, "Native motion bridge did not acknowledge the capture")
    }

    // Only the opt-in test invokes this. NSApp.sendEvent dispatches an NSEvent
    // within our own app. It neither posts to the system nor moves the cursor.
    private func sendTestMouse(_ type: NSEvent.EventType, dx: Int64 = 0, dy: Int64 = 0,
                               outside: Bool = false, windowless: Bool = false) {
        guard let window = mainView.window else { finishCheck(false, "Missing game window") }
        let point = outside ? NSPoint(x: -250, y: -250) : NSPoint(x: mainView.bounds.midX, y: mainView.bounds.midY)
        let original = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: windowless ? 0 : window.windowNumber,
            context: nil, eventNumber: 17, clickCount: 1, pressure: 0)
        guard let cgEvent = original?.cgEvent else { finishCheck(false, "Cannot create test mouse event") }
        cgEvent.setIntegerValueField(.mouseEventDeltaX, value: dx)
        cgEvent.setIntegerValueField(.mouseEventDeltaY, value: dy)
        guard let event = NSEvent(cgEvent: cgEvent), windowless ? event.window == nil : event.window === window else {
            finishCheck(false, "Test mouse event has the wrong window")
        }
        NSApp.sendEvent(event)
    }

    private func checkMouse(_ type: NSEvent.EventType, dx: Int64 = 0, dy: Int64 = 0,
                            outside: Bool = false, windowless: Bool = false,
                            expecting condition: String) async throws {
        sendTestMouse(type, dx: dx, dy: dy, outside: outside, windowless: windowless)
        let check = """
            for (let i = 0; i < 35; i++) {
                const p = navigator.getGamepads()[window.RemotePadController.getState().index];
                if (p && (\(condition))) return;
                await new Promise(resolve => setTimeout(resolve, 4));
            }
            throw Error('Native mouse input failed for \(type.rawValue): \(condition)');
            """
        _ = try await mainView.callAsyncJavaScript(check, in: nil, contentWorld: .page)
    }

    private func testChordEvent(_ type: String, button: Int, mask: Int) async throws {
        _ = try await mainView.callAsyncJavaScript("""
            document.body.dispatchEvent(new MouseEvent(type, { button, buttons:mask, bubbles:true }));
            """, arguments: ["type": type, "button": button, "mask": mask], in: nil, contentWorld: .page)
    }

    private func checkSteadyTurn() async throws -> String {
        try await Task.sleep(nanoseconds: 200_000_000)
        _ = try await mainView.evaluateJavaScript("""
            window.RemotePadController.setSensitivity(2.5);
            window.turnSamples = [];
            window.recordTurn = true;
            (function frame() {
                if (!window.recordTurn) return;
                window.turnSamples.push(navigator.getGamepads()[window.RemotePadController.getState().index].axes[2]);
                requestAnimationFrame(frame);
            })(); true
            """)
        for _ in 0..<45 {
            sendTestMouse(.mouseMoved, dx: 2, dy: 0, outside: true, windowless: true)
            try await Task.sleep(nanoseconds: 12_000_000)
        }
        let result = try await mainView.evaluateJavaScript("""
            (() => {
                window.recordTurn = false;
                const settled = window.turnSamples.slice(window.turnSamples.findIndex(v => v > 0.2) + 4);
                const min = Math.min(...settled), max = Math.max(...settled);
                if (settled.length < 6 || min < 0.23 || max - min > 0.30)
                    throw Error('Unstable stick ' + JSON.stringify(settled));
                return settled.length + ' display frames, X ' + min.toFixed(2) + '–' + max.toFixed(2);
            })()
            """)
        return result as? String ?? ""
    }

    private func checkPairedMotion() async throws -> String {
        guard let session = capture else { finishCheck(false, "Missing native capture") }
        try await Task.sleep(nanoseconds: 200_000_000)
        _ = try await mainView.evaluateJavaScript("""
            window.originalCheckAPI = window.RemotePadController;
            window.pairedCheckDeltas = [];
            window.RemotePadController = { ...window.originalCheckAPI, nativeMouseMove(token, x, y) {
                window.pairedCheckDeltas.push([x, y]);
                return window.originalCheckAPI.nativeMouseMove(token, x, y);
            }}; true
            """)
        let mode: String
        if let input = session.mice.first, let handler = input.mouseMovedHandler {
            handler(input, 7, 3)
            mode = "connected GCMouse handler"
        } else {
            recordMotion(.hardware, dx: 7, dy: -3, in: session)
            mode = "simulated hardware sample"
        }
        sendTestMouse(.mouseMoved, dx: 7, dy: -3, outside: true, windowless: true)
        _ = try await mainView.callAsyncJavaScript("""
            for (let i = 0; !window.pairedCheckDeltas.length && i < 60; i++)
                await new Promise(resolve => setTimeout(resolve, 5));
            await new Promise(resolve => setTimeout(resolve, 25));
            window.RemotePadController = window.originalCheckAPI;
            const samples = window.pairedCheckDeltas;
            if (samples.length !== 1 || samples[0][0] !== 7 || samples[0][1] !== -3)
                throw Error('Expected one native movement from paired reports, got ' + JSON.stringify(samples));
            """, in: nil, contentWorld: .page)
        try await Task.sleep(nanoseconds: 100_000_000) // Next scenario uses only AppKit.
        return mode + " and matching AppKit input delivered once"
    }

    private func checkPlayerLanding() {
        if isLocal(mainView.url, home) {
            mainView.evaluateJavaScript("window.webkit.messageHandlers.remotePad.postMessage('play')")
            return
        }
        guard let url = mainView.url, xboxHosts.contains(url.host ?? "") else { return }
        let test = """
            for (let i = 0; i < 140; i++) {
                const signIn = /sign in|log in/i.test(document.body.innerText);
                const dock = document.querySelector('#remote-pad-controls')?.shadowRoot;
                const button = dock?.querySelector('.capture');
                const pad = navigator.getGamepads().find(p => p?.connected && p.mapping === 'standard');
                if (button && signIn && pad) {
                    dock.querySelector('.toggle').click();
                    dock.querySelector('.edit-map').click();
                    const dialog = dock.querySelector('dialog[open]');
                    const editor = dialog?.lastElementChild.firstElementChild?.shadowRoot;
                    if (editor?.querySelector('select')?.options.length !== 25)
                        throw Error('Xbox player layout editor did not open');
                    dialog.close();
                    return location.host + location.pathname + ' — sign-in prompt, virtual gamepad and 25-control editor';
                }
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            throw Error('Player landing, sign-in prompt or capture button unavailable at ' + location.host + location.pathname);
            """
        mainView.callAsyncJavaScript(test, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let detail): self.finishCheck(true, detail as? String ?? "")
            case .failure(let error):
                // The public landing page can navigate again after its first document.
                if self.mainView.url != url { return }
                self.finishCheck(false, String(describing: error as NSError))
            }
        }
    }

    private func checkPackagedLayout() {
        Task { @MainActor in
            do {
                if isLocal(mainView.url, home) {
                    if settings.dictionary(forKey: "controlBindings") == nil {
                        _ = try await mainView.evaluateJavaScript("document.querySelector('button[data-action=map]').click()")
                    } else {
                        _ = try await mainView.callAsyncJavaScript("""
                            const layout = await window.webkit.messageHandlers.remotePadBindings.postMessage('get');
                            if (layout.a.join() !== 'KeyK') throw Error('Home profile summary');
                            """, in: nil, contentWorld: .page)
                        _ = try await mainView.evaluateJavaScript("document.querySelector('button[data-action=bench]').click()")
                    }
                } else if isLocal(mainView.url, mapper) {
                    _ = try await mainView.callAsyncJavaScript("""
                        const editor = document.querySelector('#mapper > div').shadowRoot;
                        const select = editor.querySelector('select');
                        for (let i = 0; i < 100 && select.disabled; i++) await new Promise(r => setTimeout(r, 20));
                        select.value = 'a';
                        select.dispatchEvent(new Event('change'));
                        editor.querySelector('.inspector button.primary').click();
                        editor.querySelector('.capture').dispatchEvent(new KeyboardEvent('keydown', {
                            key:'k', code:'KeyK', bubbles:true, composed:true
                        }));
                        for (let i = 0; i < 100; i++) {
                            const saved = await window.webkit.messageHandlers.remotePadBindings.postMessage('get');
                            if (saved.a?.join() === 'KeyK') return;
                            await new Promise(r => setTimeout(r, 20));
                        }
                        throw Error('Mapper did not save K for A');
                        """, in: nil, contentWorld: .page)
                    _ = try await mainView.evaluateJavaScript("document.querySelector('a.back').click()")
                } else if isLocal(mainView.url, bench) {
                    _ = try await mainView.callAsyncJavaScript("""
                        for (let i = 0; i < 100; i++) {
                            if (window.RemotePadController.getBindings().a.join() === 'KeyK') return;
                            await new Promise(r => setTimeout(r, 20));
                        }
                        throw Error('Input test did not load the saved mapping');
                        """, in: nil, contentWorld: .page)
                    try await captureForCheck()
                    try await checkKey(.keyDown, "k", code: 40, pressesA: true)
                    try await checkKey(.keyUp, "k", code: 40, pressesA: false)
                    try await checkKey(.keyDown, " ", code: 49, pressesA: false)
                    try await checkKey(.keyUp, " ", code: 49, pressesA: false)
                    _ = try await mainView.evaluateJavaScript("window.RemotePadController.stop(); true")
                    let url = try chromePlayURL()
                    guard let saved = settings.dictionary(forKey: "controlBindings"),
                          let encoded = url.fragment?.components(separatedBy: "=").last else {
                        finishCheck(false, "Missing Chrome handoff")
                    }
                    var base64 = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
                    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
                    guard let bytes = Data(base64Encoded: base64),
                          let decoded = try JSONSerialization.jsonObject(with: bytes) as? NSDictionary,
                          decoded.isEqual(to: saved) else { finishCheck(false, "Chrome handoff layout") }
                    finishCheck(true, "Home, mapper, saved layout, native K mapped to A, default Space replaced, Chrome handoff")
                } else { finishCheck(false, "Unexpected layout check page") }
            } catch { finishCheck(false, String(describing: error as NSError)) }
        }
    }

    private func checkKey(_ type: NSEvent.EventType, _ key: String, code: UInt16, pressesA: Bool) async throws {
        guard let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: mainWindow.windowNumber,
            context: nil, characters: key, charactersIgnoringModifiers: key, isARepeat: false, keyCode: code)
        else { finishCheck(false, "Cannot create test key") }
        NSApp.sendEvent(event)
        // Allow the queued native key event to cross WebKit's process boundary.
        try await Task.sleep(nanoseconds: 50_000_000)
        let matched = try await mainView.evaluateJavaScript("""
            navigator.getGamepads()[window.RemotePadController.getState().index].buttons[0].pressed
            """) as? Bool
        guard matched == pressesA else { finishCheck(false, "Unexpected A button state for key code \(code)") }
    }

    private func finishCheck(_ ok: Bool, _ message: String) -> Never {
        settings.removePersistentDomain(forName: checkPreferencesSuite)
        let check = checkingPlayer ? "player" : (checkingLayout ? "layout" : "input")
        print("WKWebView \(check) check \(ok ? "passed" : "failed"): \(message)")
        exit(ok ? 0 : 1)
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = RemotePad()
    app.setActivationPolicy(.regular)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
}
