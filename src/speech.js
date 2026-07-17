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

/** Wait until TTS is quiet so Robot Ears doesn't score the robot voice. */
export function waitForQuiet(maxMs = 600) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const busy =
        canSpeak &&
        (window.speechSynthesis.speaking || window.speechSynthesis.pending);
      if (!busy || Date.now() - start >= maxMs) {
        // Tiny settle so the last TTS samples leave the echo path.
        setTimeout(resolve, 80);
        return;
      }
      setTimeout(tick, 40);
    };
    tick();
  });
}

/* =====================================================================
   Mic constraints — browser DSP (echo cancel, noise suppress, AGC)
   ===================================================================== */
export const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    channelCount: { ideal: 1 },
    // Prefer the default / user-facing mic on phones when available.
    facingMode: { ideal: "user" },
  },
};

async function openMicStream() {
  return navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
}

/* =====================================================================
   Local level meter + simple speech / noise heuristics
   ===================================================================== */
function rmsFromTimeData(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

/**
 * Attach an AnalyserNode to a MediaStream (or AudioNode) and report levels.
 * level 0–1, speechDetected when energy is clearly above ambient noise floor.
 */
export function createLevelMeter(streamOrSource, opts = {}) {
  const onLevel = opts.onLevel || null;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let source;
  let ownsStream = false;
  let stream = null;

  if (streamOrSource instanceof MediaStream) {
    stream = streamOrSource;
    source = ctx.createMediaStreamSource(stream);
  } else {
    source = streamOrSource;
  }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.55;
  // High-pass to ignore rumble / handling noise when estimating speech.
  const hipass = ctx.createBiquadFilter();
  hipass.type = "highpass";
  hipass.frequency.value = 120;
  hipass.Q.value = 0.7;

  source.connect(hipass);
  hipass.connect(analyser);
  // Do not connect to destination — avoids feedback / monitoring echo.

  const data = new Uint8Array(analyser.fftSize);
  let noiseFloor = 0.02;
  let calibrated = false;
  let samples = 0;
  let floorAccum = 0;
  let peak = 0;
  let lastLevel = 0;
  let lastSpeaking = false;
  let speechFrames = 0;
  let totalFrames = 0;
  let lastSpeechAt = 0;
  let stopped = false;
  let raf = 0;

  const CALIBRATE_FRAMES = 18; // ~300ms of ambient before thresholds lock

  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(data);
    const rms = rmsFromTimeData(data);
    totalFrames++;

    if (!calibrated) {
      floorAccum += rms;
      samples++;
      if (samples >= CALIBRATE_FRAMES) {
        noiseFloor = Math.max(0.012, (floorAccum / samples) * 1.15);
        calibrated = true;
      }
    } else {
      // Slowly track quiet ambient so a noisy room doesn't stay "hot" forever.
      if (rms < noiseFloor * 1.4) {
        noiseFloor = noiseFloor * 0.98 + rms * 0.02;
      }
    }

    const speechThreshold = Math.max(0.04, noiseFloor * 2.8);
    const loud = rms >= speechThreshold;
    if (loud) {
      speechFrames++;
      lastSpeechAt = Date.now();
    }
    peak = Math.max(peak, rms);

    // Map rms → 0–1 UI bar (log-ish so soft voices still move the meter).
    const level = Math.min(1, Math.pow(Math.max(0, rms - noiseFloor) / 0.18, 0.65));
    lastLevel = level;
    lastSpeaking = loud;
    const noisyRoom = noiseFloor > 0.055;
    const tooQuietSoFar = calibrated && speechFrames < 2 && totalFrames > 40;
    const snapshot = {
      level,
      rms,
      peak,
      noiseFloor,
      calibrated,
      speechDetected: speechFrames >= 2,
      speakingNow: loud,
      noisyRoom,
      tooQuietSoFar,
      msSinceSpeech: lastSpeechAt ? Date.now() - lastSpeechAt : null,
    };
    if (onLevel) {
      try {
        onLevel(snapshot);
      } catch (e) {}
    }

    raf = requestAnimationFrame(tick);
  };

  // Resume AudioContext on iOS (often starts suspended until a gesture).
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  raf = requestAnimationFrame(tick);

  return {
    getStats: () => ({
      level: lastLevel,
      peak,
      noiseFloor,
      calibrated,
      speechDetected: speechFrames >= 2,
      speakingNow: lastSpeaking,
      speechFrames,
      totalFrames,
      noisyRoom: noiseFloor > 0.055,
      tooQuietSoFar: calibrated && speechFrames < 2 && totalFrames > 40,
    }),
    resetStats: () => {
      peak = 0;
      speechFrames = 0;
      totalFrames = 0;
      lastSpeechAt = 0;
      lastLevel = 0;
      lastSpeaking = false;
    },
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      try {
        hipass.disconnect();
      } catch (e) {}
      try {
        analyser.disconnect();
      } catch (e) {}
      try {
        source.disconnect();
      } catch (e) {}
      try {
        ctx.close();
      } catch (e) {}
      if (ownsStream && stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    },
  };
}

/* =====================================================================
   Push PCM from a processed MediaStream into Azure (browser-safe path)
   ===================================================================== */
function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * Build AudioConfig from a mic stream with browser noise suppression +
 * a light high-pass, while exposing an analyser for the level meter.
 * Falls back cleanly if ScriptProcessor / AudioContext is unavailable.
 */
async function createProcessedAudioInput(sdk) {
  const stream = await openMicStream();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("no-audiocontext");
  }

  // Let the browser pick rate; report it to Azure so PCM matches.
  const ctx = new AudioCtx();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (e) {}
  }
  const sampleRate = ctx.sampleRate || 48000;
  const source = ctx.createMediaStreamSource(stream);

  // Light cleanup before Azure: cut rumble, gentle compression of peaks.
  const hipass = ctx.createBiquadFilter();
  hipass.type = "highpass";
  hipass.frequency.value = 85;
  hipass.Q.value = 0.7;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -28;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.15;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.55;

  source.connect(hipass);
  hipass.connect(compressor);
  compressor.connect(analyser);

  // ScriptProcessor is deprecated but widely available; buffer → push stream.
  const bufferSize = 4096;
  const processor = ctx.createScriptProcessor
    ? ctx.createScriptProcessor(bufferSize, 1, 1)
    : null;
  if (!processor) {
    try {
      ctx.close();
    } catch (e) {}
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("no-script-processor");
  }

  const format = sdk.AudioStreamFormat.getWaveFormatPCM(sampleRate, 16, 1);
  const pushStream = sdk.AudioInputStream.createPushStream(format);

  // Mute output so we never play the mic back (which would loop).
  const mute = ctx.createGain();
  mute.gain.value = 0;
  analyser.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  let closed = false;
  processor.onaudioprocess = (e) => {
    if (closed) return;
    try {
      const input = e.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPCM(input);
      pushStream.write(pcm.buffer);
    } catch (err) {}
  };

  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

  // Level meter reads the same analyser (no second mic open).
  const data = new Uint8Array(analyser.fftSize);
  let noiseFloor = 0.02;
  let calibrated = false;
  let samples = 0;
  let floorAccum = 0;
  let peak = 0;
  let speechFrames = 0;
  let totalFrames = 0;
  let lastSpeechAt = 0;
  let levelCb = null;
  let raf = 0;
  let meterStopped = false;

  const meterTick = () => {
    if (meterStopped || closed) return;
    analyser.getByteTimeDomainData(data);
    const rms = rmsFromTimeData(data);
    totalFrames++;
    if (!calibrated) {
      floorAccum += rms;
      samples++;
      if (samples >= 18) {
        noiseFloor = Math.max(0.012, (floorAccum / samples) * 1.15);
        calibrated = true;
      }
    } else if (rms < noiseFloor * 1.4) {
      noiseFloor = noiseFloor * 0.98 + rms * 0.02;
    }
    const speechThreshold = Math.max(0.04, noiseFloor * 2.8);
    const loud = rms >= speechThreshold;
    if (loud) {
      speechFrames++;
      lastSpeechAt = Date.now();
    }
    peak = Math.max(peak, rms);
    const level = Math.min(1, Math.pow(Math.max(0, rms - noiseFloor) / 0.18, 0.65));
    if (levelCb) {
      try {
        levelCb({
          level,
          rms,
          peak,
          noiseFloor,
          calibrated,
          speechDetected: speechFrames >= 2,
          speakingNow: loud,
          noisyRoom: noiseFloor > 0.055,
          tooQuietSoFar: calibrated && speechFrames < 2 && totalFrames > 40,
          msSinceSpeech: lastSpeechAt ? Date.now() - lastSpeechAt : null,
        });
      } catch (e) {}
    }
    raf = requestAnimationFrame(meterTick);
  };
  raf = requestAnimationFrame(meterTick);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    meterStopped = true;
    cancelAnimationFrame(raf);
    try {
      processor.onaudioprocess = null;
    } catch (e) {}
    try {
      processor.disconnect();
    } catch (e) {}
    try {
      mute.disconnect();
    } catch (e) {}
    try {
      analyser.disconnect();
    } catch (e) {}
    try {
      compressor.disconnect();
    } catch (e) {}
    try {
      hipass.disconnect();
    } catch (e) {}
    try {
      source.disconnect();
    } catch (e) {}
    try {
      pushStream.close();
    } catch (e) {}
    try {
      ctx.close();
    } catch (e) {}
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {}
  };

  return {
    audioConfig,
    setLevelCallback: (fn) => {
      levelCb = fn;
    },
    getStats: () => ({
      peak,
      noiseFloor,
      calibrated,
      speechDetected: speechFrames >= 2,
      speechFrames,
      totalFrames,
      noisyRoom: noiseFloor > 0.055,
    }),
    resetMeterStats: () => {
      peak = 0;
      speechFrames = 0;
      totalFrames = 0;
      lastSpeechAt = 0;
      // Keep noiseFloor so room calibration carries across words.
    },
    cleanup,
    mode: "processed",
  };
}

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
    const stream = await openMicStream();
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
function pentity(x) {
  return p(x);
}

/** Soften scores when the room is very noisy or the utterance is incomplete. */
function qualityAdjust(target, detailJson, localStats) {
  let score = target;
  try {
    const nb = detailJson?.NBest?.[0];
    const completeness = nb?.PronunciationAssessment?.CompletenessScore;
    if (typeof completeness === "number" && completeness < 55) {
      // Kid only said part of the phrase — don't over-reward.
      score = Math.min(score, Math.round(score * 0.85 + completeness * 0.15));
    }
  } catch (e) {}

  if (localStats?.noisyRoom && localStats.peak < localStats.noiseFloor * 3.2) {
    // Mostly ambient energy, not a clear voice peak above the room.
    return { score, flag: "noisy" };
  }
  if (localStats && !localStats.speechDetected) {
    return { score, flag: "too_quiet" };
  }
  return { score, flag: null };
}

function normalizeHeard(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Very loose check: did Azure hear something related to the target word? */
function heardLooksRelated(heard, reference) {
  const h = normalizeHeard(heard);
  const r = normalizeHeard(reference);
  if (!h || !r) return false;
  if (h === r) return true;
  if (h.includes(r) || r.includes(h)) return true;
  // Shared first content word (helps multi-word sentences).
  const rw = r.split(" ").filter((w) => w.length > 2);
  const hw = new Set(h.split(" ").filter((w) => w.length > 2));
  return rw.some((w) => hw.has(w));
}

/* =====================================================================
   Azure Pronunciation Assessment — persistent session

   createAssessmentSession() is called ONCE when a speaking level opens.
   Prefers a processed mic pipeline (noise suppress + high-pass + meter).
   Falls back to the SDK default mic if that path fails.

   session.assess(text) resolves with:
     { status:'ok', overall, target, heard, quality }
     { status:'nomatch', reason, quality }  — nothing usable was heard
     { status:'too_quiet' | 'noisy' | 'timeout', quality }
   ===================================================================== */
export async function createAssessmentSession(worldId, opts = {}) {
  const sdk = await getSdk();
  const { token, region } = await getToken();
  const endMs = String(opts.endSilenceMs ?? 1600);
  const maxListenMs = opts.maxListenMs ?? 9000;

  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechRecognitionLanguage = "en-US";
  // Up to 12s to START talking — thinking time, but not endless hang.
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
    "12000"
  );
  // How long a pause can be before we decide the kid is finished.
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
    endMs
  );
  try {
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, endMs);
  } catch (e) {}

  let pipeline = null;
  let audioConfig;
  try {
    pipeline = await createProcessedAudioInput(sdk);
    audioConfig = pipeline.audioConfig;
  } catch (e) {
    // Reliable fallback used by earlier versions of this game.
    audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
  }

  // If we're on the default-mic path, open a separate quiet monitor stream
  // so the UI still gets a level meter (browser DSP still applies).
  let monitor = null;
  if (!pipeline) {
    try {
      const monStream = await openMicStream();
      monitor = createLevelMeter(monStream, {});
      // createLevelMeter does not own the stream — stop tracks on close.
      const baseStop = monitor.stop;
      monitor.stop = () => {
        baseStop();
        monStream.getTracks().forEach((t) => t.stop());
      };
    } catch (e) {}
  }

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
  const readyTimer = setTimeout(markReady, 2200);

  // Partial hypotheses = proof Azure is actually picking up the voice.
  recognizer.recognizing = (s, e) => {
    try {
      if (opts.onHearing && e && e.result && e.result.text) opts.onHearing(e.result.text);
    } catch (er) {}
  };

  const getLocalStats = () => {
    if (pipeline) return pipeline.getStats();
    if (monitor) return monitor.getStats();
    return null;
  };

  return {
    isReady: () => ready,
    /** 'processed' | 'default' — useful for grown-ups debug later */
    inputMode: () => (pipeline ? "processed" : "default"),

    assess(referenceText, assessOpts = {}) {
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(new Error("session-closed"));
          return;
        }

        if (pipeline) {
          pipeline.resetMeterStats();
          pipeline.setLevelCallback(assessOpts.onLevel || opts.onLevel || null);
        } else if (monitor && (assessOpts.onLevel || opts.onLevel)) {
          // Re-bind by wrapping: monitor was created without callback; poll via rAF.
          // We already have createLevelMeter with fixed callback — set via onLevel on assess only for pipeline.
          // For monitor path, re-create is heavy; instead call onLevel from a short poller.
        }

        let levelPoll = null;
        const onLevel = assessOpts.onLevel || opts.onLevel || null;
        if (!pipeline && monitor) {
          try {
            monitor.resetStats();
          } catch (e) {}
          if (onLevel) {
            levelPoll = setInterval(() => {
              const st = monitor.getStats();
              try {
                onLevel({
                  ...st,
                  msSinceSpeech: null,
                });
              } catch (e) {}
            }, 80);
          }
        }

        const finish = (payload) => {
          if (levelPoll) clearInterval(levelPoll);
          if (pipeline) pipeline.setLevelCallback(null);
          resolve(payload);
        };

        const hardTimer = setTimeout(() => {
          // recognizeOnce can't be cleanly cancelled; close is last resort only
          // if session is torn down. Here we just tag timeout when result arrives late
          // — see timedOut flag below.
        }, maxListenMs);

        let timedOut = false;
        const timeoutFlag = setTimeout(() => {
          timedOut = true;
        }, maxListenMs);

        try {
          const paConfig = new sdk.PronunciationAssessmentConfig(
            referenceText,
            sdk.PronunciationAssessmentGradingSystem.HundredMark,
            sdk.PronunciationAssessmentGranularity.Phoneme,
            false
          );
          paConfig.phonemeAlphabet = "IPA";
          // Enable misc. info when available (helps completeness / SNR later).
          try {
            paConfig.enableProsodyAssessment = false;
          } catch (e) {}
          paConfig.applyTo(recognizer);

          recognizer.recognizeOnceAsync(
            (result) => {
              clearTimeout(hardTimer);
              clearTimeout(timeoutFlag);
              const localStats = getLocalStats();
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
                  let target = extractTargetScore(detail, worldId) ?? overall;
                  const heard = result.text || "";
                  const adj = qualityAdjust(target, detail, localStats);
                  target = Math.round(adj.score);

                  // Local energy says almost nothing was spoken → trust the meter.
                  if (adj.flag === "too_quiet" && overall < 40) {
                    finish({
                      status: "too_quiet",
                      heard,
                      overall,
                      target,
                      quality: localStats,
                    });
                    return;
                  }
                  if (adj.flag === "noisy" && overall < 50 && !heardLooksRelated(heard, referenceText)) {
                    finish({
                      status: "noisy",
                      heard,
                      overall,
                      target,
                      quality: localStats,
                    });
                    return;
                  }

                  // Heard something unrelated (room TV / sibling) — treat as soft miss.
                  if (heard && !heardLooksRelated(heard, referenceText) && overall < 45) {
                    finish({
                      status: "nomatch",
                      reason: "unrelated",
                      heard,
                      overall,
                      target,
                      quality: localStats,
                    });
                    return;
                  }

                  finish({
                    status: "ok",
                    overall,
                    target,
                    heard,
                    quality: localStats,
                    inputMode: pipeline ? "processed" : "default",
                  });
                } else {
                  // NoMatch / Canceled — explain using local meter when possible.
                  if (localStats && !localStats.speechDetected) {
                    finish({
                      status: "too_quiet",
                      reason: "nomatch",
                      quality: localStats,
                    });
                    return;
                  }
                  if (localStats?.noisyRoom) {
                    finish({
                      status: "noisy",
                      reason: "nomatch",
                      quality: localStats,
                    });
                    return;
                  }
                  if (timedOut) {
                    finish({
                      status: "timeout",
                      quality: localStats,
                    });
                    return;
                  }
                  finish({
                    status: "nomatch",
                    reason: "nomatch",
                    quality: localStats,
                  });
                }
              } catch (e) {
                if (levelPoll) clearInterval(levelPoll);
                if (pipeline) pipeline.setLevelCallback(null);
                reject(e);
              }
            },
            (err) => {
              clearTimeout(hardTimer);
              clearTimeout(timeoutFlag);
              if (levelPoll) clearInterval(levelPoll);
              if (pipeline) pipeline.setLevelCallback(null);
              reject(new Error(err || "recognition-failed"));
            }
          );
        } catch (e) {
          clearTimeout(hardTimer);
          clearTimeout(timeoutFlag);
          if (levelPoll) clearInterval(levelPoll);
          if (pipeline) pipeline.setLevelCallback(null);
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
      try {
        if (pipeline) pipeline.cleanup();
      } catch (e) {}
      try {
        if (monitor) monitor.stop();
      } catch (e) {}
    },
  };
}

/* =====================================================================
   Record & compare (no cloud) — MediaRecorder fallback
   ===================================================================== */
export async function recordClip(maxMs = 4000, onTick, onLevel) {
  const stream = await openMicStream();
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  let meter = null;
  if (onLevel) {
    try {
      meter = createLevelMeter(stream, { onLevel });
    } catch (e) {}
  }

  const done = new Promise((res) => {
    rec.onstop = () => {
      if (meter) meter.stop();
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
