# Live Study Session v0.3 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. The user approved the written design and explicitly requested implementation in this chat.

**Goal:** Preserve lecture evidence during questions and commit grounded study notes without skipping unprocessed evidence.

**Architecture:** Keep capture as the sole journal writer. Add a separately locked, atomic study state with persistent batch receipts, validated annotations and reproducible exports. Extend accessible player events and expose the flow through the CLI and existing skill.

**Tech Stack:** Node >=22, built-in fs/crypto/test, existing pngjs only.

**Spec:** ../specs/2026-10-20-study-session-v03-design.md

## Global Constraints

- Node 22+; no new product dependency or model API.
- Existing capture/batch/export commands remain compatible.
- Private sessions stay ignored; no publication, browser security changes or automatic player control.
- Minimum study payload 2048 bytes, default 12000; measure entire serialized JSON.
- Snapshot fallback keeps unknown media time/state; no audio, completeness or token-saving claims.
- Work in the existing dedicated codex/lecture-companion checkout, preserving installed skill links and private captures.

## Review Focus

- Concurrent study commands, stale revision and interrupted file replacement must never advance only the cursor.
- A question arriving with a pending receipt must preserve it across mode changes and process restarts.
- Multibyte oversized events, out-of-order chunk reads and smaller retry budgets must not bypass evidence handling.
- Journal replacement/truncation and frame symlinks must fail without altering the capture journal.
- Export interruption and manually edited notes must preserve user content and permit safe retry.

### Task 1: Durable session state and receipt lifecycle

**Files:** Create src/study-store.mjs, src/study-session.mjs, test/study-session.test.mjs.

**Interfaces:** Produce StudySession(dir): init(), status(), next({maxBytes}), setMode(mode,{question,key,expectedRevision}), commit(payload), note(payload), evidence({receipt,eventId,offset,maxBytes}). Mutations return revision; commit/note payloads accept expectedRevision and require key. A receipt is stable until committed; event dispositions cover every offered event.

- [x] Write tests for question backlog, restart/retry, revision/lock/write failure, journal identity/truncation and byte-bounded receipts; run node --test test/study-session.test.mjs and observe missing API failures.
- [x] Implement atomic state/independent locking and ordered journal identity checks. Implement question/follow/catch-up and stable receipts without cursor advancement on reads.
- [x] Run node --test test/study-session.test.mjs; expect zero failures. Commit the passing deliverable.

### Task 2: Validated annotations, large evidence and reproducible export

**Files:** Create src/study-records.mjs, src/study-export.mjs, test/study-records.test.mjs. Modify src/study-session.mjs.

**Interfaces:** Consume Task 1's atomic state and journal. Produce validated lecture/explanation/correction/question/answer/open-question records, idempotent commit/note, evidence chunk completion tracking, export({notesPath,jsonPath}). Export records ownership/content hashes before file writes so a failed derived output can be retried.

- [x] Write tests rejecting missing/invalid evidence and incomplete dispositions, preserving corrections/questions, requiring all oversized ranges, rejecting frame escape/symlink, and preserving manual notes/retrying failed exports. Run node --test test/study-records.test.mjs; expect failures for unimplemented methods.
- [x] Implement record validation and canonical operation digests. Require explicit reviewed reasons or linked noted items. Track Unicode-safe chunk ranges and original journal fingerprints.
- [x] Implement Markdown/JSON export with source IDs, observed timestamps, uncertainty events and generated-file ownership. Keep source state durable on export failure.
- [x] Run node --test test/study-session.test.mjs test/study-records.test.mjs; expect zero failures. Commit the passing deliverable.

### Task 3: Playback events, public CLI and skill workflow

**Files:** Modify src/caption-source.mjs, bin/lecture.mjs, package.json, package-lock.json, README.md, skills/lecture-companion/SKILL.md, test/probe-boundaries.test.mjs, test/browser-integration.mjs. Create src/study-cli.mjs, test/study-cli.test.mjs and a skill reference with JSON examples.

**Interfaces:** CLI study init/mode/next/evidence/commit/note/status/export delegates to StudySession. New options: mode,file,receipt,event,offset,notes,json. Caption probe adds playback events carrying observed mediaTime/paused/playbackRate through the existing acknowledged queue.

- [x] Write CLI end-to-end tests for question → answer → catch-up → commit → export and failed JSON/input handling. Add playback event assertions to the probe test. Run the tests and observe new command/event failures.
- [x] Implement CLI delegation, playback event queue entries and version 0.3.0; preserve old CLI behavior.
- [x] Update the installed linked skill only after commands work. Include the exact commit/disposition and oversized-read workflow and state that the host agent still orchestrates turns.
- [x] Run npm test, npm run test:browser, skill quick_validate and git diff --check. Expect zero failures; browser fixtures use only synthetic pages.
- [x] Obtain one independent whole-change code review, fix important findings with red→green tests, and record validation/limits. Commit final changes locally.

## Execution rulings

- The user's explicit “구현해” authorizes execution of this approved design here; do not ask for another implementation permission or stop between tasks.
- Use the existing dedicated project branch in place; creating another checkout would split the installed skill from the active implementation without a benefit for this single-writer task.
- expectedRevision may be supplied in JSON. Otherwise the command uses its loaded revision and checks it again under the write lock. Idempotent retries are recognized before the stale-revision check.
