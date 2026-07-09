import React, { useState, useEffect, useMemo, useRef } from "react";
import { WORLDS, LEVELS, MAX_STARS, WORLD_MAX } from "./content.js";
import {
  speak,
  hush,
  canSpeak,
  detectCapabilities,
  assessPronunciation,
  recordClip,
  playBlob,
} from "./speech.js";

/* ---------------- design tokens ---------------- */
const INK = "#1F2540";
const PAPER = "#FFF7E8";
const STAR = "#FFB800";
const KEY = "sound-star-academy-v2";

/* ---------------- utils ---------------- */
const shuffle = (a) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
const pick3 = (arr) => shuffle(arr).slice(0, 3);
const dkey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

const hi = (text, sound, color) => {
  const s = sound.toLowerCase();
  const lower = text.toLowerCase();
  const parts = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    if (lower.startsWith(s, i)) {
      parts.push(
        <span
          key={k++}
          className="underline decoration-4 underline-offset-2"
          style={{ color, textDecorationColor: color }}
        >
          {text.slice(i, i + s.length)}
        </span>
      );
      i += s.length;
    } else {
      let j = i;
      while (j < text.length && !lower.startsWith(s, j)) j++;
      parts.push(<span key={k++}>{text.slice(i, j)}</span>);
      i = j;
    }
  }
  return parts;
};

/* ---------------- persistence (localStorage) ---------------- */
const defaults = () => ({
  stars: Object.fromEntries(WORLDS.map((w) => [w.id, 0])),
  done: Object.fromEntries(WORLDS.map((w) => [w.id, [false, false, false, false, false]])),
  listen: Object.fromEntries(WORLDS.map((w) => [w.id, { ok: 0, tries: 0 }])),
  robot: Object.fromEntries(WORLDS.map((w) => [w.id, { sum: 0, n: 0 }])),
  streak: { n: 0, last: null },
  settings: { robotEars: true },
});

const loadProgress = () => {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    return {
      stars: { ...d.stars, ...(s.stars || {}) },
      done: { ...d.done, ...(s.done || {}) },
      listen: { ...d.listen, ...(s.listen || {}) },
      robot: { ...d.robot, ...(s.robot || {}) },
      streak: { ...d.streak, ...(s.streak || {}) },
      settings: { ...d.settings, ...(s.settings || {}) },
    };
  } catch (e) {
    return d;
  }
};

/* ---------------- tiny building blocks ---------------- */
const Btn = ({ children, color = "#FFFFFF", className = "", style = {}, ...props }) => (
  <button
    {...props}
    style={{ background: color, color: INK, ...style }}
    className={`stk font-display font-bold leading-tight select-none ${className}`}
  >
    {children}
  </button>
);

const Pane = ({ children, color = "#FFFFFF", className = "", style = {} }) => (
  <div className={`stk ${className}`} style={{ background: color, ...style }}>
    {children}
  </div>
);

const Chip = ({ children, color = "#FFFFFF", className = "" }) => (
  <span
    className={`stk-sm font-display font-bold inline-flex items-center gap-1 px-3 py-1 text-sm ${className}`}
    style={{ background: color, color: INK }}
  >
    {children}
  </span>
);

const Dots = ({ total, at }) => (
  <div className="flex items-center justify-center gap-2">
    {[...Array(total)].map((_, i) => (
      <span
        key={i}
        className="w-3 h-3 rounded-full border-2"
        style={{
          borderColor: INK,
          background: i < at ? STAR : i === at ? "#FFFFFF" : "#00000015",
        }}
      />
    ))}
  </div>
);

const StarBurst = ({ burst }) =>
  burst ? (
    <div key={burst} className="pointer-events-none absolute inset-0 z-20">
      {[...Array(6)].map((_, i) => (
        <span
          key={i}
          className="floatup absolute text-3xl"
          style={{ left: `${12 + i * 14}%`, top: "50%", animationDelay: `${i * 45}ms` }}
        >
          ⭐
        </span>
      ))}
    </div>
  ) : null;

const TopBar = ({ onBack, title, right }) => (
  <div className="flex items-center gap-3 mb-4">
    <Btn aria-label="Go back" className="w-12 h-12 text-2xl shrink-0" onClick={onBack}>
      ‹
    </Btn>
    <div className="font-display font-extrabold text-xl flex-1 leading-tight" style={{ color: INK }}>
      {title}
    </div>
    {right}
  </div>
);

/* ---------------- Level 1: Super Ears ---------------- */
function ListenGame({ world, onDone }) {
  const [i, setI] = useState(0);
  const [msg, setMsg] = useState(null);
  const [wrongIdx, setWrongIdx] = useState(null);
  const [locked, setLocked] = useState(false);
  const [burst, setBurst] = useState(0);
  const missed = useRef(false);
  const okRef = useRef(0);

  const round = world.listen[i];
  const opts = useMemo(() => shuffle(round.options), [i]);

  useEffect(() => {
    missed.current = false;
    setWrongIdx(null);
    setMsg(null);
    const t = setTimeout(() => speak(round.say, 0.78), 400);
    return () => clearTimeout(t);
  }, [i]);

  const pickOpt = (opt, idx) => {
    if (locked) return;
    if (opt.w === round.say) {
      if (!missed.current) okRef.current += 1;
      setLocked(true);
      setBurst((b) => b + 1);
      setMsg({ good: true, text: `Yes! That's "${round.say}"!` });
      setTimeout(() => {
        setLocked(false);
        if (i + 1 < world.listen.length) setI(i + 1);
        else
          onDone({
            stars: MAX_STARS.listen,
            listenOk: okRef.current,
            listenTries: world.listen.length,
          });
      }, 1000);
    } else {
      missed.current = true;
      setWrongIdx(idx);
      setMsg({ good: false, text: "Oops! Listen again 👂" });
      setTimeout(() => speak(round.say, 0.72), 450);
      setTimeout(() => setWrongIdx(null), 500);
    }
  };

  return (
    <div className="relative">
      <StarBurst burst={burst} />
      <Pane className="p-5 text-center mb-4">
        <div className="font-display font-extrabold text-lg mb-1" style={{ color: INK }}>
          Tap what you hear!
        </div>
        <Btn color={world.color} className="px-6 py-3 text-xl mt-1" onClick={() => speak(round.say, 0.72)}>
          🔊 Hear it
        </Btn>
        <div
          className={`font-display font-bold mt-3 min-h-6 text-base ${msg && !msg.good ? "shake" : ""}`}
          style={{ color: msg ? (msg.good ? "#1B9E55" : "#D23F5E") : INK }}
        >
          {msg ? msg.text : "\u00A0"}
        </div>
      </Pane>

      <div className="grid grid-cols-2 gap-4">
        {opts.map((o, idx) => (
          <Btn
            key={o.w}
            onClick={() => pickOpt(o, idx)}
            className={`p-4 flex flex-col items-center gap-2 ${wrongIdx === idx ? "shake" : ""}`}
          >
            <span className="text-6xl">{o.e}</span>
            <span className="text-lg">{o.w}</span>
          </Btn>
        ))}
      </div>

      <div className="mt-6">
        <Dots total={world.listen.length} at={i} />
      </div>
    </div>
  );
}

/* ---------------- Level 2: Sound Lab ---------------- */
function LabGame({ world, onDone }) {
  const [step, setStep] = useState(0);
  const [said, setSaid] = useState(false);
  const [burst, setBurst] = useState(0);
  const drills = world.cue.drills;
  const current = drills[step];

  const hear = () => {
    speak(current, 0.7);
    setSaid(true);
  };
  const didIt = () => {
    setBurst((b) => b + 1);
    setSaid(false);
    setTimeout(() => {
      if (step + 1 < drills.length) setStep(step + 1);
      else onDone({ stars: MAX_STARS.lab });
    }, 700);
  };

  return (
    <div className="relative">
      <StarBurst burst={burst} />
      <Pane className="p-5 mb-4">
        <div className="font-display font-extrabold text-xl mb-2" style={{ color: world.color }}>
          👄 {world.cue.title}
        </div>
        {world.cue.lines.map((l, idx) => (
          <div key={idx} className="font-bold text-base mb-1" style={{ color: INK }}>
            {idx + 1}. {l}
          </div>
        ))}
      </Pane>

      <div className="flex items-center justify-center gap-2 mb-4">
        {drills.map((d, idx) => (
          <span
            key={d}
            className="stk-sm font-display font-bold w-12 h-12 flex items-center justify-center text-sm"
            style={{
              background: idx < step ? STAR : idx === step ? world.color : "#FFFFFF",
              color: INK,
              opacity: idx > step ? 0.5 : 1,
            }}
          >
            {idx < step ? "⭐" : d}
          </span>
        ))}
      </div>

      <Pane className="p-6 text-center">
        <div className="font-display font-extrabold text-5xl mb-4" style={{ color: INK }}>
          {hi(current, world.sound, world.color)}
        </div>
        <div className="flex gap-3 justify-center">
          <Btn className="px-5 py-3 text-lg" onClick={hear}>
            🔊 Hear it
          </Btn>
          <Btn
            color={said ? world.color : "#E9E4D8"}
            className="px-5 py-3 text-lg"
            style={{ opacity: said ? 1 : 0.6 }}
            onClick={() => said && didIt()}
          >
            🗣️ I said it!
          </Btn>
        </div>
        {!said && (
          <div className="font-bold text-sm mt-3" style={{ color: INK, opacity: 0.6 }}>
            Hear it first, then copy the robot!
          </div>
        )}
      </Pane>
    </div>
  );
}

/* ---------------- Levels 3–5: say-it deck ---------------- */
const POS_CHIP = {
  start: { label: "at the START", dot: "🟢" },
  middle: { label: "in the MIDDLE", dot: "🟡" },
  end: { label: "at the END", dot: "🔴" },
};

const starsFor = (t) => (t >= 80 ? 3 : t >= 60 ? 2 : 1);
const starRow = (n) => "⭐".repeat(n);

function SayDeck({ items, world, kind, input, onDone, onRobotScore }) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState("say"); // say|rate|listening|verdict|recording|compare
  const [verdict, setVerdict] = useState(null);
  const [tries, setTries] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const [clip, setClip] = useState(null);
  const [burst, setBurst] = useState(0);
  const recRef = useRef(null);

  const item = items[i];
  const ttsRate = kind === "words" ? 0.78 : 0.72;

  useEffect(() => {
    setPhase("say");
    setVerdict(null);
    setTries(0);
    setClip(null);
    const t = setTimeout(() => speak(item.text, ttsRate), 400);
    return () => clearTimeout(t);
  }, [i]);

  useEffect(
    () => () => {
      if (recRef.current) recRef.current.stop();
    },
    []
  );

  const advance = () => {
    setBurst((b) => b + 1);
    setTimeout(() => {
      if (i + 1 < items.length) setI(i + 1);
      else onDone({ stars: items.length });
    }, 750);
  };

  const retrySay = () => {
    setPhase("say");
    speak(item.text, 0.68);
  };

  /* ---- Azure Robot Ears ---- */
  const startAzure = async () => {
    hush();
    setPhase("listening");
    let v;
    try {
      const res = await assessPronunciation(item.text, world.id);
      if (res.status === "ok") {
        v = { kind: "ok", ...res, stars: starsFor(res.target) };
        onRobotScore(res.target);
      } else {
        v = { kind: "nomatch" };
      }
    } catch (e) {
      v = { kind: "error" };
    }
    setTries((t) => t + 1);
    setVerdict(v);
    setPhase("verdict");
  };

  /* ---- record & compare ---- */
  const startRecord = async () => {
    hush();
    setPhase("recording");
    try {
      const ms = kind === "words" ? 3500 : 6000;
      const r = await recordClip(ms, (s) => setCountdown(s));
      recRef.current = r;
      const blob = await r.done;
      recRef.current = null;
      setCountdown(null);
      setClip(blob);
      setPhase("compare");
    } catch (e) {
      setCountdown(null);
      setPhase("say");
    }
  };

  const micLabel = input === "azure" ? "🎤 Robot Ears!" : "🎤 Record me!";
  const micAction = input === "azure" ? startAzure : startRecord;

  return (
    <div className="relative">
      <StarBurst burst={burst} />
      <Pane className="p-6 text-center mb-4 popin" key={i}>
        {item.pos && (
          <div className="mb-3">
            <Chip color={PAPER}>
              {POS_CHIP[item.pos].dot} {world.sound} {POS_CHIP[item.pos].label}
            </Chip>
          </div>
        )}
        {item.emoji && <div className="text-7xl mb-3">{item.emoji}</div>}
        <div
          className={`font-display font-extrabold ${kind === "words" ? "text-4xl" : "text-2xl"} leading-snug`}
          style={{ color: INK }}
        >
          {hi(item.text, world.sound, world.color)}
        </div>
      </Pane>

      {/* ---------- SAY ---------- */}
      {phase === "say" && (
        <div className="grid grid-cols-2 gap-3">
          <Btn className="py-4 text-lg" onClick={() => speak(item.text, ttsRate)}>
            🔊 Hear it
          </Btn>
          {input === "self" ? (
            <Btn color={world.color} className="py-4 text-lg" onClick={() => setPhase("rate")}>
              🗣️ I said it!
            </Btn>
          ) : (
            <Btn color={world.color} className="py-4 text-lg" onClick={micAction}>
              {micLabel}
            </Btn>
          )}
        </div>
      )}

      {/* ---------- SELF-RATE ---------- */}
      {phase === "rate" && (
        <Pane className="p-4" color={PAPER}>
          <div className="font-display font-extrabold text-center text-lg mb-3" style={{ color: INK }}>
            Did yours match the robot?
          </div>
          <div className="grid grid-cols-1 gap-3">
            <Btn color={STAR} className="py-4 text-lg" onClick={advance}>
              ⭐ Yes! It matched!
            </Btn>
            <Btn className="py-3 text-base" onClick={retrySay}>
              🔁 Hear it again & try once more
            </Btn>
          </div>
        </Pane>
      )}

      {/* ---------- AZURE: LISTENING ---------- */}
      {phase === "listening" && (
        <Pane className="p-6 text-center" color={PAPER}>
          <div className="text-6xl pulse inline-block">🎤</div>
          <div className="font-display font-extrabold text-lg mt-2" style={{ color: INK }}>
            Robot Ears is listening…
          </div>
          <div className="font-bold text-base" style={{ color: INK, opacity: 0.7 }}>
            Say it loud and clear!
          </div>
        </Pane>
      )}

      {/* ---------- AZURE: VERDICT ---------- */}
      {phase === "verdict" && verdict && (
        <Pane className="p-5 text-center" color={PAPER}>
          {verdict.kind === "ok" && (
            <>
              <div className="font-display font-extrabold text-3xl mb-1">{starRow(verdict.stars)}</div>
              <div className="font-display font-extrabold text-xl mb-1" style={{ color: INK }}>
                {verdict.stars === 3
                  ? `Perfect ${world.sound}!`
                  : verdict.stars === 2
                  ? "So close!"
                  : "Good try!"}
              </div>
              {verdict.stars < 3 && (
                <div className="font-bold text-sm mb-1" style={{ color: INK }}>
                  {world.coach}
                </div>
              )}
              {verdict.heard && (
                <div className="font-bold text-xs mb-3" style={{ color: INK, opacity: 0.55 }}>
                  🤖 heard: “{verdict.heard}”
                </div>
              )}
              <div className="grid grid-cols-1 gap-3">
                {verdict.stars >= 2 ? (
                  <>
                    <Btn color={STAR} className="py-4 text-lg" onClick={advance}>
                      Next ➜
                    </Btn>
                    {verdict.stars === 2 && tries < 3 && (
                      <Btn className="py-3 text-base" onClick={retrySay}>
                        🔁 One more try for ⭐⭐⭐
                      </Btn>
                    )}
                  </>
                ) : tries < 3 ? (
                  <>
                    <Btn color={world.color} className="py-4 text-lg" onClick={retrySay}>
                      🔊 Hear robot & try again
                    </Btn>
                    <Btn className="py-3 text-base" onClick={advance}>
                      Next ➜
                    </Btn>
                  </>
                ) : (
                  <>
                    <div className="font-display font-bold text-base mb-1" style={{ color: INK }}>
                      Brave try! On we go 🎉
                    </div>
                    <Btn color={STAR} className="py-4 text-lg" onClick={advance}>
                      Next ➜
                    </Btn>
                  </>
                )}
              </div>
            </>
          )}

          {verdict.kind === "nomatch" && (
            <>
              <div className="text-5xl mb-2">🤫</div>
              <div className="font-display font-extrabold text-lg mb-3" style={{ color: INK }}>
                I couldn't hear you — get closer and try again!
              </div>
              <div className="grid grid-cols-1 gap-3">
                <Btn color={world.color} className="py-4 text-lg" onClick={startAzure}>
                  🎤 Try again
                </Btn>
                <Btn className="py-3 text-base" onClick={advance}>
                  Next ➜
                </Btn>
              </div>
            </>
          )}

          {verdict.kind === "error" && (
            <>
              <div className="text-5xl mb-2">😅</div>
              <div className="font-display font-extrabold text-lg mb-3" style={{ color: INK }}>
                Robot Ears hiccuped — you be the judge!
              </div>
              <div className="grid grid-cols-1 gap-3">
                <Btn color={STAR} className="py-4 text-lg" onClick={advance}>
                  ⭐ It matched!
                </Btn>
                <Btn className="py-3 text-base" onClick={startAzure}>
                  🎤 Try the mic again
                </Btn>
              </div>
            </>
          )}
        </Pane>
      )}

      {/* ---------- RECORD: RECORDING ---------- */}
      {phase === "recording" && (
        <Pane className="p-6 text-center" color={PAPER}>
          <div className="text-6xl pulse inline-block">🎤</div>
          <div className="font-display font-extrabold text-lg mt-2" style={{ color: INK }}>
            Speak now! {countdown !== null ? `(${countdown})` : ""}
          </div>
          <Btn
            className="px-6 py-3 text-base mt-3"
            onClick={() => recRef.current && recRef.current.stop()}
          >
            ⏹ Done talking
          </Btn>
        </Pane>
      )}

      {/* ---------- RECORD: COMPARE ---------- */}
      {phase === "compare" && (
        <Pane className="p-4" color={PAPER}>
          <div className="font-display font-extrabold text-center text-lg mb-3" style={{ color: INK }}>
            Listen & compare!
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Btn className="py-4 text-lg" onClick={() => speak(item.text, 0.7)}>
              🤖 Robot
            </Btn>
            <Btn color={world.color} className="py-4 text-lg" onClick={() => clip && playBlob(clip)}>
              🧒 Me!
            </Btn>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <Btn color={STAR} className="py-4 text-lg" onClick={advance}>
              ⭐ Mine matched!
            </Btn>
            <Btn className="py-3 text-base" onClick={startRecord}>
              🎤 Record me again
            </Btn>
          </div>
        </Pane>
      )}

      <div className="mt-6">
        <Dots total={items.length} at={i} />
      </div>
    </div>
  );
}

/* ---------------- mic enable banner ---------------- */
function MicBanner({ checking, onEnable, onSkip }) {
  return (
    <Pane className="p-5 text-center mb-4">
      <div className="text-5xl mb-2">🎙️</div>
      <div className="font-display font-extrabold text-lg mb-1" style={{ color: INK }}>
        Turn on Robot Ears?
      </div>
      <div className="font-bold text-sm mb-4" style={{ color: INK, opacity: 0.7 }}>
        The robot can listen and score your sounds. Ask a grown-up to tap Allow!
      </div>
      <div className="grid grid-cols-1 gap-3">
        <Btn color="#3FB6F0" className="py-4 text-lg" onClick={onEnable} disabled={checking}>
          {checking ? "Checking the mic… 👂" : "🎙️ Turn on my mic"}
        </Btn>
        <Btn className="py-3 text-base" onClick={onSkip}>
          Skip — I'll judge myself
        </Btn>
      </div>
    </Pane>
  );
}

/* ---------------- Play wrapper ---------------- */
function Play({ world, li, mode, checking, onEnableMic, onExit, onComplete, onRobotScore }) {
  const level = LEVELS[li];
  const [skipMic, setSkipMic] = useState(false);
  const isSayLevel = ["words", "sentences", "story"].includes(level.key);
  const input = skipMic ? "self" : mode;

  const wordDeck = useMemo(() => {
    if (level.key !== "words") return null;
    const mk = (arr, pos) => pick3(arr).map((x) => ({ text: x.w, emoji: x.e, pos }));
    return [...mk(world.words.start, "start"), ...mk(world.words.middle, "middle"), ...mk(world.words.end, "end")];
  }, [world.id, li]);

  const deckProps = { world, onDone: onComplete, onRobotScore, input };

  const body = (() => {
    if (level.key === "listen") return <ListenGame world={world} onDone={onComplete} />;
    if (level.key === "lab") return <LabGame world={world} onDone={onComplete} />;
    if (isSayLevel && input === "unknown")
      return <MicBanner checking={checking} onEnable={onEnableMic} onSkip={() => setSkipMic(true)} />;
    if (level.key === "words") return <SayDeck items={wordDeck} kind="words" {...deckProps} />;
    if (level.key === "sentences")
      return <SayDeck items={world.sentences.map((s) => ({ text: s }))} kind="sentences" {...deckProps} />;
    return (
      <div>
        <div className="text-center mb-3">
          <Chip color={world.color}>📖 {world.story.title}</Chip>
        </div>
        <SayDeck items={world.story.lines.map((s) => ({ text: s }))} kind="story" {...deckProps} />
      </div>
    );
  })();

  return (
    <div>
      <TopBar
        onBack={() => {
          hush();
          onExit();
        }}
        title={`${level.emoji} ${level.name}`}
        right={
          <Chip color={world.color}>
            {world.emoji} {world.sound}
          </Chip>
        }
      />
      {!canSpeak && (
        <Pane className="p-3 mb-4 text-center" color="#FFE8E8">
          <span className="font-bold text-sm" style={{ color: INK }}>
            🔇 This browser can't talk — read the words out loud together!
          </span>
        </Pane>
      )}
      {body}
    </div>
  );
}

/* ---------------- Celebrate overlay ---------------- */
function Celebrate({ world, li, stars, listen, worldDone, onNext, onMap }) {
  useEffect(() => {
    speak(worldDone ? "Amazing! You are a champion!" : "Great job!", 0.9);
  }, []);
  const hasNext = li + 1 < LEVELS.length;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: world.color + "55" }}
    >
      <Pane className="p-6 w-full max-w-sm text-center popin">
        <div className="text-7xl mb-2">{worldDone ? "🏆" : "🎉"}</div>
        <div className="font-display font-extrabold text-2xl mb-1" style={{ color: INK }}>
          {worldDone ? `${world.sound} Champion!` : "Level done!"}
        </div>
        <div className="font-display font-extrabold text-3xl mb-2" style={{ color: STAR }}>
          +{stars} ⭐
        </div>
        {listen && (
          <div className="font-bold text-base mb-2" style={{ color: INK }}>
            👂 {listen.ok} of {listen.tries} on the first try!
          </div>
        )}
        {worldDone && (
          <div className="font-bold text-base mb-2" style={{ color: INK }}>
            You finished all of {world.name} {world.emoji}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 mt-4">
          {hasNext && !worldDone && (
            <Btn color={world.color} className="py-4 text-lg" onClick={onNext}>
              Next level ▶
            </Btn>
          )}
          <Btn className="py-3 text-base" onClick={onMap}>
            {world.emoji} Back to the map
          </Btn>
        </div>
      </Pane>
    </div>
  );
}

/* ---------------- Home ---------------- */
function Home({ progress, go }) {
  const total = Object.values(progress.stars).reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-display font-extrabold text-3xl leading-none" style={{ color: INK }}>
            Sound Star
          </div>
          <div className="font-display font-extrabold text-3xl leading-tight" style={{ color: "#FF5D73" }}>
            Academy
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Chip>🔥 {progress.streak.n} day{progress.streak.n === 1 ? "" : "s"}</Chip>
          <Chip color={STAR}>⭐ {total}</Chip>
        </div>
      </div>
      <div className="font-bold text-base mb-5" style={{ color: INK, opacity: 0.7 }}>
        Pick a sound world and go!
      </div>

      <div className="space-y-4">
        {WORLDS.map((w) => {
          const doneCount = progress.done[w.id].filter(Boolean).length;
          return (
            <Btn
              key={w.id}
              color={w.color}
              className="w-full p-4 flex items-center gap-4 text-left"
              onClick={() => go({ name: "world", w: w.id })}
            >
              <span
                className="w-16 h-16 shrink-0 rounded-full border-4 flex items-center justify-center text-4xl bg-white"
                style={{ borderColor: INK }}
              >
                {w.emoji}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-xl leading-tight">{w.name}</span>
                <span className="block text-sm font-bold opacity-80">the {w.sound} sound</span>
                <span className="mt-2 flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <span
                      key={i}
                      className="w-3 h-3 rounded-full border-2"
                      style={{ borderColor: INK, background: i < doneCount ? STAR : "#FFFFFF" }}
                    />
                  ))}
                </span>
              </span>
              <span className="stk-sm bg-white px-3 py-1 font-display font-bold text-base shrink-0">
                ⭐ {progress.stars[w.id]}
              </span>
            </Btn>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-4 mt-6">
        <Btn className="py-4 text-lg" onClick={() => go({ name: "stars" })}>
          ⭐ My Stars
        </Btn>
        <Btn className="py-4 text-lg" onClick={() => go({ name: "adults" })}>
          👋 Grown-ups
        </Btn>
      </div>
    </div>
  );
}

/* ---------------- World map ---------------- */
function WorldMap({ world, progress, go }) {
  const done = progress.done[world.id];
  return (
    <div>
      <TopBar
        onBack={() => go({ name: "home" })}
        title={world.name}
        right={<Chip color={STAR}>⭐ {progress.stars[world.id]}</Chip>}
      />
      <Pane color={world.color} className="p-4 flex items-center gap-4 mb-5">
        <span className="text-6xl">{world.emoji}</span>
        <div>
          <div className="font-display font-extrabold text-2xl" style={{ color: INK }}>
            The {world.sound} sound
          </div>
          <div className="font-bold text-sm" style={{ color: INK, opacity: 0.75 }}>
            Climb all 5 levels to be the champion!
          </div>
        </div>
      </Pane>

      <div className="space-y-4">
        {LEVELS.map((lv, idx) => {
          const isDone = done[idx];
          const locked = idx > 0 && !done[idx - 1];
          const isNext = !isDone && !locked;
          return (
            <Btn
              key={lv.key}
              color={isDone ? "#FFFFFF" : locked ? "#EFEAE0" : world.color}
              className="w-full p-4 flex items-center gap-4 text-left"
              style={{ opacity: locked ? 0.6 : 1 }}
              onClick={() => !locked && go({ name: "play", w: world.id, li: idx })}
            >
              <span className={`text-4xl shrink-0 ${isNext ? "wig" : ""}`}>{locked ? "🔒" : lv.emoji}</span>
              <span className="flex-1">
                <span className="block text-lg leading-tight">
                  {idx + 1}. {lv.name}
                </span>
                <span className="block text-sm font-bold opacity-75">
                  {locked ? "Finish the level before!" : lv.hint}
                </span>
              </span>
              <span className="text-2xl shrink-0">{isDone ? "⭐" : isNext ? "▶" : ""}</span>
            </Btn>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- My Stars ---------------- */
function Stars({ progress, go, onReset }) {
  const [confirm, setConfirm] = useState(false);
  const total = Object.values(progress.stars).reduce((a, b) => a + b, 0);
  const listenOk = Object.values(progress.listen).reduce((a, b) => a + b.ok, 0);
  const worldsDone = WORLDS.filter((w) => progress.done[w.id].every(Boolean));

  const badges = [
    { e: "⭐", n: "First Star", got: total >= 1 },
    { e: "👂", n: "Super Listener", got: listenOk >= 15 },
    { e: "🔥", n: "3-Day Streak", got: progress.streak.n >= 3 },
    { e: "🌟", n: "Star Collector (50)", got: total >= 50 },
    { e: "🏆", n: "Week Streak", got: progress.streak.n >= 7 },
    ...WORLDS.map((w) => ({
      e: w.emoji,
      n: `${w.sound} Champion`,
      got: progress.done[w.id].every(Boolean),
    })),
    { e: "👑", n: "Sound Superstar", got: worldsDone.length === WORLDS.length },
  ];

  return (
    <div>
      <TopBar onBack={() => go({ name: "home" })} title="⭐ My Stars" />
      <div className="grid grid-cols-2 gap-4 mb-5">
        <Pane className="p-4 text-center">
          <div className="text-4xl">🔥</div>
          <div className="font-display font-extrabold text-2xl" style={{ color: INK }}>
            {progress.streak.n}
          </div>
          <div className="font-bold text-sm" style={{ color: INK, opacity: 0.7 }}>
            day streak
          </div>
        </Pane>
        <Pane className="p-4 text-center">
          <div className="text-4xl">⭐</div>
          <div className="font-display font-extrabold text-2xl" style={{ color: INK }}>
            {total}
          </div>
          <div className="font-bold text-sm" style={{ color: INK, opacity: 0.7 }}>
            stars earned
          </div>
        </Pane>
      </div>

      <Pane className="p-4 mb-5">
        <div className="font-display font-extrabold text-lg mb-1" style={{ color: INK }}>
          Sound worlds
        </div>
        <div className="font-bold text-xs mb-3" style={{ color: INK, opacity: 0.55 }}>
          👂 = listening first-try · 🤖 = Robot Ears average
        </div>
        <div className="space-y-3">
          {WORLDS.map((w) => {
            const l = progress.listen[w.id];
            const rb = progress.robot[w.id];
            const acc = l.tries ? Math.round((l.ok / l.tries) * 100) : null;
            return (
              <div key={w.id} className="flex items-center gap-3">
                <span className="text-2xl w-8 shrink-0">{w.emoji}</span>
                <span className="font-bold flex-1 text-sm" style={{ color: INK }}>
                  {w.sound} — {w.name}
                </span>
                {acc !== null && (
                  <span className="font-bold text-xs" style={{ color: INK, opacity: 0.6 }}>
                    👂{acc}
                  </span>
                )}
                {rb.n > 0 && (
                  <span className="font-bold text-xs" style={{ color: INK, opacity: 0.6 }}>
                    🤖{Math.round(rb.sum / rb.n)}
                  </span>
                )}
                <span className="font-display font-bold text-sm" style={{ color: INK }}>
                  ⭐ {progress.stars[w.id]}/{WORLD_MAX}
                </span>
              </div>
            );
          })}
        </div>
      </Pane>

      <Pane className="p-4 mb-5">
        <div className="font-display font-extrabold text-lg mb-3" style={{ color: INK }}>
          Badges
        </div>
        <div className="grid grid-cols-3 gap-3">
          {badges.map((b) => (
            <div
              key={b.n}
              className={`stk-sm p-2 text-center ${b.got ? "" : "grayscale"}`}
              style={{ background: b.got ? PAPER : "#F1EDE3", opacity: b.got ? 1 : 0.45 }}
            >
              <div className="text-2xl">{b.e}</div>
              <div className="font-bold text-xs leading-tight" style={{ color: INK }}>
                {b.n}
              </div>
            </div>
          ))}
        </div>
      </Pane>

      {!confirm ? (
        <Btn className="w-full py-3 text-base" onClick={() => setConfirm(true)}>
          🧹 Reset all progress
        </Btn>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Btn color="#FFB3B3" className="py-3 text-base" onClick={onReset}>
            Yes, erase it
          </Btn>
          <Btn className="py-3 text-base" onClick={() => setConfirm(false)}>
            Keep my stars
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ---------------- Grown-ups ---------------- */
function Adults({ go, progress, setRobotEars, mode, checking, onEnableMic }) {
  const robotOn = progress.settings.robotEars;
  const status =
    !robotOn
      ? { dot: "⚪", text: "Robot Ears is off — kids self-check instead." }
      : mode === "azure"
      ? { dot: "🟢", text: "Ready — real pronunciation scoring is on." }
      : mode === "record"
      ? { dot: "🟡", text: "Mic works, but the scoring service isn't reachable — using record & compare. (Deploy with the token function + Azure keys to enable scoring.)" }
      : mode === "self"
      ? { dot: "🔴", text: "No microphone access — using self-check. Tap Test microphone and choose Allow." }
      : { dot: "⚪", text: "Not tested yet on this device." };

  return (
    <div>
      <TopBar onBack={() => go({ name: "home" })} title="👋 For grown-ups" />
      <div className="space-y-4">
        <Pane className="p-4">
          <div className="font-display font-extrabold text-lg mb-1" style={{ color: INK }}>
            🎙️ Robot Ears (mic scoring)
          </div>
          <p className="font-bold text-sm leading-relaxed mb-3" style={{ color: INK }}>
            {status.dot} {status.text}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Btn
              color={robotOn ? "#37C978" : "#EFEAE0"}
              className="py-3 text-base"
              onClick={() => setRobotEars(!robotOn)}
            >
              {robotOn ? "ON ✓" : "OFF"}
            </Btn>
            <Btn className="py-3 text-base" onClick={onEnableMic} disabled={checking}>
              {checking ? "Testing…" : "Test microphone"}
            </Btn>
          </div>
          <p className="font-bold text-xs leading-relaxed mt-3" style={{ color: INK, opacity: 0.65 }}>
            Privacy: while the 🎤 button is active, audio streams to Microsoft Azure for scoring and is not
            stored by this game. Scores and stars stay on this device only. Turn Robot Ears off any time.
          </p>
        </Pane>
        <Pane className="p-4">
          <div className="font-display font-extrabold text-lg mb-1" style={{ color: INK }}>
            What this practices
          </div>
          <p className="font-bold text-sm leading-relaxed" style={{ color: INK }}>
            Six tricky sounds — R, S, L, TH, SH, CH — each climbing the same ladder speech therapists use: hear
            the sound, make the sound, say words (start / middle / end), then sentences, then a little story.
          </p>
        </Pane>
        <Pane className="p-4">
          <div className="font-display font-extrabold text-lg mb-1" style={{ color: INK }}>
            How the scoring feels to kids
          </div>
          <p className="font-bold text-sm leading-relaxed" style={{ color: INK }}>
            The robot grades just the target sound inside each word, gives 1–3 stars with a friendly tongue tip,
            and always moves on cheerfully after three tries — no failure screens, no frustration loops. Without
            a mic, kids compare their recording to the robot's and judge themselves, which is a real therapy
            skill called self-monitoring.
          </p>
        </Pane>
        <Pane className="p-4">
          <div className="font-display font-extrabold text-lg mb-1" style={{ color: INK }}>
            Tips
          </div>
          <p className="font-bold text-sm leading-relaxed" style={{ color: INK }}>
            Five to ten minutes a day beats one long session — the streak flame rewards exactly that. Sit in on
            Sound Lab the first time to check the tongue tips together. Treat robot scores as guidance, not
            verdicts — the tech isn't tuned for young voices, so your ear is still the referee.
          </p>
        </Pane>
        <Pane className="p-4" color="#FFF1D6">
          <div className="font-display font-extrabold text-lg mb-1" style={{ color: INK }}>
            One honest note
          </div>
          <p className="font-bold text-sm leading-relaxed" style={{ color: INK }}>
            R and S often aren't fully solid until age 7–8, so imperfect is normal. This game supports practice —
            it doesn't replace a speech-language pathologist. If progress stalls or frustration grows, one
            professional visit to confirm the right targets makes home practice much more effective.
          </p>
        </Pane>
      </div>
    </div>
  );
}

/* ---------------- App ---------------- */
export default function App() {
  const [view, setView] = useState({ name: "home" });
  const [progress, setProgress] = useState(loadProgress);
  const [result, setResult] = useState(null);
  const [caps, setCaps] = useState(null); // null = untested, else {mic, api}
  const [checking, setChecking] = useState(false);

  /* persist */
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(progress));
    } catch (e) {}
  }, [progress]);

  /* stop talking when screens change */
  useEffect(() => hush, [view]);

  const mode = !progress.settings.robotEars
    ? "self"
    : caps === null
    ? "unknown"
    : !caps.mic
    ? "self"
    : caps.api
    ? "azure"
    : "record";

  const requestCaps = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const c = await detectCapabilities();
      setCaps(c);
    } catch (e) {
      setCaps({ mic: false, api: false });
    }
    setChecking(false);
  };

  const go = (v) => {
    hush();
    setView(v);
  };

  const setRobotEars = (v) =>
    setProgress((p) => ({ ...p, settings: { ...p.settings, robotEars: v } }));

  const addRobotScore = (worldId) => (score) =>
    setProgress((p) => {
      const n = JSON.parse(JSON.stringify(p));
      n.robot[worldId].sum += score;
      n.robot[worldId].n += 1;
      return n;
    });

  const complete = (worldId, li, payload) => {
    hush();
    setProgress((p) => {
      const n = JSON.parse(JSON.stringify(p));
      if (!n.done[worldId][li]) n.stars[worldId] += payload.stars;
      n.done[worldId][li] = true;
      if (payload.listenTries) {
        n.listen[worldId].ok += payload.listenOk;
        n.listen[worldId].tries += payload.listenTries;
      }
      const t = new Date();
      const today = dkey(t);
      const y = new Date(t);
      y.setDate(t.getDate() - 1);
      if (n.streak.last !== today) {
        n.streak.n = n.streak.last === dkey(y) ? n.streak.n + 1 : 1;
        n.streak.last = today;
      }
      const worldDone = n.done[worldId].every(Boolean);
      setResult({
        w: worldId,
        li,
        stars: payload.stars,
        listen: payload.listenTries ? { ok: payload.listenOk, tries: payload.listenTries } : null,
        worldDone,
      });
      return n;
    });
  };

  const reset = () => {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {}
    setProgress(defaults());
    setView({ name: "home" });
  };

  const worldOf = (id) => WORLDS.find((w) => w.id === id);

  return (
    <div className="min-h-screen font-body" style={{ background: PAPER }}>
      <div className="max-w-md mx-auto px-4 py-6 pb-16">
        {view.name === "home" ? (
          <Home progress={progress} go={go} />
        ) : view.name === "world" ? (
          <WorldMap world={worldOf(view.w)} progress={progress} go={go} />
        ) : view.name === "play" ? (
          <Play
            world={worldOf(view.w)}
            li={view.li}
            mode={mode}
            checking={checking}
            onEnableMic={requestCaps}
            onExit={() => go({ name: "world", w: view.w })}
            onComplete={(payload) => complete(view.w, view.li, payload)}
            onRobotScore={addRobotScore(view.w)}
          />
        ) : view.name === "stars" ? (
          <Stars progress={progress} go={go} onReset={reset} />
        ) : (
          <Adults
            go={go}
            progress={progress}
            setRobotEars={setRobotEars}
            mode={mode}
            checking={checking}
            onEnableMic={requestCaps}
          />
        )}
      </div>

      {result && (
        <Celebrate
          world={worldOf(result.w)}
          li={result.li}
          stars={result.stars}
          listen={result.listen}
          worldDone={result.worldDone}
          onNext={() => {
            const nxt = { name: "play", w: result.w, li: result.li + 1 };
            setResult(null);
            go(nxt);
          }}
          onMap={() => {
            const w = result.w;
            setResult(null);
            go({ name: "world", w });
          }}
        />
      )}
    </div>
  );
}
