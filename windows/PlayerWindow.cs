using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RemotePad
{
    internal sealed class PlayerWindow : Form
    {
        internal const string Local = "https://remote-pad.invalid/";
        internal const string Xbox = "https://www.xbox.com/remoteplay";
        internal const string PlayStation = "http://127.0.0.1:17365/";
        private static readonly Regex XboxRoute = new Regex(@"^/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})*/)?(?:play|remoteplay)(?:/|$)", RegexOptions.IgnoreCase);
        private readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };
        private readonly MenuStrip menus = new MenuStrip();
        private readonly ToolStripMenuItem back = new ToolStripMenuItem("Back");
        private readonly string dataDirectory;
        private readonly ControllerSettings settings;
        private readonly CheckMode checkMode;
        private bool fullscreen;
        private FormWindowState previousState;
        private Rectangle previousBounds;

        internal bool Succeeded { get; private set; }
        internal string CheckResult { get; private set; }

        internal PlayerWindow(string directory, CheckMode mode)
        {
            checkMode = mode;
            dataDirectory = directory;
            settings = new ControllerSettings(directory);
            Text = "Remote Pad";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1100, 780);
            MinimumSize = new Size(660, 500);
            BuildMenus();
            Controls.Add(view);
            Controls.Add(menus);
            MainMenuStrip = menus;
            Shown += async (sender, args) => await StartAsync();
        }

        private async Task StartAsync()
        {
            try
            {
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDirectory, "WebView2"));
                await view.EnsureCoreWebView2Async(environment);
                var core = view.CoreWebView2;
                core.Settings.AreHostObjectsAllowed = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                string assets = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app");
                core.SetVirtualHostNameToFolderMapping("remote-pad.invalid", assets, CoreWebView2HostResourceAccessKind.Deny);
                await core.AddScriptToExecuteOnDocumentCreatedAsync(InputScript(assets));
                core.WebMessageReceived += OnMessage;
                ulong? ps5Navigation = null;
                core.NavigationStarting += (s, e) =>
                {
                    if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) ||
                        !(uri.Scheme == Uri.UriSchemeHttps || IsPlayStation(uri)))
                    {
                        e.Cancel = true;
                        return;
                    }
                    ps5Navigation = IsPlayStation(uri) ? e.NavigationId : (ulong?)null;
                };
                core.HistoryChanged += (s, e) => back.Enabled = core.CanGoBack;
                core.SourceChanged += (s, e) =>
                {
                    if (Uri.TryCreate(core.Source, UriKind.Absolute, out var uri))
                        Text = uri.Host == "remote-pad.invalid" ? "Remote Pad" : "Remote Pad  —  " + uri.Authority;
                };
                core.ContainsFullScreenElementChanged += (s, e) => SetFullscreen(core.ContainsFullScreenElement);
                core.NavigationCompleted += (s, e) =>
                {
                    ulong navigation = e.NavigationId;
                    if (checkMode != CheckMode.None || e.IsSuccess || e.HttpStatusCode != 0 || ps5Navigation != navigation ||
                        e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
                    // Let WebView2 finish its event before opening a modal WinForms dialog.
                    BeginInvoke((Action)(() =>
                    {
                        if (ps5Navigation != navigation) return;
                        MessageBox.Show(this, "Start the PS5 player on this PC, then choose PS5 Remote Play again. Open Help → PS5 setup for the steps.", "Cannot open PS5 player", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        Navigate(Local + "home.html");
                    }));
                };

                menus.Enabled = true;
                view.Focus();
                if (checkMode != CheckMode.None)
                {
                    CheckResult = checkMode == CheckMode.Xbox
                        ? await WindowsInputCheck.RunXbox(core)
                        : await WindowsInputCheck.Run(view, environment);
                    Succeeded = true;
                    Close();
                }
                else
                {
                    Navigate(Local + "home.html");
                    Succeeded = true;
                }
            }
            catch (Exception error)
            {
                CheckResult = error.ToString();
                Succeeded = false;
                if (checkMode == CheckMode.None)
                {
                    string reason = error is WebView2RuntimeNotFoundException
                        ? "Install Microsoft Edge WebView2 Evergreen Runtime, then open Remote Pad again."
                        : error.Message;
                    MessageBox.Show(this, reason, "Remote Pad could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                Close();
            }
        }

        private static string InputScript(string assets)
        {
            var libraries = new[] { "controller.js", "bindings-store.js", "controller-model.js", "mapper-ui.js", "overlay.js", "boot.js" };
            // Register one script so the settings bridge, controller and player start in a fixed order.
            return @"(() => {
                if (self !== top) return;
                const local = location.origin === 'https://remote-pad.invalid';
                const bench = local && location.pathname === '/bench.html';
                const ps5 = location.origin === 'http://127.0.0.1:17365';
                const xbox = ['https://www.xbox.com', 'https://xbox.com', 'https://play.xbox.com'].includes(location.origin);
                if (!(ps5 || xbox || (local && ['/home.html','/mapper.html','/bench.html'].includes(location.pathname)))) return;
                " + File.ReadAllText(Path.Combine(assets, "windows-bridge.js")) + @"
                if (!(ps5 || xbox || bench)) return;
                " + string.Join("\n", libraries.Select(name => File.ReadAllText(Path.Combine(assets, name)))) + "\n})();";
        }

        private static bool IsPlayStation(Uri uri)
        {
            return uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == 17365 && uri.UserInfo.Length == 0;
        }

        private static bool IsPlayer(Uri uri)
        {
            return IsPlayStation(uri) || uri.GetLeftPart(UriPartial.Path) == Local + "bench.html" ||
                (uri.Scheme == "https" && uri.IsDefaultPort && uri.UserInfo.Length == 0 &&
                (uri.Host == "play.xbox.com" || ((uri.Host == "xbox.com" || uri.Host == "www.xbox.com") && XboxRoute.IsMatch(uri.AbsolutePath))));
        }

        private void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs message)
        {
            var core = view.CoreWebView2;
            if (!Uri.TryCreate(message.Source, UriKind.Absolute, out var source) ||
                !Uri.TryCreate(core.Source, UriKind.Absolute, out var current) ||
                source.GetLeftPart(UriPartial.Path) != current.GetLeftPart(UriPartial.Path)) return;
            bool home = source.GetLeftPart(UriPartial.Path) == Local + "home.html";
            bool mapper = source.GetLeftPart(UriPartial.Path) == Local + "mapper.html";
            bool player = IsPlayer(source);
            if (!home && !mapper && !player) return;
            string id = null;
            try
            {
                var request = ControllerSettings.Json.DeserializeObject(message.WebMessageAsJson) as Dictionary<string, object>;
                if (request == null || !request.TryGetValue("id", out var requestId) ||
                    !(requestId is string token) || !Guid.TryParseExact(token, "D", out _) ||
                    !request.TryGetValue("channel", out var channelValue) || !(channelValue is string channel) ||
                    !request.TryGetValue("value", out var value)) return;
                id = token;
                if (channel == "action")
                {
                    if (!home) return;
                    switch (value as string)
                    {
                        case "play": Navigate(Xbox); break;
                        case "ps5": Navigate(PlayStation); break;
                        case "startPS5": BeginInvoke((Action)StartPS5); break;
                        case "ps5Setup": BeginInvoke((Action)(() => ShowDocument("PS5 setup", "PS5.md"))); break;
                        case "bench": Navigate(Local + "bench.html"); break;
                        case "map": Navigate(Local + "mapper.html"); break;
                    }
                    return;
                }
                if (!player && !(channel == "bindings" && (mapper || value as string == "get"))) return;
                object result = settings.Handle(channel, value);
                core.PostWebMessageAsJson(ControllerSettings.Json.Serialize(new { id, value = result }));
            }
            catch (Exception ex) when (ex is ArgumentException || ex is InvalidOperationException || ex is IOException || ex is UnauthorizedAccessException)
            {
                if (id != null)
                    core.PostWebMessageAsJson(ControllerSettings.Json.Serialize(new { id, error = "Could not read or save this controller setting." }));
            }
        }

        private void Navigate(string url)
        {
            view.CoreWebView2.Navigate(url);
            view.Focus();
        }

        private void BuildMenus()
        {
            var go = new ToolStripMenuItem("&Go");
            back.Enabled = false;
            back.Click += (s, e) => { if (view.CoreWebView2.CanGoBack) view.CoreWebView2.GoBack(); };
            go.DropDownItems.Add(back);
            go.DropDownItems.Add("Home", null, (s, e) => Navigate(Local + "home.html"));
            go.DropDownItems.Add("Reload", null, (s, e) => view.Reload());
            go.DropDownItems.Add(new ToolStripSeparator());
            go.DropDownItems.Add("Map controls", null, (s, e) => Navigate(Local + "mapper.html"));
            go.DropDownItems.Add("Test inputs", null, (s, e) => Navigate(Local + "bench.html"));
            go.DropDownItems.Add("Xbox Remote Play", null, (s, e) => Navigate(Xbox));
            go.DropDownItems.Add("PS5 Remote Play", null, (s, e) => Navigate(PlayStation));
            go.DropDownItems.Add("Start PS5 player", null, (s, e) => StartPS5());
            var help = new ToolStripMenuItem("&Help");
            void Document(string title, string name) =>
                help.DropDownItems.Add(title, null, (s, e) => ShowDocument(title, name));
            Document("PS5 setup", "PS5.md");
            Document("End-User License Agreement", "EULA.md");
            Document("License", "LICENSE");
            Document("Privacy Notice", "PRIVACY.md");
            Document("Support Guide", "SUPPORT.md");
            menus.Items.Add(go);
            menus.Items.Add(help);
            menus.Enabled = false;
        }

        private void StartPS5()
        {
            string folder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "PS5");
            try
            {
                using (Process.Start(new ProcessStartInfo
                {
                    FileName = Path.Combine(folder, "Start PS5 Player.cmd"),
                    WorkingDirectory = folder,
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Normal
                })) { }
            }
            catch (Win32Exception ex)
            {
                MessageBox.Show(this, "Could not open the bundled PS5 launcher. Extract the complete ZIP and try again.\n\n" + ex.Message,
                    "PS5 player", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private void ShowDocument(string title, string name)
        {
            string text;
            try { text = File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Documentation", name)); }
            catch (IOException)
            {
                MessageBox.Show(this, "Extract the complete Remote Pad ZIP to read the bundled document.", title);
                return;
            }
            using (var dialog = new Form { Text = title, StartPosition = FormStartPosition.CenterParent, Size = new Size(760, 580) })
            {
                var reader = new RichTextBox { Dock = DockStyle.Fill, ReadOnly = true, Font = new Font("Segoe UI", 11),
                    BorderStyle = BorderStyle.None, BackColor = SystemColors.Window, Text = text };
                dialog.Controls.Add(reader);
                dialog.ShowDialog(this);
            }
        }

        private void SetFullscreen(bool enter)
        {
            if (enter == fullscreen) return;
            fullscreen = enter;
            menus.Visible = !enter;
            if (enter)
            {
                previousState = WindowState;
                previousBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                var display = Screen.FromControl(this);
                WindowState = FormWindowState.Normal;
                FormBorderStyle = FormBorderStyle.None;
                Bounds = display.Bounds;
            }
            else
            {
                FormBorderStyle = FormBorderStyle.Sizable;
                Bounds = previousBounds;
                WindowState = previousState;
            }
        }
    }
}
