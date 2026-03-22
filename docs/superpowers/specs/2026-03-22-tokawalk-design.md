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
- **Keyword:** "Hey Toka" (custom keyword)
- **Behaviour:** Passive keyword spotting only during IDLE. Activates once per session. Does not require re-triggering mid-conversation.
- **Fallback:** Tap-to-talk button available in Chat Mode for eyes-on use

### Voice Activity Detection (VAD)

- Active only during an open session (not during IDLE)
- Detects speech start/end automatically — no per-turn wake word needed
- Silence threshold: ~1.5s pause to end a user turn
- **Sensitivity setting:** tunable in Settings — higher threshold outdoors (wind/traffic guard), lower indoors
- VAD remains active while TTS is speaking to enable barge-in

### Barge-In

- User can speak over the AI mid-response at any time
- On detection: TTS stops immediately, partial AI response is kept in context
- STT captures the user's correction
- LLM receives full context including the interrupted partial response — allows natural acknowledgement ("Ah right, what I meant was...")
- **Echo handling:**
  - Earbuds (primary use case): audio in ear, not captured by mic — no echo
  - Speaker: OS-level Acoustic Echo Cancellation (AEC) active — Android `VOICE_COMMUNICATION` mode, iOS `AVAudioSession .playAndRecord`

### Session End

- Triggered by: "Bye Toka" (wake-word-style end phrase via Porcupine) or tapping the End button
- On end: full transcript finalised → LLM generates summary → both saved to SQLite → brief "Session saved ✓" toast → returns to Home screen

---

## LLM

### Local Mode (default)

- **Model:** Llama 3.2 3B
- **Runtime:** `llama.rn` (React Native bindings for llama.cpp)
- **RAM:** ~2GB — acceptable on modern Android and iOS devices
- **Network:** zero — fully offline

### Online / Enhanced Mode

- **Model:** Llama 3.1 8B via Groq API
- **Why Groq:** generous free tier (14,400 req/day, 30 req/min), LPU hardware gives near-instant response — critical for voice conversation pacing
- **Why same Llama family:** consistent reasoning patterns and response style across Local and Enhanced — the switch feels like "same AI, more power" not a personality change
- **Context handoff:** full conversation history is passed to Groq on switch — seamless mid-session transitions
- **Toggle:** visible in both Walk Mode and Chat Mode as `📴 Local` / `🌐 Online` badge, tappable at any time
- **TTS confirmation:** switching modes is spoken aloud ("Switching to Enhanced" / "Back to Local") for hands-free awareness
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
- **Streaming:** TTS speaks sentence-by-sentence as LLM tokens arrive — minimises perceived latency
- **Settings:** voice and speed configurable in Settings screen

---

## Screens

Four primary screens. Settings accessible via gear icon — not a primary screen.

### ① Home

- App title and tagline
- Mode selector (4 options, "Just Walk" pre-selected with orange border)
- "Start Walk" button
- Recent Walks list (last 2-3 sessions inline, "View all →" link)
- **No fill/hue on selected mode** — border-only selection indicator

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
- Model info: local model name, Groq model name

---

## Data Storage

- **Engine:** SQLite via `react-native-sqlite-storage`
- **Schema (simplified):**

```
sessions
  id, mode, started_at, ended_at, duration_secs, model_used

turns
  id, session_id, speaker (user|ai), text, timestamp

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

## Out of Scope (v1)

- Export/share transcripts
- Custom wake word by user
- Multilingual support
- Background session (screen fully off mid-session)
- iPad / tablet layout optimisation
- Accessibility (screen reader support) — to be revisited post-v1
