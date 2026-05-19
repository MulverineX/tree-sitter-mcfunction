#!/usr/bin/env bun
/**
 * Compare tree-sitter-mcfunction output against syntax-mcfunction TextMate grammar.
 * Both token streams are flattened to simple position-based lists before comparison.
 *
 * Supports comparing against:
 *   - Default: MulverineX/tree-sitter-mcfunction (our grammar)
 *   - --bbfh:  bbfh-dev/tree-sitter-mcfunction
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const AdmZip = require('adm-zip');

// vscode-textmate setup
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

// web-tree-sitter setup
const TreeSitter = require('web-tree-sitter');

// Known cases where our grammar is more accurate than syntax-mcfunction
const OURS_IS_BETTER = {
  'range': ['variable.other'],  // We correctly identify .. as range operator
  'macro_variable': ['punctuation.definition.template-expression', 'punctuation.mcfunction'],
  'line_continuation': ['keyword.operator'],  // We capture \+newline as one token
  'comment': ['variable.other'],
  'comment_content': ['variable.other'],
  'string': ['string.quoted.single'],  // Same visual result, different token name
  'component_name': ['entity.name.function'],  // Item predicates: TM sees resource locations, we use unified stateful_resource
  'predicate_operator': ['constant.numeric'],  // TM treats ~ as constant.numeric globally, we correctly identify it as predicate operator
  'macro_command_prefix': ['markup'],  // TM sees $ as italic markup, we correctly identify it as macro command prefix
};

// Known acceptable differences (documented, not suppressed):
// - Anonymous bracket tokens in NBT - highlighted via queries but not in parse tree
// - "say" command arguments - TextMate treats as string, we parse normally

// Tree-sitter node type → normalized category
// Default (MulverineX) grammar mappings
const TS_CATEGORIES = {
  'comment': 'comment',
  'comment_content': 'comment',
  'comment_marker': 'comment',
  'header_comment_content': 'markup.bold',
  'string': 'string',
  'escape_sequence': 'string',
  'number_value': 'constant',
  'nbt_type_suffix': 'variable',
  'range': 'constant',
  'coordinate': 'constant',
  'boolean': 'constant',
  'operator': 'keyword',
  'comma_operator': 'keyword',
  'line_continuation': 'keyword',
  '..': 'variable',  // range operator
  'item_wildcard': 'keyword',
  'resource_tag': 'entity',
  'predicate_operator': 'keyword',
  'negation_operator': 'keyword',
  'or_operator': 'keyword',
  'selector_operator': 'keyword',
  'nbt_colon': 'keyword',
  'nbt_equals': 'keyword',
  'nbt_array_type': 'variable',
  'nbt_semicolon': 'keyword',
  'macro_command_prefix': 'keyword',
  'time_unit': 'entity',
  'bracket_open': 'variable',
  'bracket_close': 'variable',
  'brace_open': 'punctuation',
  'brace_close': 'punctuation',
  'resource_location': 'entity',
  'component_name': 'variable',
  'run_keyword': 'entity',
  'selector_type': 'support',
  'macro_key': 'variable',
  'macro_variable': 'variable',
  'uuid': 'variable',
  'criteria_key': 'variable',
  'unquoted_string': 'string',
};

// bbfh-dev grammar node type → normalized category (matched to highlights.scm)
const BF_TS_CATEGORIES = {
  'comment': 'comment',
  'special_comment': 'variable',        // @variable.parameter in highlights
  'block_comment': 'title',             // @title in highlights
  'string': 'string',
  '_double_quoted_string': 'string',
  '_single_quoted_string': 'string',
  'greedy_string': 'string',
  'brigadier_string': 'string',
  'word': 'variable',
  '_word_token': 'variable',
  '_word_overlap': 'variable',
  '_word': 'variable',
  'identifier': 'keyword',             // @keyword.function in command
  'macro': 'tag',                       // @tag in highlights
  'macro_sign': 'tag',                  // @tag in highlights
  'backslash': 'comment',
  'generic_resource': 'markup',         // @markup.link in highlights
  'minecraft_resource': 'variable',
  'entity_selector': 'variable',
  'block_selector': 'variable',
  'item_selector': 'variable',
  'selector_identifier': 'variable',
  'score_holder': 'variable',
  'key': 'property',                    // @property in highlights
  'path': 'variable',
  '_path_node': 'variable',
  '_data_path_node': 'variable',
  'range': 'punctuation',               // @punctuation.special in highlights
  'integer': 'constant',
  'float': 'constant',
  'hexadecimal': 'constant',
  'typed_number': 'constant',
  'measurement_unit': 'keyword',        // @keyword in highlights
  'boolean': 'constant',
  'brigadier_boolean': 'constant',
  'brigadier_integer': 'constant',
  'brigadier_float': 'constant',
  'uuid': 'string',
  'color': 'constant',
  'snbt_compound': 'variable',
  'snbt_array': 'variable',
  'snbt_key_value_pair': 'variable',
  'data_compound': 'variable',
  'data_key_value_pair': 'property',    // @property in highlights for resources/keys
  'advancements_data_compound': 'variable',
  'advancements_key_value_pair': 'property',
  'argument_keyword': 'keyword',
  'subcommand_keyword': 'keyword',
  'operation': 'keyword',
  '_resource_segment': 'variable',
  '_resource_segment_word': 'variable',
  'namespace': 'variable',
  'array_type': 'keyword',              // @keyword in highlights
  '_snbt_value': 'variable',
  '_primitive_type': 'variable',
  '_composite_type': 'variable',
  '_constant': 'keyword',
  '_keywords': 'keyword',
  '_execute_command': 'keyword',
  '_generic_command': 'keyword',
  '_command_argument': 'keyword',
  'command': 'keyword',                 // top-level command (not @keyword.function)
  'execute': 'keyword',
  'say': 'keyword',
  'run': 'keyword',
  'entity': 'keyword',
  'block': 'keyword',
  'item_slot': 'constant',
  'scoreboard_objective': 'constant',
  'scoreboard_display_slot': 'constant',
  '_item_slot_identifier': 'constant',
  '_whitespace': 'punctuation',
  '_newline': 'punctuation',
  '_indentation': 'punctuation',
  '[': 'punctuation',
  ']': 'punctuation',
  '{': 'punctuation',
  '}': 'punctuation',
  '(': 'punctuation',
  ')': 'punctuation',
  ',': 'punctuation',
  ':': 'punctuation',
  '=': 'keyword',
  '.': 'keyword',
  '/': 'keyword',
  '-': 'keyword',
  '"': 'string',
  "'": 'string',
  '+': 'keyword',
  '*': 'keyword',
  '%': 'keyword',
  '^': 'punctuation',
  '~': 'punctuation',
  '..': 'punctuation',
  '|': 'punctuation',
  '!': 'keyword',
  ';': 'punctuation',
};

// Load oniguruma WASM
async function loadOniguruma() {
  const wasmPath = path.join(__dirname, '..', 'node_modules/vscode-oniguruma/release/onig.wasm');
  const wasmBin = (await fsp.readFile(wasmPath)).buffer;
  await oniguruma.loadWASM(wasmBin);
  return {
    createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
    createOnigString: (s) => new oniguruma.OnigString(s)
  };
}

// Load TextMate grammar
async function loadGrammar(onigLib) {
  const grammarPath = path.join(__dirname, 'compare', 'syntax-mcfunction', 'mcfunction.tmLanguage.json');
  const grammarContent = await fsp.readFile(grammarPath, 'utf8');

  const registry = new vsctm.Registry({
    onigLib: Promise.resolve(onigLib),
    loadGrammar: async (scopeName) => {
      if (scopeName === 'source.mcfunction') {
        return vsctm.parseRawGrammar(grammarContent, grammarPath);
      }
      return null;
    }
  });

  return await registry.loadGrammar('source.mcfunction');
}

// Load tree-sitter parser (default: MulverineX grammar)
async function loadTreeSitter() {
  await TreeSitter.Parser.init();
  const parser = new TreeSitter.Parser();
  const wasmPath = path.join(__dirname, '..', 'build', 'tree-sitter-mcfunction.wasm');
  const lang = await TreeSitter.Language.load(wasmPath);
  parser.setLanguage(lang);
  return parser;
}

// Load tree-sitter parser for bbfh-dev grammar
async function loadBbfhTreeSitter() {
  await TreeSitter.Parser.init();
  const parser = new TreeSitter.Parser();
  const wasmPath = path.join(__dirname, 'compare', 'bbfh-tree-sitter', 'tree-sitter-mcfunction.wasm');
  const lang = await TreeSitter.Language.load(wasmPath);
  parser.setLanguage(lang);
  return parser;
}

// Flatten TextMate tokens to simple list, merging sequential tokens of same category
function flattenTextMate(grammar, content) {
  const lines = content.split(/\r?\n/);
  const rawTokens = [];
  let ruleStack = vsctm.INITIAL;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = grammar.tokenizeLine(line, ruleStack);
    ruleStack = lineTokens.ruleStack;

    for (const token of lineTokens.tokens) {
      const text = line.substring(token.startIndex, token.endIndex);
      const scopes = token.scopes.filter(s => s !== 'source.mcfunction' && !s.startsWith('meta.'));

      // Skip whitespace unless it's part of a string (needed for proper merging)
      if (!text.trim() && !scopes.some(s => s.includes('string'))) continue;
      if (scopes.length === 0) continue;

      rawTokens.push({
        line: i + 1,
        start: token.startIndex,
        end: token.endIndex,
        text,
        category: normalizeScope(scopes[0]),
        scopes
      });
    }
  }

  // Merge sequential string tokens on same line (TextMate breaks strings into fragments)
  const merged = [];
  for (const tok of rawTokens) {
    const prev = merged[merged.length - 1];
    if (prev && prev.line === tok.line && prev.end === tok.start &&
        prev.category === tok.category && prev.category === 'string') {
      // Merge: extend previous token
      prev.end = tok.end;
      prev.text += tok.text;
    } else {
      merged.push({ ...tok });
    }
  }

  // Merge single-quoted strings: TextMate breaks these into fragments
  // Find ' ... ' sequences on the same line and merge into single string token
  const tokens = [];
  let i = 0;
  while (i < merged.length) {
    const tok = merged[i];
    // Check if this is a single quote starting a string
    if (tok.text === "'" && tok.scopes.some(s => s.includes('string.quoted.single'))) {
      // Find the closing quote on the same line
      let j = i + 1;
      while (j < merged.length && merged[j].line === tok.line) {
        if (merged[j].text === "'" && merged[j].scopes.some(s => s.includes('string.quoted.single'))) {
          // Found closing quote - merge everything from i to j
          const mergedTok = {
            line: tok.line,
            start: tok.start,
            end: merged[j].end,
            text: merged.slice(i, j + 1).map(t => t.text).join(''),
            category: 'string',
            scopes: ['string.quoted.single.mcfunction']
          };
          tokens.push(mergedTok);
          i = j + 1;
          break;
        }
        j++;
      }
      if (j >= merged.length || merged[j].line !== tok.line) {
        // No closing quote found, keep original token
        tokens.push(tok);
        i++;
      }
    } else {
      tokens.push(tok);
      i++;
    }
  }

  return tokens;
}

// Node types that should be emitted as terminals (don't walk into children)
// Default (MulverineX) grammar terminals
const TERMINAL_NODES = new Set([
  'string', 'comment', 'comment_content', 'comment_marker', 'header_comment_content', 'number_value', 'nbt_type_suffix', 'boolean',
  'coordinate', 'resource_location', 'selector_type', 'operator',
  'comma_operator', 'line_continuation', 'selector_operator',
  'macro_key', 'escape_sequence', 'identifier', 'word', 'command_name',
  'subcommand_name', 'nbt_key', 'selector_key', 'selector_value', 'criteria_key', 'run_keyword',
  'item_wildcard', 'resource_tag', 'predicate_operator', 'negation_operator', 'or_operator', 'component_name',
  'fakeplayer', 'dotted_identifier', 'macro_command_prefix', 'nbt_colon', 'nbt_equals', 'nbt_array_type', 'nbt_semicolon',
  'bracket_open', 'bracket_close', 'brace_open', 'brace_close',
  'time_unit', 'uuid',
  'unquoted_string'
]);

// bbfh-dev grammar terminals
// Emits all named tokens that aren't hidden (_ prefix) or structural wrappers.
// Some composite nodes (typed_number, snbt_compound, etc.) emit BOTH their
// wrapper AND children, so we capture all of them and let comparison sort it out.
const BF_TERMINAL_NODES = new Set([
  'comment', 'special_comment', 'block_comment',
  'string', '_double_quoted_string', '_single_quoted_string',
  'word', '_word_token', '_word_overlap', '_word',
  'identifier', 'macro', 'macro_sign', 'backslash',
  'generic_resource', 'minecraft_resource', 'namespace', '_resource_segment', '_resource_segment_word',
  'entity_selector', 'block_selector', 'item_selector', 'selector_identifier',
  'score_holder', 'key', 'path', '_path_node', '_data_path_node',
  'range', 'integer', 'float', 'hexadecimal', 'typed_number', 'measurement_unit',
  'boolean', 'uuid', 'color', 'vector',
  'snbt_compound', 'snbt_array', 'snbt_key_value_pair',
  'data_compound', 'data_key_value_pair',
  'advancements_data_compound', 'advancements_key_value_pair',
  'brigadier_boolean', 'brigadier_integer', 'brigadier_float', 'brigadier_string', 'greedy_string',
  'argument_keyword', 'subcommand_keyword',
  'operation',
  'array_type',
  // NOT command — it's a structural wrapper whose children carry the semantics
  'execute', 'say', 'run',
  'entity', 'block', 'item_slot',
  'scoreboard_objective', 'scoreboard_display_slot',
  '_item_slot_identifier',
  // Punctuation tokens (emitted as named nodes in bbfh)
  '=', '!=', '<', '>', '<=', '>=',
  '[', ']', '{', '}', '(', ')', ',', ':', '.', '/', '-', '+', '*', '%', '^', '~', '..', '|', ';',
  '"', "'", '!',
  'return run',
  'minecraft:',
  // Keywords from _constant
  'container', 'hotbar', 'inventory', 'enderchest', 'player.crafting',
  'contents', 'weapon', 'weapon.offhand', 'weapon.mainhand',
  'armor.head', 'armor.chest', 'armor.legs', 'armor.feet', 'armor.body',
  'horse.saddle', 'horse.chest', 'player.cursor',
]);

// Flatten tree-sitter to terminal tokens
function flattenTreeSitter(parser, content) {
  const tree = parser.parse(content);
  const lines = content.split(/\r?\n/);
  const tokens = [];
  let hasError = false;

  function walk(node) {
    if (node.type === 'ERROR') {
      hasError = true;
      return;
    }

    // Skip hidden nodes
    if (node.type.startsWith('_')) {
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i));
      }
      return;
    }

    // Emit terminal nodes directly, don't recurse into them
    if (TERMINAL_NODES.has(node.type) || node.childCount === 0) {
      const sl = node.startPosition.row;
      const sc = node.startPosition.column;
      const el = node.endPosition.row;
      const ec = node.endPosition.column;

      // Get text (single line only for comparison)
      let text = '';
      if (sl === el && lines[sl]) {
        text = lines[sl].substring(sc, ec);
      } else if (lines[sl]) {
        // Multi-line token - just get first line portion
        text = lines[sl].substring(sc);
      }

      if (text.trim()) {
        tokens.push({
          line: sl + 1,
          start: sc,
          end: sl === el ? ec : lines[sl].length,
          text,
          nodeType: node.type,
          category: TS_CATEGORIES[node.type] || null
        });
      }
      return;  // Don't recurse into terminal nodes
    }

    // Recurse into non-terminal nodes
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(tree.rootNode);

  // Sort by position
  tokens.sort((a, b) => a.line - b.line || a.start - b.start);

  return { tokens, hasError };
}

// Normalize TextMate scope to category
function normalizeScope(scope) {
  const parts = scope.split('.');
  if (parts[0] === 'punctuation') return 'punctuation';
  if (parts[0] === 'string') return 'string';
  if (parts[0] === 'comment') return 'comment';
  if (parts[0] === 'markup' && parts[1] === 'bold') return 'markup.bold';
  if (parts[0] === 'constant') return 'constant';
  if (parts[0] === 'keyword') return 'keyword';
  if (parts[0] === 'entity') return 'entity';
  if (parts[0] === 'variable') return 'variable';
  if (parts[0] === 'support') return 'support';
  return parts[0];
}

// Flatten tree-sitter to terminal tokens (bbfh variant)
function flattenBbfhTreeSitter(parser, content) {
  const tree = parser.parse(content);
  const lines = content.split(/\r?\n/);
  const tokens = [];
  let hasError = false;

  function walk(node) {
    if (node.type === 'ERROR') {
      hasError = true;
      return;
    }

    // Skip hidden nodes
    if (node.type.startsWith('_')) {
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i));
      }
      return;
    }

    // Emit terminal nodes directly, don't recurse into them
    if (BF_TERMINAL_NODES.has(node.type) || node.childCount === 0) {
      const sl = node.startPosition.row;
      const sc = node.startPosition.column;
      const el = node.endPosition.row;
      const ec = node.endPosition.column;

      let text = '';
      if (sl === el && lines[sl]) {
        text = lines[sl].substring(sc, ec);
      } else if (lines[sl]) {
        text = lines[sl].substring(sc);
      }

      if (text.trim()) {
        tokens.push({
          line: sl + 1,
          start: sc,
          end: sl === el ? ec : lines[sl].length,
          text,
          nodeType: node.type,
          category: BF_TS_CATEGORIES[node.type] || null
        });
      }
      return;
    }

    // Recurse into non-terminal nodes
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(tree.rootNode);

  tokens.sort((a, b) => a.line - b.line || a.start - b.start);

  return { tokens, hasError };
}

// Node types where we accept different granularity (contain subtokens)
const COARSE_TOKENS = new Set(['fakeplayer', 'command_name', 'coordinate', 'header_comment_content']);

// Suppress specific "missing" differences where our tokenization is correct but coarser.
// tm: the TextMate token that has no tree-sitter match
// lineTokens: all tree-sitter tokens on the same line
function isSuppressedMissing(tm, tsCommandTokens, tmLineTokens) {
  // Hyphenated path segments: TM splits identifiers containing hyphens when followed by digits
  // (e.g. U-235.fast_capture → U + -235 + . + fast_capture, U-r01e → U + - + r01e).
  // Our identifier keeps the whole segment. Suppress when the TM token is contained within a
  // hyphenated identifier that's part of a dot-separated path (operator "." adjacent).
  const hyphenatedIdent = tsCommandTokens.find(ts =>
    ts.nodeType === 'identifier' && ts.text.includes('-') &&
    ts.start <= tm.start && ts.end >= tm.end && ts.text !== tm.text
  );
  if (hyphenatedIdent) {
    const dotAdjacent = tsCommandTokens.some(ts =>
      ts.nodeType === 'operator' && ts.text === '.' &&
      (ts.end === hyphenatedIdent.start || ts.start === hyphenatedIdent.end)
    );
    if (dotAdjacent) return true;
  }

  // TextMate treats NBT key:value pairs as single entity.name.function tokens (e.g. ignited:1b).
  // We correctly split them into nbt_key + nbt_colon + value (number/boolean/string).
  // Suppress when the TM token starts at an nbt_key and ends at a following value token.
  if (tm.scopes[0]?.includes('entity.name.function')) {
    const nbtKey = tsCommandTokens.find(ts =>
      ts.nodeType === 'nbt_key' && ts.start === tm.start
    );
    if (nbtKey) {
      const valueEnd = tsCommandTokens.find(ts =>
        (ts.nodeType === 'number_value' || ts.nodeType === 'nbt_type_suffix' || ts.nodeType === 'boolean' || ts.nodeType === 'string' || ts.nodeType === 'identifier') &&
        ts.end === tm.end && ts.start > nbtKey.end
      );
      if (valueEnd) return true;
    }
  }

  // Macro-interrupted resource locations: macro variables split resource locations into word tokens.
  // TextMate emits path segments as entity.name; suppress when contained in a word adjacent to a macro.
  // Covers both: trailing paths after macro (e.g. /place after $(id)) and
  // namespace before macro (e.g. minecraft in minecraft:$(color)_candle).
  if (tm.scopes[0]?.includes('entity.name')) {
    const word = tsCommandTokens.find(ts =>
      ts.nodeType === 'word' && ts.start <= tm.start && ts.end >= tm.end
    );
    if (word) {
      const macroAdjacent = tsCommandTokens.find(ts =>
        (ts.text === ')' && ts.end === word.start) ||
        (ts.text === '$(' && ts.start === word.end)
      );
      if (macroAdjacent) return true;
    }
  }

  // TextMate splits compound operators we treat as single tokens (e.g. =! → = + !, %= → %)
  // Our selector_operator and operator tokens are more accurate semantic units.
  if (tm.scopes[0]?.includes('keyword.operator')) {
    const container = tsCommandTokens.find(ts =>
      (ts.nodeType === 'selector_operator' || ts.nodeType === 'operator') &&
      ts.start <= tm.start && ts.end >= tm.end && ts.text !== tm.text
    );
    if (container) return true;

    // Macro variables can interrupt resource locations (e.g. gm4_zauber_cauldrons:$(flower)_patch),
    // causing the namespace: portion to be absorbed into a word token.
    // TextMate still emits ":" or "=" as keyword.operator; suppress when contained in a word
    // that's immediately followed by a macro_variable start "$(".
    if (tm.text === ':' || tm.text === '=') {
      const word = tsCommandTokens.find(ts =>
        ts.nodeType === 'word' && ts.start <= tm.start && ts.end >= tm.end
      );
      if (word) {
        const macroAfter = tsCommandTokens.find(ts =>
          ts.text === '$(' && ts.start === word.end
        );
        if (macroAfter) return true;
      }
    }

    // Macro-interrupted resource locations: after a macro variable closes, the remaining path
    // (e.g. /place in myriad:block/$(id)/place) gets absorbed into a word token.
    // TextMate emits "/" as keyword.operator; suppress when contained in a word that immediately
    // follows a macro variable's closing ")".
    if (tm.text === '/') {
      const word = tsCommandTokens.find(ts =>
        ts.nodeType === 'word' && ts.start <= tm.start && ts.end >= tm.end
      );
      if (word) {
        const macroBefore = tsCommandTokens.find(ts =>
          ts.text === ')' && ts.end === word.start
        );
        if (macroBefore) return true;
      }
    }

    // TextMate splits dots out of digit-prefixed dotted identifiers (e.g. 91.timer.io → 91 + . + timer + . + io)
    // Our dotted_identifier treats it as one unit. Only suppress "." tokens strictly within a dotted_identifier span.
    if (tm.text === '.') {
      const dottedIdent = tsCommandTokens.find(ts =>
        ts.nodeType === 'dotted_identifier' && ts.start < tm.start && tm.end < ts.end
      );
      if (dottedIdent) return true;
    }
  }

  // TextMate splits camelCase NBT keys with trailing digits (e.g. addCol0 → addCol + 0).
  // Our nbt_key treats the whole identifier as a unit, which is correct.
  // Suppress the variable.other prefix only when a constant.numeric TM token immediately
  // follows to complete the same nbt_key. Suppress the constant.numeric suffix only when
  // it ends at the nbt_key boundary.
  if (tm.scopes[0]?.includes('variable.other')) {
    // Header comment lines (##...): TM emits remaining # signs as variable.other,
    // we parse as comment_marker + header_comment_content. Suppress when on a header comment line.
    const hasCommentMarker = tsCommandTokens.some(ts => ts.nodeType === 'comment_marker');
    const hasHeaderContent = tsCommandTokens.some(ts => ts.nodeType === 'header_comment_content');
    if (hasCommentMarker && hasHeaderContent) return true;

    // TextMate splits camelCase NBT keys with trailing digits (e.g. addCol0 → addCol + 0).
    // Our nbt_key treats the whole identifier as a unit, which is correct.
    // Suppress the variable.other prefix only when a constant.numeric TM token immediately
    // follows to complete the same nbt_key.
    const nbtKey = tsCommandTokens.find(ts =>
      ts.nodeType === 'nbt_key' && ts.start === tm.start && tm.end < ts.end && /\d$/.test(ts.text)
    );
    if (nbtKey) {
      const trailingDigit = tmLineTokens.find(other =>
        other !== tm &&
        other.scopes[0]?.includes('constant.numeric') &&
        other.start === tm.end && other.end === nbtKey.end
      );
      if (trailingDigit) return true;
    }

    // TextMate splits dot-separated portions out of dotted_identifiers
    // (e.g. 91.timer.total_ticks → 91 + timer.total_ticks as variable.other).
    // Our dotted_identifier keeps the whole thing as one token.
    // Suppress only when the TM token is strictly contained within a dotted_identifier
    // and the TM text is itself dot-separated (confirming it's a path fragment, not arbitrary).
    if (tm.text.includes('.')) {
      const dottedIdent = tsCommandTokens.find(ts =>
        ts.nodeType === 'dotted_identifier' && ts.start < tm.start && tm.end <= ts.end
      );
      if (dottedIdent) return true;
    }
  }

  if (tm.scopes[0]?.includes('constant.numeric')) {
    // TM emits suffixed numbers as one token (e.g. 0.0f, 3b, 1200L).
    // We split into number_value + nbt_type_suffix. Suppress when they cover the TM span.
    const numVal = tsCommandTokens.find(ts =>
      ts.nodeType === 'number_value' && ts.start === tm.start && ts.end < tm.end
    );
    if (numVal) {
      const suffix = tsCommandTokens.find(ts =>
        ts.nodeType === 'nbt_type_suffix' && ts.start === numVal.end && ts.end === tm.end
      );
      if (suffix) return true;
    }

    // Suppress trailing digit portion of camelCase nbt_key split (counterpart of above)
    const nbtKey = tsCommandTokens.find(ts =>
      ts.nodeType === 'nbt_key' && ts.end === tm.end && ts.start < tm.start && /\d$/.test(ts.text)
    );
    if (nbtKey) return true;

    // TextMate splits leading digits off dotted identifiers (e.g. 91.timer.total_ticks → 91 + .timer...)
    // Our dotted_identifier treats the whole token as a unit, which is correct.
    // Strict check: tm must be the leading numeric token, and no other constant.numeric
    // tokens from TextMate may exist within the dotted_identifier span.
    const dottedIdent = tsCommandTokens.find(ts =>
      ts.nodeType === 'dotted_identifier' && ts.start === tm.start && tm.end < ts.end
    );
    if (dottedIdent) {
      const otherNumeric = tmLineTokens.find(other =>
        other !== tm &&
        other.scopes[0]?.includes('constant.numeric') &&
        other.start >= dottedIdent.start && other.end <= dottedIdent.end
      );
      if (!otherNumeric) return true;
    }
  }

  // TextMate treats dot-separated storage paths as single string.unquoted tokens
  // (e.g. recalculate_items_iter.i, icon_font.actionbar).
  // We correctly split them into identifier + operator(.) + identifier sequences.
  // Suppress when the TM span is fully covered by adjacent identifier/operator tokens with no gaps.
  if (tm.scopes[0]?.includes('string.unquoted')) {
    // TextMate treats dot-separated storage paths as single string.unquoted tokens
    // (e.g. recalculate_items_iter.i, icon_font.actionbar).
    // We correctly split them into identifier + operator(.) + identifier sequences.
    // Suppress when the TM span is fully covered by adjacent identifier/operator tokens with no gaps.
    // Also allow string tokens for paths with quoted segments (e.g. new_orb.components."minecraft:lore")
    const covering = tsCommandTokens
      .filter(ts => ts.start >= tm.start && ts.end <= tm.end &&
        (ts.nodeType === 'identifier' || ts.nodeType === 'string' ||
         (ts.nodeType === 'operator' && ts.text === '.')))
      .sort((a, b) => a.start - b.start);
    if (covering.length >= 3 && covering[0].start === tm.start && covering[covering.length - 1].end === tm.end) {
      const contiguous = covering.every((t, i) => i === 0 || t.start === covering[i - 1].end);
      if (contiguous) return true;
    }

    // Hyphenated identifier dot-path: TM splits U-r01e.fast_capture into U + - + r01e.fast_capture,
    // where r01e.fast_capture is one string.unquoted. We parse U-r01e as one identifier + . + fast_capture.
    // Suppress when TM span starts inside a hyphenated identifier and ends at a following identifier
    // with a dot operator between them.
    const partialIdent = tsCommandTokens.find(ts =>
      ts.nodeType === 'identifier' && ts.text.includes('-') &&
      ts.start < tm.start && ts.end > tm.start
    );
    if (partialIdent) {
      const dotAfter = tsCommandTokens.find(ts =>
        ts.nodeType === 'operator' && ts.text === '.' && ts.start === partialIdent.end
      );
      if (dotAfter) {
        const identAfter = tsCommandTokens.find(ts =>
          ts.nodeType === 'identifier' && ts.start === dotAfter.end && ts.end === tm.end
        );
        if (identAfter) return true;
      }
    }

    // Leadingless float compromise: tree-sitter's longest-match consumes `.86` as a number
    // instead of operator(.) + number(86), so `trigger_map.86` becomes identifier + number(.86).
    // Suppress when a dot-path (identifier [. identifier]* . float) covers the TM span.
    const leadinglessFloat = tsCommandTokens.find(ts =>
      ts.nodeType === 'number_value' && ts.text.startsWith('.') &&
      ts.start >= tm.start && ts.end <= tm.end
    );
    if (leadinglessFloat && leadinglessFloat.end === tm.end) {
      // Walk backwards from the float: expect alternating identifier and operator(.)
      const startsAtTm = tsCommandTokens.find(ts =>
        ts.nodeType === 'identifier' && ts.start === tm.start
      );
      if (startsAtTm) {
        // Verify a chain of identifier.dot.identifier... leads to the float
        let pos = startsAtTm.end;
        while (pos < leadinglessFloat.start) {
          const dot = tsCommandTokens.find(ts =>
            ts.nodeType === 'operator' && ts.text === '.' && ts.start === pos
          );
          if (!dot) break;
          const nextIdent = tsCommandTokens.find(ts =>
            ts.nodeType === 'identifier' && ts.start === dot.end
          );
          if (!nextIdent) break;
          pos = nextIdent.end;
        }
        if (pos === leadinglessFloat.start) return true;
      }
    }

    // Sandwiched number compromise: `item_grid.0.tag` where `.0` is consumed as number(.0).
    // TM treats the full path as string.unquoted. We split it into identifier.number.identifier...
    // Suppress when TM starts at an identifier, contains a number_value starting with '.',
    // and ends at a later identifier, with a valid identifier.dot chain after the number.
    const sandwichedNum = tsCommandTokens.find(ts =>
      ts.nodeType === 'number_value' && ts.text.startsWith('.') &&
      ts.start >= tm.start && ts.end <= tm.end
    );
    if (sandwichedNum) {
      const startsAtIdent = tsCommandTokens.find(ts =>
        ts.nodeType === 'identifier' && ts.start === tm.start
      );
      if (startsAtIdent) {
        // Verify the number is truly sandwiched by walking the chain after it
        let pos = sandwichedNum.end;
        while (pos < tm.end) {
          const dot = tsCommandTokens.find(ts =>
            ts.nodeType === 'operator' && ts.text === '.' && ts.start === pos
          );
          if (!dot) break;
          const nextIdent = tsCommandTokens.find(ts =>
            ts.nodeType === 'identifier' && ts.start === dot.end
          );
          if (!nextIdent) break;
          pos = nextIdent.end;
        }
        if (pos === tm.end) return true;
      }
    }

    // Macro-interrupted resource locations: TM splits `gm4_zauber_cauldrons:$(flower)_patch` into
    // `gm4_zauber_cauldrons` (string.unquoted) + `:` + macro + `_patch`. We absorb the namespace
    // and colon into a `word` token. Suppress when TM token is contained in a word followed by a macro.
    const containingWord = tsCommandTokens.find(ts =>
      ts.nodeType === 'word' && ts.start === tm.start && ts.end > tm.end && ts.text.endsWith(':')
    );
    if (containingWord) {
      const macroAfter = tsCommandTokens.find(ts =>
        ts.text === '$(' && ts.start === containingWord.end
      );
      if (macroAfter) return true;
    }

    // TextMate greedily includes $ with preceding text (e.g. has_slot$ as string.unquoted)
    // when it's actually the start of a macro variable. We correctly split at the macro boundary.
    // Suppress when the TM token ends with $ and a macro_variable immediately follows.
    // Covers both: identifier + $ (has_slot$) and identifier + leadingless float + $ (item_grid.0$)
    if (tm.text.endsWith('$')) {
      const macroAfter = tsCommandTokens.find(ts =>
        ts.text === '$(' && ts.start === tm.end - 1
      );
      if (macroAfter) {
        // Simple case: identifier immediately before $
        const identBefore = tsCommandTokens.find(ts =>
          ts.nodeType === 'identifier' && ts.start === tm.start && ts.end === tm.end - 1
        );
        if (identBefore) return true;

        // Leadingless float case: identifier + .N before $ (e.g. item_grid.0$)
        const floatBefore = tsCommandTokens.find(ts =>
          ts.nodeType === 'number_value' && ts.text.startsWith('.') &&
          ts.end === tm.end - 1
        );
        if (floatBefore) {
          const identFirst = tsCommandTokens.find(ts =>
            ts.nodeType === 'identifier' && ts.start === tm.start && ts.end === floatBefore.start
          );
          if (identFirst) return true;
        }
      }
    }
  }

  // Scoreboard objective paths: TM treats `gm4_player_motion.internal.math` as one string.unquoted,
  // but we correctly tokenize it as identifier.operator.identifier.operator.identifier.
  // Suppress when TM token is a dot-separated path where:
  // - TM starts at an identifier
  // - TM ends at an identifier
  // - The path has no leadingless floats (those are handled separately above)
  // Uses tsLineTokens (filtered by line) to avoid cross-line token bleed from line continuations.
  if (tm.scopes[0]?.includes('string.unquoted')) {
    const tsLineTokens = tsCommandTokens.filter(ts => ts.line === tm.line);
    const startsAtIdent = tsLineTokens.find(ts =>
      ts.nodeType === 'identifier' && ts.start === tm.start
    );
    const endsAtIdent = tsLineTokens.find(ts =>
      ts.nodeType === 'identifier' && ts.end === tm.end
    );
    if (startsAtIdent && endsAtIdent) {
      // Verify it's all identifier.operator pairs with no number_value in between
      let pos = startsAtIdent.end;
      let valid = true;
      while (pos < tm.end) {
        const dot = tsLineTokens.find(ts =>
          ts.nodeType === 'operator' && ts.text === '.' && ts.start === pos
        );
        if (!dot) { valid = false; break; }
        pos = dot.end;
        const nextIdent = tsLineTokens.find(ts =>
          ts.nodeType === 'identifier' && ts.start === pos
        );
        if (!nextIdent) { valid = false; break; }
        pos = nextIdent.end;
      }
      if (valid && pos === tm.end) return true;
    }
  }

  // TextMate emits "(" as punctuation from macro variables like $(slot_id).
  // We parse "$(" as a single anonymous token, so the "(" alone has no TS match.
  // Suppress only when "(" immediately follows "$" and together they form our "$(" token.
  if (tm.scopes[0]?.includes('punctuation') && tm.text === '(') {
    const dollarParen = tsCommandTokens.find(ts =>
      ts.text === '$(' && ts.start === tm.start - 1 && ts.end === tm.end
    );
    if (dollarParen) return true;
  }

  // TextMate scopes regular # comment lines after #> as comment.block instead of comment.line.
  // We correctly parse them as a single comment token. Suppress when all TM tokens on the line
  // are comment.block and tree-sitter has a single comment covering the whole line.
  // Also covers ## header comment lines where TM incorrectly splits into comment.block + variable.other.
  if (tm.scopes[0]?.includes('comment.block')) {
    const allCommentBlock = tmLineTokens.every(t => t.scopes[0]?.includes('comment.block'));
    if (allCommentBlock && tsCommandTokens.length === 1 && tsCommandTokens[0].nodeType === 'comment') return true;

    // Header comment lines (##...): TM emits "#" as comment.block, we parse as comment_marker + header_comment_content
    const hasCommentMarker = tsCommandTokens.some(ts => ts.nodeType === 'comment_marker');
    const hasHeaderContent = tsCommandTokens.some(ts => ts.nodeType === 'header_comment_content');
    if (hasCommentMarker && hasHeaderContent) return true;
  }

  // Invalid UUIDs (e.g. extra character like 9a347e6c-1ce5-434a-b717-6707d51f4299f) partially match
  // our uuid rule, leaving trailing characters as a separate identifier. TM tokenizes the whole thing
  // as variable.uuid. Suppress when uuid (+ optional trailing identifier) covers the TM span.
  if (tm.scopes[0]?.includes('variable.uuid')) {
    const uuid = tsCommandTokens.find(ts =>
      ts.nodeType === 'uuid' && ts.start === tm.start && ts.end <= tm.end
    );
    if (uuid) {
      if (uuid.end === tm.end) return true;
      const trailing = tsCommandTokens.find(ts =>
        ts.nodeType === 'identifier' && ts.start === uuid.end && ts.end === tm.end
      );
      if (trailing) return true;
    }
  }

  // Numeric NBT keys: digit-only keys like {0:0,1:0}. Our grammar emits nbt_colon
  // for the ":" but with category: null (not in TS_CATEGORIES). TM sees it as keyword.operator.
  // Suppress when there's an nbt_colon at the same position — it's not truly "missing",
  // it's just categorized differently in our grammar.
  if (tm.category === 'keyword' && tm.text === ':') {

    // Use line-local TS tokens for numKey/pairValue to avoid cross-line leakage
    const tsLineTokens = tsCommandTokens.filter(ts => ts.line === tm.line);
    const numKey = tsLineTokens.find(ts =>
      ts.nodeType === 'number_value' && ts.end === tm.start
    );
    const pairValue = tsLineTokens.find(ts =>
      ['number_value', 'string', 'brace_open', 'bracket_open'].includes(ts.nodeType) &&
      ts.start >= tm.end
    );
    if (numKey && pairValue && numKey.end === tm.start && tm.end <= pairValue.start) {
      // Check if there is whitespace-only content between TM colon and pairValue
      const between = tmLineTokens.filter(t =>
        t.start >= tm.end && t.end <= pairValue.start
      );
      const isAllWhitespace = between.every(t => !t.text.trim());
      if (isAllWhitespace) {
        const before = (a, b) => a.line < b.line || (a.line === b.line && a.start < b.start);
        const after = (a, b) => a.line > b.line || (a.line === b.line && a.end > b.end);
        const inCompound = tsCommandTokens.some(ts =>
          ts.nodeType === 'brace_open' && before(ts, tm)
        ) && tsCommandTokens.some(ts =>
          ts.nodeType === 'brace_close' && after(ts, tm)
        );
        if (inCompound) return true;
      }
    }
  }

  // Say command: TM treats the message as string.quoted.double with leading space,
  // we correctly parse it as unquoted_string without the leading space.
  // TM text starts with space, our text doesn't — TM ends at same position as ours.
  if (tm.scopes[0]?.includes('string') && tm.text.startsWith(' ')) {
    const matchingTs = tsCommandTokens.find(ts =>
      ts.nodeType === 'unquoted_string' &&
      ts.start === tm.start + 1 &&
      !ts.text.startsWith(' ') &&
      ts.end === tm.end
    );
    if (matchingTs) return true;
  }

  return false;
}

function isSuppressedMismatch(tm, match, tsCommandTokens) {
  // Numeric macro keys: $(0) — TM sees "0" as constant.numeric, we correctly parse as macro_key.
  // Suppress only when the macro_key is bracketed by $( and ) tokens.
  if (match.nodeType === 'macro_key' && tm.scopes[0]?.includes('constant.numeric')) {
    const dollarParen = tsCommandTokens.find(ts =>
      ts.text === '$(' && ts.end === match.start
    );
    const closeParen = tsCommandTokens.find(ts =>
      ts.text === ')' && ts.start === match.end
    );
    if (dollarParen && closeParen) return true;
  }

  return false;
}

// Compare flattened token lists (exact position match)
// Merge adjacent TextMate tokens that fall within a single tree-sitter token and share the same category.
// TextMate splits camelCase identifiers (e.g. textComponent → text + Component),
// both with the same scope. Merging them before comparison avoids false "missing" diffs.
function mergeAdjacentTmTokens(tmTokens, tsTokens) {
  if (tmTokens.length === 0) return tmTokens;
  // Build line-based TS lookup for containment checks
  const tsByLine = new Map();
  for (const ts of tsTokens) {
    if (!tsByLine.has(ts.line)) tsByLine.set(ts.line, []);
    tsByLine.get(ts.line).push(ts);
  }

  const merged = [tmTokens[0]];
  for (let i = 1; i < tmTokens.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = tmTokens[i];
    if (cur.line === prev.line && cur.start === prev.end && cur.category === prev.category) {
      // Only merge if both tokens are contained within a single TS token
      const container = (tsByLine.get(cur.line) || []).find(ts =>
        ts.start <= prev.start && ts.end >= cur.end
      );
      if (container) {
        merged[merged.length - 1] = {
          ...prev,
          end: cur.end,
          text: prev.text + cur.text,
        };
        continue;
      }
    }
    merged.push(cur);
  }
  return merged;
}

function compareTokens(tmTokens, tsTokens) {
  tmTokens = mergeAdjacentTmTokens(tmTokens, tsTokens);
  const differences = [];

  // Build position map for tree-sitter tokens: "line:start:end" -> token
  const tsMap = new Map();
  for (const ts of tsTokens) {
    const key = `${ts.line}:${ts.start}:${ts.end}`;
    tsMap.set(key, ts);
  }

  // Build line-based lookups for containment checks
  const tsByLine = new Map();
  for (const ts of tsTokens) {
    if (!tsByLine.has(ts.line)) tsByLine.set(ts.line, []);
    tsByLine.get(ts.line).push(ts);
  }
  const tmByLine = new Map();
  for (const tm of tmTokens) {
    if (!tmByLine.has(tm.line)) tmByLine.set(tm.line, []);
    tmByLine.get(tm.line).push(tm);
  }

  // Build command-level token groups (merging continuation lines into one list).
  // A line ending with line_continuation belongs to the same command as the next line.
  const continuationLines = new Set();
  for (const [line, tokens] of tsByLine) {
    if (tokens.some(ts => ts.nodeType === 'line_continuation')) {
      continuationLines.add(line);
    }
  }
  // Map each line number to its command's start line
  const lineToCommandStart = new Map();
  const allLines = [...tsByLine.keys()].sort((a, b) => a - b);
  let cmdStart = allLines[0] ?? 1;
  for (const line of allLines) {
    if (!lineToCommandStart.has(line)) {
      cmdStart = line;
    }
    lineToCommandStart.set(line, cmdStart);
    if (continuationLines.has(line)) {
      // Next line continues this command
      lineToCommandStart.set(line + 1, cmdStart);
    }
  }
  // Build command-level token lists
  const tsByCommand = new Map();
  for (const [line, tokens] of tsByLine) {
    const start = lineToCommandStart.get(line) ?? line;
    if (!tsByCommand.has(start)) tsByCommand.set(start, []);
    tsByCommand.get(start).push(...tokens);
  }

  for (const tm of tmTokens) {
    const key = `${tm.line}:${tm.start}:${tm.end}`;
    const match = tsMap.get(key);

    if (!match) {
      // Check if this token is contained by a coarse token (e.g., fakeplayer)
      const lineTokens = tsByLine.get(tm.line) || [];
      const container = lineTokens.find(ts =>
        COARSE_TOKENS.has(ts.nodeType) && ts.start <= tm.start && ts.end >= tm.end
      );

      const cmdStart = lineToCommandStart.get(tm.line) ?? tm.line;
      const tsCommandTokens = tsByCommand.get(cmdStart) || tsByLine.get(tm.line) || [];
      if (!container && !isSuppressedMissing(tm, tsCommandTokens, tmByLine.get(tm.line) || [])) {
        differences.push({
          type: 'missing',
          line: tm.line,
          start: tm.start,
          end: tm.end,
          text: tm.text,
          tmCategory: tm.category,
          tmScopes: tm.scopes
        });
      }
      // else: contained by coarse token or known acceptable missing, skip
    } else if (match.category && tm.category !== match.category) {
      // Check if this is a known "ours is better" case
      const betterScopes = OURS_IS_BETTER[match.nodeType];
      const isOursBetter = betterScopes && tm.scopes.some(s =>
        betterScopes.some(bs => s.includes(bs))
      );

      const cmdStart2 = lineToCommandStart.get(tm.line) ?? tm.line;
      const tsCommandTokens2 = tsByCommand.get(cmdStart2) || tsByLine.get(tm.line) || [];
      if (!isOursBetter && !isSuppressedMismatch(tm, match, tsCommandTokens2)) {
        differences.push({
          type: 'mismatch',
          line: tm.line,
          start: tm.start,
          end: tm.end,
          text: tm.text,
          tmCategory: tm.category,
          tmScopes: tm.scopes,
          tsNodeType: match.nodeType,
          tsCategory: match.category
        });
      }
    }
    // If match.category is null (identifier/word), skip - context dependent
  }

  return differences;
}

// Main
async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let fileFilter = null;
  let verbose = false;
  let dumpAst = false;
  let fullScopes = false;
  let useBbfh = false;
  const datapackPaths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      fileFilter = args[++i];
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--scopes') {
      fullScopes = true;
    } else if (args[i] === '--ast') {
      dumpAst = true;
    } else if (args[i] === '--bbfh') {
      useBbfh = true;
    } else if (!args[i].startsWith('--')) {
      datapackPaths.push(args[i]);
    }
  }
  if (datapackPaths.length === 0) {
    // Auto-discover all packs (directories and zips) in the packs directory
    const packsDir = path.join(__dirname, 'compare', 'packs');
    const EXCLUDED_PACKS = new Set([]);
    for (const entry of await fsp.readdir(packsDir)) {
      if (EXCLUDED_PACKS.has(entry)) continue;
      datapackPaths.push(path.join(packsDir, entry));
    }
  }

  console.log('Loading oniguruma...');
  const onigLib = await loadOniguruma();

  console.log('Loading TextMate grammar...');
  const grammar = await loadGrammar(onigLib);

  console.log(`Loading tree-sitter parser (${useBbfh ? 'bbfh-dev' : 'MulverineX'})...`);
  const tsParser = useBbfh ? await loadBbfhTreeSitter() : await loadTreeSitter();

  // Collect all mcfunction files as { name, content } entries
  async function collectFiles(datapacks, filter) {
    const entries = [];
    for (const dp of datapacks) {
      if (dp.endsWith('.zip')) {
        const zip = new AdmZip(dp);
        const zipName = path.basename(dp);
        for (const entry of zip.getEntries()) {
          if (!entry.isDirectory && entry.entryName.endsWith('.mcfunction')) {
            const name = `${zipName}:${entry.entryName}`;
            if (filter && !name.includes(filter) && !path.basename(entry.entryName).includes(filter)) continue;
            entries.push({ name, content: entry.getData().toString('utf8') });
          }
        }
      } else {
        let found;
        if (filter) {
          let stat;
          try { stat = await fsp.stat(filter); } catch { stat = null; }
          if (stat?.isFile()) {
            found = [path.resolve(filter)];
          } else {
            const allFiles = await fsp.readdir(dp, { recursive: true });
            found = allFiles
              .filter(f => path.basename(f).includes(path.basename(filter)))
              .map(f => path.join(dp, f));
            if (found.length > 1) {
              console.log(`Found ${found.length} matches, using first: ${found[0]}`);
              found = [found[0]];
            }
          }
        } else {
          const allFiles = await fsp.readdir(dp, { recursive: true });
          found = allFiles
            .filter(f => f.endsWith('.mcfunction'))
            .map(f => path.join(dp, f));
        }
        for (const f of found) {
          entries.push({ name: f, content: await fsp.readFile(f, 'utf8') });
        }
      }
    }
    return entries;
  }

  // If --file points to a direct file path, use it directly
  let files;
  let directFileStat;
  try { directFileStat = await fsp.stat(fileFilter); } catch { directFileStat = null; }
  if (fileFilter && directFileStat?.isFile()) {
    files = [{ name: path.basename(fileFilter), content: await fsp.readFile(fileFilter, 'utf8') }];
  } else {
    files = await collectFiles(datapackPaths, fileFilter);

    // Also collect individual test files from compare/manual/ directory (only when using collected files)
    const manualDir = path.join(__dirname, 'compare', 'manual');
    let manualStat;
    try { manualStat = await fsp.stat(manualDir); } catch { manualStat = null; }
    if (manualStat?.isDirectory()) {
      const allFiles = await fsp.readdir(manualDir, { recursive: true });
      const manualFiles = allFiles.filter(f => f.endsWith('.mcfunction'));
      for (const f of manualFiles) {
        files.push({ name: path.join(manualDir, f), content: await fsp.readFile(path.join(manualDir, f), 'utf8') });
      }
    }
  }

  if (files.length === 0) {
    console.error('No .mcfunction files found.');
    process.exit(1);
  }
  console.log(`Found ${files.length} files to compare (from ${datapackPaths.length} source${datapackPaths.length > 1 ? 's' : ''})\n`);

  let totalDiffs = 0;
  let filesWithDiffs = 0;
  const diffSummary = {};
  const examples = {};
  let tmTotalTime = 0;
  let tsTotalTime = 0;

  for (const file of files) {
    const content = file.content;

    // Tokenize with both (timed)
    const tmStart = performance.now();
    const tmTokens = flattenTextMate(grammar, content);
    tmTotalTime += performance.now() - tmStart;

    const tsStart = performance.now();
    const tsResult = useBbfh
      ? flattenBbfhTreeSitter(tsParser, content)
      : flattenTreeSitter(tsParser, content);
    tsTotalTime += performance.now() - tsStart;

    // AST dump: show raw parse tree
    if (dumpAst) {
      console.log(`\n=== AST: ${path.basename(file.name)} ===`);
      const tree = tsParser.parse(content);
      function walkAst(node, indent) {
        const text = node.childCount === 0 ? ` "${node.text.replace(/\n/g, '\\n')}"` : '';
        console.log(`${indent}(${node.type}${text})`);
        for (let i = 0; i < node.childCount; i++) walkAst(node.child(i), indent + '  ');
      }
      walkAst(tree.rootNode, '');
    }

    // Verbose: dump both token streams side by side
    if (verbose) {
      console.log(`\n=== ${path.basename(file.name)} ===`);
      const allLines = new Set([
        ...tmTokens.map(t => t.line),
        ...tsResult.tokens.map(t => t.line)
      ]);
      const contentLines = content.split(/\r?\n/);
      for (const lineNum of [...allLines].sort((a, b) => a - b)) {
        console.log(`\nLine ${lineNum}: ${contentLines[lineNum - 1]}`);
        const tmLine = tmTokens.filter(t => t.line === lineNum);
        const tsLine = tsResult.tokens.filter(t => t.line === lineNum);
        console.log('  TextMate:    ' + tmLine.map(t => fullScopes ? `[${t.text}:${t.scopes.join(' ')}]` : `[${t.text}:${t.category}]`).join(' '));
        console.log('  Tree-sitter: ' + tsLine.map(t => `[${t.text}:${t.nodeType}→${t.category}]`).join(' '));
      }
    }

    // Compare
    const diffs = compareTokens(tmTokens, tsResult.tokens);

    if (diffs.length > 0) {
      filesWithDiffs++;
      totalDiffs += diffs.length;

      for (const diff of diffs) {
        const key = diff.type === 'mismatch'
          ? `${diff.tsNodeType} vs ${diff.tmScopes[0]}`
          : `missing: ${diff.tmScopes[0]}`;
        diffSummary[key] = (diffSummary[key] || 0) + 1;

        if (!examples[key] || examples[key].length < 3) {
          if (!examples[key]) examples[key] = [];
          examples[key].push({
            file: file.name,
            line: diff.line,
            text: diff.text,
            context: content.split('\n')[diff.line - 1]?.substring(0, 300)
          });
        }
      }
    }
  }

  // Detailed output to file
  const outputPath = path.join(__dirname, 'compare', 'output.txt');
  const lines = [];
  lines.push('========================================');
  lines.push('SUMMARY');
  lines.push('========================================');
  lines.push(`Total files: ${files.length}`);
  lines.push(`Files with differences: ${filesWithDiffs}`);
  lines.push(`Total differences: ${totalDiffs}`);
  lines.push(`\nTokenization time:`);
  lines.push(`  TextMate:    ${(tmTotalTime / 1000).toFixed(2)}s`);
  lines.push(`  Tree-sitter: ${(tsTotalTime / 1000).toFixed(2)}s`);
  lines.push('\nDifference breakdown:');

  const sorted = Object.entries(diffSummary).sort((a, b) => b[1] - a[1]);
  for (const [key, count] of sorted.slice(0, 20)) {
    lines.push(`  ${count}: ${key}`);
    if (examples[key]) {
      for (const ex of examples[key]) {
        lines.push(`      "${ex.text}" in ${ex.file}:${ex.line}`);
        lines.push(`      Context: ${ex.context}`);
      }
    }
  }
  await fsp.writeFile(outputPath, lines.join('\n') + '\n');

  // Extract/symlink one test file per diff category (skip in --file mode to preserve manual test files)
  if (!fileFilter) {
    const testsDir = path.join(__dirname, 'compare', 'tests');
    let testsDirStat;
    try { testsDirStat = await fsp.stat(testsDir); } catch { testsDirStat = null; }
    if (testsDirStat?.isDirectory()) {
      for (const f of await fsp.readdir(testsDir)) {
        await fsp.unlink(path.join(testsDir, f));
      }
    } else {
      await fsp.mkdir(testsDir, { recursive: true });
    }
    const seenFiles = new Set();
    for (const [key] of sorted) {
      const ex = examples[key]?.[0];
      if (!ex) continue;
      const category = key.replace(/[^a-zA-Z0-9_.]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const sourceName = ex.file;

      if (seenFiles.has(sourceName)) continue;
      seenFiles.add(sourceName);

      const baseName = path.basename(sourceName, '.mcfunction');
      const testName = `${category}--${baseName}.mcfunction`;
      const testPath = path.join(testsDir, testName);

      if (sourceName.includes('.zip:')) {
        const [zipPath, entryPath] = (() => {
          for (const dp of datapackPaths) {
            if (dp.endsWith('.zip') && sourceName.startsWith(path.basename(dp) + ':')) {
              const entry = sourceName.slice(path.basename(dp).length + 1);
              return [dp, entry];
            }
          }
          return [null, null];
        })();
        if (zipPath) {
          const zip = new AdmZip(zipPath);
          const entry = zip.getEntry(entryPath);
          if (entry) {
            await fsp.writeFile(testPath, entry.getData().toString('utf8'));
          }
        }
      } else {
        const absSource = path.resolve(sourceName);
        await fsp.symlink(absSource, testPath);
      }
    }
  }

  // Console summary
  const grammarLabel = useBbfh ? 'bbfh-dev' : 'MulverineX';
  console.log(`\n${files.length} files, ${filesWithDiffs} with differences, ${totalDiffs} total diffs (${(tmTotalTime / 1000).toFixed(2)}s TM, ${(tsTotalTime / 1000).toFixed(2)}s TS) — ${grammarLabel} grammar`);
  if (sorted.length > 0) {
    console.log('');
    for (const [key, count] of sorted) {
      console.log(`  ${count}  ${key}`);
    }
  }
  console.log(`\nDetailed output: ${outputPath}`);
  console.log(`\nUse --bbfh flag to compare against bbfh-dev grammar instead`);
}

main().catch(console.error);
