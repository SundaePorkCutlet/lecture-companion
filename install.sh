#!/bin/sh
# Install the complete local checkout as a skill; no network or Node required.
set -eu
lecture_host=codex
case "${1:-}" in
  '') ;;
  --host) [ "$#" -eq 2 ] || { echo 'Usage: /bin/sh install.sh [--host codex|claude-code|both]' >&2; exit 1; }; lecture_host=$2;;
  *) echo 'Usage: /bin/sh install.sh [--host codex|claude-code|both]' >&2; exit 1;;
esac
case "$lecture_host" in codex|claude-code|both) ;; *) echo 'Host must be codex, claude-code, or both.' >&2; exit 1;; esac
[ -n "${HOME:-}" ] || { echo 'HOME is required for skill installation.' >&2; exit 1; }
lecture_root=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
lecture_source="$lecture_root/skills/lecture-companion"
for lecture_required in "$lecture_source/SKILL.md" "$lecture_root/bin/lecture" "$lecture_root/src/onboarding.mjs" "$lecture_root/vendor/pngjs/lib/png.js"; do
  [ -f "$lecture_required" ] || { echo 'Download the complete repository, including vendor/, before installing.' >&2; exit 1; }
done
lecture_codex="${CODEX_HOME:-$HOME/.codex}/skills/lecture-companion"
lecture_claude="$HOME/.claude/skills/lecture-companion"
case "$lecture_host" in
  codex) set -- "$lecture_codex";;
  claude-code) set -- "$lecture_claude";;
  both) set -- "$lecture_codex" "$lecture_claude";;
esac
# Check every destination before creating any links. Never replace a user skill.
for lecture_destination do
  if [ -e "$lecture_destination" ] || [ -L "$lecture_destination" ]; then
    if [ -L "$lecture_destination" ] && [ "$(readlink "$lecture_destination")" = "$lecture_source" ]; then continue; fi
    echo "Existing skill preserved: $lecture_destination. Choose which checkout to keep before installing." >&2; exit 1
  fi
done
umask 077
for lecture_destination do
  if [ ! -L "$lecture_destination" ]; then
    mkdir -p "$(dirname "$lecture_destination")"
    ln -s "$lecture_source" "$lecture_destination"
  fi
  printf 'Installed: %s\n' "$lecture_destination"
done
printf '\nKeep this repository in place. No Node/npm installation is needed.\n'
printf 'Open a new Codex/Claude Code chat if the skill is not listed.\n'
printf 'Skill file: %s/SKILL.md\n' "$lecture_source"
case "$lecture_host" in codex|both) printf 'Codex: $lecture-companion으로 Aside 강의를 골라 같이 공부하고 질문 채팅도 열어줘.\n';; esac
case "$lecture_host" in claude-code|both) printf 'Claude Code: /lecture-companion Aside 강의를 골라 같이 공부하고 질문 채팅도 준비해줘.\n';; esac
