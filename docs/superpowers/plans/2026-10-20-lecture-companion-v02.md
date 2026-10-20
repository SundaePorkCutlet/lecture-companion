# Lecture Companion v0.2 improvement plan

Goal: preserve rapid subtitle changes between reads and keep PNG processing off the caption loop.

The user approved the proposed event collector and separate image processing. Implement inline on the existing personal project branch. No browser-security changes, extension installation, audio capture, public upload, or new model API dependency.

1. Image worker: move PNG comparison/filter into one external Node process, retain the entire selected player PNG, and mask only the comparison region. Keep at most one frame in flight and enforce a timeout. Test real worker output, crash and timeout, and caption progress during a slow frame.
2. Caption source: inject a bounded, leased event queue inside an accessible selected player. Prefer native TextTrack cuechange; allow an explicit subtitle DOM selector with MutationObserver. Preserve observed media times, clear/repeated captions, seeks, end and overflow. Read then acknowledge only after journaling. Cross-origin access is unavailable through the current page bridge: auto mode must label the snapshot fallback; event-only mode must fail explicitly. Never weaken security.
3. Integrate independent image/caption loops, bounded cleanup and source errors. Update CLI/skill/docs, verify browser fixtures with actual DOM/TextTrack behavior, run regression suite and one fresh review. Keep old private lecture evidence unchanged.

Acceptance: rapid changes survive a slow consumer; caption loop advances while screenshot/worker is slow; selected images retain bottom content; supported media end is normal completion; unsupported event source is honest fallback; worker crash/loss of source stops with evidence, releasing lock.

Review focus: event queue overflow/reload, stale subtitle DOM, worker shutdown and late events, masked-region blind spots, cross-origin fallback claims, cleanup on user control.

Ruling: worker_threads passed ordinary Node tests but disconnected ego's embedded runtime. A minimal execFile probe confirmed an external standard Node process works. Use that process with the CLI's explicit Node executable; no signing/security changes. Cost: a small process/IPC overhead per session.

Completed: event source/browser fixtures, separate external image process, full-image preservation, explicit CLI modes/output directory and updated installed skill. Real browser event tests passed; the final regression suite passed 24/24. Independent review's five findings were fixed red→green, including source identity/track filtering, prompt stop/drain, cancellation and clear events. A final embedded-runtime controlled-delay run recorded 95 caption observations in 2s, max interval 58ms with 200ms screenshot delay. See [validation results](../../validation/2026-10-20-v02.md).
