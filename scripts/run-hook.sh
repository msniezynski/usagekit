#!/bin/sh
set -eu
root=$(git rev-parse --show-toplevel)
cd "$root"
version=$(cat .nvmrc)
node_dir="${NVM_DIR:-$HOME/.nvm}/versions/node/v$version/bin"
if [ -x "$node_dir/node" ]; then
  PATH="$node_dir:$PATH"
  export PATH
fi
exec node scripts/git-hook.mjs "$@"
