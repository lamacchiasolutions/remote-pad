# Remote Pad

Use your Mac or Windows PC's keyboard and mouse to play games on your Xbox or PlayStation 5. Move the mouse to turn, hold right click to aim, and use left click independently to fire. Select buttons or stick directions on the controller model to change their assignments.

**[Download for Mac](https://github.com/lamacchiasolutions/remote-pad/releases/latest/download/Remote-Pad-macOS.zip)** · **[Download for Windows x64](https://github.com/lamacchiasolutions/remote-pad/releases/latest/download/Remote-Pad-Windows-x64.zip)** · [Release notes](https://github.com/lamacchiasolutions/remote-pad/releases/latest)

| Console | What you need on your computer |
| --- | --- |
| Xbox One or Xbox Series X/S | The Remote Pad desktop app and your Microsoft account. Choose **Open Xbox Remote Play**. |
| PlayStation 5 | The desktop app, Docker Desktop and a PS5 on the same home network. The included launcher starts a separate PS5 Web Play companion. Pair the console once, then choose **Open PS5 Remote Play**. [PS5 setup](docs/PS5.md) |

Lamacchia Solutions permits free noncommercial use and source inspection. Redistribution and commercial reuse require written permission. Review the end-user agreement before downloading. A copy is included under **Help → End-User License Agreement** in the app. [End-user license agreement](EULA.md) · [License](LICENSE)

## Install

### Mac

1. Download **Remote-Pad-macOS.zip**. The same download runs on Apple silicon and Intel Macs with **macOS 13 or later**.
2. Double-click the ZIP in Finder. Drag **Remote Pad.app** to **Applications**, then open it.
3. This release uses an ad hoc signature and has no Apple notarization. If macOS blocks the first launch and you trust this download, open **System Settings → Privacy & Security**, find Remote Pad, choose **Open Anyway**, and confirm. Managed Macs may require administrator assistance. [Apple’s instructions for opening downloaded apps](https://support.apple.com/en-us/102445)

### Windows

1. Download **Remote-Pad-Windows-x64.zip** for an Intel or AMD 64-bit PC running Windows 10 or 11 with .NET Framework 4.8 or newer.
2. Choose **Extract All** in File Explorer. Open **RemotePad.exe** in the extracted folder and keep the files beside it when moving it. This portable build is unsigned, so Windows may show an unknown-publisher notice.
3. If the app asks for a browser runtime, install Microsoft's **Evergreen WebView2 Runtime** and reopen Remote Pad. [Microsoft's WebView2 download](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)

For PS5, also check the Docker Desktop requirements for your OS. On Mac, the embedded PS5 player needs Safari 26 or newer for both sound and video. [PS5 setup and pairing](docs/PS5.md)

## Connect and play on Xbox

1. On your **Xbox Series X, Series S, or Xbox One**, open **Settings → Devices & connections → Remote features** and enable remote features. You’ll need a game installed on the console, a Microsoft account with an Xbox profile, and an internet connection. [Xbox Remote Play requirements](https://www.xbox.com/en-US/consoles/remote-play)
2. On your computer, select **Test inputs → Capture inputs**. Move the mouse with both buttons released. The right-stick dot should follow the direction of movement and return to center when you stop. Press **Esc** to get your cursor back.
3. Return to the home screen and select **Open Xbox Remote Play**. Sign in on Microsoft’s page with the account linked to your Xbox and select the console. [Xbox Remote Play](https://www.xbox.com/remoteplay)
4. Select **Capture inputs** to play. Press **Esc** to use the cursor again. **F8** toggles capture unless you assign it to a game control. On keyboards that use the top row for media keys, press **Fn–F8**.

## Default controls

| Xbox control | Keyboard or mouse |
| --- | --- |
| Left stick | W / A / S / D |
| Right stick | Move the mouse |
| RT / LT | Left click / right click |
| A / B / X / Y | Space / C / R / F |
| LB / RB | Q / E |
| Left stick click / right stick click | Left Shift / V |
| D-pad | Arrow keys |
| View / Menu / Xbox guide | Tab / Enter / G |

## Customize your layout

Choose **Map controls** on the home screen for Xbox, or **PS5 setup → Map PS5 controls** for PlayStation. Select a part of the controller model or use the list. **Shoulders** shows the bumpers and triggers. For a stick, choose its click or one of its four directions.

![Remote Pad’s controller layout editor with an interactive controller model and input assignments](docs/controller-layout.png)

Choose **Replace input**, then press a key or click the recording box with the mouse button you want. **Add another** keeps the existing assignment. **Assign mouse movement** binds a direction of mouse travel. If an input is already in use, choose **Move here** or **Use for both**. Changes save automatically. Press Esc to release your keyboard and mouse.

During play, press **Esc → ⋯ → Map controls** to edit the same layout. The **⋯** menu also contains these settings.

- **Mouse sensitivity** changes how far the virtual stick moves for a given mouse speed. Each game’s controller settings determine its maximum turning speed.
- **Minimum look strength** sets the initial stick deflection. The default is **27%**. Raise it if a game ignores slow mouse movement, or lower it for a game with a smaller stick dead zone.
- **Show stick and triggers during play** displays the input Remote Pad sends. With the default layout, right click lights LT, left click lights RT, and moving the mouse moves the right stick even with both buttons released.

## Use Google Chrome

The Mac app includes an optional extension for playing in desktop Google Chrome.

1. On the app’s home screen, expand **Play in Google Chrome** and select **Set up Chrome**. This opens Chrome’s Extensions page and copies the extension folder’s path.
2. Enable **Developer mode** and choose **Load unpacked**. In the folder picker, press **⌘⇧G**, paste the copied path, press Return, and confirm the folder.
3. Back in Remote Pad, choose **Open in Chrome**. Your saved app layout comes with you. You can edit it inside Chrome. Reopening from the app with the same layout preserves later Chrome edits.

After updating the Mac app, choose **Set up Chrome** again, click the reload arrow on Remote Pad’s extension card, and refresh the Remote Play tab.

## Build and test

Build from the repository root on a Mac with current Xcode Command Line Tools.

```sh
./build.sh
```

The build creates `dist/Remote Pad.app` and `dist/Remote-Pad-macOS.zip`. On Windows, use a current .NET SDK with the .NET Framework 4.8 targeting pack and run the following in PowerShell from the repository root. This builds the portable x64 ZIP. The optional `-CheckInput` switch starts the extracted Windows app and exercises its WebView2 player on an interactive desktop.

```powershell
./tools/build-windows.ps1 -CheckInput
```

Run the shared input and Windows integration tests with Node.js.

```sh
node --test
```

Run the app checks one at a time from an interactive Mac desktop. They use temporary settings and open their own windows.

```sh
"dist/Remote Pad.app/Contents/MacOS/RemotePad" --check-input
"dist/Remote Pad.app/Contents/MacOS/RemotePad" --check-layout
"dist/Remote Pad.app/Contents/MacOS/RemotePad" --check-player
```

The checks exercise mouse movement with both buttons released, trigger chords, fullscreen capture, focus loss, and remapping. The player check requires internet access and opens the public, signed-out Xbox page. The additional `--check-ps5` Mac check requires the pinned PS5 companion listening locally. It exercises the companion's actual controller packet encoder with a private test profile. Testing with physical Xbox and PS5 consoles remains outstanding.

## Support and terms

Microsoft owns Xbox and Sony Interactive Entertainment owns PlayStation. Remote Pad is independent of both companies. For help with the app, see [Support](SUPPORT.md).

[Privacy](PRIVACY.md) · [End-user license agreement](EULA.md) · [License](LICENSE)
