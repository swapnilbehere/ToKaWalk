# ToKaWalk

An offline-first AI walking companion for Android. Talk to Nova while you walk — hands-free, eyes-free, no internet required.

## What it does

ToKaWalk runs a full voice conversation pipeline on your phone:

**Speech → LLM → Voice response**

- **Walk Mode** — eyes-free orb UI, speak naturally, Nova responds via TTS
- **Chat Mode** — type messages, see responses as chat bubbles
- **Offline-first** — local LLM (Qwen 2.5 1.5B) runs entirely on-device
- **Online mode** — swap to Groq API for faster, smarter responses
- **Resilient** — automatic STT fallback to offline, LLM retry logic, graceful error handling

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | React Native 0.84 (New Architecture) |
| Local LLM | llama.rn — Qwen 2.5 1.5B Q4_K_M |
| Online LLM | Groq API (llama-3.1-8b-instant, streaming SSE) |
| STT | @react-native-voice/voice |
| TTS | react-native-tts |
| Storage | @op-engineering/op-sqlite |
| Navigation | React Navigation |

## Getting Started

### Prerequisites

- Node.js 18+
- Android Studio + Android SDK
- Java 17
- A physical Android device (recommended — local LLM is heavy for emulators)

### Setup

```bash
git clone https://github.com/yourusername/ToKaWalk.git
cd ToKaWalk
npm install
```

### Run (development)

```bash
# Start Metro
npm start

# In a new terminal — build and install on connected device
npx react-native run-android --device <device-id>
```

### Build standalone APK

```bash
# Bundle JS first
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res

# Build APK
cd android && ./gradlew assembleDebug
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

### Model Setup

On first launch, the app downloads the LLM model (~1.8GB) to the device. Requires wifi for initial setup. The Vosk STT model downloads automatically in the background.

### Groq API (optional)

For faster online responses:
1. Get a free API key at [console.groq.com](https://console.groq.com)
2. Open the app → Settings → paste your key
3. Toggle to Online mode

## Architecture

```
ConversationEngine (singleton)
├── STTService        — speech recognition, offline fallback, retry policy
├── LocalLLMService   — llama.rn inference, async generator streaming
├── GroqLLMService    — SSE streaming, retry + error classification
├── TTSService        — text-to-speech, token feeding
└── Storage           — SQLite sessions, turns, summaries, preferences
```

The `ConversationEngine` is a state machine (`idle → listening → processing → speaking`) shared across screens via React Context.

## Screens

- **Home** — mode picker, recent sessions
- **Walk Mode** — mic orb, voice controls, offline/online badge
- **Chat Mode** — message bubbles, typing indicator, text input
- **Session Detail** — transcript + AI summary
- **Settings** — Groq API key, LLM mode, TTS speed

## Testing

```bash
npm test
```

26 smoke tests covering the ConversationEngine pipeline.

## Notes

- First response after launch is slow (~20s) — local model loads cold
- Samsung devices fall back to Google TTS (debug builds rejected by Samsung TTS)
- Say **"Bye Nova"** to end a walk session
- New Architecture (Fabric) is enabled and cannot be disabled in RN 0.84
