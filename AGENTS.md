# Agent Instructions for ToKaWalk

## Memory and Session Tracking

Before starting non-trivial work, read:
- `docs/SHARED_MEMORY.md` — durable project context, architecture, and known gotchas
- Recent entries in `docs/SESSION_LOG.md` — ongoing work and last-known state

After each meaningful session, append a short entry to `docs/SESSION_LOG.md` using the template at the top of that file.

Only update `docs/SHARED_MEMORY.md` when:
- A durable architectural fact changes
- A new recurring gotcha is confirmed
- An open question is resolved
- A constraint is added or removed

Never store raw conversation transcripts, temporary speculation, or task-specific state in either file.

## Repository Basics

- Android-first dev. Primary device: `RZCW815CVZL` (Samsung SM-M346B, adb id).
- Build: `npx react-native run-android --device RZCW815CVZL`
- Test: `npm test`
- Lint: `npm run lint`
- TypeScript check: `npx tsc --noEmit`
- Patches auto-apply on `npm install` via postinstall (patch-package).

See `docs/SHARED_MEMORY.md` for full architecture and constraints.
