# ToKaWalk — Shared Memory

> Durable project context for future agent work.
> Last updated: 2026-04-01

## Project Overview

ToKaWalk is a React Native mobile app with Android and iOS folders present. The current app flow is Android-first and centers on:
- first-run permission and model setup
- local SQLite-backed session storage
- a singleton conversation engine
- two conversation entry modes: voice (`WalkMode`) and text (`ChatMode`)

Confirmed on the connected Android device: both online handsfree (`Groq` + TTS) and offline handsfree (`LocalLLM` + TTS) function in WalkMode with the current STT/session fixes when using the small Vosk model.

The root `README.md` is still the default React Native template and does not describe the app-specific product or workflow.

## Architecture

- `App.tsx` initializes SQLite with `initDatabase()` and gates the UI on `useModelSetup()`.
- `src/hooks/useModelSetup.ts` requests permissions, checks for model files, and downloads Vosk and GGUF assets when missing.
- `src/navigation/AppNavigator.tsx` wraps the app in `ConversationEngineProvider` and mounts the main screens.
- `src/context/ConversationEngineContext.tsx` owns a single `ConversationEngine` instance for the app lifetime.
- `src/engine/ConversationEngine.ts` coordinates STT, TTS, LLM selection, session persistence, and summary generation.
- `src/engine/ContextManager.ts` builds/prunes LLM message history and injects a mode-specific system prompt.
- `src/services/stt/STTService.ts` wraps `react-native-vosk`.
- `src/services/tts/TTSService.ts` wraps `react-native-tts`.
- `src/services/llm/LocalLLMService.ts` wraps `llama.rn`.
- `src/services/llm/GroqLLMService.ts` streams online completions through `react-native-sse`.
- `src/services/storage/database.ts` creates SQLite tables directly with inline migrations.

## Important Directories

- `src/components` UI primitives and shared components.
- `src/constants` prompts, colors, and app constants.
- `src/context` singleton provider for the conversation engine.
- `src/engine` orchestration logic for sessions and prompt context.
- `src/hooks` setup and engine-related hooks.
- `src/navigation` React Navigation stack setup.
- `src/screens` app screens including setup, home, walk, chat, history, settings, and session detail.
- `src/services` native/service integrations: model management, permissions, STT, TTS, LLM, and SQLite repositories.
- `src/types` shared TypeScript types.
- `__tests__` Jest tests.
- `__mocks__` Jest mocks for native modules.
- `patches` `patch-package` overrides applied on `npm install`.
- `android` native Android project.
- `ios` native iOS project.
- `docs` agent memory and design/planning notes.

## Commands That Work

Discovered repo commands and observed status on 2026-03-30:

- `npm start` exists in `package.json`. Needs confirmation.
- `npm run android` exists in `package.json`. Needs confirmation.
- `npm run ios` exists in `package.json`. Needs confirmation.
- `npm test` exists but failed in this environment because Jest tried to use Watchman and hit a permissions error.
- `npm test -- --runInBand --watchman=false` passes reliably in this environment.
- `npm run lint` passes.
- `npx tsc --noEmit` passes.
- `npx react-native run-android --device RZCW815CVZL --no-packager` builds and installs to the connected Samsung device.
- `adb -s RZCW815CVZL reverse tcp:8081 tcp:8081` plus `npm start` allows the physical device to load the Metro bundle.

## Constraints and Guardrails

- Keep documentation grounded in repository evidence. Mark unknowns explicitly.
- Do not edit generated/build outputs such as `node_modules`, `android/.gradle`, `android/build`, `ios/Pods`, or `ios/build`.
- `patch-package` is wired through `postinstall`; dependency changes can invalidate local patches.
- Model setup depends on runtime permissions plus network downloads via `react-native-fs` and `react-native-zip-archive`.
- The app currently assumes database initialization completes before the main navigator is shown.
- The conversation engine is provided from a single React context instance; new work should not create competing engine instances without confirming the intended lifecycle.

## Fragile Areas

- `src/context/ConversationEngineContext.tsx`
  Single engine lifecycle, preference bootstrapping, and service wiring all meet here.
- `src/engine/ConversationEngine.ts`
  Controls session state, STT restart policy, mode switching, persistence, and summary timing.
- `src/services/stt/STTService.ts`
  Depends on native Vosk lifecycle and listener ordering.
- `src/services/tts/TTSService.ts`
  Buffers streamed tokens into utterances and tracks async idle state.
- `src/services/llm/LocalLLMService.ts`
  Manages native model loading and token streaming from `llama.rn`.
- `src/services/llm/GroqLLMService.ts`
  Depends on SSE streaming and currently exposes test configuration gaps.
- `src/services/storage/database.ts`
  Schema changes are inline and affect all persisted history/preferences data.
- `patches`
  High impact because package reinstall or version bumps can silently break local native behavior.

## Recurring Gotchas

- `README.md` is generic React Native boilerplate; do not treat it as product documentation.
- The repo is currently dirty. Avoid reverting unrelated user changes while doing doc or code work.
- Jest’s default Watchman path is not reliable in this environment; disable Watchman when validating tests here.
- `react-native-vosk` can emit plain text from `onResult`, not only JSON payloads.
- Physical-device debug flow needs Metro plus `adb reverse tcp:8081 tcp:8081`; without that, the device reports `Cannot connect to Metro`.
- Session-start callbacks exposed from context must stay stable; otherwise screen effects can retrigger `startSession(...)` and create duplicate voice sessions on hardware.
- The small Vosk model remains the current baseline. On the tested Samsung device, `vosk-model-en-us-0.22-lgraph` produced materially worse recognition, and full `vosk-model-en-us-0.22` was too risky for memory when combined with the local Qwen model.
- `GroqLLMService` is constructed once at startup. Any code that saves the Groq API key must call `updateGroqApiKey()` from the engine context — writing to SQLite alone does not update the running instance.

## Open Questions

- Confirm the intended primary platform: repo instructions say Android-first, but iOS native files and Pods are also present.
- Confirm whether online LLM mode through Groq is considered production-ready or still experimental.
- Confirm whether generated directories under `android/` and `ios/` should be gitignored more aggressively. Current tree includes generated/build artifacts.
- Needs confirmation: the historical `react-native-screens` fragment-restore crash seen in older device logs may already be obsolete, since it was not reproduced during the current validated run.
- Device is confirmed back on `vosk-model-small-en-us-0.15` — observed in device logs on 2026-04-01.
- Mode persistence after full app restart needs re-verification now that the Groq API key propagation bug is fixed.
