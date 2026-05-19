/**
 * Tree-sitter grammar for Minecraft mcfunction files.
 *
 * Inspired by:
 * - mc-script's context-based sublime-syntax structure
 * - syntax-mcfunction's TextMate patterns for compatibility
 */

module.exports = grammar({
  name: "mcfunction",

  extras: ($) => [],

  // GLR conflicts: parser explores both paths and picks the one that succeeds
  conflicts: ($) => [
    [$.number, $._range_endpoint],
    [$._token, $._range_endpoint],
    [$._nbt_inner, $._range_endpoint],
    [$._selector_inner, $._range_endpoint],
    [$._stateful_inner, $._range_endpoint],
  ],

  rules: {
    root: ($) => seq(
      // Handle first line (no preceding newline)
      optional($._first_line),
      // Handle subsequent lines
      repeat($._line)
    ),

    _first_line: ($) => choice(
      $.header_comment,
      $.comment,
      $._tokens
    ),

    _line: ($) => seq(
      $._eol,
      optional(choice(
        $.header_comment,
        $.comment,
        $._tokens
      ))
    ),

    _eol: ($) => /\r?\n|\r/,

    // =========================================================================
    // Comments - must be first thing on a line
    // =========================================================================

    header_comment: ($) => seq(
      optional($._indent),
      alias(choice("##", "#>"), $.comment_marker),
      optional($.header_comment_content)
    ),

    header_comment_content: ($) => /[^\r\n]+/,

    comment: ($) => seq(
      optional($._indent),
      "#",
      optional($.comment_content)
    ),

    _indent: ($) => /[ \t]+/,
    comment_content: ($) => /[^\r\n]+/,

    // =========================================================================
    // Tokens - content of a non-comment line
    // =========================================================================

    _tokens: ($) => seq(
      optional($._whitespace),
      choice(
        $.say_command,
        seq($.command_name, repeat($._token)),
        // Full macro command: $$(command) — entire command is a macro expansion
        // Using alias to name the $ for highlighting without creating a standalone lexer token
        seq(alias("$", $.macro_command_prefix), $.macro_variable, repeat($._token))
      )
    ),

    // Command name - first identifier on a line, can start with $ for macros
    command_name: ($) => /\$?[a-zA-Z_][a-zA-Z0-9_.\-]*/,

    _token: ($) => choice(
      $.line_continuation,
      $.run_command,
      $.nbt_indexed_path,
      $.stateful_resource,
      $.resource_location,
      $.selector,
      $.nbt_compound,
      $.nbt_list,
      $.string,
      $.time_value,
      $.uuid,
      $.range,
      $.coordinate,
      $.number,
      $.boolean,
      $.operator,
      $.macro_variable,
      $.fakeplayer,
      $.identifier,
      $.word,
      $._whitespace
    ),

    // Subcommand after "run" in execute chains (supports line continuation)
    run_command: ($) => seq(
      $._whitespace,
      $.run_keyword,
      $._whitespace,
      optional(seq($.line_continuation, optional($._whitespace))),
      choice($.say_command, $.subcommand_name)
    ),

    run_keyword: ($) => "run",

    // Say command: "say <unquoted string>" — everything after the space is an unquoted string
    say_command: ($) => seq(
      alias("say", $.command_name),
      $._whitespace,
      $.unquoted_string
    ),

    unquoted_string: ($) => /[^\r\n]+/,

    subcommand_name: ($) => /[a-zA-Z_][a-zA-Z0-9_.\-]*/,

    _whitespace: ($) => /[ \t]+/,

    // =========================================================================
    // Line continuation - backslash before newline
    // =========================================================================

    line_continuation: ($) => token(seq(
      "\\",
      /[ \t]*/,
      /\r?\n|\r/
    )),

    // =========================================================================
    // Macro variable: $(key)
    // =========================================================================

    // Macro variable: $(key)
    macro_variable: ($) => seq(
      "$(",
      $.macro_key,
      ")"
    ),

    macro_key: ($) => /[a-zA-Z0-9_]+/,

    // =========================================================================
    // Resource locations: namespace:path, #namespace:path (tags)
    // =========================================================================

    resource_location: ($) => token(prec(3, seq(
      optional("#"),
      /[a-z0-9_][a-z0-9_.\-]*/,
      ":",
      /[a-z0-9_.\-\/]+/
    ))),

    // =========================================================================
    // Selectors
    // =========================================================================

    selector: ($) => prec.right(seq(
      $.selector_type,
      optional($.selector_arguments)
    )),

    selector_type: ($) => /@[aeprsn]/,

    selector_arguments: ($) => seq(
      $.bracket_open,
      repeat($._selector_inner),
      $.bracket_close
    ),

    _selector_inner: ($) => choice(
      $.line_continuation,
      $.nbt_compound,
      $.advancement_selector_pair,
      $.selector_pair,
      $.macro_variable,
      $.resource_location,
      $.range,
      $.number,
      $.boolean,
      $.string,
      $.identifier,
      $.comma_operator,
      /[=!]/,
      $._whitespace
    ),

    // Specialized selector pair for advancements={resource_location=boolean, ...}
    // NOTE: Fixing this exposes +22 variable.other and +45 punctuation diffs from files
    // that previously had ERROR nodes swallowing multiple lines (item predicate issues).
    advancement_selector_pair: ($) => prec(3, seq(
      alias(token(prec(3, "advancements")), $.selector_key),
      $.selector_operator,
      $.advancement_compound
    )),

    advancement_compound: ($) => seq(
      $.brace_open,
      repeat($._advancement_inner),
      $.brace_close
    ),

    _advancement_inner: ($) => choice(
      $.advancement_pair,
      $.macro_variable,
      $.comma_operator,
      $._whitespace
    ),

    advancement_pair: ($) => seq(
      $.resource_location,
      $.nbt_equals,
      choice($.boolean, $.advancement_criteria)
    ),

    // Criteria compound: {criterion=boolean, ...}
    advancement_criteria: ($) => seq(
      $.brace_open,
      repeat($._criteria_inner),
      $.brace_close
    ),

    _criteria_inner: ($) => choice(
      $.criteria_pair,
      $.macro_variable,
      $.comma_operator,
      $._whitespace
    ),

    criteria_pair: ($) => seq(
      $.criteria_key,
      $.nbt_equals,
      $.boolean
    ),

    criteria_key: ($) => /[a-zA-Z0-9_]+/,

    // Selector key=value pair - captures both for highlighting
    // The = or =! is the selector_operator
    selector_pair: ($) => seq(
      $.selector_key,
      $.selector_operator,
      optional($.selector_value)
    ),

    selector_key: ($) => token(prec(2, /[a-zA-Z_][a-zA-Z0-9_]*/)),

    // Selector operator: = or =! (negation)
    selector_operator: ($) => token.immediate(prec(2, /=!?/)),

    // Selector value - identifier-like values after = or =! (e.g., tag=fetchr.card_frame, gamemode=!survival)
    // Does not start with digits so numeric values fall through to range/number tokens
    selector_value: ($) => token.immediate(prec(2, /[a-zA-Z_][a-zA-Z0-9_.:\-]*/)),

    // =========================================================================
    // NBT path array index (e.g., Pos[1], explosions[0])
    // Uses token.immediate with prec(6) to take priority over block_with_state (prec 5)
    nbt_indexed_path: ($) => prec(6, seq(
      $.resource_location,
      alias(token.immediate(prec(5, "[")), $.bracket_open),
      $.number,
      $.bracket_close
    )),

    // Block with State (e.g., minecraft:stone[axis=y])
    // Uses token.immediate on bracket to attach directly to resource_location
    // =========================================================================

    // Block with state requires 3 preceding coordinates (e.g., setblock ~ ~ ~ minecraft:stone[axis=y])
    // This prevents it from consuming item predicates like minecraft:potion[potion_contents=...]
    // =========================================================================
    // Stateful Resource: resource_location, item_wildcard, or item_tag with optional [...]
    // Handles both block states (minecraft:stone[axis=y]) and item predicates
    // (minecraft:potion[potion_contents="minecraft:water"], *[custom_data~{...}])
    // Merged into one rule because tree-sitter can't backtrack between them.
    // =========================================================================

    stateful_resource: ($) => prec.right(5, seq(
      choice($.item_wildcard, $.resource_location, $.resource_tag),
      optional($.stateful_arguments)
    )),

    item_wildcard: ($) => "*",

    // Item tag reference (e.g., #minecraft:planks)
    resource_tag: ($) => /#[a-z_][a-z0-9_.\-]*:[a-z0-9_.\-\/]+/,

    stateful_arguments: ($) => seq(
      alias(token.immediate(prec(5, "[")), $.bracket_open),
      repeat($._stateful_inner),
      $.bracket_close
    ),

    _stateful_inner: ($) => choice(
      // Item predicate content (checked first)
      $.component_name,
      // Block state pairs (key=value with simple values)
      $.block_state_pair,
      $.macro_variable,
      $.nbt_compound,
      $.nbt_list,
      $.string,
      $.range,
      $.number,
      $.boolean,
      $.comma_operator,
      $.nbt_equals,
      $.predicate_operator,
      $.negation_operator,
      $.or_operator,
      $._whitespace
    ),

    block_state_pair: ($) => seq(
      $.component_name,
      "=",
      choice($.boolean, $.number, $.component_name, $.macro_variable)
    ),

    _item_predicate_inner: ($) => choice(
      $.component_name,
      $.nbt_compound,
      $.nbt_list,
      $.string,
      $.range,
      $.number,
      $.boolean,
      $.comma_operator,
      $.nbt_equals,
      $.predicate_operator,
      $.negation_operator,
      $.or_operator,
      $._whitespace
    ),

    // Component name in item predicates - can be namespaced (minecraft:rarity) or implicit (count)
    component_name: ($) => /[a-z_][a-z0-9_.\-]*(:[a-z0-9_.\-\/]+)?/,

    // ~ operator for sub-predicates (e.g., count~{min:1})
    predicate_operator: ($) => "~",

    // ! operator for negation in predicates
    negation_operator: ($) => "!",

    // | operator for OR in predicates
    or_operator: ($) => "|",

    // =========================================================================
    // NBT
    // =========================================================================

    nbt_compound: ($) => seq($.brace_open, repeat($._nbt_inner), $.brace_close),

    nbt_list: ($) => seq(
      $.bracket_open,
      optional($.nbt_array_prefix),
      repeat($._nbt_inner),
      $.bracket_close
    ),

    // Typed array prefix: [B; ...], [I; ...], [L; ...]
    // token.immediate anchors the letter to the preceding [, so the lexer
    // can distinguish B/I/L-as-array-type from B/I/L-as-identifier.
    nbt_array_prefix: ($) => seq(
      alias(token.immediate(prec(3, /[BIL]/)), $.nbt_array_type),
      alias(token.immediate(";"), $.nbt_semicolon)
    ),

    _nbt_inner: ($) => choice(
      $.line_continuation,
      $.nbt_compound,
      $.nbt_list,
      $.nbt_pair,
      $.json_pair,
      $.macro_variable,
      $.string,
      $.range,
      $.number,
      $.boolean,
      $.comma_operator,
      $.nbt_equals,
      $.dotted_identifier,
      $.identifier,
      /[:;]/,
      $._whitespace
    ),

    // NBT key:value pair - captures key for highlighting
    nbt_pair: ($) => prec(2, seq(
      $.nbt_key,
      choice($.nbt_colon, $.nbt_equals)
    )),

    // JSON-style quoted key:value pair
    json_pair: ($) => prec(2, seq(
      $.string,
      choice($.nbt_colon, $.nbt_equals)
    )),

    // NBT/SNBT separators
    nbt_colon: ($) => ":",
    nbt_equals: ($) => token(prec(2, "=")),

    // Brackets
    bracket_open: ($) => "[",
    bracket_close: ($) => "]",

    brace_open: ($) => "{",
    brace_close: ($) => "}",

    // NBT key (identifier before colon or equals)
    nbt_key: ($) => /[a-zA-Z_][a-zA-Z0-9_.\-]*/,

    // NBT path keys can start with numbers (e.g., 91.timer.io in scores)
    // Pattern: digits, then dot, then at least one letter, then more chars
    dotted_identifier: ($) => /\d+\.[a-zA-Z_][a-zA-Z0-9_.\-]*/,

    // =========================================================================
    // Strings
    // =========================================================================

    string: ($) => choice(
      seq('"', repeat(choice($.escape_sequence, $.macro_variable, $.line_continuation, "$", /[^"\\$\r\n]+/)), '"'),
      seq("'", repeat(choice($.escape_sequence, $.macro_variable, $.line_continuation, "$", /[^'\\$\r\n]+/)), "'")
    ),

    escape_sequence: ($) => /\\./,

    // =========================================================================
    // Numbers and ranges
    // =========================================================================

    // UUIDs: 8-4-4-4-12 hex pattern (e.g. 9a347e6c-1ce5-434a-b717-6707d51f4299)
    // Must be a single token() so the lexer's longest-match rule beats number.
    uuid: ($) => token(/[0-9a-fA-F]{1,8}-[0-9a-fA-F]{1,4}-[0-9a-fA-F]{1,4}-[0-9a-fA-F]{1,4}-[0-9a-fA-F]{1,12}/),

    _number_literal: ($) => token(choice(
      /[+-]?\d*\.\d+/,
      /[+-]?\d+/
    )),

    number: ($) => seq(
      alias($._number_literal, $.number_value),
      optional($.nbt_type_suffix)
    ),

    // Type suffix for NBT numbers (e.g. 135L, 1.5f, 3b)
    // token.immediate anchors to preceding number so identifier doesn't steal the letter.
    nbt_type_suffix: ($) => token.immediate(prec(3, /[bBsSlLfFdD]/)),

    // Time values: 20t (ticks), 5s (seconds), 3d (days)
    // Uses prec(1) so the seq beats `word` which would consume `20t` as one token.
    time_value: ($) => prec(1, seq(
      alias($._number_literal, $.number_value),
      $.time_unit
    )),

    time_unit: ($) => token.immediate(/[tsd]/),

    // Range endpoint: either a number or a macro variable
    _range_endpoint: ($) => choice(
      alias($._number_literal, $.number_value),
      $.macro_variable
    ),

    range: ($) => prec.right(2, choice(
      seq($._range_endpoint, "..", $._range_endpoint),  // 1..10, $(min)..$(max), 1..$(max), etc.
      seq($._range_endpoint, ".."),                     // 1.., $(min)..
      seq("..", $._range_endpoint)                      // ..10, ..$(max)
    )),

    // =========================================================================
    // Coordinates
    // =========================================================================

    coordinate: ($) => token(/[~^][+-]?\d*\.?\d*/),

    // =========================================================================
    // Other tokens
    // =========================================================================

    boolean: ($) => token(prec(2, choice("true", "false"))),

    operator: ($) => token(choice(
      "+=", "-=", "*=", "/=", "%=",
      "<=", ">=", "><", "<", ">",
      "=",
      "."  // Data path separator
    )),

    comma_operator: ($) => ",",

    // Fakeplayer/score holder names starting with $ (e.g., $blind_mode, $$(color))
    fakeplayer: ($) => choice(
      // $$(color) - fakeplayer with macro expansion, using token to match $$ atomically
      seq(token(prec(3, /\$\$/)), alias($.macro_variable_inner, $.macro_variable)),
      // $blind_mode - literal fakeplayer (allows /)
      token(prec(2, /\$[a-zA-Z0-9_\/][a-zA-Z0-9_.\-\/]*/)),
      // #constant.-1 - hash-prefixed fakeplayer (internal scoreboard holders)
      // Safe because # comments are only matched at line level, not as _token
      token(prec(2, /#[a-zA-Z0-9_][a-zA-Z0-9_.\-]*/))
    ),

    // Inner macro variable for use after $$ (reuses same structure)
    macro_variable_inner: ($) => seq(
      "(",
      $.macro_key,
      ")"
    ),

    // Normal identifier (commands, subcommands, keywords, etc.)
    identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_\-]*/,

    // Catch-all for unquoted words (score holders, data paths, etc.)
    // Excludes $ so fakeplayer and macro_variable can match
    // Excludes . so dots are parsed as separate operator tokens
    // Must not start with a digit so number + time_unit can handle digit-prefixed tokens.
    // WARNING: This means digit-prefixed strings (e.g. 43jkl) split into number + identifier
    // instead of a single word token. Not a problem currently but may need revisiting.
    word: ($) => token(prec(-1, /[^\s\[\]{}(),"';.$0-9][^\s\[\]{}(),"';.$]*/)),
  },
});
