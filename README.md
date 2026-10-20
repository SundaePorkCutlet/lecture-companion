# Lecture Companion

An experimental local capture library and Codex skill for studying a subtitled lecture with an AI partner. The collector keeps repetitive browser observations out of the model context. The agent explains new evidence and writes combined notes.

**v0.1:** ego lite + a visible subtitled player. No audio capture and no built-in model API. Captions are observed through the player's accessibility subtree every 500 ms. A cropped screenshot is compared locally every 2 seconds; only stable, meaningful changes are saved. This is a compatibility fallback, not event-driven subtitle capture. TextTrack/MutationObserver adapters are future work.

## Run

Requires Node 22+, npm, and the `ego-browser` CLI connected to ego lite. Read the installed ego-browser skill and obtain an authorized task space and page first.

```sh
npm ci
npm test
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
```

Start/pause/speed remain in the player. The collector prints small readiness notices; it does not send anything to a model. A separate tutoring agent reads new batches. The byte limit bounds the entire serialized response, not model token usage. Keep each batch's cursor until its notes are saved, then persist the returned `nextCursor`. Oversized events return a reference that must be inspected before acknowledgment.

To install the Codex skill, link `skills/lecture-companion` into `~/.codex/skills/lecture-companion` (do not overwrite an existing skill). Keep the repository in place; the skill launcher imports its library. A new chat may be needed for automatic skill discovery. The launcher can be run immediately.

## Files and library

- `src/core.mjs`: caption transition deduplication and recoverable JSONL journal; bounded cursor batches.
- `src/snapshot.mjs`: player subtree extraction; captions outside the player and control labels are excluded.
- `src/visual.mjs`: pure JavaScript PNG crop and comparison, with cursor/noise suppression and stabilization.
- `src/ego-capture.mjs`: observer loop; stops on observation failure, writes delays and local metrics.
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

Wall timestamps are exact observation times. The current ego adapter cannot read media time from the cross-origin player, so `mediaTime` stays null. Captions shorter than the polling interval can be missed; no completeness percentage is claimed. A delayed observation is recorded as uncertainty, not proof of missed speech. Black/protected video may prevent useful screenshots; never bypass player restrictions. Only the top 80% of the selected player is stored, excluding subtitle/control areas but potentially omitting bottom slide content. Tiny code edits/annotations may fall below the visual threshold.

The library is MIT licensed. Lecture captions, images and generated private notes are not included in that license and should stay local. No public upload or repository publication is performed by the tool.
