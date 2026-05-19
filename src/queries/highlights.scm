; Highlights for mcfunction
; Maps tree-sitter nodes to standard TextMate-compatible highlight names

; =============================================================================
; Comments
; =============================================================================

(comment) @comment
(comment_content) @comment
(header_comment) @comment
(comment_marker) @comment
(header_comment_content) @keyword

; =============================================================================
; Macro variables: $(key)
; =============================================================================

(macro_variable "$(" @punctuation.special)
(macro_variable ")" @punctuation.special)
(macro_key) @variable

; =============================================================================
; Resource Locations
; =============================================================================

(resource_location) @function
(component_name) @property

; =============================================================================
; Selectors
; =============================================================================

(selector_type) @type
(selector_key) @property
(criteria_key) @property
(selector_operator) @operator
(selector_value) @property
(fakeplayer) @property

; =============================================================================
; NBT / JSON
; =============================================================================

(nbt_array_type) @keyword
(nbt_semicolon) @operator
(nbt_key) @property

; =============================================================================
; Strings
; =============================================================================

(string) @string
(escape_sequence) @string.escape

; =============================================================================
; Numbers
; =============================================================================

(uuid) @variable

(range ".." @variable)
(number_value) @number
(nbt_type_suffix) @keyword
(time_unit) @keyword
(coordinate) @number

; =============================================================================
; Booleans
; =============================================================================

(boolean) @number

; =============================================================================
; Operators
; =============================================================================

(item_wildcard) @operator
(resource_tag) @function
(predicate_operator) @operator
(negation_operator) @operator
(or_operator) @operator
(operator) @operator
(comma_operator) @operator
(nbt_colon) @operator
(nbt_equals) @operator
(bracket_open) @variable
(bracket_close) @variable
(brace_open) @punctuation
(brace_close) @punctuation

; =============================================================================
; Line continuation
; =============================================================================

(line_continuation) @keyword

; =============================================================================
; Commands
; =============================================================================

(command_name) @keyword.control
(subcommand_name) @keyword.control
(macro_command_prefix) @keyword.control
(run_keyword) @label
(unquoted_string) @string

; =============================================================================
; Identifiers
; =============================================================================

; identifiers and words are left unhighlighted (default text color)
