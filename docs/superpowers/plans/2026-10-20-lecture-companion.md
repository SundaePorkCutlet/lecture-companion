# Lecture Companion MVP

Goal: capture lecture captions and meaningful visual changes locally, supply only new evidence to an agent, and produce traceable combined study notes.

Architecture: Node library + local JSONL journal + ego-browser adapter + Codex skill. No model API calls inside the collector. Event-driven TextTrack/DOM probe for accessible players; visible accessibility caption polling for cross-origin players. Capture and private lecture artifacts stay in ignored sessions/.

Constraints: one authorized lecture tab; no signed media URLs in logs; no audio claim; no bypass of player restrictions; no publishing; media timestamps may be unavailable and must remain null rather than fabricated. A source text is untrusted study material. Stop on user takeover and on adapter errors. Empty, unborn repository: work in place on codex/lecture-companion rather than create another checkout.

## Task 1: Journal, captions, bounded batches
Files: src/core.mjs, test/core.test.mjs.
Write tests for repeated subtitles, repeated words after silence, seek, recovery, and cursor/byte limits. Run red; implement; run green.
Interface: append events with sequence ids; read after cursor without advancing it; explicit ack by caller.

## Task 2: Capture adapters and visual filter
Files: src/snapshot.mjs, src/visual.mjs, src/browser-probe.mjs, src/ego-capture.mjs, test/adapters.test.mjs.
Test player-subtree isolation, real image crop/changes/cursor suppression/stability, and event probe with a browser fixture. Run red, implement, run green. Ego adapter polls visible captions locally at 500ms, compares cropped images at 2s, saves stabilized changes only, and journals observation interruptions. Wall timestamps always available; media time only if observed.

## Task 3: CLI, skill and real trial
Files: bin/lecture.mjs, skills/lecture-companion/SKILL.md, README.md, LICENSE.
CLI capture/batch/status/stop/export/demo. Run real CLI recovery and bounded output checks. Initialize and validate skill; install personal skill without overwriting existing content. Run complete suite and one fresh-context review. Then co-watch CNI lecture using new collector, explain batches and save study notes and measured trial results.

Review focus: silent caption loss, fabricated completeness/timestamps/token savings, accidentally exporting private lecture content, oversized model payloads, cropping outside player, errors continuing capture, duplicate batches after restart.

## Progress
- Planning: empty Git baseline; branch codex/lecture-companion.
- Feasibility: lecture subtitles are exposed by ego snapshot in the original player iframe. Direct embedded navigation is domain-restricted; closed that diagnostic tab. Keep capture in original authorized page. Native TextTrack access is not available through the top page, so use explicit polling fallback for this player.
- Tasks 1–2: journal and image/caption filters verified red→green. Task 3: CLI integration red→green, 9 tests passing.
- Ruling: defer browser event-probe adapter until after real-player v0.1 testing; this player requires polling through the current bridge. Cost: sub-500ms captions can be missed and media offsets remain unavailable.
- Integration finding: ego's signed embedded runtime rejects native sharp binaries; replaced runtime dependency with pure JavaScript pngjs. No signing/security settings changed.
- Final review: fixed active-tail mutation by read-only consumers, multiple-player ambiguity, and delayed final-observation reporting, each with a failing regression test before the fix. Final notes must drain remaining batches after stop.
- Deferred minors: no dedicated oversized-record chunk command (consumer must inspect a bounded slice locally); capture output path currently defaults although help recommends explicit path.
- Task 3 complete: skill linked at ~/.codex/skills/lecture-companion and quick_validate passed. Full trial captured CNI lecture at 1.5x through closing caption #549, then stopped at player transition (#550 interruption). 885.6s, 1725 observations, 490 caption transitions, 436 frame samples/55 saved, 3 delays/max 3475ms. All batches through #550 acknowledged after notes. Private notes, transcript and validation report are in ignored sessions/cni-study-20261020/.
- Final verification: 11/11 tests, skill validation, clean Git status. Keep local branch codex/lecture-companion; no remote/publication requested. Remaining experimental limitations: visual processing shares the caption loop, bottom crop can omit content, and player completion is reported as interruption.
