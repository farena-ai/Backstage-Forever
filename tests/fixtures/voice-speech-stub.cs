// Test-only System.Speech API substitute. No System.Speech assembly or audio API.
namespace System.Speech.Recognition
{
    public enum RecognizeMode { Single }
    public sealed class RecognizerInfo
    {
        public string Id = "MS-1033-80-DESK";
        public string Description = "Microsoft Test Recognizer";
        public System.Globalization.CultureInfo Culture = new System.Globalization.CultureInfo("en-US");
    }
    public sealed class DictationGrammar {}
    public sealed class RecognitionResult { public string Text = "editable test draft"; }
    public class SpeechHypothesizedEventArgs : System.EventArgs { public RecognitionResult Result = new RecognitionResult(); }
    public class SpeechRecognizedEventArgs : System.EventArgs { public RecognitionResult Result = new RecognitionResult(); }
    public class RecognizeCompletedEventArgs : System.EventArgs { public System.Exception Error; public bool Cancelled; }
    public sealed class SpeechRecognitionEngine : System.IDisposable
    {
        public static RecognizerInfo[] InstalledRecognizers() { if (System.Environment.GetEnvironmentVariable("BF_VOICE_STUB_BLOCK") == "1") System.Threading.Thread.Sleep(20000); return new RecognizerInfo[] { new RecognizerInfo() }; }
        public SpeechRecognitionEngine(RecognizerInfo info) {}
        public System.TimeSpan InitialSilenceTimeout, BabbleTimeout, EndSilenceTimeout, EndSilenceTimeoutAmbiguous;
        public event System.EventHandler<SpeechHypothesizedEventArgs> SpeechHypothesized;
        public event System.EventHandler<SpeechRecognizedEventArgs> SpeechRecognized;
        public event System.EventHandler<RecognizeCompletedEventArgs> RecognizeCompleted;
        public void LoadGrammar(DictationGrammar grammar) {}
        public void SetInputToDefaultAudioDevice() { BackstageVoiceStub.Record("attach-fake-input"); }
        public void RecognizeAsync(RecognizeMode mode) { BackstageVoiceStub.Record("recognize-fake"); if (SpeechHypothesized != null) SpeechHypothesized(this, new SpeechHypothesizedEventArgs()); if (System.Environment.GetEnvironmentVariable("BF_VOICE_STUB_COMPLETE") == "1") { if (SpeechRecognized != null) SpeechRecognized(this, new SpeechRecognizedEventArgs()); if (RecognizeCompleted != null) RecognizeCompleted(this, new RecognizeCompletedEventArgs()); } }
        public void RecognizeAsyncCancel() { BackstageVoiceStub.Record("cancel-fake-input"); }
        public void Dispose() { BackstageVoiceStub.Record("dispose-fake-input"); if (System.Environment.GetEnvironmentVariable("BF_VOICE_STUB_DISPOSE_BLOCK") == "1") System.Threading.Thread.Sleep(20000); }
    }
}
namespace System.Speech.Synthesis
{
    public sealed class VoiceInfo
    {
        public string Name = "Microsoft Test Voice";
        public System.Globalization.CultureInfo Culture = new System.Globalization.CultureInfo("en-US");
        public System.Collections.Generic.Dictionary<string, string> AdditionalInfo = new System.Collections.Generic.Dictionary<string, string> { { "Vendor", "Microsoft" } };
    }
    public sealed class InstalledVoice { public bool Enabled = true; public VoiceInfo VoiceInfo = new VoiceInfo(); }
    public class SpeakCompletedEventArgs : System.EventArgs { public System.Exception Error; public bool Cancelled; }
    public sealed class SpeechSynthesizer : System.IDisposable
    {
        public InstalledVoice[] GetInstalledVoices() { return new InstalledVoice[] { new InstalledVoice() }; }
        public event System.EventHandler<SpeakCompletedEventArgs> SpeakCompleted;
        public void SelectVoice(string name) { BackstageVoiceStub.Record("select-fake-voice"); }
        public void SpeakAsync(string text) { BackstageVoiceStub.Record("speak-fake"); if (System.Environment.GetEnvironmentVariable("BF_VOICE_STUB_COMPLETE") == "1" && SpeakCompleted != null) SpeakCompleted(this, new SpeakCompletedEventArgs()); }
        public void SpeakAsyncCancelAll() { BackstageVoiceStub.Record("cancel-fake-output"); }
        public void Dispose() { BackstageVoiceStub.Record("dispose-fake-output"); }
    }
}
public static class BackstageVoiceStub
{
    public static void Record(string value)
    {
        if (typeof(System.Speech.Recognition.SpeechRecognitionEngine).Assembly != typeof(BackstageVoiceHelper).Assembly) throw new System.Exception("Real audio is forbidden in this fixture");
        System.IO.File.AppendAllText(System.Environment.GetEnvironmentVariable("BF_VOICE_STUB_LOG"), value + "\n");
    }
}
