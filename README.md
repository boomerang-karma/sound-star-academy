# Sound Star Academy 🌟

A speech-sound practice game for kids (ages 6–8, solo-friendly) covering **R, S, L, TH, SH, CH**. Each sound climbs the ladder speech therapists use: listening → sound in isolation → words → sentences → story.

**Robot Ears** (the new part): the game listens through the microphone and scores pronunciation using Azure AI Speech — grading *just the target sound* inside each word (the R in "carrot", not the whole word).

---

## How the three modes work (automatic fallback)

| Mode | When | What the kid gets |
|---|---|---|
| 🟢 **Azure scoring** | Mic allowed + token function deployed | 1–3 stars per word, phoneme-targeted, with a friendly tongue tip |
| 🟡 **Record & compare** | Mic allowed, no Azure (e.g. `npm run dev`) | Hears the robot, then their own recording, judges the match |
| ⚪ **Self-check** | No mic, or Robot Ears switched off | Hear → say → self-rate (works everywhere) |

The game detects what's available and never blocks play. Grown-ups screen has the on/off toggle, a mic test, and the current status.

---

## 1. Play it locally right now (no Azure needed)

Requires [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm run dev
```

Open the printed URL. You'll get **record & compare** mode (browsers treat `localhost` as secure, so the mic works). To try it on your phone on the same Wi-Fi: `npm run dev -- --host`, then open the network URL — note the mic may be blocked there because phones require HTTPS; deploying (step 3) fixes that.

## 2. Create the Azure Speech resource (~10 min, one-time)

1. Sign up / sign in at [portal.azure.com](https://portal.azure.com) (free account is fine).
2. **Create a resource → "Speech service"** (under AI services).
3. Pick any resource group name, a **Region** near you (e.g. `eastus`), and — important — **Pricing tier: Free (F0)**. F0 gives 5 audio hours/month and cannot bill you; it simply stops at the quota. A daily 10-minute practice session records well under 1 hour/month.
4. After it deploys, open the resource → **Keys and Endpoint**. Copy **KEY 1** and the **Region** string. That's all the Azure config the game needs.

Optional seatbelt: in the Azure portal search for **Budgets** and add a $1 budget alert on your subscription.

## 3. Deploy on Azure Static Web Apps (free tier)

This hosts the game **and** the token function together, with HTTPS (which unlocks the phone microphone).

1. Push this folder to a new **GitHub** repository.
2. In the Azure portal: **Create a resource → Static Web App**.
   - Plan: **Free**
   - Source: GitHub → select your repo and branch
   - Build presets: **Custom**
     - App location: `/`
     - Api location: `api`
     - Output location: `dist`
3. Create it. Azure adds a GitHub Action that builds and deploys automatically (~2–3 min).
4. Open your Static Web App → **Settings → Environment variables** (may be labeled *Configuration*) and add:
   - `AZURE_SPEECH_KEY` = the key from step 2
   - `AZURE_SPEECH_REGION` = the region string (e.g. `eastus`)
   Save — the API restarts with the settings.
5. Open the app URL on your phone, tap **🎙 Turn on Robot Ears**, and Allow the mic. On the Grown-ups screen you should see **🟢 Ready**.

Tip: use your phone browser's **"Add to Home Screen"** so it launches like an app.

<details>
<summary>Alternative: deploy without GitHub (SWA CLI)</summary>

```bash
npm run build
npx @azure/static-web-apps-cli deploy ./dist --api-location ./api --env production
```

The CLI walks you through login and app creation, then set the two environment variables in the portal as above.
</details>

## 4. How scoring works (and how to tune it)

- We send Azure the expected text (scripted assessment). It returns accuracy **per phoneme**; `src/speech.js` averages only the target phonemes (`TARGET_PHONEMES` map — IPA plus fallbacks).
- Verdicts in `src/App.jsx` (`starsFor`): **80+** = ⭐⭐⭐, **60–79** = ⭐⭐ + coaching tip, below = hear-and-retry. After **3 tries** the game moves on cheerfully — no failure loops.
- Calibrate with your own voice first: say a word correctly, then deliberately wrong ("wabbit"), and adjust the 80/60 thresholds if needed. Scores are guidance — the tech isn't tuned for young voices.

## 5. Privacy notes for the grown-up

- Audio streams to Microsoft Azure **only while the 🎤 button is active**, solely to compute the score; this game stores no audio.
- Stars, streaks, and scores live in the browser's local storage on the device — nothing else leaves it.
- Robot Ears can be switched off any time (Grown-ups screen); the game falls back to self-check.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| Grown-ups shows 🟡 "scoring service isn't reachable" | You're on `npm run dev`, or env vars missing → set `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` in the Static Web App settings |
| 🔴 "No microphone access" | Browser permission denied → site settings → Allow microphone; must be HTTPS (or localhost) |
| "Robot Ears hiccuped" during play | Usually a network blip — the kid can self-judge and continue; check the token endpoint at `https://YOUR-APP/api/token` (should return JSON) |
| Robot voice sounds odd | It's the device's built-in text-to-speech; voices vary per phone |

## Project layout

```
├── src/
│   ├── App.jsx        # game UI + modes + verdict logic
│   ├── content.js     # all six sound worlds (edit words here!)
│   ├── speech.js      # TTS, mic, Azure assessment, record & compare
│   └── index.css      # sticker design system
├── api/
│   └── src/functions/token.js   # exchanges secret key → short-lived token
├── staticwebapp.config.json     # SWA routing + Node 20 API runtime
└── index.html
```

Adding words is easy: edit `src/content.js` — every word is `{ w: "rabbit", e: "🐰" }`.
