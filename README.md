# Lecture Companion

Study a subtitled lecture with your usual AI agent. Ask questions in a separate chat while capture continues, then keep the explanations and Q&A in your review notes.

**Experimental · Codex / Claude Code · Aside / ego · macOS / Linux**

[한국어](README.ko.md) · [Download v0.10.1](https://github.com/SundaePorkCutlet/lecture-companion/releases/tag/v0.10.1) · [Example notes](examples/containers/notes.md) · [Technical reference](docs/reference.md)

## What you get

- Local caption capture and selected player screenshots, with bounded evidence batches for the agent.
- A separate question chat that reads fresh lecture context on each question.
- Combined notes containing lecture observations, AI explanations and saved Q&A.

The collector makes no model calls. Your agent still uses its normal allowance or billing when processing evidence and answering questions. There is no separate model API key or speech service in this project, and no measured token-savings claim.

## Start with a lecture

1. Install **[`skills/lecture-companion`](https://github.com/SundaePorkCutlet/lecture-companion/tree/main/skills/lecture-companion)** with your agent's skill installer, or download the [standalone skill ZIP](https://github.com/SundaePorkCutlet/lecture-companion/releases/download/v0.10.1/lecture-companion-0.10.1.zip) and use the installer below. The folder includes the collector, runtime code and PNG library; you can remove the downloaded repository afterward.
2. Open the lecture in **Aside or ego**, turn on visible subtitles, and keep the full player visible. Finish the browser's account/profile and CLI connection first.
3. In Codex, ask:

   > Use $lecture-companion to study the lecture in Aside with me. Open a separate question chat and save our Q&A with the final notes.

   For ego, replace “Aside” with “ego”. In Claude Code use `/lecture-companion` followed by the same request.
4. Choose the lecture by title. After the agent verifies a caption, player image and actual question-chat connection, press Play. Keep your preferred playback speed.
5. Ask in the question chat. When finished, ask the lecture worker to stop and produce the final notes. You can still ask about the saved session afterward; export again to include later answers.

A downloaded release ZIP can also be installed after extraction:

```sh
/bin/sh lecture-companion/scripts/install.sh
# Claude Code: add --host claude-code
# Both hosts: add --host both
```

No separate Node/npm installation is needed when a supported host runtime is present. A new chat may be needed to discover the installed skill. Existing customized skill copies are preserved by the installer.

## Try it without a course

Ask your agent:

> Use $lecture-companion to open its built-in synthetic demo in Aside, prepare a question chat, and study it with me. Afterward, combine the notes and our questions.

The skill includes a **36-second silent sample** about images and containers. It runs locally, uses no third-party course recordings and follows the same capture/Q&A path as a real lecture. The agent runs `demo --serve`, opens the returned local URL, and starts a normal session. The sample waits for Play.

Try asking: **“Will docker cp change the image used for the next container?”** See the [illustrative final notes](examples/containers/notes.md) for the intended reading experience.

## Supported today

| Requirement | Current behavior |
| --- | --- |
| Browser | Aside with its official CLI connection, or ego with its browser skill. Ordinary Chrome is not directly supported. |
| Setup | Guided title/player discovery in Aside; agent-assisted selection in ego. Initial sign-in and browser setup add time. |
| Question chat | Automatic in Codex when native chat tools are available. Claude Code or other hosts may require opening a full-tool session manually. |
| Captions | TextTrack or DOM events where accessible. Cross-origin players can require a labeled snapshot fallback. |
| End of lecture | Observed media end completes capture. A detected player/source change stops the current session and asks you to choose the next lecture. |

No audio is recorded. Burned-in subtitles without accessible text are unsupported; complete transcription is not guaranteed. Capture does not automatically move to the next lecture or control playback. The collector keeps observing locally while a worker is active; it cannot wake the AI agent on its own.

Sessions are stored separately from the skill, normally under `~/.local/share/lecture-companion/sessions/`. Only selected evidence enters the host agent's context; the host's own data handling applies. Avoid sharing private captures in issues.

## Data and AI processing

**Local capture does not mean offline AI processing.** The collector has no upload backend or model API. When Codex or Claude Code reads session evidence, that content enters the configured host/model provider's context under your account settings and terms.

| Data | Where it goes |
| --- | --- |
| Observed captions, selected player PNGs, timestamps and capture status | Private local session files. |
| Caption batches, player images the agent opens, summaries, questions and saved answers | The lecture worker or question chat, and its configured AI provider. Multiple batches can expose substantial lecture content over a session. |
| Combined notes and Q&A | Local exports; material used to write them has also entered the host chat. No automatic public publication. |

Audio is not recorded. The collector does not extract login passwords or cookies. Visible names, faces, email addresses, code and other sensitive material in captions/images are **not automatically redacted**. Aside temporarily sends a full viewport image through local collector/image-worker memory before cropping; the saved frame is the selected player. The question chat has the host's normal tools; opening a separate chat does not isolate its filesystem access.

Choose content you may process, check the course conditions and your host's retention/training settings, and exclude sensitive material before capture. Session files are plaintext with restrictive creation permissions, not encrypted. They remain until you delete them; stop capture and related chats before removing the selected session folder. Deleting local files does not delete provider-side chat history. See [the technical reference](docs/reference.md#data-handling-and-storage-limits).

## Contribute

For first-run problems, report your browser, host, release version and the step that failed. See [CONTRIBUTING.md](CONTRIBUTING.md). Developers can run `npm test`, `npm run check:skill` and `npm run package:skill`; users do not run npm. Detailed CLI commands, capture limits and prior validation live in the [technical reference](docs/reference.md).

MIT · [License](LICENSE)
