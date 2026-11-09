using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

// .NET Framework / Windows PowerShell 5.1. No dynamic source or shell text.
public static class BackstageVoiceHelper
{
    const int LineLimit = 32768, OutputLimit = 131072, TextLimit = 4000, EnumerationLimit = 32;
    static readonly object OutputLock = new object();
    static readonly ManualResetEvent CommandReady = new ManualResetEvent(false);
    static readonly ManualResetEvent Finished = new ManualResetEvent(false);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = LineLimit, RecursionLimit = 4 };
    static Dictionary<string, object> Command;
    static volatile bool Cancelled, ProtocolError;
    static string OperationId, LastText = "";
    static int OutputBytes;
    static bool Terminal;
    static SpeechRecognitionEngine Recognition;
    static SpeechSynthesizer Synthesis;
    static Timer Watchdog, ExitBackstop;
    static readonly object CancelLock = new object();

    static void Cancel()
    {
        Cancelled = true; Finished.Set();
        lock (CancelLock) if (ExitBackstop == null)
            ExitBackstop = new Timer(delegate(object ignored) { System.Diagnostics.Process.GetCurrentProcess().Kill(); }, null, 1000, Timeout.Infinite);
    }

    static void Deadline(int milliseconds)
    {
        if (Watchdog == null) Watchdog = new Timer(delegate(object state) {
            // Exit is the backstop if an installed engine blocks initialization
            // or disposal. Main independently terminates this owned process.
            Cancel();
        }, null, milliseconds, Timeout.Infinite);
        else Watchdog.Change(milliseconds, Timeout.Infinite);
    }

    static string Text(object value, int limit, bool empty)
    {
        string result = value as string;
        if (result == null || result.Length > limit || result.IndexOf('\0') >= 0 || (!empty && String.IsNullOrWhiteSpace(result))) throw new InvalidDataException();
        return result;
    }
    static void Keys(Dictionary<string, object> input, params string[] keys)
    {
        if (input == null || input.Count != keys.Length) throw new InvalidDataException();
        foreach (string key in keys) if (!input.ContainsKey(key)) throw new InvalidDataException();
    }
    static Dictionary<string, object> Parse(string raw)
    {
        // JavaScriptSerializer accepts duplicate keys. Reject them explicitly,
        // using the flat command grammar, before its value decoding.
        HashSet<string> keys = new HashSet<string>();
        bool quoted = false, escaped = false; int start = -1;
        for (int i = 0; i < raw.Length; i++)
        {
            char c = raw[i];
            if (quoted) { if (escaped) { escaped = false; continue; } if (c == '\\') { escaped = true; continue; } if (c == '"') { quoted = false; int next = i + 1; while (next < raw.Length && Char.IsWhiteSpace(raw[next])) next++; if (next < raw.Length && raw[next] == ':') { string key = raw.Substring(start + 1, i - start - 1); if (key.IndexOf('\\') >= 0 || !keys.Add(key)) throw new InvalidDataException(); } } }
            else if (c == '"') { quoted = true; start = i; }
            else if (c == '[' || c == ']' || (c == '{' && i != raw.IndexOf('{'))) throw new InvalidDataException();
        }
        Dictionary<string, object> value = Json.Deserialize<Dictionary<string, object>>(raw);
        if (value == null || !value.ContainsKey("v") || !(value["v"] is int) || (int)value["v"] != 1) throw new InvalidDataException();
        string id = Text(value.ContainsKey("id") ? value["id"] : null, 36, false);
        if (!Regex.IsMatch(id, "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) throw new InvalidDataException();
        return value;
    }
    static string ReadLine(Stream input, ref int total)
    {
        using (MemoryStream bytes = new MemoryStream())
        {
            while (true)
            {
                int next = input.ReadByte(); if (next == -1) { if (bytes.Length != 0) throw new InvalidDataException(); return null; }
                if (++total > LineLimit * 2) throw new InvalidDataException();
                if (next == 10) break;
                if (bytes.Length >= LineLimit) throw new InvalidDataException(); bytes.WriteByte((byte)next);
            }
            return new UTF8Encoding(false, true).GetString(bytes.ToArray());
        }
    }
    static void ReadCommands()
    {
        try
        {
            Stream input = Console.OpenStandardInput(); int total = 0;
            string line = ReadLine(input, ref total); if (line == null) throw new InvalidDataException();
            Command = Parse(line); OperationId = (string)Command["id"];
            string command = Text(Command.ContainsKey("command") ? Command["command"] : null, 16, false);
            if (command == "capabilities") Keys(Command, "v", "id", "command");
            else if (command == "listen") { Keys(Command, "v", "id", "command", "culture"); Text(Command["culture"], 64, false); }
            else if (command == "speak") { Keys(Command, "v", "id", "command", "text", "voiceId"); Text(Command["text"], TextLimit, false); Text(Command["voiceId"], 256, false); }
            else throw new InvalidDataException();
            CommandReady.Set();
            line = ReadLine(input, ref total);
            if (line != null) { Dictionary<string, object> cancel = Parse(line); Keys(cancel, "v", "id", "command"); if ((string)cancel["id"] != OperationId || Text(cancel["command"], 16, false) != "cancel") throw new InvalidDataException(); }
            Cancel();
            // A disposable worker permits no third command or stdin flood.
            if (line != null && ReadLine(input, ref total) != null) ProtocolError = true;
        }
        catch { ProtocolError = true; Cancel(); CommandReady.Set(); }
    }
    static bool Emit(string name, bool terminal, params object[] fields)
    {
        lock (OutputLock)
        {
            if (Terminal || OperationId == null) return false;
            Dictionary<string, object> value = new Dictionary<string, object>(); value.Add("v", 1); value.Add("id", OperationId); value.Add("event", name);
            for (int i = 0; i < fields.Length; i += 2) value.Add((string)fields[i], fields[i + 1]);
            // Separate serializer: input and asynchronous event output use different threads.
            string line = new JavaScriptSerializer { MaxJsonLength = OutputLimit, RecursionLimit = 8 }.Serialize(value) + "\n";
            int size = Encoding.UTF8.GetByteCount(line);
            if (size > LineLimit || OutputBytes + size > OutputLimit) { Cancel(); return false; }
            OutputBytes += size; Terminal = terminal; Console.Out.Write(line); Console.Out.Flush(); return true;
        }
    }
    static bool MicrosoftRecognizer(RecognizerInfo info)
    {
        return Regex.IsMatch(info.Id, "^MS-[0-9]+-[0-9]+-DESK$") && info.Description.StartsWith("Microsoft ", StringComparison.OrdinalIgnoreCase);
    }
    static bool MicrosoftVoice(InstalledVoice voice)
    {
        string vendor;
        return voice.Enabled && voice.VoiceInfo.Name.StartsWith("Microsoft ", StringComparison.Ordinal) && voice.VoiceInfo.AdditionalInfo.TryGetValue("Vendor", out vendor) && vendor.StartsWith("Microsoft", StringComparison.OrdinalIgnoreCase);
    }
    static Dictionary<string, object> Item(string id, string culture, string name)
    {
        Text(id, 256, false); Text(culture, 64, false); Text(name, 256, false);
        return new Dictionary<string, object> { { "id", id }, { "culture", culture }, { "name", name } };
    }
    static void Capabilities()
    {
        List<object> recognizers = new List<object>(), voices = new List<object>();
        foreach (RecognizerInfo info in SpeechRecognitionEngine.InstalledRecognizers()) if (MicrosoftRecognizer(info)) { if (recognizers.Count == EnumerationLimit) throw new InvalidDataException(); recognizers.Add(Item(info.Id, info.Culture.Name, info.Description)); }
        // Enumeration deliberately never selects input/output or starts speech.
        using (SpeechSynthesizer synth = new SpeechSynthesizer()) foreach (InstalledVoice voice in synth.GetInstalledVoices()) if (MicrosoftVoice(voice)) { if (voices.Count == EnumerationLimit) throw new InvalidDataException(); VoiceInfo info = voice.VoiceInfo; voices.Add(Item(info.Name, info.Culture.Name, info.Name)); }
        if (!Cancelled) Emit("capabilities", true, "recognizers", recognizers, "voices", voices);
    }
    static void Capture()
    {
        RecognizerInfo selected = null;
        foreach (RecognizerInfo info in SpeechRecognitionEngine.InstalledRecognizers()) if (MicrosoftRecognizer(info) && info.Culture.Name == (string)Command["culture"]) { selected = info; break; }
        if (selected == null) { Emit("unavailable", true, "code", "engine"); return; }
        Recognition = new SpeechRecognitionEngine(selected); Recognition.LoadGrammar(new DictationGrammar());
        Recognition.InitialSilenceTimeout = TimeSpan.FromSeconds(4); Recognition.BabbleTimeout = TimeSpan.FromSeconds(4); Recognition.EndSilenceTimeout = TimeSpan.FromSeconds(4); Recognition.EndSilenceTimeoutAmbiguous = TimeSpan.FromSeconds(4);
        Recognition.SpeechHypothesized += delegate(object sender, SpeechHypothesizedEventArgs e) { if (!Cancelled) { string text = e.Result.Text; if (text.Length > TextLimit || text.IndexOf('\0') >= 0) { Cancelled = true; Finished.Set(); return; } LastText = text; Emit("hypothesis", false, "text", text); } };
        Recognition.SpeechRecognized += delegate(object sender, SpeechRecognizedEventArgs e) { if (!Cancelled) { string text = e.Result.Text; if (text.Length > TextLimit || text.IndexOf('\0') >= 0) Cancelled = true; else LastText = text; } };
        Recognition.RecognizeCompleted += delegate(object sender, RecognizeCompletedEventArgs e) { if (e.Error != null || e.Cancelled) Cancelled = true; Finished.Set(); };
        if (Cancelled) return;
        Recognition.SetInputToDefaultAudioDevice(); if (Cancelled) return;
        Deadline(15000); Emit("started", false); if (Cancelled) return; Recognition.RecognizeAsync(RecognizeMode.Single);
        if (!Finished.WaitOne(15000)) Cancelled = true;
        DisposeAudio();
        if (!Cancelled) Emit("completed", true, "text", LastText);
    }
    static void Speak()
    {
        Synthesis = new SpeechSynthesizer(); string selected = null;
        foreach (InstalledVoice voice in Synthesis.GetInstalledVoices()) if (MicrosoftVoice(voice) && voice.VoiceInfo.Name == (string)Command["voiceId"]) { selected = voice.VoiceInfo.Name; break; }
        if (selected == null) { Emit("unavailable", true, "code", "engine"); return; }
        Synthesis.SelectVoice(selected); Synthesis.SpeakCompleted += delegate(object sender, SpeakCompletedEventArgs e) { if (e.Error != null || e.Cancelled) Cancelled = true; Finished.Set(); };
        if (Cancelled) return;
        Deadline(60000); Emit("started", false); if (Cancelled) return; Synthesis.SpeakAsync((string)Command["text"]);
        if (!Finished.WaitOne(60000)) Cancelled = true;
        DisposeAudio(); if (!Cancelled) Emit("completed", true);
    }
    static void DisposeAudio()
    {
        if (Recognition != null) { try { Recognition.RecognizeAsyncCancel(); } catch {} try { Recognition.Dispose(); } catch {} Recognition = null; }
        if (Synthesis != null) { try { Synthesis.SpeakAsyncCancelAll(); } catch {} try { Synthesis.Dispose(); } catch {} Synthesis = null; }
    }
    public static int Run()
    {
        Deadline(8000);
        Thread reader = new Thread(ReadCommands); reader.IsBackground = true; reader.Start();
        try
        {
            if (!CommandReady.WaitOne(8000) || Cancelled) return 1;
            string command = (string)Command["command"];
            if (command == "capabilities") Capabilities(); else if (command == "listen") Capture(); else if (command == "speak") Speak();
            return ProtocolError ? 1 : 0;
        }
        catch { DisposeAudio(); Emit("unavailable", true, "code", "audio"); return 0; }
        finally { Cancelled = true; DisposeAudio(); if (Watchdog != null) Watchdog.Dispose(); if (ExitBackstop != null) ExitBackstop.Dispose(); }
    }
}
