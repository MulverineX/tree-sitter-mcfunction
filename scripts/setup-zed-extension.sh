#!/usr/bin/env bash
# Sets up a Zed dev extension in zed-extension/ with a local grammar repo
# that symlinks to the source and build output, so changes are picked up
# after running build + update without committing to the parent repo.
#
# Usage: bash scripts/setup-zed-extension.sh
# Then in Zed: "zed: install dev extension" pointing at zed-extension/

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$REPO_ROOT/zed-extension"

if [ -d "$EXT_DIR" ]; then
  echo "zed-extension/ already exists. Delete it first to regenerate."
  exit 1
fi

mkdir -p "$EXT_DIR/languages/mcfunction"

# Create a separate grammar repo that Zed can clone from
GRAMMAR_REPO="$EXT_DIR/grammar-repo"
mkdir -p "$GRAMMAR_REPO"
ln -s "$REPO_ROOT/src/grammar.js" "$GRAMMAR_REPO/grammar.js"
ln -s "$REPO_ROOT/build/src" "$GRAMMAR_REPO/src"
cd "$GRAMMAR_REPO"
git init
git add -A
git commit -m "Initial grammar"
cd "$REPO_ROOT"

# Extension manifest pointing at the local grammar repo
cat > "$EXT_DIR/extension.toml" <<EOF
id = "mcfunction"
name = "Minecraft mcfunction"
version = "0.0.1"
schema_version = 1
description = "Syntax highlighting for Minecraft mcfunction files"
authors = ["MulverineX"]
languages = ["languages/mcfunction"]

[grammars.mcfunction]
repository = "file://$GRAMMAR_REPO"
rev = "main"
EOF

# Language config
cat > "$EXT_DIR/languages/mcfunction/config.toml" <<'EOF'
name = "mcfunction"
grammar = "mcfunction"
path_suffixes = ["mcfunction"]
line_comments = ["# "]
brackets = [
    { start = "{", end = "}", close = true, newline = true },
    { start = "[", end = "]", close = true, newline = true },
    { start = "(", end = ")", close = true, newline = false },
    { start = "\"", end = "\"", close = true, newline = false, not_in = ["string", "comment"] },
    { start = "'", end = "'", close = true, newline = false, not_in = ["string", "comment"] },
]
EOF

# Symlink query files
ln -s "$REPO_ROOT/src/queries/highlights.scm" "$EXT_DIR/languages/mcfunction/highlights.scm"
ln -s "$REPO_ROOT/src/queries/brackets.scm" "$EXT_DIR/languages/mcfunction/brackets.scm"

# Initialize the extension git repo
cd "$EXT_DIR"
echo "grammar-repo/" > .gitignore
echo "grammars/" >> .gitignore
git init
git add -A
git commit -m "Initial Zed dev extension setup"

echo ""
echo "Zed dev extension created at: $EXT_DIR"
echo ""
echo "To install in Zed:"
echo "  1. Run 'zed: install dev extension' and select zed-extension/"
echo ""
echo "To update after grammar changes:"
echo "  1. Run 'bun run build' in the parent repo"
echo "  2. Run 'bash scripts/update-zed-extension.sh'"
echo "  3. Reinstall dev extension in Zed"
