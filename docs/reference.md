# Lecture Companion

For first-time use, see the [English guide](../README.md) or [한국어 안내](../README.ko.md). This page keeps detailed CLI and maintainer reference material.

**v0.10.1:** Caption/event/packet and cumulative capture storage limits now stop unsafe ingestion with `resource-limit`. Journal reads are bounded, including legacy rows. Startup and the guides explain which local evidence enters the host AI context. See [v0.10.1 release notes](releases/v0.10.1.md) and [data handling and limits](#data-handling-and-storage-limits).

**v0.10:** `demo --serve` serves the bundled self-authored silent sample on localhost. Capture now reports `stopReason` and `completed`; `player-changed` is a detected boundary, not proof of completion. The original player/source is checked around caption reads and images, with generic observation failures still reported as interruptions. See [release validation](validation/2026-10-21-v010.md). Older version notes below describe their respective validation runs.

An experimental local capture library and Codex/Claude Code skill for studying a subtitled lecture with an AI partner. The collector keeps repetitive browser observations out of the model context. The agent explains new evidence and writes combined notes.

## 5분 시작하기 · Aside

Codex 또는 Claude Code와 Aside에 로그인되어 있다면, 강의 제목을 골라 시작할 수 있습니다. macOS/Linux용이며 Node/npm을 따로 설치할 필요가 없습니다. 앱 다운로드·첫 로그인 시간은 별도입니다.

1. 스킬 설치기에서 이 저장소의 **`skills/lecture-companion` 폴더만 설치**하면 수집기·CLI·PNG 라이브러리까지 함께 준비됩니다. 별도로 저장소를 복제하거나 유지할 필요가 없습니다.
2. 배포 ZIP을 직접 받은 경우에는 `lecture-companion-0.10.1.zip`을 풀고 아래 명령을 한 번 실행합니다. 일반 스킬 설치기를 사용했다면 이 단계는 필요 없습니다.

   ```sh
   /bin/sh lecture-companion/scripts/install.sh                     # Codex
   # Claude Code: /bin/sh lecture-companion/scripts/install.sh --host claude-code
   # 둘 다 사용: /bin/sh lecture-companion/scripts/install.sh --host both
   ```

3. Aside에서 강의를 열고 자막을 켭니다. 첫 설치라면 Aside의 로그인·프로필 설정과 Developer 설정의 공식 CLI 연결을 마칩니다.
4. Codex에 **“$lecture-companion으로 Aside 강의를 골라 같이 공부하고 질문 채팅도 열어줘”**라고 입력합니다. Claude Code에서는 `/lecture-companion Aside 강의를 골라 같이 공부하고 질문 채팅도 준비해줘`를 사용합니다. 강의가 여러 개면 제목만 선택하면 됩니다.

스킬이 안 보이면 새 채팅을 열거나 설치된 폴더의 `SKILL.md`를 읽어 달라고 요청하세요. 설치 완료 후 ZIP과 압축을 푼 폴더는 지워도 됩니다. 설치기는 전체 스킬을 독립된 실제 폴더로 복사하고, 기존 사용자 수정본은 보존합니다. 브라우저 연결과 호스트의 내장 Node는 계속 사용하며 별도 Node/npm 설치는 필요하지 않습니다.

새 강의 기록은 스킬 밖의 `~/.local/share/lecture-companion/sessions/`에 저장됩니다. `XDG_DATA_HOME`, 절대 경로 `LECTURE_COMPANION_DATA_DIR`, 명시적 `--out`으로 위치를 선택할 수 있습니다. 기존 버전의 세션은 자동 이동하지 않으며, 원래 경로를 `--out`으로 지정해 계속 사용할 수 있습니다.

에이전트가 플레이어·자막을 찾아 수집과 질문 채팅 준비를 함께 시작합니다. Codex의 지원되는 채팅 도구로 질문 채팅을 열고, 질문마다 최신 강의 문맥을 읽습니다. 자동 열기 도구가 없는 호스트에서는 질문 프롬프트와 별도 터미널 명령을 제공합니다. **자막·이미지 수집과 실제 채팅 연결을 확인한 뒤 준비 완료를 표시합니다.** 질문·답변은 최종 노트에 함께 저장됩니다.

에이전트/개발자용 빠른 경로:

```sh
./bin/lecture setup                       # 제목 목록과 필요한 연결 조치
./bin/lecture setup --tab ACTUAL_ID       # 관찰한 플레이어와 startArgs
./bin/lecture start --tab ACTUAL_ID       # 백그라운드 실행: 선택자·세션 경로 자동
./bin/lecture check --out ACTUAL_SESSION  # 수집 근거와 실제 질문 채팅 연결 확인
```

`start`는 강의를 재생하거나 속도를 바꾸지 않습니다. 여러 플레이어가 보이면 추가 선택을 요청하고, 창 밖으로 잘린 플레이어는 먼저 완전히 보이게 해야 합니다. ego는 아래 기존 수동/스킬 경로를 사용합니다. Claude Code 스킬 설치 위치와 질문 세션 옵션은 [공식 스킬 문서](https://code.claude.com/docs/en/skills), [CLI 문서](https://code.claude.com/docs/en/cli-reference)를 따릅니다.

**v0.9:** the complete collector, CLI, vendored PNG dependency and licenses now ship inside the skill. A copied/standard-installed skill folder runs independently; the ZIP's optional installer makes verified copies for Codex/Claude Code. Downloaded source can be deleted, and new lecture data stays outside the installation. See [packaging validation](validation/2026-10-21-v09.md). Title-based setup, automatic player discovery and question-chat handoff remain as documented in [v0.8](validation/2026-10-21-v08.md). The [v0.7.1 native capture tests](validation/2026-10-21-v071.md) cover rapid DOM captions, TextTrack cues, a cross-origin player, player-only PNGs and concurrent Q&A/export. No separate model API or speech service is required. The host AI still invokes commands and decides when to explain; this library does not wake model turns.

Capture requires Aside with its official CLI connection, or ego lite, and a visible subtitled player. No audio capture and no built-in model API. Accessible players use TextTrack `cuechange` or an explicit subtitle DOM selector with `MutationObserver`. A bounded event queue preserves short changes between reads and records play/pause/ratechange. Inaccessible cross-origin players use a clearly labeled snapshot fallback (500 ms read target; browser work can delay it). PNG processing runs in an independent external Node process. Only stable visual changes are saved; the whole selected player image is retained.

## Run

Use the installed skill's `/bin/sh ABS_SKILL/scripts/lecture`. The examples below use `./bin/lecture` from a development checkout; the installed launcher accepts the same arguments. On macOS/Linux it first honors explicit `LECTURE_NODE`, then checks Aside's managed `~/.aside/runtime/node/bin/node` (or `$ASIDE_HOME/runtime/node/bin/node`), the local Codex bundle, ego's embedded runtime, and an existing compatible Node. Candidate Nodes must be 22+. `LECTURE_NODE` can select a runtime path returned by the host's dependency tool. The launcher never downloads or installs Node or npm packages. Aside's sandboxed browser REPL controls the browser; imports and image processing run in managed Node.

For Aside capture, keep Aside open with a connected profile and enable its official CLI in Developer settings. The library locates the existing CLI on PATH or its standard installation paths. `LECTURE_ASIDE=/absolute/path/to/aside` selects a custom existing CLI; `ASIDE_CLI_INSTALL_DIR` is respected. Read [Aside capture setup and limits](../skills/lecture-companion/references/aside.md), then select the authorized existing tab and exact player selector. For ego, read its skill and obtain an authorized task space/page. Study/Q&A/export commands do not control the browser. Windows users can invoke `bin/lecture.mjs` with a host-provided Node; an automatic PowerShell launcher is not included.

```sh
./bin/lecture doctor # checks the selected runtime and actual image worker
./bin/lecture help
./bin/lecture demo --out /absolute/path/to/private-demo

# Aside only: list tabs, inspect the authorized original player via Aside REPL,
# then use its actual targetId and unique CSS selector. No ego is needed.
./bin/lecture tabs --browser aside
./bin/lecture capture --browser aside --tab ACTUAL_TARGET_ID \
  --out /absolute/path/to/aside-session --duration 1800 \
  --selector '#player' --caption-selector '.subtitle'
# Omit --caption-selector for native TextTrack captions.
# Carry --account uN / --profile ID consistently if explicitly selected.

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

The skill's `scripts/lecture` uses the same launcher. No `npm ci` is required to run it. Maintainers with Node can run `npm test` or `node --test test/*.test.mjs`; optional `npm run test:browser` exercises synthetic ego players and `npm run test:aside` requires a ready Aside profile and opens only a synthetic localhost player. The legacy `.mjs` entry points remain available to callers that already have a host Node path.

`--caption-mode auto` (default) tries events, then reports `fallbackReason` if snapshot capture is needed. `event` requires an accessible source; `snapshot` forces compatibility polling. The tested Fastcampus/Kollus cross-origin iframe still requires fallback. No browser security setting is changed. Enable the intended subtitle track first: among `captions`/`subtitles` tracks, the probe prefers the first showing track, then an enabled hidden track. Metadata/chapters tracks are ignored. An explicit DOM selector is used when no enabled caption track exists. Selectors are scoped to one selected player. Multiple visible iframe players are refused for screenshots.

The event queue is read and acknowledged after journaling, holds at most 2048 events, and reports `caption-overflow` rather than silently implying full coverage. It observes seeks and media end, and journals subtitle disappearance as `caption-clear`. Normal shutdown freezes and drains the source before closing it and joining slow image work. Its lease cleans up listeners after reads stop, subject to browser timer throttling. A reload can lose undrained events; document identity/source loss stops capture. DOM updates coalesced within a single browser task and rendered/burned-in video subtitles cannot be reconstructed by this adapter.

Aside keeps one MCP REPL session and serializes browser calls to avoid colliding evaluations. Its caption probe lease is 60 seconds, allowing a slow screenshot before the next buffered read. To work around the tested Aside screenshot clip-origin bug, a viewport PNG stays transient in local memory/IPC and the external image worker crops it before comparison or saving. Geometry checks around the screenshot and observed pixel-ratio validation stop capture if its viewport/player bounds change. Snapshot fallback discards orphan iframe trees that Aside may append despite selector scoping, plus page metadata and controls. It reads text inside the selected player, which may include slide text. Native snapshot escaping cannot distinguish real newlines from literal backslash-n; fallback preserves backslashes. Tab/REPL loss, operation failure and timeouts stop capture without switching tabs or browsers. The borrowed lecture tab stays open. No model/agent tool is invoked by the collector.

Install the complete `skills/lecture-companion` folder through the host's skill installer, or use the release installer above. The checkout's `/bin/sh install.sh` delegates to the same installer. It can convert its own legacy source link to an independent copy; unrelated links and existing modified copies are preserved. Repeat installation of the same intact release succeeds. To update a different existing release, use the skill manager or move the old skill aside first. Keep the private data directory. A new chat may be needed for automatic discovery; the installed launcher can run immediately.

## Packaging for maintainers

Canonical development code stays in root `bin/`, `src/` and `vendor/`. `npm run build:skill` generates the checked-in `skills/lecture-companion/scripts/runtime/` plus a full file index and SHA-256 manifest. `npm run check:skill` and the test suite reject stale bundles. Source/runtime directories must be real directories, so the packaged skill cannot accidentally depend on an external symlink. Original MIT/PNG licenses are included.

`npm run package:skill` builds `dist/lecture-companion-VERSION.zip` and its `.sha256` file using the maintainer's `zip` utility. It archives only the explicit skill/runtime file map, excluding sessions, tests, node_modules, Git state and private logs. Users do not run npm or the build step. No public repository, package-registry publication or installer URL is created by this local packaging command.

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

See [native chat setup and Q&A payloads](../skills/lecture-companion/references/question-chat.md) and [worker payloads](../skills/lecture-companion/references/study-session.md) before writing JSON. `study chat` reserves a setup and produces instructions; the CLI alone does not create a chat. A bound setup is reused; an interrupted opening requires inspecting the prior attempt instead of duplicating it. The Codex path opens a dedicated native chat and does not claim to invoke the literal `/side` panel. Claude Code needs a supported full-tool session opener; `/btw` cannot read local context or save answers. If the host exposes no opener, the skill reports that manual step.

`study context` is read-only and bounded. It returns the source snapshot/hash, recent captions/frames, saved summaries, recent Q&A and uncertainty. Omitted events and items can be read with `--event ID` or `--item KEY`, using `--offset` and returned `nextOffset`. Search earlier saved items with `--query KEYWORD`; an empty query lists all items with bounded pagination (`search.nextOffset`, counting results). It never consumes the worker's receipt. `study qa` atomically saves a linked question/answer and the exact source snapshot; later capture is allowed, but evidence newer than the snapshot, invalid provenance metadata and altered journal prefixes are refused. No ongoing context messages are pushed to the question chat.

`next` persists one stable receipt without moving the committed cursor. `commit` saves records and dispositions together before moving it. Every event must be noted or explicitly reviewed with a reason. Oversized worker references must be read through `study evidence` before commit. Limits apply to the serialized JSON, default 12000 and minimum 2048 UTF-8 bytes; they are not model token budgets. Single-chat question mode remains a fallback; a separate question chat must not call `study mode question`, `next` or `commit`.

`study.json` holds worker records; `questions.json` holds the native chat binding and Q&A with its own `.questions.lock`. Capture owns `events.jsonl`. Q&A never changes the worker's mode, pending receipt or cursor and can save while `.study.lock` is held. After a hard crash verify the original command ended before manually removing its stale lock. Repeated keyed operations with the same payload return their original result. Conflicting keys and stale explicit worker `expectedRevision` values fail. A receipt returned before a mode change remains the original receipt, including its original revision; use current status for an explicit revision check.

Study state schema 2 fingerprints observed journal evidence independently of the committed cursor, including evidence used by standalone notes. Unsupported state versions fail explicitly; raw v0.2 captures can be initialized without altering their evidence. See [v0.3 validation and limitations](validation/2026-10-20-v03.md).

See [v0.4 native chat validation and limitations](validation/2026-10-20-v04.md) for the actual Codex chat demonstration, independent review corrections and final test results.

See [v0.5 app-runtime validation](validation/2026-10-21-v05.md) for execution without PATH Node or node_modules, actual Codex/ego runtime checks and current platform limits.

See [v0.6 Aside runtime validation](validation/2026-10-21-v06.md) for automatic managed-runtime discovery and execution with a genuine verified Aside Node distribution.

See [v0.7 Aside capture validation](validation/2026-10-21-v07.md) for the initial adapter work and unsuccessful isolated-profile attempt; [v0.7.1 installed-browser validation](validation/2026-10-21-v071.md) records the subsequent successful native checks and crop fix.

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
- `src/aside-browser.mjs`: discovered official Aside CLI, persistent MCP REPL, exact tab binding, scoped accessibility adapter and PNG transport into the shared capture loop.
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

## Data handling and storage limits

Local capture and AI processing are separate steps. The collector writes observed captions, selected player PNGs and capture metadata to the selected local session. The worker reads caption batches and opens selected frames; the question chat reads fresh evidence, summaries and saved Q&A. These reads place their contents into the configured Codex/Claude Code model provider's context. A session's cumulative batches can contain substantial lecture content. The collector has no upload backend, telemetry or separate model API, but this host workflow is not offline. The startup notice includes `dataHandling.local`, `dataHandling.hostAI` and `collectorUploads: false` so the agent can explain the distinction before teaching begins.

No audio is recorded or login cookies/passwords extracted. Visible personal information, instructor faces, secrets or confidential code in lecture captions/images are not automatically redacted. Aside's full-viewport screenshot passes transiently through local adapter/collector/image-worker memory before crop; only the selected processed player PNG is persisted. Host chats keep their normal tools and are not isolated OS principals. Provider storage/training settings follow the chosen account, not this library.

New session directories/files use restrictive creation permissions, not encryption. Files remain until removed by the user. Stop the collector and related chats before deleting the intended session folder. This does not delete provider-side chat history or copies already exported elsewhere. Choose content you are authorized to process and check its terms before capture or sharing.

Capture enforces these hard ceilings on the host, independently of model response budgets:

| Resource | Maximum |
| --- | --- |
| Raw UTF-8 caption | 64 KiB |
| Encoded event | 128 KiB |
| Caption events per packet / encoded event-array bytes | 256 / 256 KiB |
| Browser caption queue | 2,048 events and 512 KiB; dropped evidence is reported |
| Raw accessibility snapshot before local parsing | 1 MiB |
| Journal (including reserved terminal record) | 16 MiB |
| Captured journal and PNG evidence combined | 128 MiB |

Metadata, study/Q&A state, notes and exports are outside the capture evidence budget. The storage limits reserve 1 KiB for a terminal record; local disk exhaustion or an already oversized session may prevent that record, so `status.json` is written separately. Limits may be lowered through the library API but cannot be raised above the hard ceilings. They are bytes, not tokens. Oversized captions, invalid/non-progressing packets, excessive drain work or exhausted storage stop with `stopReason: resource-limit`, `completed: false`, and a safe limit code. Rejected content is not silently truncated or presented as complete evidence. Earlier accepted evidence and saved Q&A remain available for export when the journal is within the read limit.

Every journal consumer uses a bounded reader, including legacy sessions and read-only context/export. A file over 16 MiB is refused before full-file allocation/JSON parsing and left untouched; oversized legacy rows/captions are also refused, including an otherwise repairable final row. The tool does not silently truncate or migrate rejected evidence. This is a fixed local processing ceiling, not streaming or a guarantee of a particular RAM footprint. Browser evaluation and screenshot APIs remain external boundaries; these controls do not sandbox the browser or host AI.
