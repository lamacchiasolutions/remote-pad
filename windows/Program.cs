using System;
using System.IO;
using System.Windows.Forms;

namespace RemotePad
{
    internal enum CheckMode { None, Input, Xbox }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            CheckMode mode = CheckMode.None;
            if (args.Length > 0 && args[0] == "--check-input") mode = CheckMode.Input;
            if (args.Length > 0 && args[0] == "--check-xbox") mode = CheckMode.Xbox;
            bool check = mode != CheckMode.None;
            string log = check && args.Length == 3 && args[1] == "--log" ? args[2] : null;
            string dataDirectory = check
                ? Path.Combine(Path.GetTempPath(), "RemotePad-check-" + Guid.NewGuid().ToString("N"))
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Remote Pad");

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                using (var form = new PlayerWindow(dataDirectory, mode))
                {
                    Application.Run(form);
                    if (check && log != null) File.WriteAllText(log, form.CheckResult ?? "Check did not finish.");
                    return form.Succeeded ? 0 : 1;
                }
            }
            finally
            {
                if (check)
                {
                    try { if (Directory.Exists(dataDirectory)) Directory.Delete(dataDirectory, true); }
                    catch (IOException) { } // WebView2 can still be shutting down its temporary profile.
                    catch (UnauthorizedAccessException) { }
                }
            }
        }
    }
}
