# Study session command reference

Use the skill's absolute `scripts/lecture.mjs` launcher with Node 22+. Examples below use `node bin/lecture.mjs` from the repository. `SESSION` is an existing private capture directory; input JSON files should live there too. These commands do not call a model or control the player.

## Follow and commit

Run `study init --out SESSION` once after capture wrote its first event. Resume an existing `study.json` with `study status`. `study next --out SESSION --bytes 12000` provides at most one pending receipt and leaves the committed cursor unchanged. A new command process returns the same pending receipt until saved.

For a synthetic batch with start #1 and caption #2, save this JSON to a file and pass it to `study commit --out SESSION --file PATH`:

```json
{
  "key": "batch-1-notes",
  "receipt": "RECEIPT_FROM_NEXT",
  "items": [
    {"key": "concept-1", "kind": "lecture", "text": "Observed lecture point", "evidence": [2]},
    {"key": "explain-1", "kind": "explanation", "text": "Useful additional explanation", "evidence": [2]}
  ],
  "dispositions": [
    {"eventId": 1, "action": "reviewed", "reason": "Capture start marker."},
    {"eventId": 2, "action": "noted", "itemKeys": ["concept-1", "explain-1"]}
  ]
}
```

Use the actual receipt and IDs returned, never the example IDs blindly. Every provided event needs one disposition. `noted` must link to items with that event in evidence; `reviewed` needs a concrete reason. Do not mark uninspected captions reviewed just to advance. `lecture`, `explanation` and `correction` require caption/frame evidence. A correction needs a checked external source or `unverified: true`. A checked source has `url`, `title`, `verification: "checked"`; unverified references use `verification: "unverified"`. The library validates structure and links, not truth. `targetItemKey` can connect a correction to an earlier item without deleting it.

Each operation key must be stable across retries and distinct across different work. Same key + same payload returns the original result even after other commands; different content with that key fails. `expectedRevision` is optional: it checks a particular current study revision. A pending receipt keeps its original revision after mode changes, notes or evidence reads. If using an explicit revision, get the latest `study status` before saving. Without the field the command checks its loaded revision under the lock.

## Separate question chat (default when requested)

Keep the worker in follow/catch-up mode. Use [question-chat.md](question-chat.md) for `study chat`, native host creation/binding, fresh `study context` reads and independent `study qa` payloads. The question role never consumes this worker's receipt or changes its mode. `study export` merges both stores and reports the included Q&A revision.

## Single-chat questions and catch-up (fallback)

Use `study mode --out SESSION --mode question --file QUESTION_JSON`:

```json
{"key":"ask-1","question":{"key":"question-1","kind":"question","text":"Why is this necessary?","evidence":[2]}}
```

This saves the question and its captured/committed positions. In question mode `study next` returns blocked status, while capture continues. Any pending batch is preserved. Save the answer using `study note --out SESSION --file ANSWER_JSON`:

```json
{"key":"answer-1","items":[{"key":"answer-item-1","kind":"answer","questionKey":"question-1","text":"Answer with the needed explanation","evidence":[2]}]}
```

Then switch with `study mode --out SESSION --mode catch-up`, resume `study next`, and process pending/new evidence in order. `study note` does not move the capture cursor. Standalone unresolved points use kind `open-question`; standalone question records also receive the current capture positions.

Once caught up, switch explicitly to `--mode follow`. `caughtUpThrough` refers to a specific journal end at the reported time. New capture may arrive immediately afterward. Do not equate it with lecture completion or learner understanding. Seek events preserve the previous evidence; do not subtract replay positions to calculate missing study time. Unknown mediaTime stays unknown.

## Oversized evidence and frames

`omitted: true` is a reference, not dropped evidence. Read it using `study evidence --out SESSION --receipt ID --event EVENT_ID --offset 0 --bytes 12000`. The response `text` is a fragment of the JSON-serialized original event. Offsets count Unicode code points. Continue at `nextOffset` until `complete` is true; that flag means this fragment reaches the end. Commit separately verifies that every part from zero was provided, so reading only a tail cannot satisfy it. Parse the combined text if you need the original event structure.

Study payloads have a 2048-byte minimum and 12000-byte default, including JSON metadata. A smaller retry budget cannot change an existing receipt; reuse a sufficient limit. Frame paths are validated as real session-local files. View selected frames with the available image tool; a file reference does not mean you inspected the image.

## Export and recovery

`study export --out SESSION` derives `notes.md` and `study-notes.json` from saved state. Use `--notes ABS_PATH --json ABS_PATH` for fresh alternative paths. Existing manual or modified generated files are refused. An interrupted export leaves saved work and ownership intent; retry the same outputs after resolving the underlying filesystem failure. Export again to include subsequent saved work. Raw `export --out SESSION` remains separate and produces `transcript.md`.

The consumer uses `.study.lock` separately from `.capture.lock`. Do not delete either lock without verifying its original process ended. Capture journal replacement/truncation is an error to inspect, not permission to reset the committed cursor. No source reconstruction, automatic player action or token saving claim follows from these commands.
