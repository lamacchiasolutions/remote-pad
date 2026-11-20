using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RemotePad
{
    internal static class WindowsInputCheck
    {
        internal static async Task<string> Run(WebView2 view, CoreWebView2Environment environment)
        {
            var core = view.CoreWebView2;
            // Only check mode installs fixtures, and it uses a temporary WebView2 profile.
            // Exercise both player entry URLs offline, including the player page's first script.
            const string fixture = "<!doctype html><html><head><title>Player check</title></head>" +
                "<body class='mode-control'><script>window.readPad = () => Array.from(navigator.getGamepads()).find(p => p && p.mapping === 'standard');</script></body></html>";
            core.AddWebResourceRequestedFilter(PlayerWindow.Xbox, CoreWebView2WebResourceContext.Document);
            core.AddWebResourceRequestedFilter(PlayerWindow.PlayStation + "*", CoreWebView2WebResourceContext.Document);
            core.WebResourceRequested += (s, e) =>
            {
                if (e.Request.Uri == PlayerWindow.Xbox || e.Request.Uri == PlayerWindow.PlayStation)
                    e.Response = environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(fixture)),
                        200, "OK", "Content-Type: text/html; charset=utf-8");
            };

            await Load(core, PlayerWindow.Local + "home.html", () => core.Navigate(PlayerWindow.Local + "home.html"));
            await Eval(core, "await RemotePadBindings.load(); if (!document.querySelector('#home-model > div')?.shadowRoot?.querySelector('canvas')) throw Error('Home controller model missing');");
            await Load(core, PlayerWindow.Local + "mapper.html", () => core.ExecuteScriptAsync("document.querySelector('[data-action=map]').click()"));
            await Eval(core, @"const layout = await RemotePadBindings.load();
                layout.a = ['KeyK']; await RemotePadBindings.save(layout);");
            await Load(core, PlayerWindow.Local + "bench.html", () => core.Navigate(PlayerWindow.Local + "bench.html"));

            // CI runners can share an interactive desktop. Focus emulation applies only to this test view.
            await core.CallDevToolsProtocolMethodAsync("Emulation.setFocusEmulationEnabled", "{\"enabled\":true}");
            await Eval(core, @"const layout = await RemotePadBindings.load();
                if (layout.a[0] !== 'KeyK' || !RemotePadController.getState().connected) throw Error('Saved mapping or controller missing');
                document.querySelector('#capture').click();
                for (let i=0; i<60 && !RemotePadController.getState().capturing; i++) await new Promise(r => setTimeout(r, 80));
                if (!document.pointerLockElement || !RemotePadController.getState().capturing) throw Error('Pointer lock: ' + RemotePadUI.getNotice());
                const pad = () => navigator.getGamepads()[RemotePadController.getState().index];
                const move = (dx,dy,buttons) => window.dispatchEvent(new MouseEvent('mousemove', {movementX:dx, movementY:dy, buttons, bubbles:true}));
                move(18, 0, 0);
                if (pad().axes[2] <= 0 || pad().buttons[6].pressed || pad().buttons[7].pressed) throw Error('Mouse look without a button');
                move(0, 18, 3);
                if (pad().axes[3] <= 0 || !pad().buttons[6].pressed || !pad().buttons[7].pressed) throw Error('Look while aiming and firing');
                window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyK',bubbles:true}));
                if (!pad().buttons[0].pressed) throw Error('Remapped A button');
                window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true}));
                if (RemotePadController.getState().capturing || pad().axes.some(x=>x!==0) || pad().buttons.some(b=>b.pressed)) throw Error('Escape did not release input');");

            foreach (string url in new[] { PlayerWindow.Xbox, PlayerWindow.PlayStation })
            {
                await Load(core, PlayerWindow.Local + "home.html", () => core.Navigate(PlayerWindow.Local + "home.html"));
                string action = url == PlayerWindow.Xbox ? "play" : "ps5";
                await Load(core, url, () => core.ExecuteScriptAsync("document.querySelector('[data-action=" + action + "]').click()"));
                await Eval(core, @"if ((await RemotePadBindings.load()).a[0] !== 'KeyK') throw Error('Player did not load saved bindings');
                    if (!document.getElementById('remote-pad-controls') || !readPad() || readPad().axes.length !== 4)
                        throw Error('Player controller or capture overlay missing');");
                if (url == PlayerWindow.PlayStation)
                {
                    await Eval(core, @"if (readPad().buttons.length !== 18) throw Error('PS5 touchpad button missing');
                        const touch = [];
                        for (const type of ['keydown','keyup']) window.addEventListener(type, e => { if (e.code === 'Tab') touch.push(type); });
                        RemotePadController.start();
                        window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyT'}));
                        if (!readPad().buttons[17].pressed) throw Error('PS5 touchpad press');
                        window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyT'}));
                        if (readPad().buttons[17].pressed || touch.join(',') !== 'keydown,keyup') throw Error('PS5 touchpad shortcut');
                        RemotePadController.stop();");
                }
                else await Eval(core, "if (readPad().buttons.length !== 17) throw Error('Xbox standard buttons');");
            }
            return "PASS: WebView2 home, saved mapping, pointer lock, button-free mouse look, aim and fire together, Escape, Xbox and PS5 player fixtures.";
        }

        private static async Task Load(CoreWebView2 core, string url, Action navigate)
        {
            var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            EventHandler<CoreWebView2NavigationCompletedEventArgs> handler = (s, e) =>
            {
                if (core.Source != url) return;
                if (e.IsSuccess) completion.TrySetResult(true);
                else completion.TrySetException(new IOException(url + ": " + e.WebErrorStatus));
            };
            core.NavigationCompleted += handler;
            try
            {
                navigate();
                if (await Task.WhenAny(completion.Task, Task.Delay(15000)) != completion.Task)
                    throw new TimeoutException("Navigation timed out waiting for " + url + " from " + core.Source);
                await completion.Task;
            }
            finally { core.NavigationCompleted -= handler; }
        }

        private static async Task Eval(CoreWebView2 core, string script)
        {
            var request = new
            {
                expression = "(async () => { try { " + script + "\n return 'OK'; } catch(error) { return String(error.stack || error); } })()",
                awaitPromise = true, userGesture = true, returnByValue = true
            };
            string json = await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate", ControllerSettings.Json.Serialize(request));
            var response = ControllerSettings.Json.Deserialize<Dictionary<string, object>>(json);
            if (!(response["result"] is Dictionary<string, object> result) ||
                !result.TryGetValue("value", out var value) || value as string != "OK")
                throw new InvalidOperationException(core.Source + ": " + json);
        }
    }
}
