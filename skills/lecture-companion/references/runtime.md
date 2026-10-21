# App-provided execution

On macOS/Linux run `/bin/sh ABS_SKILL/scripts/lecture doctor`. The same launcher handles capture, study, context, Q&A and export. It does not install software, download binaries or run npm. The complete repository must include `bin/`, `src/` and `vendor/`; a skill-only copy without those files is not a working distribution.

Selection order:

1. Explicit `LECTURE_NODE`, when the agent obtained a real compatible runtime path from its host. An invalid explicit path fails instead of silently changing providers.
2. Aside's app-managed `~/.aside/runtime/node/bin/node`, or `$ASIDE_HOME/runtime/node/bin/node` when the app home is customized. It is a standalone Node and must be 22+. Its verified executable is also passed to generated question commands, so a new chat can work without inheriting `ASIDE_HOME`.
3. The known local Codex dependency bundle, if present and Node 22+.
4. `ego-browser nodejs`, if the CLI is available. This uses ego's embedded runtime for both commands and the separate image processor; no standalone Node is needed.
5. An already available Node 22+ on PATH.

In Codex, use `load_workspace_dependencies` when the bundle is not discoverable. Set `LECTURE_NODE` to the exact returned Node executable for the launcher invocation; generated question commands preserve that explicit selection. Do not invent a machine path or modify global shell configuration. If no supported runtime is available, report the missing host capability. Do not instruct the user to install Node as the default recovery or silently switch browsers.

`doctor` actually encodes, decodes and processes a synthetic PNG, including duplicate filtering through the selected image worker. It controls no browser page. Host diagnostics go to stderr; normal command results remain on stdout.

For direct library calls inside ego, choose one verified path:

- `imageNode: ABS_HOST_NODE` for a standalone host Node.
- `imageRuntime: {provider: 'ego', command: ABS_EGO_CLI}` for ego's supported embedded Node command. Use an absolute CLI path because ego does not inherit the shell working directory/environment. The image process communicates over a private Unix socket, with one pending frame and timeout/shutdown cleanup. Do not reintroduce worker_threads, which failed in the embedded runtime during v0.2 testing.

Aside's managed runtime is distinct from `aside repl`: the current official REPL guide explicitly forbids imports and require. Do not execute `aside runtime ...` speculatively: the inspected CLI does not list a runtime subcommand and unknown words can be treated as an agent prompt. This launcher only checks an already provisioned managed executable. If it is absent or incompatible, use the next available provider; if none works, report that the app's runtime is unavailable. Do not repair, install, log in, send agent tasks or change permissions as a side effect of detection. Background: [official runtime feature history](https://docs.aside.com/changelog/components), [CLI/REPL documentation](https://docs.aside.com/help/developers).

The existing `.mjs` entry points remain compatible with an explicit host Node. Windows requires that explicit host-runtime invocation; no automatic PowerShell bootstrap is included. A browser's page JavaScript engine alone is not a general Node runtime. For Aside browser capture use the official CLI/MCP adapter described in [aside.md](aside.md); it runs outside the sandboxed REPL and keeps all imports/image processing in the managed Node. Chrome capture and native Aside question-chat creation are not included.
