# Lecture Companion

An experimental local capture library and Codex skill for studying a subtitled lecture with an AI partner. The collector keeps repetitive browser observations out of the model context. The agent explains new evidence and writes combined notes.

**v0.6:** automatically reuse Aside's managed Node as well as Codex/ego runtimes, without a separate Node/npm installation. The PNG library is included. The lecture worker keeps processing while a separate question chat reads fresh shared context on each question. Q&A saves independently and joins the final Markdown/JSON notes. No separate model API or speech service is required. The host AI still invokes commands and decides when to explain; this library does not wake model turns.

Capture requires ego lite + a visible subtitled player. No audio capture and no built-in model API. Accessible players use TextTrack `cuechange` or an explicit subtitle DOM selector with `MutationObserver`. A bounded event queue preserves short changes between reads and records play/pause/ratechange. Inaccessible cross-origin players use a clearly labeled 500 ms snapshot fallback. PNG processing runs in an independent external Node process. Only stable visual changes are saved; the whole selected player image is retained.

## Run

Download/clone the complete repository, including `vendor/`. On macOS/Linux, the launcher first honors explicit `LECTURE_NODE`, then checks Aside's managed `~/.aside/runtime/node/bin/node` (or `$ASIDE_HOME/runtime/node/bin/node`), the local Codex bundle, ego's embedded runtime, and an existing compatible Node. Candidate Nodes must be 22+. `LECTURE_NODE` can select a runtime path returned by the host's dependency tool. The launcher never downloads or installs Node or npm packages. Aside's sandboxed browser REPL is not used as a Node interpreter, and Chrome/Aside browser capture adapters are not implemented here.

For capture, the current adapter still needs the `ego-browser` CLI connected to ego lite. Read its skill and obtain an authorized task space and page first. Study/Q&A/export commands do not control the browser. Windows users can invoke `bin/lecture.mjs` with a host-provided Node; an automatic PowerShell launcher is not included.

```sh
./bin/lecture doctor # checks the selected runtime and actual image worker
./bin/lecture help
./bin/lecture demo --out /absolute/path/to/private-demo

# Use your existing authorized task space ID and player selector.
./bin/lecture capture --space 7 --page p1 \
  --out /absolute/path/to/private-session --duration 1800 \
  --selector 'iframe[src*="kollus.com"]'
./bin/lecture batch --out /absolute/path/to/private-session --after 0 --bytes 12000
./bin/lecture status --out /absolute/path/to/private-session
./bin/lecture stop --out /absolute/path/to/private-session
./bin/lecture export --out /absolute/path/to/private-session

# Accessible player: prefer enabled native TextTrack captions.
./bin/lecture capture --space 7 --page p1 \
  --out /absolute/path/to/another-session --selector '#player' --caption-mode event

# If captions are DOM-rendered, select that element inside the player.
./bin/lecture capture --space 7 --page p1 \
  --out /absolute/path/to/dom-session --selector '#player' \
  --caption-mode event --caption-selector '.subtitle'
```

Start/pause/speed remain in the player. The collector prints small readiness notices; it does not send anything to a model. A separate tutoring agent reads new batches. The byte limit bounds the entire serialized response, not model token usage. Keep each batch's cursor until its notes are saved, then persist the returned `nextCursor`. Oversized events return a reference that must be inspected before acknowledgment.

The skill's `scripts/lecture` uses the same launcher. No `npm ci` is required to run it. Maintainers with Node can run `npm test` or `node --test test/*.test.mjs`; the optional `npm run test:browser` exercises synthetic ego players. The legacy `.mjs` entry points remain available to callers that already have a host Node path.

`--caption-mode auto` (default) tries events, then reports `fallbackReason` if snapshot capture is needed. `event` requires an accessible source; `snapshot` forces compatibility polling. The tested Fastcampus/Kollus cross-origin iframe still requires fallback. No browser security setting is changed. Enable the intended subtitle track first: among `captions`/`subtitles` tracks, the probe prefers the first showing track, then an enabled hidden track. Metadata/chapters tracks are ignored. An explicit DOM selector is used when no enabled caption track exists. Selectors are scoped to one selected player. Multiple visible iframe players are refused for screenshots.

The event queue is read and acknowledged after journaling, holds at most 2048 events, and reports `caption-overflow` rather than silently implying full coverage. It observes seeks and media end, and journals subtitle disappearance as `caption-clear`. Normal shutdown freezes and drains the source before closing it and joining slow image work. Its lease cleans up listeners after reads stop, subject to browser timer throttling. A reload can lose undrained events; document identity/source loss stops capture. DOM updates coalesced within a single browser task and rendered/burned-in video subtitles cannot be reconstructed by this adapter.

To install the Codex skill, link `skills/lecture-companion` into `~/.codex/skills/lecture-companion` (do not overwrite an existing skill). Keep the repository in place; the skill launcher imports its library. A new chat may be needed for automatic skill discovery. The launcher can be run immediately.

## Study while the lecture continues

Initialize after the collector has written its first event. Use one private output directory per lecture.

```sh
./bin/lecture study init --out /absolute/private/session
./bin/lecture study next --out /absolute/private/session --bytes 12000
# Save a JSON payload containing the receipt, items and per-event dispositions.
./bin/lecture study commit --out /absolute/private/session --file /absolute/private/commit.json

# Worker: reserve one question chat. The skill uses native host tools to
# actually create/open it, then binds the returned real thread ID.
./bin/lecture study chat --out /absolute/private/session --host codex --title 'My lecture'
./bin/lecture study chat-bind --out /absolute/private/session --file /absolute/private/chat-binding.json

# Question chat: read again for EVERY question, then save the pair.
./bin/lecture study context --out /absolute/private/session --bytes 12000
./bin/lecture study qa --out /absolute/private/session --file /absolute/private/qa.json

# Worker continues next/commit in follow mode and exports saved Q&A too.
./bin/lecture study status --out /absolute/private/session
./bin/lecture study export --out /absolute/private/session
```

See [native chat setup and Q&A payloads](skills/lecture-companion/references/question-chat.md) and [worker payloads](skills/lecture-companion/references/study-session.md) before writing JSON. `study chat` reserves a setup and produces instructions; the CLI alone does not create a chat. A bound setup is reused; an interrupted opening requires inspecting the prior attempt instead of duplicating it. The Codex path opens a dedicated native chat and does not claim to invoke the literal `/side` panel. Claude Code needs a supported full-tool session opener; `/btw` cannot read local context or save answers. If the host exposes no opener, the skill reports that manual step.

`study context` is read-only and bounded. It returns the source snapshot/hash, recent captions/frames, saved summaries, recent Q&A and uncertainty. Omitted events and items can be read with `--event ID` or `--item KEY`, using `--offset` and returned `nextOffset`. Search earlier saved items with `--query KEYWORD`; an empty query lists all items with bounded pagination (`search.nextOffset`, counting results). It never consumes the worker's receipt. `study qa` atomically saves a linked question/answer and the exact source snapshot; later capture is allowed, but evidence newer than the snapshot, invalid provenance metadata and altered journal prefixes are refused. No ongoing context messages are pushed to the question chat.

`next` persists one stable receipt without moving the committed cursor. `commit` saves records and dispositions together before moving it. Every event must be noted or explicitly reviewed with a reason. Oversized worker references must be read through `study evidence` before commit. Limits apply to the serialized JSON, default 12000 and minimum 2048 UTF-8 bytes; they are not model token budgets. Single-chat question mode remains a fallback; a separate question chat must not call `study mode question`, `next` or `commit`.

`study.json` holds worker records; `questions.json` holds the native chat binding and Q&A with its own `.questions.lock`. Capture owns `events.jsonl`. Q&A never changes the worker's mode, pending receipt or cursor and can save while `.study.lock` is held. After a hard crash verify the original command ended before manually removing its stale lock. Repeated keyed operations with the same payload return their original result. Conflicting keys and stale explicit worker `expectedRevision` values fail. A receipt returned before a mode change remains the original receipt, including its original revision; use current status for an explicit revision check.

Study state schema 2 fingerprints observed journal evidence independently of the committed cursor, including evidence used by standalone notes. Unsupported state versions fail explicitly; raw v0.2 captures can be initialized without altering their evidence. See [v0.3 validation and limitations](docs/validation/2026-10-20-v03.md).

See [v0.4 native chat validation and limitations](docs/validation/2026-10-20-v04.md) for the actual Codex chat demonstration, independent review corrections and final test results.

See [v0.5 app-runtime validation](docs/validation/2026-10-21-v05.md) for execution without PATH Node or node_modules, actual Codex/ego runtime checks and current platform limits.

See [v0.6 Aside runtime validation](docs/validation/2026-10-21-v06.md) for automatic managed-runtime discovery and execution with a genuine verified Aside Node distribution.

The default outputs are `notes.md` and `study-notes.json`. Both include saved side-chat Q&A and identify the included question revision; export again after later answers finish. Existing manual files and edited generated files are refused; choose fresh explicit `--notes`/`--json` paths. Export reservations let an interrupted export be retried without losing saved work. Exports distinguish lecture observations, explanations, corrections, Q&A, unresolved questions and capture uncertainty. Source links identify evidence events; checking a source URL is the host agent's responsibility. Nothing here proves the learner understood a concept or reconstructs unobserved speech.

## Files and library

- `src/core.mjs`: caption transition deduplication and recoverable JSONL journal; bounded cursor batches.
- `src/snapshot.mjs`: player subtree extraction; captions outside the player and control labels are excluded.
- `src/caption-source.mjs`: leased TextTrack/DOM event queue, media observations, explicit snapshot fallback.
- `src/visual.mjs`: PNG comparison mask, cursor/noise suppression and stabilization; selected originals are retained.
- `src/visual-worker*.mjs`: one external Node image process with bounded work, timeout and cleanup. JSON/base64 IPC supports different Node/V8 versions.
- `bin/lecture`, `src/host-runtime.mjs`: app runtime selection and a diagnostic check; no downloads or runtime installation.
- `src/ego-image-worker.mjs`: isolated image processing through ego's supported Node command and private local IPC, without a standalone Node binary.
- `vendor/pngjs/`: unmodified MIT runtime dependency and its license/provenance; no package installation needed.
- `src/player-frame.mjs`: screenshot bounds validation and cancellation before further browser commands.
- `src/ego-capture.mjs`: independent caption/image loops; stops on source/worker failure, writes delays and local metrics.
- `src/study-session.mjs`: follow/question/catch-up, persistent receipts, operation retries and bounded large-evidence reads.
- `src/study-store.mjs`: separate writer lock, atomic state and capture-journal fingerprints.
- `src/study-records.mjs`: evidence/record/disposition validation and safe local frame references.
- `src/question-context.mjs`: bounded fresh context and read-only evidence/item fragments.
- `src/questions-store.mjs`: independent atomic Q&A, source snapshots and retry keys.
- `src/question-chat.mjs`: native host role prompt and reserved/bound/reused chat setup.
- `src/study-export.mjs`: derived Markdown/JSON with generated-file ownership and retryable export reservations.
- `src/study-cli.mjs`: public study command routing.
- `sessions/`: ignored private records, selected screenshots, notes and status. Use a new folder per lecture.

```js
import {Journal} from './src/core.mjs';
const journal = new Journal('/absolute/private/session', {readOnly: true});
const batch = journal.batch({after: 10, maxBytes: 12000});
// Save notes, then acknowledge batch.nextCursor in your own consumer state.
```

Only one writer is allowed per capture folder. A `.capture.lock` prevents duplicate collectors. After a hard crash, first verify the old process ended, then remove its stale lock. A truncated final JSONL write is retained as `crash-tail.txt` before recovery; malformed interior records fail loudly.

## What the measurements mean

`status.json` reports observations, new caption events, sampled/saved frames, largest observation interval and raw snapshot bytes processed locally. `modelCalls` measures this collector only and is always zero. `tokenUsage` is null because tutoring runs in the host agent. Do not present raw bytes or cached tokens as money saved.

It also reports `adapter`, `fallbackReason`, `captionEventsDropped`, `maxScreenshotMs`, and `maxImageProcessingMs`. The CLI forwards the selected runtime: standalone host Node uses fork IPC; ego-only execution uses a separate ego Node process over a private Unix socket. Direct `runCapture` calls inside ego must provide either a valid host `imageNode` or `imageRuntime: {provider: 'ego', command: ABS_EGO_CLI}`. At most one image is in flight. Image processing is independent of caption reads, but browser calls may still serialize and cause latency. No new lecture-wide token saving percentage is claimed for v0.2.

Journal `wallTime` is the write time. Event captions also retain browser `observedAt` and observed media time. Snapshot fallback cannot read media time, so `mediaTime` stays null; captions shorter than its observation interval can be missed. No completeness percentage is claimed. A delayed read is uncertainty, not proof of missed speech; event mode may retain those captions in its queue. Black/protected video may prevent useful screenshots; never bypass player restrictions. The bottom 20% is excluded only from comparison, so changes entirely there can still be filtered, but saved images include the entire selected player. Tiny code edits/annotations may fall below the visual threshold.

The library is MIT licensed. Lecture captions, images and generated private notes are not included in that license and should stay local. No public upload or repository publication is performed by the tool.
