# Remote Pad support

## Start with the input test

Open **Test inputs → Capture inputs**. With the default layout, **W** moves the left stick, moving the mouse moves the right stick, left click presses RT, and right click presses LT. Try moving the mouse with both buttons released, then while holding each one. Press **Esc** to release the cursor. This test works without signing in to Xbox.

| What happens | What to try |
| --- | --- |
| The cursor stays free or stops steering after switching windows. | Click inside the player and choose **Capture inputs** again. **F8** also toggles capture when unassigned. Use **Fn–F8** on keyboards set to media keys. |
| Slow mouse movements register in the test but the game ignores them. | In the player, open **⋯** and enable **Show stick and triggers during play**. If the stick moves, increase **Minimum look strength** a little or lower the game's right-stick dead zone. Use **Mouse sensitivity** to adjust turning speed. |
| The Chrome player has no capture button, or uses an old layout. | Run **Set up Chrome** in the current Mac app. Follow its instructions to load the extension, or click **Reload** for an existing installation on Chrome's Extensions page. Refresh the Xbox tab. **Open in Chrome** imports a saved Mac layout. |
| Your console is missing or the stream will not start. | Enable remote features on the console and sign in to the linked Microsoft account. Check Microsoft's setup requirements and service status. [Xbox Remote Play](https://www.xbox.com/en-US/consoles/remote-play) · [Xbox status](https://support.xbox.com/xbox-live-status) |
| macOS displays a warning when opening the download. | The release uses a local signature without Apple notarization. See Apple's explanation of the alert or follow the README to build from source. [Apple's app-opening guidance](https://support.apple.com/en-us/102445) · [Build instructions](README.md#build-and-test) |

## Windows and PlayStation 5

On Windows, extract the entire ZIP before opening RemotePad.exe. If the app reports a missing runtime, install the Evergreen WebView2 Runtime from Microsoft, then reopen it. [WebView2 download](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)

For PS5, open **PS5 setup → Test PS5 inputs** to check the virtual controller locally. If you cannot open the player, start Docker Desktop, choose **Start PS5 Player**, and wait for the local password. The pairing guide covers manual console addresses, account IDs, audio and the companion's Chinese button labels. [PS5 pairing and troubleshooting](https://github.com/lamacchiasolutions/remote-pad/blob/main/docs/PS5.md)

## Report a problem

For a Remote Pad problem, open a GitHub issue. Include the app version, operating system version, whether you used the Mac app, Windows app or Chrome, your console, and the steps that reproduce it. For input issues, include the game, the binding you tried, and what the offline test and in-game input display showed. The tracker is public. Crop account names, console addresses, account IDs, pairing codes and sign-in details from screenshots. [Remote Pad issues](https://github.com/lamacchiasolutions/remote-pad/issues)

For Microsoft account access, console registration or Xbox service problems, contact Xbox Support. [Xbox Support](https://support.xbox.com/)
