# Aside capture

Use Aside's existing managed Node and official CLI/MCP REPL. The collector calls only the deterministic `repl` tool; it does not start an Aside model task. No ego command, npm installation or model API is required for this path. Aside must already be open with a connected browser profile and its CLI available through Developer settings.

Read `aside guide repl` before controlling tabs; read an applicable `aside skills show NAME` when using one of its service-specific globals. The library discovers `aside` on PATH, `~/.local/bin/aside`, or the official CLI installation under `~/.aside/cli` (`ASIDE_CLI_INSTALL_DIR` is respected). Set `LECTURE_ASIDE` to an existing absolute CLI executable if the host provides a different location. Detection never installs or logs in.

List existing tabs with `/bin/sh ABS_LAUNCHER tabs --browser aside`. Resolve the lecture from the user's authorization; never select the active or first tab automatically. The returned `targetId` is the capture `--tab` argument. `--account uN` and `--profile ID` select an existing account/profile and must be used consistently for listing, inspection and capture. If the CLI reports a missing profile binding, inspect its supported host/profile commands or Aside Developer settings. Do not guess profile IDs or use another account silently.

Inspect that original tab through `aside repl` with `attachBrowserTab(TARGET_ID)` and a compact `snapshot(page, {interactive: true})`, escalating to a full snapshot when needed to identify the exact player selector. Do not navigate, change speed or start playback as an incidental part of capture. Use existing task authorization for any intended player action.

```sh
/bin/sh ABS_LAUNCHER capture --browser aside --tab ACTUAL_TARGET_ID \
  --selector '#player' --caption-selector '.subtitle' \
  --out ABS_PRIVATE_SESSION --duration 1800
```

Omit `--caption-selector` for native enabled TextTrack captions. Use `--caption-mode event` to require events, `snapshot` to force compatibility polling, or `auto` for events followed by explicit fallback. Captions and PNGs are processed locally. The persistent REPL serializes browser operations; image processing uses a separate managed Node. A screenshot may delay a read, so the Aside event probe has a 60-second lease; overflow and observation gaps remain visible in the journal. Forced interruption may leave listeners until that lease expires, subject to background timer throttling.

Snapshot fallback uses the selected player subtree and discards orphan iframe trees that Aside may append outside that selection. It excludes controls and page title/URL metadata. This is observed accessibility text, which can include slide text inside the player. Native snapshot escaping cannot distinguish source newlines from literal backslash-n; fallback preserves backslashes so code/path captions are not silently interpreted as JSON escapes. Prefer event captions when available. Neither mode reconstructs burned-in subtitles or speech.

Tab closure, REPL reset, permission denial, browser failure or a timed-out operation stops capture. Do not fall back to ego, a different tab, direct CDP or changed security settings. Confirm the selected source before restarting. `stop --out DIR` requests a normal drain and shutdown; the borrowed lecture tab remains open. The same study, question-chat, Q&A and export commands consume the resulting journal. Native question-chat opening still depends on the Codex/Claude host capabilities documented in [question-chat.md](question-chat.md).

Maintainers can explicitly run `npm run test:aside` (or the same script with Aside's managed Node) against a ready native Aside profile. This opens only a synthetic localhost player, exercises DOM event capture/PNG/snapshot fallback, and closes only its own fixture tab. `LECTURE_ASIDE_ACCOUNT` and `LECTURE_ASIDE_PROFILE` select its test account/profile. See the v0.7 validation record for what has actually been run; an adapter fixture test is not proof of native browser readiness.
