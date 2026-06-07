# Session Log

Use this template for each meaningful work session:

## 2026-06-06 18:00 - iOS voice cut-off fix + Groq key security

### Goal
Fix iOS voice mode cutting off mid-sentence; move Groq API key out of plaintext SQLite into the system Keychain.

### Major Changes

#### 1. Continuous listening (`src/services/stt/STTService.ios.ts`)
**Problem:** iOS `SFSpeechRecognizer` fires `onSpeechResults` after ~1 s of silence — a natural pause mid-sentence triggers it and the fragment is dispatched immediately to the LLM.

**Fix:** Continuous listening with accumulation.
- `onSpeechResults` now appends the segment to `accumulatedText` and immediately restarts the recogniser (`restartForContinuous`, 80 ms cancel+restart cycle).
- A 1200 ms commit timer starts. Every new segment resets it.
- When 1200 ms pass without new speech → `commitAccumulated()` dispatches the full sentence.
- If the restart throws an error and accumulated text exists → commit rather than lose it.
- `stopListening()` / `destroy()` cancel the timer and clear accumulation for a clean slate.

New private fields: `accumulatedText: string`, `commitTimer`.  
New private methods: `commitAccumulated()`, `clearCommitTimer()`, `restartForContinuous()`.

#### 2. Keychain-backed API key (`src/services/storage/SecureStorage.ts` — new file)
**Problem:** `groqApiKey` was stored as plaintext in `tokawalk.db` via `INSERT OR REPLACE INTO preferences`. Readable from any unencrypted iTunes backup or jailbroken device.

**Fix:** `react-native-keychain` (v10) added. New `SecureStorage` module with:
- `getApiKey()` — reads from iOS Keychain / Android Keystore.
- `setApiKey(key)` — writes (or deletes on empty string).
- `migrateApiKeyFromSQLite(sqliteKey, clearFromDB)` — one-time migration: moves any existing plaintext key to Keychain then deletes the DB row.

#### 3. `PreferencesRepository` (`src/services/storage/PreferencesRepository.ts`)
- `groqApiKey` removed from all SQL reads/writes.
- `get()` always returns `groqApiKey: ''` (type satisfied for backwards compat; real value comes from Keychain).
- Added `clearLegacyApiKey()` to DELETE the plaintext row during migration.

#### 4. `ConversationEngineContext` (`src/context/ConversationEngineContext.tsx`)
- On startup: runs `migrateApiKeyFromSQLite` then `getApiKey()` to load the key.
- `updateGroqApiKey()` now calls `setApiKey()` (Keychain) instead of `prefsRepo.set('groqApiKey', ...)`.

#### 5. `SettingsScreen` (`src/screens/SettingsScreen.tsx`)
- Loads API key independently from Keychain via `getApiKey()` (not from `prefs`).
- Separate `apiKey` / `setApiKeyState` local state manages the input field.
- `update()` generic type tightened to `Omit<Preferences, 'groqApiKey'>` to prevent accidental SQL writes of the key.

### Files Affected
| File | Change |
|------|--------|
| `src/services/stt/STTService.ios.ts` | Continuous listening accumulation logic |
| `src/services/storage/SecureStorage.ts` | **New** — Keychain wrapper + migration helper |
| `src/services/storage/PreferencesRepository.ts` | Removed groqApiKey from SQL; added clearLegacyApiKey |
| `src/context/ConversationEngineContext.tsx` | Load key from Keychain; write via setApiKey |
| `src/screens/SettingsScreen.tsx` | Reads key from Keychain; dedicated apiKey state |
| `package.json` / `package-lock.json` | `react-native-keychain@10.0.0` added |
| `ios/Podfile.lock` / `ios/*.pbxproj` | Pods updated for react-native-keychain |

### Decisions Made
- 1200 ms commit threshold chosen: matches typical between-sentence pause without adding perceptible response latency for short sentences.
- Key stored under `service: 'com.tokawalk.apikey'`, `username: 'groq'` — distinct service name avoids collision with any future per-user credentials.
- `groqApiKey: ''` kept in `Preferences` return type to avoid cascading type changes across callers.

### Validation
- `npx tsc --noEmit` — only 3 pre-existing errors (repeat_penalty type, two Voice API stubs); no new errors.
- Pods install cleanly: 83 dependencies, 82 total pods.

### Remaining Issues
- Migration runs on every cold start until the SQLite row is gone; harmless (no-op after first run) but could be removed after a release cycle.
- `react-native-keychain` not yet mocked in test suite — tests that touch `ConversationEngineContext` will need a mock added (`__mocks__/react-native-keychain.ts`).
- 3 pre-existing TS errors unchanged.

### Memory Worth Keeping
- iOS STT mid-sentence cutoff: root cause is SFSpeechRecognizer 1 s silence timeout. Fix lives in `STTService.ios.ts` continuous-listening logic, not in the engine.
- Groq API key: now in Keychain only. Any future code touching it must go through `SecureStorage.getApiKey/setApiKey` — never SQLite.

## 2026-06-07 03:00 - Test CI hardening + 5 MEDIUM-priority fixes

### Goal
Validate all previous fixes via automated testing, harden the CI pipeline, then address the top 5 MEDIUM-priority issues from the June 6 code review.

### Major Changes

#### 1. Test infrastructure (`__mocks__/keychain.ts`, `jest.config.js`)
Added `react-native-keychain` Jest mock (in-memory store, `getGenericPassword` / `setGenericPassword` / `resetGenericPassword`) and wired it into `moduleNameMapper`. Without this, any test importing `ConversationEngineContext` would fail after the Keychain migration landed in the previous session.

#### 2. CI pipeline (`.github/workflows/test.yml`)
- Node version bumped 18 → 22 to match `engines: ">= 22.11.0"` in `package.json`.
- `actions/checkout` and `actions/setup-node` bumped v4 → v5 (Node 20 runners deprecated June 16, 2026).
- Removed stale `patches/react-native-vosk+0.2.2.patch` and `patches/react-native-zip-archive+5.0.6.patch` — packages were removed from `dependencies` but patches remained, causing `npm ci` to fail with `patch-package` errors.

#### 3. `splitIntoSentences` regex (`src/services/tts/TTSService.ts`)
**Problem:** Lookbehind `(?<=[a-z][.!?])` only matched when a lowercase letter preceded the punctuation. Sentences ending with all-caps words (e.g. "NASA.") were never split → TTS received a single long utterance.

**Fix:** Added a second fixed-length alternative `[A-Z]{2}[.!?]` (exactly 3 chars — Hermes-compatible). New regex: `/(?<=[a-z][.!?]|[A-Z]{2}[.!?])\s+/`. "U.S." still doesn't split (only 1 uppercase before each period). 3 new test cases added.

#### 4. `generateSummaryWithTimeout` always uses localLLM (`src/engine/ConversationEngine.ts`)
**Problem:** Called `this.getActiveLLM()` which returns whichever LLM is active at run time. Since it fires fire-and-forget from `endSession()`, the user may have switched modes by the time it runs. Also burns Groq quota for background work.

**Fix:** Changed to `llm.generate(summaryMessages)` (the `llm` variable already points to `this.services.localLLM`). Added early-exit guard: if `!llm.isReady()` save empty summary and return.

#### 5. `vadSensitivity` applied to STT
**Problem:** The outdoor/indoor preference was stored in SQLite and shown in Settings but never passed to the recogniser.

**Fix (iOS — `STTService.ios.ts`):** Made `CONTINUOUS_COMMIT_DELAY_MS` a private `commitDelayMs` instance field. `setVadSensitivity('outdoor')` sets it to 2000 ms; `'indoor'` resets to 1200 ms — wider window before committing accumulated speech in noisy environments.

**Fix (Android — `STTService.ts`):** Added `vadSensitivity` field. In `startListening`, merges `EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 2500` and `EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2500` into `Voice.start` opts when `'outdoor'`.

**Wiring (`ConversationEngineContext.tsx`):** `sttServiceRef` added. On init: `sttService.setVadSensitivity(prefs.vadSensitivity)`. New `updateVadSensitivity(mode)` callback calls `setVadSensitivity` + persists to SQLite. `SettingsScreen` outdoor toggle now calls `updateVadSensitivity` in addition to `update()`.

#### 6. TTS rate live update
**Problem:** TTS speed could be read from prefs but the Settings screen had no controls to change it, and any change would require an app restart.

**Fix (`TTSService.ts`):** Added `async setRate(rate: number)` method (calls `Tts.setDefaultRate(rate, false)` in try/catch, same as `init`).

**Fix (`SettingsScreen.tsx`):** TTS Speed row now has − / + `TouchableOpacity` buttons (step 0.1, clamped 0.1–2.0). Each press calls `update('ttsRate', newRate)` (SQLite) and `updateTtsRate(newRate)` (live apply).

**Wiring (`ConversationEngineContext.tsx`):** `ttsRef` added. New `updateTtsRate(rate)` callback calls `ttsRef.current?.setRate(rate)` + persists to SQLite.

#### 7. `ready` guard before `startSession` + dead `useEffect` removal
**Problem:** Both screens called `startSession` immediately on mount, before the engine had finished initialising (`ready === false`).

**Fix (`WalkModeScreen.tsx`):** Split the combined effect into two — one for the session (`ready` guard + deps) and one for the elapsed timer (empty deps, always runs). Added `ready` to destructure.

**Fix (`ChatModeScreen.tsx`):** Same `ready` guard added; `ready` added to deps. Removed dead no-op `useEffect` (`// Avoid imperative scroll churn...` with empty body on `turns` change).

### Files Affected
| File | Change |
|------|--------|
| `__mocks__/keychain.ts` | **New** — in-memory Keychain mock for Jest |
| `jest.config.js` | Added `react-native-keychain` → keychain mock |
| `.github/workflows/test.yml` | Node 22, actions v5, runs clean |
| `patches/react-native-vosk+*.patch` | **Deleted** — stale, package no longer installed |
| `patches/react-native-zip-archive+*.patch` | **Deleted** — stale, package no longer installed |
| `src/services/tts/TTSService.ts` | Fixed `splitIntoSentences` regex; added `setRate()` |
| `__tests__/services/TTSService.test.ts` | 3 new test cases for uppercase sentence endings |
| `src/engine/ConversationEngine.ts` | `generateSummaryWithTimeout` uses `localLLM` + isReady guard |
| `src/services/stt/STTService.ios.ts` | `commitDelayMs` field; `setVadSensitivity()` |
| `src/services/stt/STTService.ts` | `vadSensitivity` field; VAD opts in `startListening`; `setVadSensitivity()` |
| `src/context/ConversationEngineContext.tsx` | `ttsRef`, `sttServiceRef`, `updateTtsRate`, `updateVadSensitivity` |
| `src/screens/SettingsScreen.tsx` | TTS +/− buttons; VAD toggle wired to `updateVadSensitivity` |
| `src/screens/WalkModeScreen.tsx` | `ready` guard; split useEffect |
| `src/screens/ChatModeScreen.tsx` | `ready` guard; dead useEffect removed |

### Decisions Made
- `[A-Z]{2}[.!?]` chosen for the regex alternative (exactly 3 chars) — avoids variable-length lookbehind which Hermes may not support; handles acronyms (NASA, CEO) without splitting single-letter abbreviations (U.S.).
- Summary generation always uses localLLM regardless of current mode — avoids Groq quota burn on background work; if model not loaded, empty summary saved rather than blocking.
- VAD outdoor mode: iOS 2000 ms commit delay (vs 1200 indoor), Android 2500 ms silence extras — values chosen based on typical outdoor ambient noise that would cause sub-second false silences.
- TTS rate step 0.1, clamped [0.1, 2.0] — matches typical speech-rate UX conventions.

### Validation
- `npx jest --no-coverage`: 9/9 suites, 33/33 tests (3 new TTS cases). All green locally.
- GitHub Actions run `27082590829`: passed in ~27 s on ubuntu-latest, Node 22, actions v5.

### Remaining Issues (MEDIUM, not yet addressed)
- Unversioned DB migrations (`CREATE TABLE IF NOT EXISTS` only — no schema version tracking)
- `generateSummaryWithTimeout` uses `this.llmMode` captured at session start for the `modelUsed` column — not the same as always-localLLM for generation (minor inconsistency)

### Memory Worth Keeping
- `vadSensitivity` is now live: iOS adjusts `commitDelayMs`, Android adjusts `Voice.start` extras. Both surfaces call `sttServiceRef.current?.setVadSensitivity(mode)` via context.
- `updateTtsRate` / `updateVadSensitivity` follow the same pattern as `updateGroqApiKey`: ref-based callback in context, persist to SQLite, apply immediately to the service.

## YYYY-MM-DD HH:MM - Short Title
- Goal:
- Major Changes:
- Files/Areas Affected:
- Decisions Made:
- Validation:
- Remaining Issues:
- Memory Worth Keeping:

## 2026-03-30 13:00 - Repository baseline and memory setup
- Goal: Inspect the repository and establish concise shared memory/session tracking for future agents.
- Major Changes: Rewrote `docs/SHARED_MEMORY.md` from repo evidence; created this session log with a reusable template; left `AGENTS.md` unchanged because the required memory section already exists.
- Files/Areas Affected: `docs/SHARED_MEMORY.md`, `docs/SESSION_LOG.md`
- Decisions Made: Kept unknowns explicitly marked as needing confirmation; recorded command status based on observed execution rather than assuming success; did not modify code or generated outputs.
- Validation: Read `README.md`, `package.json`, TypeScript/Jest/Metro/Babel/ESLint config, app entrypoints, engine/context/services, and repo structure. Ran `npm test`, `npm test -- --runInBand --watchman=false`, `npm run lint`, and `npx tsc --noEmit`.
- Remaining Issues: Default `npm test` hits a Watchman permission error in this environment; Jest still fails on `react-native-sse` ESM parsing; ESLint currently reports hook/unused-variable issues; TypeScript currently fails because tests reference removed `wakeWord` service wiring.
- Memory Worth Keeping: Root README is stale boilerplate; the conversation engine is a singleton provider-backed integration point; build/generated folders and a dirty worktree are present, so future agents should avoid editing or reverting unrelated files.

## 2026-03-30 13:10 - Test harness foundation slice
- Goal: Remove two immediate test infrastructure blockers so future agent work can validate changes more reliably.
- Major Changes: Added a Jest mock for `react-native-sse`; wired it into Jest config; updated the Groq service tests to match the current SSE-based implementation; removed stale `wakeWord` wiring from the engine test.
- Files/Areas Affected: `__mocks__/reactNativeSse.ts`, `jest.config.js`, `__tests__/services/GroqLLMService.test.ts`, `__tests__/engine/ConversationEngine.test.ts`, `docs/SESSION_LOG.md`
- Decisions Made: Chose mocking over Jest transform changes for `react-native-sse` because the goal was a small, stable test harness step; limited the slice to a few files and stopped before lint-related source fixes.
- Validation: `npx tsc --noEmit` now passes. `npm test -- --runInBand --watchman=false` now runs all 8 suites and all 26 tests pass, but Jest still exits non-zero because of async teardown/logging issues in app and screen tests.
- Remaining Issues: Lint failures remain in app source; Jest still has post-test async cleanup/logging problems in `App.test.tsx`-related screen flows and a mocked `react-native-tts` initialization mismatch.
- Memory Worth Keeping: The Groq service now expects SSE-style tests, not fetch-style tests; stale test doubles can drift quickly when service boundaries change.

## 2026-03-30 13:18 - Jest teardown stabilization
- Goal: Clear the remaining Jest exit failure after the SSE and TypeScript test-harness fixes.
- Major Changes: Added `getInitStatus` to the TTS mock and updated the app test to mount, drain timers, and unmount explicitly inside `act(...)`.
- Files/Areas Affected: `__mocks__/tts.ts`, `__tests__/App.test.tsx`, `docs/SESSION_LOG.md`
- Decisions Made: Fixed the failure in test code and mocks instead of changing runtime screens/provider code, because the observed issue was test teardown ownership.
- Validation: `npm test -- --runInBand --watchman=false` passes with 8/8 suites and 26/26 tests. Existing `HomeScreen` act warnings still print, but Jest exits successfully.
- Remaining Issues: Default `npm test` still needs Watchman-disabled execution in this environment; lint failures remain in source files.
- Memory Worth Keeping: When rendering the full app in tests, explicit timer draining and unmounting are needed to keep screen/provider cleanup from leaking past test completion.

## 2026-03-30 13:22 - HomeScreen test async cleanup
- Goal: Remove the remaining `act(...)` warnings coming from `HomeScreen` test setup.
- Major Changes: Updated the `HomeScreen` tests to wait for async effect-driven state hydration before asserting and interacting.
- Files/Areas Affected: `__tests__/screens/HomeScreen.test.tsx`, `docs/SESSION_LOG.md`
- Decisions Made: Kept the fix in test code instead of changing `HomeScreen`, because the warning came from unawaited test timing rather than incorrect runtime behavior.
- Validation: `npm test -- --runInBand --watchman=false` passes with 8/8 suites and 26/26 tests, and the previous `HomeScreen` act warnings no longer appear.
- Remaining Issues: Default `npm test` still needs a Watchman workaround in this environment; lint failures in app source are still open.
- Memory Worth Keeping: Async screen initialization in tests should be awaited explicitly, even when the UI appears synchronously.

## 2026-03-30 13:30 - Lint error cleanup
- Goal: Clear the remaining ESLint errors without broad runtime changes.
- Major Changes: Fixed hook dependency/unused-binding issues in chat, walk, and mic UI files so ESLint now exits successfully.
- Files/Areas Affected: `src/screens/ChatModeScreen.tsx`, `src/screens/WalkModeScreen.tsx`, `src/components/MicOrb.tsx`, `docs/SESSION_LOG.md`
- Decisions Made: Used minimal dependency-list and destructuring fixes rather than larger refactors; left warnings untouched because the current slice was focused on blockers.
- Validation: `npm run lint` now passes. Remaining output is warnings only in `App.tsx` and `src/services/tts/TTSService.ts`.
- Remaining Issues: `npm test` still needs `--watchman=false` in this environment; lint warnings remain; no full post-lint test rerun was done in this session slice.
- Memory Worth Keeping: The recent lint blockers were straightforward hook dependency drift rather than deeper architecture issues.

## 2026-03-30 13:36 - Lint warning cleanup
- Goal: Clear the remaining ESLint warnings with minimal risk.
- Major Changes: Moved the root app container style in `App.tsx` into a stylesheet and removed the two `no-void` warning sites in `src/services/tts/TTSService.ts`.
- Files/Areas Affected: `App.tsx`, `src/services/tts/TTSService.ts`, `docs/SESSION_LOG.md`
- Decisions Made: Kept changes behavior-preserving and limited to lint-warning cleanup only.
- Validation: `npm run lint` now passes with no output.
- Remaining Issues: `npm test` still needs `--watchman=false` in this environment; no fresh full test rerun was done after this warning-only slice.
- Memory Worth Keeping: The last lint warnings were cleanup-level issues, not signs of deeper runtime problems.

## 2026-03-30 13:40 - Full validation checkpoint
- Goal: Re-verify the repository after the recent test and lint cleanup slices.
- Major Changes: No code changes in this step; ran the main validation commands and confirmed the current state.
- Files/Areas Affected: `docs/SESSION_LOG.md`
- Decisions Made: Used `npm test -- --runInBand --watchman=false` instead of plain `npm test` because Watchman permissions are still unreliable in this environment.
- Validation: `npx tsc --noEmit` passed; `npm test -- --runInBand --watchman=false` passed with 8/8 suites and 26/26 tests; `npm run lint` passed.
- Remaining Issues: Plain `npm test` may still fail locally because of Watchman permissions; Jest output still includes expected console logs from mocked error-path tests.
- Memory Worth Keeping: For this workspace, `--watchman=false` remains the reliable Jest invocation.

## 2026-03-30 13:50 - On-device STT and handsfree validation
- Goal: Validate the connected Android device path and fix the WalkMode voice-loop regressions seen only on hardware.
- Major Changes: Stabilized `startSession` callback identity in `ConversationEngineContext` to stop duplicate voice-session starts; updated `STTService` to accept plain-text Vosk `onResult` payloads and stop the recognizer after final results so restart can succeed cleanly.
- Files/Areas Affected: `src/context/ConversationEngineContext.tsx`, `src/services/stt/STTService.ts`, `docs/SESSION_LOG.md`
- Decisions Made: Fixed the repeated session-start issue at the provider boundary instead of adding per-screen guards; treated raw Vosk results as either plain text or JSON because device logs showed both shapes.
- Validation: `npx tsc --noEmit` passed; `npm test -- --runInBand --watchman=false` passed; `npm run lint` passed; physical-device testing on `RZCW815CVZL` confirmed clean WalkMode/handsfree turns with STT -> Groq -> TTS -> STT restart and no more `Recognizer is already in use` or parse-failure loops.
- Remaining Issues: Plain `npm test` still depends on a Watchman workaround in this environment; logs remain noisy with repeated `speaking -> speaking` state transitions; a historical `react-native-screens` fragment-restore crash exists in older logs but was not reproduced in the current validated run.
- Memory Worth Keeping: On device, `react-native-vosk` can emit plain text from `onResult`, not just JSON; stable context callbacks matter for screen effects that start sessions; the physical Android voice loop is currently working with online Groq + TTS.

## 2026-03-30 14:00 - Offline handsfree validation
- Goal: Confirm that the physical-device handsfree loop also works with the local/offline LLM path.
- Major Changes: No code changes in this step; switched the app to local mode on the connected device and validated repeated WalkMode turns through STT, LocalLLM, and TTS.
- Files/Areas Affected: `docs/SESSION_LOG.md`
- Decisions Made: Treated this as a runtime validation checkpoint rather than a code-change step because the main question was whether offline handsfree already worked after the STT/session fixes.
- Validation: Device logs on `RZCW815CVZL` showed `llmMode: 'local'`, `activeLLM: 'LocalLLMService'`, successful `[LocalLLM] Starting completion`, TTS playback, and STT restart across multiple turns without parse failures, degraded mode, or recognizer-in-use errors.
- Remaining Issues: Log output still contains many repeated `speaking -> speaking` state transitions; plain `npm test` still needs the Watchman workaround in this environment.
- Memory Worth Keeping: Offline handsfree mode is currently functioning on the connected Android device with the local model path.

## 2026-03-30 14:15 - Setup copy cleanup
- Goal: Correct inaccurate setup copy while leaving runtime behavior unchanged.
- Major Changes: Renamed the Vosk setup label from `Wake word model` to `Speech recognition model` in the first-launch setup screen.
- Files/Areas Affected: `src/screens/SetupScreen.tsx`, `docs/SESSION_LOG.md`
- Decisions Made: Limited this slice to copy cleanup only; deferred any larger-model STT accuracy change because it requires a product/runtime tradeoff rather than a small safe patch.
- Validation: `npm run lint` passed.
- Remaining Issues: STT accuracy is still constrained by the current small Vosk model; mode persistence still needs a clearer repro if it is still suspected.
- Memory Worth Keeping: The current Vosk asset is used for full speech recognition, not wake-word detection, so setup/UI copy should reflect STT rather than wake-word behavior.

## 2026-03-30 14:25 - Medium Vosk model swap
- Goal: Improve STT accuracy without jumping straight to the highest-memory Vosk model.
- Major Changes: Swapped the hardcoded Vosk download/path from `vosk-model-small-en-us-0.15` to `vosk-model-en-us-0.22-lgraph` and updated setup UI size text from `~40 MB` to `~128 MB`.
- Files/Areas Affected: `src/services/ModelManager.ts`, `src/screens/SetupScreen.tsx`, `docs/SESSION_LOG.md`
- Decisions Made: Chose the `0.22-lgraph` model as the first accuracy upgrade because it is materially larger than the mobile-small model but much less risky for RAM than the full `1.8G` `vosk-model-en-us-0.22`.
- Validation: `npx tsc --noEmit` passed; `npm run lint` passed.
- Remaining Issues: Device re-download and runtime validation are still pending; offline handsfree remains the main memory-risk path because Vosk and the local GGUF model share one process.
- Memory Worth Keeping: The medium `128M` Vosk model is the current compromise between STT accuracy and Android RAM pressure.

## 2026-03-30 15:05 - Full Vosk experiment reverted
- Goal: Test whether the full `vosk-model-en-us-0.22` materially improves STT enough to justify its mobile cost, then revert if it does not.
- Major Changes: Temporarily swapped the speech model to `vosk-model-en-us-0.22`, triggered a fresh `~1.8 GB` download on device, observed the runtime, and then reverted the repo back to `vosk-model-small-en-us-0.15` with the setup size text restored to `~40 MB`.
- Files/Areas Affected: `src/services/ModelManager.ts`, `src/screens/SetupScreen.tsx`, `docs/SESSION_LOG.md`
- Decisions Made: Abandoned the full-model path because the device run combined full Vosk with local Qwen in one process, recognition quality did not justify the cost, and the app process later disappeared without a normal crash signature, consistent with memory-pressure kill risk.
- Validation: `npx tsc --noEmit` passed; `npm run lint` passed; device logs confirmed the full Vosk model loaded from `vosk-model-en-us-0.22`, local `RNLlama` initialized in the same run, and the process later died with no `AndroidRuntime`/fatal-signal crash line and no remaining `pidof com.tokawalk`.
- Remaining Issues: The device still needs to be reset back onto the small-model download path; STT accuracy remains an open product problem, but full `vosk-model-en-us-0.22` is not a safe solution for the current mobile architecture.
- Memory Worth Keeping: In this app architecture, full `vosk-model-en-us-0.22` is too risky on-device, especially for offline handsfree where Vosk and the local GGUF model share one process.

## 2026-04-01 19:00 - Device validation + Groq API key fix

- Goal: Run all three pending device validation tests and fix any blockers found.
- Major Changes: Added `setApiKey()` to `GroqLLMService`; added `groqLLMRef` and `updateGroqApiKey()` to `ConversationEngineContext`; updated `SettingsScreen` to call `updateGroqApiKey()` instead of writing to prefs directly for the API key field.
- Files/Areas Affected: `src/services/llm/GroqLLMService.ts`, `src/context/ConversationEngineContext.tsx`, `src/screens/SettingsScreen.tsx`, `docs/SHARED_MEMORY.md`, `codex_read.md`, `docs/SESSION_LOG.md`
- Decisions Made: Root cause of `onlineReady: false` was that `GroqLLMService` is a singleton constructed at startup — saving the key to SQLite in Settings never reached the running instance. Fixed by threading the update through the context layer.
- Validation: All three device tests passed on `RZCW815CVZL`: chat no crash (local LLM), online mode Groq response (~1s), walk mode STT→Groq→TTS→STT loop clean. `npx tsc --noEmit` passes.
- Remaining Issues: STT accuracy poor with small Vosk model. Wake word unimplemented (`WakeWordService.ts` deleted). Mode persistence on cold restart not yet re-verified.
- Memory Worth Keeping: Any future code that touches the Groq API key must go through `updateGroqApiKey()` from context — not direct prefs writes.

## 2026-04-01 09:00 - Memory docs sync
- Goal: Bring shared memory in line with the latest confirmed device findings and reverted model experiments.
- Major Changes: Updated shared memory to reflect that the small Vosk model remains the baseline, the `0.22-lgraph` model regressed recognition on the tested device, and the full `0.22` model is too risky for the current offline memory profile.
- Files/Areas Affected: `docs/SHARED_MEMORY.md`, `docs/SESSION_LOG.md`
- Decisions Made: Promoted only durable outcomes from the model experiments and left unresolved runtime questions explicitly marked as needing confirmation.
- Validation: Documentation-only update based on the already logged device experiments and local repo state.
- Remaining Issues: Device still needs to be reset back onto the restored small-model path; STT accuracy and mode-persistence behavior remain open.
- Memory Worth Keeping: For this repository and tested Samsung device, Vosk model upgrades are not interchangeable; both accuracy and memory behavior must be validated on hardware.
