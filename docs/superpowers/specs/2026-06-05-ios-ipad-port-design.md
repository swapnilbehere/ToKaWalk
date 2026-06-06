# iOS/iPad Port — Backend Design

**Date:** 2026-06-05
**Scope:** Get ToKaWalk running on a physical iPad. Backend/infra only — no UX changes.
**Strategy:** Option B — `.ios.ts` / `.android.ts` split files for platform-divergent services. Shared logic (engine, screens, context, repositories) unchanged.

---

## Goals

- App builds and runs on a physical iPad via Xcode
- LLM model downloads on first launch to iOS Documents directory
- STT works in both online (Apple cloud) and offline (Apple on-device, iOS 17+) modes
- TTS plays while screen is locked / app is backgrounded
- New Architecture stays **disabled** on iOS (risk reduction; enable in a future pass)

---

## What Changes

### 1. File Splits

React Native resolves `.ios.ts` over `.ts` on iOS and `.android.ts` over `.ts` on Android. The base `.ts` file is renamed to `.android.ts` (no code changes). A new `.ios.ts` file implements the same exported interface with iOS-specific logic.

| File | Change |
|---|---|
| `src/services/llm/ModelManager.ts` | Rename → `ModelManager.android.ts` (no edits). Add `ModelManager.ios.ts`. |
| `src/services/stt/STTService.ts` | Rename → `STTService.android.ts` (no edits). Add `STTService.ios.ts`. |
| `src/services/tts/TTSService.ts` | No change — audio session handled natively (see AppDelegate). |
| `ios/ToKaWalk/Info.plist` | Add permissions + background audio mode. |
| `ios/ToKaWalk/AppDelegate.mm` | Add 3-line AVAudioSession setup. |
| `ios/Podfile` | Remove stale comments about disabled packages. |

No changes to: ConversationEngine, screens, navigation, context, repositories, or any test file.

---

### 2. ModelManager.ios.ts

**Purpose:** Provide the same exports as `ModelManager.android.ts` but resolve the model path to the iOS Documents directory.

**Exports (identical interface to Android):**
- `LLM_MODEL_FILENAME` — filename constant (shared value)
- `LLM_MODEL_PATH` — `{RNFS.DocumentDirectoryPath}/{filename}`
- `LLM_MODEL_DOWNLOAD_URL` — same download URL as Android
- `isModelDownloaded(): Promise<boolean>` — `RNFS.exists(LLM_MODEL_PATH)`
- `downloadModel(onProgress): Promise<void>` — `RNFS.downloadFile` to Documents directory

**Why Documents directory:** iOS sandboxes apps strictly. External storage paths don't exist. `RNFS.DocumentDirectoryPath` is the correct writable location that persists across app launches and is not purged by the OS.

---

### 3. STTService.ios.ts

**Purpose:** Implement the same `STTService` interface using iOS-appropriate APIs for the three points that differ from Android.

**`startListening(offline: boolean)`**
```
offline=false → Voice.start('en-US', {})
offline=true  → Voice.start('en-US', { iosShouldUseOfflineRecognition: true })
```
Note: verify exact option key against `@react-native-voice/voice` v3.2.4 iOS source during implementation.

**`isOnDeviceAvailable(): Promise<boolean>`**
Returns `true` if `parseInt(Platform.Version as string, 10) >= 17`. (`Platform.Version` is a string on iOS.) On-device recognition ships with iOS 17+ — no model download required.

**`triggerOnDeviceModelDownload(): Promise<boolean>`**
Returns `false`. No-op on iOS: Apple bundles recognition models with the OS.

**Online/offline toggle behaviour (unchanged):**
The engine's `switchToOfflineSTT()` calls `isOnDeviceAvailable()` → `true` on iOS 17+ → switches `sttMode` to `'offline'` → subsequent `startListening(true)` calls use on-device recognition. The Settings screen toggle and auto-fallback on network errors both work identically to Android.

**TS errors fixed:** The two pre-existing errors (`isOnDeviceRecognitionAvailable` and `triggerModelDownload` not on `RCTVoice` type) disappear because `STTService.ios.ts` uses only iOS-valid Voice API calls.

---

### 4. Info.plist

Four entries added to `ios/ToKaWalk/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>ToKaWalk uses your microphone to listen during walks.</string>

<key>NSSpeechRecognitionUsageDescription</key>
<string>ToKaWalk transcribes your speech to have a conversation while you walk.</string>

<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>

<key>AVAudioSessionCategory</key>
<string>AVAudioSessionCategoryPlayback</string>
```

`UIBackgroundModes: audio` is required for TTS to continue when the screen locks mid-walk.

---

### 5. AppDelegate.mm — Background Audio Session

Three lines added after `[super application:application didFinishLaunchingWithOptions:launchOptions]`:

```objc
[[AVAudioSession sharedInstance]
  setCategory:AVAudioSessionCategoryPlayback
  withOptions:AVAudioSessionCategoryOptionMixWithOthers
  error:nil];
[[AVAudioSession sharedInstance] setActive:YES error:nil];
```

**Why here and not in JS:** AVAudioSession category must be set before any audio plays. Setting it in AppDelegate guarantees it's configured at launch before any React Native code runs. `MixWithOthers` allows the app's TTS to coexist with background music the user may be playing.

---

### 6. Podfile

- Remove the comment block explaining why New Architecture is disabled (references deleted packages `react-native-sqlite-storage` and `react-native-vosk`)
- Keep `ENV['RCT_NEW_ARCH_ENABLED'] = '0'` — New Arch stays off for this port
- Run `pod install` after changes

---

## What Is Not Changing

- **ConversationEngine** — platform-agnostic, no changes
- **All screens** — no layout or UX changes
- **Repositories / database** — op-sqlite supports iOS unchanged
- **GroqLLMService** — network calls work identically
- **LocalLLMService** — llama.rn supports iOS; path comes from ModelManager
- **TTSService** — react-native-tts works on iOS; background audio handled natively
- **Tests** — no test changes needed; split files share the same interface

---

## Known Risks / Follow-up

| Risk | Mitigation |
|---|---|
| `iosShouldUseOfflineRecognition` option key unverified | Check v3.2.4 iOS source before implementing; fallback to always-online if unavailable |
| New Architecture disabled — some packages may behave differently | Acceptable for first run; enable New Arch in a dedicated follow-up pass |
| iPad-specific layout issues | Out of scope for this port; address in a UX pass |
| Podfile pod install failures | Run `pod install` early; resolve dependency conflicts before writing service code |

---

## Implementation Order

1. Podfile cleanup → `pod install` → verify clean build
2. Info.plist permissions
3. AppDelegate.mm audio session
4. ModelManager split (unblocks LLM on iOS)
5. STTService split (fixes TS errors, enables voice)
6. First run on iPad — smoke test voice + LLM + TTS
