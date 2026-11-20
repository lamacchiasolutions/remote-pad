using System;
using System.IO;
using System.Windows.Forms;

namespace RemotePad
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            bool check = args.Length > 0 && args[0] == "--check-input";
            string log = check && args.Length == 3 && args[1] == "--log" ? args[2] : null;
            string dataDirectory = check
                ? Path.Combine(Path.GetTempPath(), "RemotePad-check-" + Guid.NewGuid().ToString("N"))
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Remote Pad");

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                using (var form = new PlayerWindow(dataDirectory, check))
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
