#!/usr/bin/env bash
# Updates the Zed dev extension after grammar/query changes.
# Commits in the grammar repo, bumps the extension version, clears
# Zed's grammar cache, and commits.
#
# Usage: bash scripts/update-zed-extension.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$REPO_ROOT/zed-extension"
GRAMMAR_REPO="$EXT_DIR/grammar-repo"

if [ ! -d "$EXT_DIR" ]; then
  echo "zed-extension/ not found. Run scripts/setup-zed-extension.sh first."
  exit 1
fi

# Commit any changes in the grammar repo (symlinks pick up new build output)
cd "$GRAMMAR_REPO"
git add -A
git diff --cached --quiet || git commit -m "Update grammar"

# Clear Zed's grammar cache so it re-clones
rm -rf "$EXT_DIR/grammars"

# Bump patch version
cd "$EXT_DIR"
current=$(grep '^version' extension.toml | sed 's/.*"\(.*\)"/\1/')
IFS='.' read -r major minor patch <<< "$current"
new="$major.$minor.$((patch + 1))"
sed -i "s/version = \"$current\"/version = \"$new\"/" extension.toml

git add -A
git commit -m "Update to $new"

echo "Updated zed-extension to $new"
echo "Reinstall dev extension in Zed to pick up changes."
