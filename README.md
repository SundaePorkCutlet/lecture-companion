# Lecture Companion

An experimental local capture library and Codex skill for studying a subtitled lecture with an AI partner. The collector keeps repetitive browser observations out of the model context. The agent explains new evidence and writes combined notes.

**v0.2:** ego lite + a visible subtitled player. No audio capture and no built-in model API. Accessible players use TextTrack `cuechange` or an explicit subtitle DOM selector with `MutationObserver`. A bounded event queue preserves short changes between reads. Inaccessible cross-origin players use a clearly labeled 500 ms snapshot fallback. PNG processing runs in an independent external Node process. Only stable visual changes are saved; the whole selected player image is retained.

## Run

Requires Node 22+, npm, and the `ego-browser` CLI connected to ego lite. Read the installed ego-browser skill and obtain an authorized task space and page first.

```sh
npm ci
npm test
npm run test:browser # optional: real ego tests against synthetic local players
node bin/lecture.mjs help
node bin/lecture.mjs demo --out /absolute/path/to/private-demo

# Use your existing authorized task space ID and player selector.
node bin/lecture.mjs capture --space 7 --page p1 \
  --out /absolute/path/to/private-session --duration 1800 \
  --selector 'iframe[src*="kollus.com"]'
node bin/lecture.mjs batch --out /absolute/path/to/private-session --after 0 --bytes 12000
node bin/lecture.mjs status --out /absolute/path/to/private-session
node bin/lecture.mjs stop --out /absolute/path/to/private-session
node bin/lecture.mjs export --out /absolute/path/to/private-session

# Accessible player: prefer enabled native TextTrack captions.
node bin/lecture.mjs capture --space 7 --page p1 \
  --out /absolute/path/to/another-session --selector '#player' --caption-mode event

# If captions are DOM-rendered, select that element inside the player.
node bin/lecture.mjs capture --space 7 --page p1 \
  --out /absolute/path/to/dom-session --selector '#player' \
  --caption-mode event --caption-selector '.subtitle'
```

Start/pause/speed remain in the player. The collector prints small readiness notices; it does not send anything to a model. A separate tutoring agent reads new batches. The byte limit bounds the entire serialized response, not model token usage. Keep each batch's cursor until its notes are saved, then persist the returned `nextCursor`. Oversized events return a reference that must be inspected before acknowledgment.

`--caption-mode auto` (default) tries events, then reports `fallbackReason` if snapshot capture is needed. `event` requires an accessible source; `snapshot` forces compatibility polling. The tested Fastcampus/Kollus cross-origin iframe still requires fallback. No browser security setting is changed. Enable the intended subtitle track first: among `captions`/`subtitles` tracks, the probe prefers the first showing track, then an enabled hidden track. Metadata/chapters tracks are ignored. An explicit DOM selector is used when no enabled caption track exists. Selectors are scoped to one selected player. Multiple visible iframe players are refused for screenshots.

The event queue is read and acknowledged after journaling, holds at most 2048 events, and reports `caption-overflow` rather than silently implying full coverage. It observes seeks and media end, and journals subtitle disappearance as `caption-clear`. Normal shutdown freezes and drains the source before closing it and joining slow image work. Its lease cleans up listeners after reads stop, subject to browser timer throttling. A reload can lose undrained events; document identity/source loss stops capture. DOM updates coalesced within a single browser task and rendered/burned-in video subtitles cannot be reconstructed by this adapter.

To install the Codex skill, link `skills/lecture-companion` into `~/.codex/skills/lecture-companion` (do not overwrite an existing skill). Keep the repository in place; the skill launcher imports its library. A new chat may be needed for automatic skill discovery. The launcher can be run immediately.

## Files and library

- `src/core.mjs`: caption transition deduplication and recoverable JSONL journal; bounded cursor batches.
- `src/snapshot.mjs`: player subtree extraction; captions outside the player and control labels are excluded.
- `src/caption-source.mjs`: leased TextTrack/DOM event queue, media observations, explicit snapshot fallback.
- `src/visual.mjs`: PNG comparison mask, cursor/noise suppression and stabilization; selected originals are retained.
- `src/visual-worker*.mjs`: one external Node image process with bounded work, timeout and cleanup. JSON/base64 IPC supports different Node/V8 versions.
- `src/player-frame.mjs`: screenshot bounds validation and cancellation before further browser commands.
- `src/ego-capture.mjs`: independent caption/image loops; stops on source/worker failure, writes delays and local metrics.
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

It also reports `adapter`, `fallbackReason`, `captionEventsDropped`, `maxScreenshotMs`, and `maxImageProcessingMs`. The CLI passes its standard Node executable to the external worker; direct `runCapture` calls inside ego must supply `imageNode`. At most one image is in flight. Image processing is independent of caption reads, but browser calls may still serialize and cause latency. No new lecture-wide token saving percentage is claimed for v0.2.

Journal `wallTime` is the write time. Event captions also retain browser `observedAt` and observed media time. Snapshot fallback cannot read media time, so `mediaTime` stays null; captions shorter than its observation interval can be missed. No completeness percentage is claimed. A delayed read is uncertainty, not proof of missed speech; event mode may retain those captions in its queue. Black/protected video may prevent useful screenshots; never bypass player restrictions. The bottom 20% is excluded only from comparison, so changes entirely there can still be filtered, but saved images include the entire selected player. Tiny code edits/annotations may fall below the visual threshold.

The library is MIT licensed. Lecture captions, images and generated private notes are not included in that license and should stay local. No public upload or repository publication is performed by the tool.
