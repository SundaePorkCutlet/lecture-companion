#!/bin/sh
# Install only this self-contained skill. No Node, npm, network or repository.
set -eu
lecture_host=codex
case "${1:-}" in
  '') ;;
  --host) [ "$#" -eq 2 ] || { echo 'Usage: install.sh [--host codex|claude-code|both]' >&2; exit 1; }; lecture_host=$2;;
  *) echo 'Usage: install.sh [--host codex|claude-code|both]' >&2; exit 1;;
esac
case "$lecture_host" in codex|claude-code|both) ;; *) echo 'Host must be codex, claude-code, or both.' >&2; exit 1;; esac
[ -n "${HOME:-}" ] || { echo 'HOME is required.' >&2; exit 1; }
lecture_source=$(CDPATH= cd "$(dirname "$0")/.." && pwd -P)
lecture_verify() {
  [ -f "$1/BUNDLE.sha256" ] && [ -f "$1/FILES" ] || return 1
  lecture_listed=$(sed -n 's/^[0-9a-f][0-9a-f]*  //p' "$1/BUNDLE.sha256" | LC_ALL=C sort)
  lecture_expected=$(LC_ALL=C sort "$1/FILES")
  [ "$lecture_listed" = "$lecture_expected" ] || return 1
  for lecture_required in SKILL.md scripts/lecture scripts/install.sh scripts/runtime/bin/lecture scripts/runtime/bin/lecture.mjs scripts/runtime/src/onboarding.mjs scripts/runtime/vendor/pngjs/lib/png.js scripts/runtime/vendor/pngjs/LICENSE; do
    printf '%s\n' "$lecture_expected" | grep -Fqx "$lecture_required" || return 1
    [ -f "$1/$lecture_required" ] || return 1
  done
  if command -v sha256sum >/dev/null 2>&1; then (cd "$1" && sha256sum -c BUNDLE.sha256 >/dev/null 2>&1)
  elif command -v shasum >/dev/null 2>&1; then (cd "$1" && shasum -a 256 -c BUNDLE.sha256 >/dev/null 2>&1)
  else echo 'An OS SHA-256 utility (sha256sum or shasum) is required.' >&2; return 1; fi
}
lecture_verify "$lecture_source" || { echo 'Skill bundle is incomplete or changed. Obtain a complete release, or rebuild the developer bundle.' >&2; exit 1; }
lecture_codex="${CODEX_HOME:-$HOME/.codex}/skills/lecture-companion"
lecture_claude="$HOME/.claude/skills/lecture-companion"
case "$lecture_host" in codex) set -- "$lecture_codex";; claude-code) set -- "$lecture_claude";; both) set -- "$lecture_codex" "$lecture_claude";; esac
for lecture_destination do
  if [ -L "$lecture_destination" ]; then
    [ "$lecture_destination" -ef "$lecture_source" ] || { echo "Existing linked skill preserved: $lecture_destination" >&2; exit 1; }
  elif [ -e "$lecture_destination" ]; then
    if [ -d "$lecture_destination" ] && cmp -s "$lecture_source/BUNDLE.sha256" "$lecture_destination/BUNDLE.sha256" && lecture_verify "$lecture_destination"; then continue; fi
    echo "Existing or modified skill preserved: $lecture_destination. Update it through your skill manager, or move it aside before installing." >&2; exit 1
  fi
done
umask 077
lecture_stage=''
lecture_lock=''
lecture_legacy_link=''
lecture_cleanup() {
  if [ -n "$lecture_legacy_link" ] && [ ! -e "$lecture_destination" ] && [ ! -L "$lecture_destination" ]; then
    ln -s "$lecture_legacy_link" "$lecture_destination" || echo 'Could not restore the legacy registration; restore its original link before retrying.' >&2
  fi
  [ -z "$lecture_stage" ] || rm -rf "$lecture_stage"
  [ -z "$lecture_lock" ] || rmdir "$lecture_lock" 2>/dev/null || true
}
trap lecture_cleanup 0
trap 'exit 130' 2
trap 'exit 143' 15
for lecture_destination do
  if [ ! -L "$lecture_destination" ] && [ -d "$lecture_destination" ]; then printf 'Already installed: %s\n' "$lecture_destination"; continue; fi
  lecture_parent=$(dirname "$lecture_destination")
  mkdir -p "$lecture_parent"
  lecture_lock_candidate="$lecture_parent/.lecture-companion-install.lock"
  mkdir "$lecture_lock_candidate" 2>/dev/null || { echo 'Another skill installation is in progress.' >&2; exit 1; }
  lecture_lock=$lecture_lock_candidate
  lecture_stage=$(mktemp -d "$lecture_parent/.lecture-companion-stage.XXXXXXXX")
  while IFS= read -r lecture_line; do
    lecture_file=${lecture_line#*  }
    case "/$lecture_file/" in */../*|*/./*|//*) echo 'Invalid bundle path.' >&2; exit 1;; esac
    [ "$lecture_file" != "$lecture_line" ] || { echo 'Invalid bundle manifest.' >&2; exit 1; }
    mkdir -p "$lecture_stage/$(dirname "$lecture_file")"
    cp -p "$lecture_source/$lecture_file" "$lecture_stage/$lecture_file"
  done < "$lecture_source/BUNDLE.sha256"
  cp "$lecture_source/BUNDLE.sha256" "$lecture_stage/BUNDLE.sha256"
  lecture_verify "$lecture_stage" || { echo 'Staged skill verification failed.' >&2; exit 1; }
  # The only replaceable link is this checkout's known legacy registration.
  if [ -L "$lecture_destination" ]; then
    [ "$lecture_destination" -ef "$lecture_source" ] || { echo 'Skill destination changed; installation stopped.' >&2; exit 1; }
    lecture_legacy_link=$(readlink "$lecture_destination")
    rm "$lecture_destination"
  elif [ -e "$lecture_destination" ]; then echo 'Skill destination changed; installation stopped.' >&2; exit 1; fi
  mv "$lecture_stage" "$lecture_destination"
  lecture_stage=''
  lecture_legacy_link=''
  lecture_verify "$lecture_destination" || { echo 'Installed skill verification failed; inspect the destination before retrying.' >&2; exit 1; }
  rmdir "$lecture_lock"; lecture_lock=''
  printf 'Installed self-contained skill: %s\n' "$lecture_destination"
done
printf '\nThe download and source repository are no longer needed. Browser/host runtime prerequisites still apply.\n'
case "$lecture_host" in codex|both) printf 'Codex: $lecture-companion으로 Aside 강의를 골라 같이 공부하고 질문 채팅도 열어줘.\n';; esac
case "$lecture_host" in claude-code|both) printf 'Claude Code: /lecture-companion Aside 강의를 골라 같이 공부하고 질문 채팅도 준비해줘.\n';; esac
