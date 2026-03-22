# ToKaWalk — Design Spec

**Date:** 2026-03-22
**Status:** Locked

---

## Overview

ToKaWalk is a lightweight, hands-free mobile app for Android and iOS that holds voice conversations with the user while they walk. It uses an on-device LLM by default (offline, no data usage) with an optional internet-connected Enhanced mode for smarter responses. The experience is fully voice-driven — wake once, talk freely, end when done.

---

## Goals

- Zero friction to start a walk — default mode requires no setup
- Fully hands-free: wake word activation, voice activity detection, barge-in support
- Privacy-first: all data stays on device, no accounts, no cloud sync
- Lightweight: works offline, minimal battery impact when idle
- Cross-platform: single React Native codebase for Android and iOS

---

## Non-Goals

- Cloud sync or cross-device history
- User accounts or authentication
- Social features
- Custom AI personality configuration
- Always-on listening (outside of active sessions)

---

## Platform

**React Native** — single TypeScript codebase targeting Android and iOS.
Chosen for: shared codebase, strong native module ecosystem, solid LLM bindings via `llama.rn`.

---

## Architecture

Layered architecture with clear service boundaries (Approach B).

```
┌─────────────────────────────────────────────────┐
│                   UI LAYER                       │
│   Home Screen · Walk Mode · Chat Mode · History  │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│            CONVERSATION ENGINE                   │
│  Session state · Mode · Turn management          │
│  Context window · History writer                 │
└──────┬──────────┬──────────┬──────────┬─────────┘
       │          │          │          │
┌──────▼──┐ ┌────▼───┐ ┌────▼───┐ ┌───▼─────┐
│  WAKE   │ │  STT   │ │  LLM   │ │   TTS   │
│  WORD   │ │        │ │        │ │         │
│Porcupine│ │Native  │ │Local:  │ │Native   │
│"Hey     │ │OS STT  │ │llama.rn│ │OS TTS   │
│ Toka"   │ │        │ │Cloud:  │ │         │
│         │ │        │ │Groq API│ │         │
└─────────┘ └────────┘ └────────┘ └─────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│                LOCAL STORAGE                     │
│         SQLite · Transcripts · Summaries         │
│              Preferences · No cloud              │
└─────────────────────────────────────────────────┘
```

---

## Session Modes

Four session modes selectable from the Home screen. "Just Walk" is pre-selected by default.

| Mode | Intent | AI Behaviour |
|---|---|---|
| ⚡ Just Walk | General conversation, no setup | Open-ended, adaptive |
| 🧠 Brain Dump | Capture ideas to revisit later | Draws ideas out, asks clarifying questions |
| 📔 Journal | Reflect on the day | Empathetic, listens and reflects back |
| 🎓 Learn & Discuss | Deep-dive any topic | Informative, teaches and challenges |

Mode is applied as a system prompt to the LLM at session start. The same system prompt structure works for both Local and Online modes — ensuring consistent personality across both.

---

## Conversation Flow

### Lifecycle

```
IDLE (Porcupine active, low CPU)
  └─ "Hey Toka" detected
       └─ CONVERSATION MODE (VAD active)
            ├─ VAD detects user speech
            ├─ STT transcribes
            ├─ Conversation Engine appends turn, routes to LLM
            ├─ LLM streams response tokens
            ├─ TTS speaks sentence-by-sentence (low latency)
            ├─ VAD still listening → barge-in supported
            └─ "Bye Toka" or tap End
                 └─ SESSION END → summary generated → IDLE
```

### Wake Word

- **Library:** Picovoice Porcupine (React Native SDK)
- **Keyword:** "Hey Toka" (custom keyword, trained via Picovoice Console)
- **Licensing:** Porcupine AccessKey embedded in the app bundle. Free tier supports up to 3 keywords with no expiry under normal usage. Key is not user-configurable in v1.
- **Behaviour:** Passive keyword spotting only during IDLE. Activates once per session. Does not require re-triggering mid-conversation.
- **Session end phrase:** "Bye Toka" is detected via **STT phrase matching** (not a second Porcupine keyword). After each user turn is transcribed, the Conversation Engine checks if the text is a close match to "bye toka" (case-insensitive, fuzzy — e.g. "bye Toka", "goodbye Toka"). If matched, session end is triggered. This avoids the complexity of running two Porcupine keywords simultaneously.
- **False positive risk:** mitigated by requiring the phrase to appear as the entire utterance (not embedded in a longer sentence). Users who naturally say "bye" mid-conversation without "Toka" will not trigger session end.
- **Fallback:** Tap-to-talk button available in Chat Mode for eyes-on use

### Voice Activity Detection (VAD)

- Active only during an open session (not during IDLE)
- Detects speech start/end automatically — no per-turn wake word needed
- Silence threshold: ~1.5s pause to end a user turn
- **Sensitivity setting:** binary toggle in Settings — Indoor / Outdoor
  - **Indoor:** standard energy threshold (~-40 dBFS)
  - **Outdoor:** raised threshold (~-25 dBFS) to guard against wind and traffic noise
  - Default: Indoor. User can switch at any time in Settings. Active setting shown in the Settings screen but not surfaced during a walk.
- VAD remains active while TTS is speaking to enable barge-in

### Barge-In

- User can speak over the AI mid-response at any time
- On detection: TTS stops immediately; partial AI response is **flagged as `[interrupted]` in the context array** — it is stored as a turn with `status: "interrupted"` so the LLM knows what it was mid-saying
- Partial response is **persisted to the `turns` table** with `status: "interrupted"` — it is kept in the database and in LLM context
- In Chat Mode, the interrupted bubble remains visible with a trailing `…` — it is not deleted, giving the user context for what was cut off
- In the full transcript view (Session Detail), interrupted turns are shown with an `[interrupted]` label
- STT captures the user's correction as the next user turn
- LLM receives full context including the interrupted partial response — allows natural acknowledgement ("Ah right, what I meant was...")
- **Echo handling:**
  - Earbuds (primary use case): audio in ear, not captured by mic — no echo
  - Speaker: OS-level Acoustic Echo Cancellation (AEC) active — Android `VOICE_COMMUNICATION` mode, iOS `AVAudioSession .playAndRecord`

### Session End

- Triggered by: "Bye Toka" (STT phrase match, see Wake Word section) or tapping the End button
- On end: full transcript finalised → LLM generates summary (async, non-blocking) → both saved to SQLite → brief "Session saved ✓" toast → returns to Home screen
- **Summary generation:** triggered only on explicit session end (tap End or "Bye Toka"). Not triggered on app crash, backgrounding, or force-quit — those sessions will have no summary.
- **Summary timeout:** 30 seconds. If generation exceeds this or fails, an empty summary is stored and the session is still saved. Session Detail shows "Summary unavailable." No retry in v1.

---

## LLM

### Context Window & Truncation

- **Local (Llama 3.2 3B):** 4K token context window
- **Cloud (Llama 3.1 8B via Groq):** 128K token context window
- **Truncation strategy:** when the local context approaches 3,800 tokens, the oldest turns are pruned first (FIFO), keeping the system prompt and the most recent turns intact. The system prompt is never pruned.
- **No hard session length limit** in v1. Long sessions naturally self-truncate via the above strategy.

### Local Mode (default)

- **Model:** Llama 3.2 3B
- **Runtime:** `llama.rn` (React Native bindings for llama.cpp)
- **RAM:** ~2GB — acceptable on modern Android and iOS devices
- **Network:** zero — fully offline

### Online / Enhanced Mode

- **Model:** Llama 3.1 8B via Groq API
- **Why Groq:** generous free tier (14,400 req/day, 30 req/min), LPU hardware gives near-instant response — critical for voice conversation pacing
- **Why same Llama family:** consistent reasoning patterns and response style across Local and Enhanced — the switch feels like "same AI, more power" not a personality change
- **API key:** User provides their own Groq API key, entered once in Settings. Stored locally in SQLite preferences. If no key is set, the Online toggle is disabled with a prompt: "Add your Groq API key in Settings to enable Online mode."
- **Context handoff:** full conversation history is passed to Groq on switch — seamless mid-session transitions
- **Toggle:** visible in both Walk Mode and Chat Mode as `📴 Local` / `🌐 Online` badge, tappable at any time
- **Mid-turn toggle behaviour:** if the toggle is tapped while the LLM is actively generating a response, the mode switch is **queued** — the current turn completes with the current model, then the next turn uses the new mode. No response is cancelled or re-executed.
- **Error handling:** if Groq is unreachable, rate-limited, or returns an error, the app **automatically falls back to Local mode** for that turn and speaks: "Connection issue, using local mode." The badge reverts to `📴 Local`. No crash, no silent failure.
- **TTS confirmation:** the badge updates immediately on tap, then "Switching to Enhanced" is spoken. The audio confirmation plays **before** Groq connection is validated — if Groq subsequently fails on the next turn, a second spoken message plays: "Connection issue, using local mode" and the badge reverts. This keeps the toggle feeling instant while still communicating fallback clearly.
- **First-time tooltip:** one-time popover on first toggle — "Online mode connects to the internet for smarter responses" — never shown again

---

## Speech-to-Text (STT)

- **Provider:** Native OS STT on both platforms
  - Android: `SpeechRecognizer` API
  - iOS: `SFSpeechRecognizer`
- **Mode:** on-device where available, no cloud dependency for STT
- **Language:** device default language

---

## Text-to-Speech (TTS)

- **Provider:** Native OS TTS on both platforms
  - Android: `TextToSpeech` API
  - iOS: `AVSpeechSynthesizer`
- **Streaming:** TTS speaks sentence-by-sentence as LLM tokens arrive — minimises perceived latency. Sentence boundaries are detected by punctuation: `.` `?` `!` followed by whitespace or end-of-stream. A minimum of 8 tokens must accumulate before a sentence is flushed to avoid speaking fragments (handles abbreviations like "Dr." or "U.S."). Incomplete final fragments are flushed when the LLM stream ends.
- **Settings:** voice and speed configurable in Settings screen

---

## Screens

Four primary screens. Settings accessible via gear icon — not a primary screen.

### ① Home

- App title and tagline
- Mode selector (4 options, "Just Walk" pre-selected with orange border)
- "Start Walk" button
- Recent Walks list (last 3 sessions inline, sorted most-recent-first, "View all →" link to full history)
- **No fill/hue on selected mode** — border-only selection indicator
- Sessions can be deleted individually from the full history view only. No bulk delete or "clear history" in v1.

### ② Walk Mode (Eyes-Free)

- Session mode label + elapsed time (top left)
- `📴 Local` / `🌐 Online` badge (top right, tappable)
- Large mic orb with pulsing rings — visual state indicator
- Status text: "Listening..." / "Toka is speaking..." / "Thinking..."
- Three bottom controls: Chat Mode toggle · Settings · End

### ③ Chat Mode (Bubbles)

- Session mode label + elapsed time (top left)
- `📴 Local` / `🌐 Online` badge + Walk Mode toggle (top right)
- Chat bubble history (user left, Toka right in orange)
  - Speaker labels: "You" (user), "Toka" (AI)
  - No per-bubble timestamp — timestamps appear only in full transcript view
  - Interrupted AI responses shown with trailing `…` to indicate cut-off
  - Long responses wrap naturally, no truncation in bubbles
- Input bar with tap-to-talk mic button
- VAD + barge-in still active — tap is a convenience, not required

### ④ Session Detail

- Back arrow + session mode + date/duration/model used
- **Summary section first** (AI-generated, key points)
- Full transcript below (scrollable, speaker-labelled)
- Accessible from Recent Walks on Home or full history list

### Settings (gear icon)

- VAD sensitivity: Indoor / Outdoor toggle
- Default mode: which mode pre-selects on Home
- TTS voice and speed
- Online/Offline default preference
- **Groq API key:** text input, stored locally, masked after entry
- Model info: local model name, Groq model name

---

## Data Storage

- **Engine:** SQLite via `react-native-sqlite-storage`
- **Schema (simplified):**

```
sessions
  id, mode, started_at, ended_at, duration_secs, model_used

turns
  id, session_id, speaker (user|ai), text, timestamp,
  status (completed|interrupted)

summaries
  id, session_id, summary_text, generated_at
```

- **All data local to device** — no export, no sync, no accounts
- **Privacy:** mic access only during active sessions; no audio recorded, only transcribed text stored

---

## Key Technical Decisions

| Decision | Choice | Reason |
|---|---|---|
| Cross-platform | React Native | Single codebase, strong LLM bindings |
| Offline LLM | Llama 3.2 3B via llama.rn | Best quality/size tradeoff for mobile |
| Cloud LLM | Llama 3.1 8B via Groq | Free tier, fast, same model family |
| Wake word | Picovoice Porcupine | On-device, custom keyword, cross-platform |
| STT | Native OS | On-device, no cost, no cloud dependency |
| TTS | Native OS | On-device, no cost, natural voice |
| Storage | SQLite | Simple, local, no backend needed |
| History sync | None | Reduces scope; local-only is private by default |

---

## Localisation

- **UI language:** English only in v1
- **STT/TTS language:** follows device default language (OS handles this automatically)
- **LLM system prompts:** written in English. Responses may adapt to the language the user speaks in (model-dependent behaviour, not guaranteed in v1)
- Multilingual UI is explicitly out of scope for v1

---

## Out of Scope (v1)

- Export/share transcripts
- Custom wake word by user
- Multilingual UI
- Background session (screen fully off mid-session)
- iPad / tablet layout optimisation
- Accessibility (screen reader support) — to be revisited post-v1
- Bulk history deletion / clear all
- Multi-user or shared Groq API key management
