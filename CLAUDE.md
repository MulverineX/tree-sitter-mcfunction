# tree-sitter-mcfunction

Tree-sitter grammar for Minecraft mcfunction files.

## Project Structure

```
src/grammar.js                    # Main grammar definition
src/queries/highlights.scm        # Syntax highlighting rules
src/queries/brackets.scm          # Bracket matching rules
build/src/                        # Generated parser files (grammar.json, parser.c, etc.)
build/tree-sitter-mcfunction.wasm # WASM parser for browser/node
scripts/compare-grammars.js       # Comparison tool: tree-sitter vs TextMate
scripts/setup-zed-extension.sh    # Creates zed-extension/ for dev testing in Zed
scripts/update-zed-extension.sh   # Bumps version and clears cache in zed-extension/
scripts/compare/packs/            # Datapack folders and zips for comparison testing
scripts/compare/syntax-mcfunction/ # Reference TextMate grammar
scripts/compare/tests/            # Auto-generated test files (one per diff category)
scripts/compare/output.txt        # Detailed comparison output
test/                             # Tree-sitter test corpus
```

**Note:** The `src/` directory should only contain `grammar.js` and `queries/`. All generated parser files (`grammar.json`, `parser.c`, `node-types.json`) are placed in `build/src/`.

## Development Workflow

### Working Procedure

When making grammar changes, follow this cycle:

1. **Edit** `src/grammar.js` (and `src/queries/highlights.scm` / `scripts/compare-grammars.js` as needed)
2. **Generate and build**: `bun run build`
3. **Quick parse test** to verify the change works: `echo 'command here' | npx tree-sitter parse /dev/stdin`
4. **Run comparison**: `bun run compare`
6. **Analyze results**: Check `Total differences` and the breakdown

For investigating specific diffs:
- Use `--file <path>` to test a single file
- Use `--verbose` to see full token-by-token comparison
- Use `--scopes` to show full TextMate scope stacks (e.g. `comment.block.mcfunction` instead of just `comment`)
- Use `--ast` to dump the tree-sitter parse tree
- The compare script auto-extracts one test file per diff category into `scripts/compare/tests/`
- Detailed output goes to `scripts/compare/output.txt`; console shows a short summary
- Add new datapacks to `scripts/compare/packs/` (folders or zips)

**IMPORTANT:**
- The comparison script is the primary testing method for tokenization accuracy
- Use `tree-sitter test` for grammar regression testing via the test corpus
- Expand `compare-grammars.js` rather than writing one-off scripts
- When adding debug logging, remember to remove it after
- When adding new named terminal rules, add them to `TERMINAL_NODES` and `TS_CATEGORIES` in the comparison script
- When adding new highlight-relevant nodes, add them to `src/queries/highlights.scm`
- **Never write throwaway scripts to `/tmp/` or anywhere else**, and never run inline script code via `bun -e` or similar. If the existing tools don't cover what's needed, ask the user for guidance rather than improvising.
- **Never use `git stash`** — it can silently lose uncommitted work from different change sets. Instead, comment out changes temporarily or use worktrees.
- The TextMate grammar repo is at `scripts/compare/syntax-mcfunction/` — read it directly instead of fetching from GitHub.

### Build Commands

```bash
bun run generate     # Generate parser from grammar.js
bun run build        # Generate parser + build WASM
bun run test         # Run tree-sitter test corpus
bun run compare      # Compare against TextMate grammar
bun run zed:setup    # Create zed-extension/ for dev testing in Zed
bun run zed:update   # Rebuild grammar repo + bump version in zed-extension/
```

### Testing Against TextMate

The primary testing method is comparing against the reference TextMate grammar (syntax-mcfunction):

```bash
bun run compare
```

This compares tokenization of all `.mcfunction` files from multiple sources:
- All folders and zips in `scripts/compare/packs/`

You can also pass explicit paths: `bun run compare /path/to/datapack /path/to/pack.zip`

### Testing in Zed

1. Bump version in `extension.toml`
2. Delete `grammars/` folder (clears Zed's cache)
3. Commit changes
4. In Zed: `zed: install dev extension` on this directory

## Key Grammar Concepts

### Token Categories (TS_CATEGORIES in compare-grammars.js)

Maps tree-sitter node types to comparison categories for TextMate matching:
- `keyword`: operators, control flow
- `string`: quoted strings
- `constant`: number_value, coordinates, booleans, ranges
- `entity`: resource locations, time units
- `variable`: identifiers, macro keys, component names, nbt array types, UUIDs, nbt_type_suffix
- `support`: selector types (@a, @e, etc.)

### TERMINAL_NODES

Node types that should be emitted as tokens (leaf nodes for comparison). Add new named terminal rules here.

### COARSE_TOKENS

Node types where we accept different granularity than TextMate. TextMate may split these into subtokens, but we keep them as one unit:
- `fakeplayer`: `$name` / `#name` as one token
- `command_name`: `$execute` as one token (TextMate splits `$` + `execute`)
- `coordinate`: `~-1` as one token (TextMate splits `~` + `-1`)

### OURS_IS_BETTER

Cases where our tokenization is intentionally different and preferred:
- `range`: `0..10` as structured vs TextMate's flat tokens
- `macro_variable`: `$(key)` structure vs TextMate's punctuation
- `string`: single-quoted strings (same visual result)
- `comment`/`comment_content`: TextMate incorrectly emits `markup.bold` for some comment content
- `component_name` vs `entity.name.function`: item predicates use unified `stateful_resource` (TODO: should be a specific suppressor instead of OURS_IS_BETTER)
- `predicate_operator` vs `constant.numeric`: TM treats `~` as numeric globally, we correctly identify it as predicate operator

### mergeAdjacentTmTokens (compare-grammars.js)

Pre-comparison step that merges adjacent TextMate tokens with the same category when they both fall within a single tree-sitter token. Handles camelCase splitting (e.g. TextMate splits `textComponent` → `text` + `Component`, both `variable.other`; merge reunites them to match our `nbt_key`).

### isSuppressedMissing (compare-grammars.js)

Targeted suppression for "missing" diffs where our tokenization is correct but structured differently. Each suppression has strict context checks:
- `entity.name.function`: NBT key:value pairs — TM sees `ignited:1b` as one token, we split into `nbt_key` + `nbt_colon` + `number_value` (+ optional `nbt_type_suffix`)
- `keyword.operator` inside `selector_operator`/`operator` spans: TM splits `=!` → `=` + `!`
- `keyword.operator` `:` or `=` inside `word` followed by `$(` macro: macro-interrupted resource locations
- `keyword.operator` `.` inside `dotted_identifier`: TM splits dots out of digit-prefixed paths
- `variable.other` prefix of `nbt_key` with trailing digit: TM splits `addCol0` → `addCol` + `0`
- `variable.other` dot-separated fragment inside `dotted_identifier`: TM splits `91.timer.total_ticks`
- `constant.numeric` suffixed numbers: TM emits `0.0f`/`3b`/`1200L` as one token, we split into `number_value` + `nbt_type_suffix`
- `constant.numeric` suffix of `nbt_key`: counterpart of the `addCol0` split
- `constant.numeric` leading digits of `dotted_identifier`
- `string.unquoted` dot-separated paths: our `identifier` + `.` + `identifier` (+ optional `string`) sequence covers the TM span
- `string.unquoted` with sandwiched number: `item_grid.0.tag` where `.0` is consumed as `number_value(.0)` — TM treats full path as `string.unquoted`, we split correctly
- `string.unquoted` with scoreboard paths: `gm4_player_motion.internal.math` — TM treats as one `string.unquoted`, we tokenize as `identifier.operator.identifier.operator.identifier`
- `string.unquoted` with leadingless float: `trigger_map.86` → `identifier` + `number_value(.86)` due to longest-match rule
- `string.unquoted` ending with `$` before macro: TM includes `$` with preceding text (`has_slot$`)
- `string.unquoted` inside macro-interrupted resource location: `gm4_zauber_cauldrons:$(flower)` — TM splits namespace, we absorb into `word` ending with `:`
- `punctuation` `(` inside macro `$(`: TM emits `(` separately, we have `$(` as one anonymous node
- `comment.block` lines after `#>`: TM scopes regular `#` comments as `comment.block` when they follow `#>` header comments; visually identical
- `variable.uuid` for invalid UUIDs: malformed UUIDs (e.g. extra trailing char) partially match our `uuid` rule + trailing `identifier`

### Known Accepted Compromises

Diffs that are intentionally not fixed and must be suppressed in the comparison script:
- `component_name` vs `entity.name.function` inside `*[...]` item predicates: TextMate treats bare resource locations like `minecraft:rarity` as `entity.name.function`, but our unified `stateful_resource` rule uses `component_name` for all predicate content. Fixing this would require backtracking between block state and item predicate contexts, which tree-sitter can't do. The visual result in Zed is `@property` vs `@function` — a minor difference we accept.
- Leadingless float numbers (`.86`): tree-sitter's longest-match rule consumes `.86` as a number even after an identifier (`trigger_map.86`), when ideally `.` would be an operator. Can't fix without an external scanner (C code) — not worth the complexity.
- Macro ranges (`$(min)..$(max)`): The `range` rule expects numeric values. When macros are used as range endpoints, tree-sitter creates an ERROR node that swallows `..$(max)` tokens. The `$(min)` parses correctly, but the `..` triggers an error since it expects a number. The comparison script's token extraction doesn't recover these lost tokens. Would require either: (1) extending range to accept macro_variable (creates grammar conflicts), or (2) an external scanner. Visually, the macro variables still get some highlighting via error recovery, but it's inconsistent.

## Tree-sitter Lexer Behavior

Key rules that affect grammar design:
- **Longer match wins**: When two tokens could match, tree-sitter picks the longer one regardless of precedence
- **Precedence only breaks ties at same length**: `prec()` on tokens only matters when matches are equally long
- **`token.immediate` anchoring**: Use to attach a token to the preceding one without whitespace — critical for disambiguating short tokens (e.g. `[BIL]` as `nbt_array_type` after `[`)
- **No regex lookahead or lookbehind**: Tree-sitter doesn't support `(?=...)` or `(?<=...)` in regex patterns, and there's no way to peek at preceding characters without an external scanner
- **`repeat()` is greedy per iteration**: In `repeat(_token)`, each `_token` is matched independently — multi-token sequences inside `_token` choices won't "steal" tokens already consumed by a previous iteration
- **Catch-all tokens need care**: The `word` rule has `prec(-1)` and excludes leading digits so `number` + `time_unit` can match `20t` instead of `word` consuming it whole

## Grammar Structure

### Main Rules

- `root` → lines of commands
- `_token` → choice of all token types
- `command_name` → first identifier (supports `$` prefix for macros)
- `run_command` → `run` keyword + subcommand in execute chains; supports `say_command` as subcommand
- `say_command` → `say <unquoted_string>` — the message after `say` is parsed as `unquoted_string`
- `unquoted_string` → raw text after `say` command, excludes leading whitespace
- `header_comment` → `##` or `#>` lines; `comment_marker` for the prefix, `header_comment_content` for the body (highlighted `@keyword` for visibility)
- `fakeplayer` → matches `$name`, `$$macro`, and `#name` (hash-prefixed internal scoreboard holders)
- `operator` → includes bare `=` (safe since selectors/NBT use higher-precedence `selector_operator`/`nbt_equals` inside their own rules)

### Selectors

- `selector` → `@a[...]`, `@e[...]`, etc.
- `selector_arguments` → bracket contents with key-value pairs
- `selector_pair` → `key=value` or `key=!value`
- `advancement_selector_pair` → `advancements={resource_location=boolean, ...}` — specialized pair with `prec(3)` on the `"advancements"` string literal to beat `selector_key` regex
- `advancement_criteria` → `{criterion=boolean, ...}` — nested compound for per-criterion advancement checks
- `macro_variable` is valid inside selector arguments, advancement compounds, stateful arguments, and block state pair values

### NBT/SNBT

- `nbt_compound` → `{key: value, ...}`
- `nbt_list` → `[value, ...]` with optional `nbt_array_prefix`
- `nbt_array_prefix` → `B;`, `I;`, `L;` — split into `nbt_array_type` (letter, via `token.immediate` anchored to `[`) + `nbt_semicolon` (`;`)
- `nbt_pair` → `nbt_key` + `:` or `=` (alphabetic keys only, value is a sibling not child)
- `dotted_identifier` → `/\d+\.[a-zA-Z_][a-zA-Z0-9_.\-]*/` — digit-prefixed dotted paths like `91.timer.total_ticks`
- `nbt_equals` has `token(prec(2, "="))` to take priority over `selector_operator` inside NBT compounds
- `nbt_indexed_path` → `resource_location[number]` (e.g. `explosions[0]`) with `prec(6)` to beat `stateful_resource`

### Stateful Resources (block states + item predicates)

- `stateful_resource` → unified rule for `resource_location[...]`, `*[...]`, `#tag[...]`
- `stateful_arguments` → bracket contents using `token.immediate(prec(5, "["))` for attachment
- `_stateful_inner` → accepts block state content, item predicate content, and `macro_variable`
- `block_state_pair` → `component_name = value` where value can be `boolean`, `number`, `component_name`, or `macro_variable`
- `component_name` → `/[a-z_][a-z0-9_.\-]*(:[a-z0-9_.\-\/]+)?/` — used for both block state keys/values and item predicate components

Previously `block_with_state` and `item_predicate` were separate rules, but tree-sitter can't backtrack between them when both start with `resource_location[`. Merging them into `stateful_resource` resolves this.

### Numbers and Ranges

- `_number_literal` → hidden token matching `[+-]?\d*\.\d+` or `[+-]?\d+` (raw numeric value without suffix)
- `number` → `seq(number_value, optional(nbt_type_suffix))` — parser-level rule that splits the numeric value from its type suffix
- `number_value` → alias of `_number_literal`, the visible numeric part
- `nbt_type_suffix` → `token.immediate(prec(3, /[bBsSlLfFdD]/))` — type suffix anchored to preceding number
- `range` → uses `_number_literal` directly (aliased to `number_value`), not `number`, since ranges don't have type suffixes
- `time_value` → `seq(_number_literal, time_unit)` — also uses raw literal, not `number`
- `time_unit` → `token.immediate(/[tsd]/)` — attached to preceding number
- `uuid` → `token(/[0-9a-fA-F]{1,8}-...-[0-9a-fA-F]{1,12}/)` — single lexer token so longest-match beats `number`; supports shorthand UUIDs (e.g. `ec-0-0-0-1`)
- WARNING: digit-prefixed strings like `43jkl` split into `number` + `identifier` instead of `word`
- WARNING: leadingless floats like `.86` get consumed as `number_value` even after identifiers due to longest-match

### Macros

- `macro_variable` → `$(key)` — valid in `_token`, `_nbt_inner`, `_stateful_inner`, `_selector_inner`, `_advancement_inner`, `block_state_pair` values, and strings
- `macro_key` → the identifier inside `$()`
- `macro_command_prefix` → the `$` prefix for full macro commands like `$$(command)` — uses `alias("$", $.macro_command_prefix)` in `_tokens` to name it for highlighting without creating a standalone lexer token that would interfere with mid-line `$(` parsing

## Highlight Tokens (highlights.scm)

Key mappings:
- `@keyword` / `@keyword.control`: commands, operators, nbt_array_type, nbt_type_suffix, header_comment_content, macro_command_prefix
- `@function`: resource locations, resource tags
- `@property`: selector keys/values, component names, nbt keys, fakeplayers
- `@variable`: selectors, identifiers, UUIDs
- `@number`: coordinates, number_value, booleans
- `@string`: quoted strings
- `@comment`: comments (regular `#` lines), header comments
- `@operator`: nbt_colon, nbt_semicolon, nbt_equals, selector_operator, predicate_operator, etc.
- `@label`: `run` keyword (uncolored in VSCode Dark Modern)

## Debugging Tips

1. **Parse errors**: Check `tree.rootNode` for `ERROR` nodes — they can swallow multiple lines, not just the line with the error
2. **Zed caching**: Delete `grammars/` folder and bump version
3. **Precedence conflicts**: Use `prec()`, `prec.left()`, `prec.right()`
4. **Token attachment**: Use `token.immediate()` for adjacent tokens
5. **Anonymous vs named**: Anonymous nodes (string literals) are hidden; use `alias()` to name them
6. **Lexer wins over parser**: If a catch-all token matches more characters, no amount of parser precedence will override it — restructure the lexer rules instead

## Current Status

As of 2026-05-19: **0 diffs** across 4378 files.

### Commit Notes
- `934b184` commit message understates the scope — includes significant changes beyond advancement_criteria and macro support. Read the diff before amending docs or referencing what changed.
