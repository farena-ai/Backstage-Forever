"use strict";
function registerVoiceHandlers({ handle, voice }) {
  const args = (count, fn) => (...values) => { if (values.length !== count) throw Error("Invalid voice request."); return fn(...values); };
  handle("voiceCapabilities", args(0, () => voice.capabilities()));
  handle("voiceStart", args(1, input => voice.start(input)));
  handle("voiceStatus", args(1, id => voice.status(id)));
  handle("voiceStop", args(1, id => voice.stop(id)));
  handle("voiceSpeak", args(1, input => voice.speak(input)));
  handle("voiceCancel", args(0, () => voice.cancel()));
}
module.exports = { registerVoiceHandlers };
