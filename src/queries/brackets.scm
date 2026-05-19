((bracket_open) @open
  (bracket_close) @close)

((brace_open) @open
  (brace_close) @close)

(("\"" @open
  "\"" @close)
  (#set! rainbow.exclude))

(("'" @open
  "'" @close)
  (#set! rainbow.exclude))
