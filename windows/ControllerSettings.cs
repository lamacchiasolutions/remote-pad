using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace RemotePad
{
    internal sealed class ControllerSettings
    {
        private static readonly HashSet<string> Controls = new HashSet<string>(
            "a b x y lb rb lt rt view menu ls rs up down left right guide touchpad lxLeft lxRight lyUp lyDown rxLeft rxRight ryUp ryDown".Split(' '));
        private static readonly Regex Input = new Regex(@"\A[A-Z][A-Za-z0-9]{0,47}\z");
        private static readonly HashSet<string> Reserved = new HashSet<string>(
            "Escape Meta MetaLeft MetaRight OSLeft OSRight Unidentified".Split(' '));
        private static readonly HashSet<string> MouseInputs = new HashSet<string>(
            "Mouse0 Mouse1 Mouse2 Mouse3 Mouse4 MouseMoveLeft MouseMoveRight MouseMoveUp MouseMoveDown".Split(' '));
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 80000, RecursionLimit = 8 };
        private readonly string directory;

        internal ControllerSettings(string directory)
        {
            this.directory = directory;
        }

        internal object Handle(string channel, object value)
        {
            if (channel != "bindings" && channel != "sensitivity" && channel != "lookDeadzone")
                throw new ArgumentException("Unknown controller setting.");
            string path = Path.Combine(directory, channel + ".json");
            if (value as string == "get")
            {
                if (File.Exists(path)) return Validate(channel, Json.DeserializeObject(File.ReadAllText(path)));
                if (channel == "bindings") return new Dictionary<string, object>();
                return channel == "sensitivity" ? 1.0 : 0.27;
            }

            object validated = Validate(channel, value);
            Directory.CreateDirectory(directory);
            string temporary = path + "." + Guid.NewGuid().ToString("N");
            try
            {
                File.WriteAllText(temporary, Json.Serialize(validated));
                // Rename on the same volume so readers see either complete version.
                try { File.Move(temporary, path); }
                catch (IOException) when (File.Exists(path)) { File.Replace(temporary, path, null); }
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
            return validated;
        }

        private static object Validate(string channel, object value)
        {
            if (channel == "bindings")
            {
                var layout = value as Dictionary<string, object>;
                if (layout == null || layout.Count > Controls.Count)
                    throw new ArgumentException("Invalid controller layout.");
                foreach (var entry in layout)
                {
                    var tokens = entry.Value as object[];
                    if (!Controls.Contains(entry.Key) || tokens == null || tokens.Length > 32 || !tokens.All(IsInput))
                        throw new ArgumentException("Invalid input in controller layout.");
                }
                return layout;
            }
            if (!(value is int || value is long || value is decimal || value is double))
                throw new ArgumentException("Invalid look setting.");
            double number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
            bool valid = channel == "sensitivity" ? number >= 0.25 && number <= 3 : number >= 0 && number <= 0.5;
            if (!valid) throw new ArgumentException("Look setting outside its supported range.");
            return number;
        }

        private static bool IsInput(object value)
        {
            var token = value as string;
            return token != null && Input.IsMatch(token) && !Reserved.Contains(token)
                && (!token.StartsWith("Mouse", StringComparison.Ordinal) || MouseInputs.Contains(token));
        }
    }
}
