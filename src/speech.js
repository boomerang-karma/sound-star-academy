let sdkPromise = null;
const getSdk = () => {
  if (!sdkPromise) sdkPromise = import("microsoft-cognitiveservices-speech-sdk");
  return sdkPromise;
};

/* =====================================================================
   Text-to-speech (the "robot voice") — free, built into every browser
   ===================================================================== */
export const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

export const speak = (text, rate = 0.8) => {
  try {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = 1.05;
    window.speechSynthesis.speak(u);
  } catch (e) {}
};

export const hush = () => {
  try {
    if (canSpeak) window.speechSynthesis.cancel();
  } catch (e) {}
};

/* =====================================================================
   Capability detection → decides Robot Ears mode
   'azure'  = mic + token endpoint reachable  → real pronunciation scoring
   'record' = mic only                        → record & compare
   'self'   = no mic                          → self-rating
   ===================================================================== */
export async function detectCapabilities() {
  const caps = { mic: false, api: false };

  try {
    const r = await fetch("/api/token", { method: "GET" });
    if (r.ok) {
      const j = await r.json();
      caps.api = Boolean(j.token && j.region);
      if (caps.api) cacheToken(j.token, j.region);
    }
  } catch (e) {}

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    caps.mic = true;
  } catch (e) {}

  return caps;
}

/* =====================================================================
   Token cache — Azure tokens live 10 min; refresh after 8
   ===================================================================== */
let tokenCache = null; // { token, region, exp }

function cacheToken(token, region) {
  tokenCache = { token, region, exp: Date.now() + 8 * 60 * 1000 };
}

async function getToken() {
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache;
  const r = await fetch("/api/token");
  if (!r.ok) throw new Error("token-endpoint");
  const j = await r.json();
  if (!j.token || !j.region) throw new Error("token-endpoint");
  cacheToken(j.token, j.region);
  return tokenCache;
}

/* =====================================================================
   Target-sound phoneme mapping
   Azure returns per-phoneme scores; we grade just the sound being
   practiced. Lists include IPA symbols plus SAPI fallbacks.
   ===================================================================== */
const TARGET_PHONEMES = {
  r: ["ɹ", "r", "ɚ", "ɝ"],
  s: ["s"],
  l: ["l"],
  th: ["θ", "ð", "th", "dh"],
  sh: ["ʃ", "sh"],
  ch: ["tʃ", "ʧ", "ch"],
};

function extractTargetScore(detailJson, worldId) {
  const targets = TARGET_PHONEMES[worldId] || [];
  const scores = [];
  try {
    const words = detailJson?.NBest?.[0]?.Words || [];
    for (const w of words) {
      for (const p of w.Phonemes || []) {
        const ph = (p.Phoneme || "").toLowerCase();
        if (targets.includes(ph)) {
          const s = pentity(p);
          if (typeof s === "number") scores.push(s);
        }
      }
    }
  } catch (e) {}
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function p(x) {
  return x?.PronunciationAssessment?.AccuracyScore;
}
// small alias kept separate so extractTargetScore stays readable
function pentity(x) {
  return p(x);
}

/* =====================================================================
   Azure Pronunciation Assessment — persistent session

   createAssessmentSession() is called ONCE when a speaking level opens.
   It builds the recognizer, pre-opens the websocket to Azure, and stays
   armed in a "ready to hear" state. Each word then scores instantly with
   no connection wait.

   Audio input uses the SDK's own microphone path (fromDefaultMicrophoneInput),
   which is the reliable one — do NOT hand it a MediaStream we opened
   ourselves; that path silently delivers no audio.

   session.assess(text) resolves with:
     { status:'ok', overall, target, heard }
     { status:'nomatch' }   — nothing usable was heard
   ===================================================================== */
export async function createAssessmentSession(worldId, opts = {}) {
  const sdk = await getSdk();
  const { token, region } = await getToken();
  const endMs = String(opts.endSilenceMs ?? 1600);

  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechRecognitionLanguage = "en-US";
  // Up to 20s to START talking — thinking time is allowed.
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
    "20000"
  );
  // How long a pause can be before we decide the kid is finished.
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
    endMs
  );
  try {
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, endMs);
  } catch (e) {}

  const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  /* ---- ready state ---- */
  let ready = false;
  let closed = false;
  const markReady = () => {
    if (ready || closed) return;
    ready = true;
    try {
      if (opts.onReady) opts.onReady();
    } catch (e) {}
  };

  // Pre-open the websocket so the first word doesn't pay the handshake cost.
  let connection = null;
  try {
    connection = sdk.Connection.fromRecognizer(recognizer);
    connection.connected = () => markReady();
    connection.openConnection();
  } catch (e) {}

  recognizer.sessionStarted = () => markReady();

  // Safety net: never leave the UI stuck on "connecting" forever.
  const readyTimer = setTimeout(markReady, 2000);

  // Partial hypotheses = proof Azure is actually picking up the voice.
  recognizer.recognizing = (s, e) => {
    try {
      if (opts.onHearing && e && e.result && e.result.text) opts.onHearing(e.result.text);
    } catch (er) {}
  };

  return {
    isReady: () => ready,

    assess(referenceText) {
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(new Error("session-closed"));
          return;
        }
        try {
          const paConfig = new sdk.PronunciationAssessmentConfig(
            referenceText,
            sdk.PronunciationAssessmentGradingSystem.HundredMark,
            sdk.PronunciationAssessmentGranularity.Phoneme,
            false
          );
          paConfig.phonemeAlphabet = "IPA";
          paConfig.applyTo(recognizer);

          recognizer.recognizeOnceAsync(
            (result) => {
              try {
                if (result.reason === sdk.ResultReason.RecognizedSpeech) {
                  const pa = sdk.PronunciationAssessmentResult.fromResult(result);
                  let detail = null;
                  try {
                    detail = JSON.parse(
                      result.properties.getProperty(
                        sdk.PropertyId.SpeechServiceResponse_JsonResult
                      )
                    );
                  } catch (e) {}
                  const overall = Math.round((pa && pa.accuracyScore) || 0);
                  const target = extractTargetScore(detail, worldId) ?? overall;
                  resolve({ status: "ok", overall, target, heard: result.text || "" });
                } else {
                  resolve({ status: "nomatch" });
                }
              } catch (e) {
                reject(e);
              }
            },
            (err) => reject(new Error(err || "recognition-failed"))
          );
        } catch (e) {
          reject(e);
        }
      });
    },

    close() {
      if (closed) return;
      closed = true;
      clearTimeout(readyTimer);
      try {
        if (connection) connection.closeConnection();
      } catch (e) {}
      try {
        recognizer.close();
      } catch (e) {}
    },
  };
}

/* =====================================================================
   Record & compare (no cloud) — MediaRecorder fallback
   ===================================================================== */
export async function recordClip(maxMs = 4000, onTick) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const done = new Promise((res) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      res(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    };
  });

  rec.start();
  const startedAt = Date.now();
  const tick = onTick
    ? setInterval(() => {
        const left = Math.max(0, maxMs - (Date.now() - startedAt));
        onTick(Math.ceil(left / 1000));
        if (left <= 0) clearInterval(tick);
      }, 200)
    : null;
  const timer = setTimeout(() => {
    if (rec.state !== "inactive") rec.stop();
  }, maxMs);

  return {
    stop: () => {
      clearTimeout(timer);
      if (tick) clearInterval(tick);
      if (rec.state !== "inactive") rec.stop();
    },
    done,
  };
}

let lastUrl = null;
export function playBlob(blob) {
  try {
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    const a = new Audio(lastUrl);
    a.play();
  } catch (e) {}
}
