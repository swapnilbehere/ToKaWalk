# iOS/iPad Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get ToKaWalk building and running on a physical iPad with working voice pipeline (STT online-only), LLM, and background TTS.

**Architecture:** Four targeted changes — Podfile comment cleanup, Info.plist New Arch flag fix, AppDelegate audio session option, and a new `STTService.ios.ts` that Metro resolves on iOS instead of the Android-specific `STTService.ts`. Everything else (ModelManager, engine, screens, DB) already works on iOS without changes.

**Tech Stack:** React Native 0.84, Swift AppDelegate, @react-native-voice/voice v3.2.4, react-native-tts, llama.rn, react-native-fs

---

## Pre-flight: What Already Works on iOS

Before touching anything, understand what's already done:

- **`src/services/ModelManager.ts`** — already uses `Platform.OS === 'ios' ? DocumentDirectoryPath : ExternalDirectoryPath`. No change needed.
- **`ios/ToKaWalk/Info.plist`** — already has `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`, and `UIBackgroundModes: audio`. No permissions to add.
- **`ios/ToKaWalk/AppDelegate.swift`** — already configures `AVAudioSession` with `.playAndRecord`.

## Known iOS Limitation

The `@react-native-voice/voice` v3.2.4 iOS native module (`Voice.m`) does not export `isOnDeviceRecognitionAvailable` or `triggerModelDownload`, and `startSpeech` accepts no options — so there is no offline STT toggle on iOS with this library version. `STTService.ios.ts` will stub those methods safely (return `false`). STT on iOS is online-only for this port. Address in a follow-up by patching the native module.

---

## File Map

| Action | File |
|--------|------|
| Modify | `ios/Podfile` |
| Modify | `ios/ToKaWalk/Info.plist` |
| Modify | `ios/ToKaWalk/AppDelegate.swift` |
| **Create** | `src/services/stt/STTService.ios.ts` |

---

## Task 1: Podfile — Remove Stale Comment

**Files:**
- Modify: `ios/Podfile` (line 1–2)

The comment references `react-native-sqlite-storage` and `react-native-vosk`, both of which were removed. The `ENV` line stays — only the comment goes.

- [ ] **Step 1: Edit Podfile**

Replace the opening of `ios/Podfile`:

```ruby
# Disable New Architecture: react-native-sqlite-storage and react-native-vosk
# use the legacy bridge (NativeModules) and are not TurboModule-compatible.
ENV['RCT_NEW_ARCH_ENABLED'] = '0'
```

with:

```ruby
ENV['RCT_NEW_ARCH_ENABLED'] = '0'
```

- [ ] **Step 2: Run pod install**

```bash
cd ios && pod install && cd ..
```

Expected: Pods installed successfully. No errors. If you see dependency conflicts, check that `node_modules` is intact (`npm install` from repo root first).

- [ ] **Step 3: Commit**

```bash
git add ios/Podfile ios/Podfile.lock
git commit -m "chore(ios): remove stale New Arch comment from Podfile"
```

---

## Task 2: Fix New Architecture Consistency in Info.plist

**Files:**
- Modify: `ios/ToKaWalk/Info.plist`

The Podfile sets `ENV['RCT_NEW_ARCH_ENABLED'] = '0'` (disabled) but `Info.plist` has `RCTNewArchEnabled = true`. This contradiction can cause runtime bridge selection mismatches. Set them to agree.

- [ ] **Step 1: Edit Info.plist**

Find:
```xml
	<key>RCTNewArchEnabled</key>
	<true/>
```

Replace with:
```xml
	<key>RCTNewArchEnabled</key>
	<false/>
```

- [ ] **Step 2: Verify the file**

```bash
grep -A1 "RCTNewArchEnabled" ios/ToKaWalk/Info.plist
```

Expected output:
```
	<key>RCTNewArchEnabled</key>
	<false/>
```

- [ ] **Step 3: Commit**

```bash
git add ios/ToKaWalk/Info.plist
git commit -m "fix(ios): set RCTNewArchEnabled false to match Podfile"
```

---

## Task 3: AppDelegate — Add mixWithOthers to Audio Session

**Files:**
- Modify: `ios/ToKaWalk/AppDelegate.swift`

The current audio session uses `.playAndRecord` with `.voiceChat` mode, which is correct for STT+TTS. Adding `.mixWithOthers` lets the app's TTS coexist with music the user plays during a walk instead of ducking it completely.

Note: `Voice.m` also configures AVAudioSession when it starts listening (it sets `PlayAndRecord`). The AppDelegate setup runs at launch before any React Native code and sets the baseline — `Voice.m` will override the category temporarily during recording but restores it after. The `.mixWithOthers` baseline is the right default.

- [ ] **Step 1: Edit AppDelegate.swift**

Find:
```swift
    try? AVAudioSession.sharedInstance().setCategory(
      .playAndRecord,
      mode: .voiceChat,
      options: [.defaultToSpeaker, .allowBluetooth]
    )
```

Replace with:
```swift
    try? AVAudioSession.sharedInstance().setCategory(
      .playAndRecord,
      mode: .voiceChat,
      options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers]
    )
```

- [ ] **Step 2: Verify edit**

```bash
grep -A4 "setCategory" ios/ToKaWalk/AppDelegate.swift
```

Expected: options array contains `.mixWithOthers`.

- [ ] **Step 3: Commit**

```bash
git add ios/ToKaWalk/AppDelegate.swift
git commit -m "fix(ios): add mixWithOthers to audio session for background TTS"
```

---

## Task 4: Create STTService.ios.ts

**Files:**
- Create: `src/services/stt/STTService.ios.ts`

Metro resolves `STTService.ios.ts` on iOS instead of `STTService.ts`. The iOS file implements the same `STTService` class with three key differences:

1. **Error mapping** — iOS Voice errors always have `code: "recognition_fail"`. The numeric NSError code is embedded in the `message` string as `"NSCODE/description"`. Parse the message to classify the error.
2. **`isOnDeviceAvailable()`** — returns `false` (not available in this library version; always online).
3. **`triggerOnDeviceModelDownload()`** — no-op, returns `false`.
4. **`startListening()`** — no options passed (iOS `startSpeech` ignores them).

The rest of the class (init, Voice event handlers, stopListening, destroy, isListeningActive) is identical to the Android version.

- [ ] **Step 1: Create the file**

Create `src/services/stt/STTService.ios.ts` with this content:

```typescript
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
import { STTErrorInfo, STTErrorKind } from '../../types';

function getLocale(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) return locale;
  } catch {}
  return 'en-US';
}

// iOS Voice errors always have code="recognition_fail".
// The message encodes the NSError code as "NSCODE/description".
// Map the numeric NSError code to our error kind.
function mapIOSError(message: string): STTErrorKind {
  const numericCode = parseInt(message.split('/')[0] ?? '', 10);
  // Network-related NSURLError codes
  if (numericCode === -1009 || numericCode === -1001 || numericCode === -1004) {
    return 'network_error';
  }
  // Not authorized or unsupported locale
  if (numericCode === 1 || numericCode === 2) {
    return 'unavailable';
  }
  // Default: treat as no_match (retried gracefully by the engine)
  return 'no_match';
}

export class STTService {
  private listening = false;
  private resultDispatched = false;
  private onResultCb: ((text: string) => void | Promise<void>) | null = null;
  private onErrorCb: ((error: STTErrorInfo) => void) | null = null;

  init(callbacks: {
    onResult: (text: string) => void | Promise<void>;
    onError: (error: STTErrorInfo) => void;
  }): void {
    this.onResultCb = callbacks.onResult;
    this.onErrorCb = callbacks.onError;

    Voice.onSpeechResults = (event: SpeechResultsEvent) => {
      this.listening = false;
      this.resultDispatched = true;
      const text = (event.value?.[0] ?? '').trim();
      console.log('[STT][iOS] onSpeechResults:', text);
      if (text) {
        if (this.onResultCb) {
          Promise.resolve(this.onResultCb(text)).catch(e =>
            console.error('[STT][iOS] Result callback failed', e),
          );
        }
      } else {
        this.onErrorCb?.({
          kind: 'no_match',
          message: 'No speech detected',
          sawFinalResult: true,
        });
      }
    };

    Voice.onSpeechPartialResults = (event: SpeechResultsEvent) => {
      const partial = event.value?.[0] ?? '';
      if (partial) console.log('[STT][iOS] partial:', partial);
    };

    Voice.onSpeechError = (event: SpeechErrorEvent) => {
      this.listening = false;
      // iOS always sends code="recognition_fail"; numeric error is in the message.
      const message = event.error?.message ?? '';
      console.warn('[STT][iOS] onSpeechError:', { message });
      if (this.resultDispatched) {
        console.log('[STT][iOS] Suppressing post-result error');
        return;
      }
      this.onErrorCb?.({
        kind: mapIOSError(message),
        message,
        code: 'recognition_fail',
        sawFinalResult: false,
      });
    };

    Voice.onSpeechEnd = () => {
      console.log('[STT][iOS] onSpeechEnd');
      this.listening = false;
    };

    console.log('[STT][iOS] Initialized native Voice STT');
  }

  // iOS v3.2.4 does not export isOnDeviceRecognitionAvailable.
  // Offline STT is a follow-up (requires patching the native module).
  async isOnDeviceAvailable(): Promise<boolean> {
    return false;
  }

  // No model to download on iOS — recognition models ship with the OS.
  async triggerOnDeviceModelDownload(): Promise<boolean> {
    return false;
  }

  async startListening(_useOnDevice = false): Promise<void> {
    if (this.listening) {
      console.log('[STT][iOS] Already listening, skipping');
      return;
    }
    this.listening = true;
    this.resultDispatched = false;
    const locale = getLocale();
    console.log('[STT][iOS] startListening', { locale });
    try {
      // iOS startSpeech accepts only locale — options are ignored by the native module.
      await Voice.start(locale);
    } catch (error) {
      this.listening = false;
      console.error('[STT][iOS] Voice.start() failed:', error);
      try {
        await Voice.cancel();
        await new Promise(resolve => setTimeout(resolve, 100));
        await Voice.start(locale);
        this.listening = true;
      } catch (retryError) {
        console.error('[STT][iOS] Voice.start() retry failed:', retryError);
        this.onErrorCb?.({
          kind: 'client_error',
          message: retryError instanceof Error ? retryError.message : 'Failed to start STT',
          sawFinalResult: false,
        });
      }
    }
  }

  async stopListening(): Promise<void> {
    console.log('[STT][iOS] stopListening');
    this.listening = false;
    try {
      await Voice.stop();
    } catch (e) {
      console.warn('[STT][iOS] Voice.stop() failed:', e);
    }
  }

  async destroy(): Promise<void> {
    console.log('[STT][iOS] destroy');
    this.listening = false;
    try {
      await Voice.destroy();
      Voice.removeAllListeners();
    } catch (e) {
      console.warn('[STT][iOS] Voice.destroy() failed:', e);
    }
    this.onResultCb = null;
    this.onErrorCb = null;
  }

  isListeningActive(): boolean {
    return this.listening;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "STTService.ts\|LocalLLMService.ts"
```

Expected: no new errors. (The two pre-existing errors in `STTService.ts` and `LocalLLMService.ts` are Android-only and will not be present on iOS builds.)

- [ ] **Step 3: Run the test suite**

```bash
npx jest --passWithNoTests
```

Expected: 30 tests pass. (Tests use the Android `STTService.ts` mock — no iOS-specific tests needed; the interface is identical.)

- [ ] **Step 4: Commit**

```bash
git add src/services/stt/STTService.ios.ts
git commit -m "feat(ios): add STTService.ios.ts for iOS speech recognition"
```

---

## Task 5: Build and First Run on iPad

**Prerequisites:** iPad connected via USB, trusted by Mac, Xcode installed.

- [ ] **Step 1: Find the device identifier**

```bash
xcrun xctrace list devices 2>&1 | grep -v Simulator | grep -i ipad
```

Note the UDID (e.g. `00008103-001234567890ABCD`).

- [ ] **Step 2: Start Metro bundler**

In a separate terminal:
```bash
npx react-native start --reset-cache
```

- [ ] **Step 3: Build and run on device**

```bash
npx react-native run-ios --device "Your iPad Name"
```

Or with UDID:
```bash
npx react-native run-ios --udid 00008103-001234567890ABCD
```

Expected: App installs and launches on iPad. If the build fails, check the Xcode log for pod link errors before debugging JS.

- [ ] **Step 4: Smoke test checklist**

Work through these in order on the iPad:

1. **First launch** — SetupScreen appears, model download starts, progress bar advances. Wait for completion (~900 MB, time depends on connection).
2. **Home screen** — appears after download, mode picker visible.
3. **Walk mode** — tap Walk. Orb UI appears. Tap mic. Speak a sentence. Verify STT transcribes it and LLM responds via TTS (give it 10-30s for first local LLM inference).
4. **Chat mode** — tap Chat. Type a message. Verify streaming bubble appears token-by-token. Verify response completes.
5. **Background TTS** — in Walk mode, lock the iPad screen mid-response. Verify TTS audio continues playing.
6. **Groq mode** — enter a Groq API key in Settings. Toggle to Online. Verify faster responses.

- [ ] **Step 5: Log any failures**

```bash
# Stream device logs while testing
npx react-native log-ios
```

Filter for app-specific output:
```bash
npx react-native log-ios 2>&1 | grep -E "\[STT\]\[iOS\]|\[Engine\]|\[LocalLLM\]|\[Groq\]"
```

- [ ] **Step 6: Commit smoke test notes**

After testing, document what worked and what didn't in a short commit message or comment on this task. No code change needed unless a blocker is found.

---

## Follow-up Items (Out of Scope for This Port)

| Item | Notes |
|------|-------|
| iOS offline STT | Requires patching `Voice.m` to pass `requiresOnDeviceRecognition = YES` on `SFSpeechAudioBufferRecognitionRequest` and exposing it via a new JS option key |
| New Architecture on iOS | Enable in a dedicated pass once all packages are confirmed New Arch compatible |
| iPad landscape layout | UX pass, separate spec |
| Keychain for Groq API key | Security improvement; currently stored in SQLite prefs same as Android |
