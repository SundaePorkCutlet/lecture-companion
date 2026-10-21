#!/bin/sh
# Developer-checkout convenience wrapper; releases include the same installer.
lecture_root=$(CDPATH= cd "$(dirname "$0")" && pwd -P) || exit 1
exec /bin/sh "$lecture_root/skills/lecture-companion/scripts/install.sh" "$@"
