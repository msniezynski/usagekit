#!/bin/sh
set -eu
# The runner comes from the checkout that holds this script; git's working directory stays as is,
# because a hook may run for a worktree that is still being created.
root=$(cd "$(dirname "$0")/.." && pwd)
version=$(cat "$root/.nvmrc")
node_dir="${NVM_DIR:-$HOME/.nvm}/versions/node/v$version/bin"
if [ -x "$node_dir/node" ]; then
  PATH="$node_dir:$PATH"
  export PATH
fi
exec node "$root/scripts/git-hook.mjs" "$@"
