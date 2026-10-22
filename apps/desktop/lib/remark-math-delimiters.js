import remarkMath from 'remark-math';

// Pandoc-style boundaries for SINGLE-dollar inline math. Keep remark's block
// math, multi-dollar inline syntax, token resolution and mdast conversion.
// Work at the tokenizer boundary, not on raw Markdown: escapes, code, links,
// HTML and source offsets must stay owned by the Markdown parser.
export default function remarkMathDelimiters() {
  remarkMath.call(this);
  const data = this.data();
  const syntax = data.micromarkExtensions.at(-1);
  const original = syntax.text[36];
  syntax.text[36] = {
    ...original,
    tokenize(effects, ok, nok) {
      const context = this;
      let token;
      return original.tokenize.call(this, {
        ...effects,
        enter(type, ...args) {
          const entered = effects.enter(type, ...args);
          if (type === 'mathText') token = entered;
          return entered;
        },
      }, function checkedEnd(code) {
        const raw = context.sliceSerialize(token);
        if (!raw.startsWith('$$') && (
          /\s/u.test(raw[1]) || /\s/u.test(raw.at(-2)) || (code >= 48 && code <= 57)
        )) return nok(code);
        return ok(code);
      }, nok);
    },
  };

  // Rich edits can put a digit after an existing math atom. Leading/trailing
  // whitespace can also arrive via existing multi-dollar math. Do not serialize
  // either as single-dollar syntax that this parser would reject on reopen.
  const output = data.toMarkdownExtensions.at(-1);
  const inlineMath = output.handlers.inlineMath;
  function safeInlineMath(node, parent, state, info) {
    const serialized = inlineMath(node, parent, state, info);
    if (serialized.startsWith('$$') || !(
      /\s/u.test(serialized[1]) || /\s/u.test(serialized.at(-2)) || /^[0-9]/.test(info.after)
    )) return serialized;
    const body = serialized.slice(1, -1);
    const runs = body.match(/\$+/g) || [];
    const fence = '$'.repeat(runs.reduce((size, run) => Math.max(size, run.length + 1), 2));
    return fence + body + fence;
  }
  safeInlineMath.peek = inlineMath.peek;
  output.handlers.inlineMath = safeInlineMath;
}
