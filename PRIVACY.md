# Remote Pad privacy

Remote Pad maps your keyboard and mouse on your Mac or Windows PC. The project has no account service, analytics endpoint, or automatic crash-report uploader. The input test and layout editor work offline.

## During play

When you choose **Capture inputs**, Remote Pad reads keys, mouse buttons and relative mouse movement in the focused player. It keeps the current controller state in memory and exposes that state to the active console player. Xbox sends it through your Remote Play session. On PS5 the local companion relays controller packets to the paired console. Press **Esc** or switch away to release capture. The mapper saves the key or mouse control you assign. It does not keep a history of your keystrokes or movements.

**Open Xbox Remote Play** loads Microsoft's Xbox website. Microsoft handles sign-in and streaming. Remote Pad does not request your account password or read it from the sign-in form. Its Mac window uses WebKit's persistent website data store, so cookies and sign-in state can survive quitting the app. Windows uses a local WebView2 profile. Chrome uses its own profile. If you enable voice chat, the Xbox site may request microphone access. You can manage permission for Remote Pad or Chrome in **System Settings → Privacy & Security → Microphone**. [Microsoft Privacy Statement](https://www.microsoft.com/en-us/privacy/privacystatement) · [Apple's WebKit data storage](https://developer.apple.com/documentation/webkit/wkwebsitedatastore) · [Microphone controls on Mac](https://support.apple.com/guide/mac-help/mchla1b1e1fe/mac)

## PlayStation 5

Choosing **Start PS5 Player** asks Docker Desktop to obtain a pinned image from Docker Hub on first use. The player listens only on this computer. It processes the console address, base64 PSN account ID, pairing code and stream. It persists its generated login password, console registration keys and configuration in a local Docker volume. The startup window displays the local password. Treat this data as private. Removing the desktop app leaves Docker data in place. [PS5 setup and data removal](https://github.com/lamacchiasolutions/remote-pad/blob/main/docs/PS5.md)

## Saved settings

- **Mac app.** Your layout, mouse sensitivity and minimum look strength are saved in your Mac user preferences. The player also uses local website storage for look settings and the optional input display.
- **Windows app.** Your layout, look settings and persistent WebView2 profile (including cookies and local website storage) are kept under `%LOCALAPPDATA%\Remote Pad`. WebView2 implements its own browser/runtime services under Microsoft’s terms.
- **Chrome extension.** The extension stores the layout and a copy of the last layout imported from the app in the current Chrome profile. It uses local extension storage. The Xbox page's local storage holds look settings and the input-display preference. The extension runs on the Xbox player routes listed in its manifest. Controller state and mapping settings are available to scripts on those pages. [Extension permissions](chrome/manifest.json)
- **Open in Chrome.** If you have saved a layout in the app, it travels to Chrome in the part of the Xbox URL after `#`. The browser processes this part locally and the extension removes it from the address bar when it reads it. Anyone with a copy of the original link can decode the bindings. **Set up Chrome** also copies the local extension folder's path to the clipboard. [Layout handoff](app/bindings-store.js)

## Reset or remove local data

**Map controls → Restore defaults** resets the layout for the player you are using. To end a Microsoft session on a shared computer, sign out in each player you used.

- **Mac app.** Quit Remote Pad and move it to the Trash to uninstall. App preferences and website data can remain. To reset all native preferences, quit the app and run `defaults delete local.remotepad.macos` in Terminal. The app-specific WebKit data and cache folders can be removed in Finder if present at `~/Library/WebKit/local.remotepad.macos` and `~/Library/Caches/local.remotepad.macos`.
- **Windows.** Exit Remote Pad and delete its extracted app folder. To remove saved layouts and sign-ins, delete `%LOCALAPPDATA%\Remote Pad` after quitting. PS5 pairing data is managed separately in Docker Desktop.
- **Chrome.** Remove Remote Pad from Chrome's Extensions page to clear its local extension storage. If you used the app's Chrome setup, you can also remove the exported folder at `~/Library/Application Support/Remote Pad/Chrome Extension`. Manage Xbox and Microsoft site data separately in Chrome's privacy settings. Clearing a site's cookies can sign you out. [Chrome extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas) · [Clear Chrome site data](https://support.google.com/chrome/answer/95647)

These steps affect local data. Microsoft and Sony manage their respective account and service data under their own privacy controls.
