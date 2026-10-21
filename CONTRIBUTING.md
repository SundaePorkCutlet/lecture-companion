# Contributing

Start with one real task: install the skill, choose a lecture, ask a question and export the notes. Reports about where that flow breaks are especially useful.

## Report a first-run problem

Include the release version, operating system, AI host, browser and failed step: installation, browser connection, lecture selection, capture, question chat or final notes. Say what you expected and what happened. A sanitized `doctor` or `check` result can help; remove personal paths and thread IDs first. Do not attach course recordings, private captions, cookies, signed URLs or complete session directories.

When possible, reproduce against the built-in synthetic sample (`demo --serve`). This gives maintainers a shareable test case.

## Development

Canonical code lives in `src/`, `bin/`, `assets/` and `vendor/`. Edit these sources, then run:

```sh
npm run build:skill
npm test
npm run check:skill
```

The generated skill runtime must match its source. `npm run package:skill` creates the installable ZIP and SHA-256 file under `dist/`. Users install the skill folder or release ZIP and do not run npm. Native browser tests are opt-in; see the [technical reference](docs/reference.md).

The silent sample video is project-authored: 36 seconds of solid `#132238`, 640×360 at 10 fps, VP9 WebM, no audio. Slides and subtitles are rendered by `assets/demo/player.html`; playback controls remain native. To regenerate the background video with a maintainer-provided ffmpeg:

```sh
ffmpeg -f lavfi -i color=c=0x132238:s=640x360:r=10 -t 36 -c:v libvpx-vp9 -an assets/demo/lecture.webm
```

## What to measure in an early trial

Record whether the user reached their first question and exported notes, the step where they needed help, and whether they returned for a second lecture. Report observed times only. No usage telemetry is sent by this project.
