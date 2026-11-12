// Tiny dependency-free syntax highlighter for the three languages a component
// uses. highlightCode(source, 'html' | 'css' | 'js') returns safe HTML made of
// <span class="tok-..."> elements. It aims for readable, not perfect.
(() => {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const span = (cls, s) => `<span class="tok-${cls}">${esc(s)}</span>`;

  // Walks `src`, passing each regex match to `classify` and escaping the gaps.
  function scan(src, re, classify) {
    let out = '';
    let last = 0;
    for (const m of src.matchAll(re)) {
      out += esc(src.slice(last, m.index)) + classify(m, m.index + m[0].length);
      last = m.index + m[0].length;
    }
    return out + esc(src.slice(last));
  }

  const JS_KEYWORDS = new Set(
    ('async await break case catch class const continue debugger default delete do else export extends finally for ' +
      'function if import in instanceof let new of return static super switch this throw try typeof var void while yield')
      .split(' ')
  );
  const JS_ATOMS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
  const JS_RE =
    /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?)|(\b0[xX][\da-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;

  function js(src) {
    return scan(src, JS_RE, (m, end) => {
      if (m[1]) return span('comment', m[1]);
      if (m[2]) return span('str', m[2]);
      if (m[3]) return span('num', m[3]);
      const word = m[4];
      if (JS_KEYWORDS.has(word)) return span('kw', word);
      if (JS_ATOMS.has(word)) return span('num', word);
      if (/^\s*\(/.test(src.slice(end, end + 20))) return span('fn', word);
      return esc(word);
    });
  }

  const CSS_RE =
    /(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(@[\w-]+)|(#[\da-fA-F]{3,8}\b)|(-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?)|([{}])|(--[\w-]+|-?[A-Za-z_][\w-]*)/g;

  function css(src) {
    let depth = 0;
    return scan(src, CSS_RE, (m, end) => {
      if (m[1]) return span('comment', m[1]);
      if (m[2]) return span('str', m[2]);
      if (m[3]) return span('kw', m[3]);
      if (m[4]) return depth > 0 ? span('num', m[4]) : span('sel', m[4]);
      if (m[5]) return span('num', m[5]);
      if (m[6]) {
        depth = Math.max(0, depth + (m[6] === '{' ? 1 : -1));
        return esc(m[6]);
      }
      if (depth === 0) return span('sel', m[7]);
      // Inside a block, "name:" is a property unless a "{" follows first (a nested selector).
      const rest = src.slice(end, end + 400);
      const stop = rest.search(/[{;}]/);
      if (/^\s*:/.test(rest) && rest[stop] !== '{') return span('prop', m[7]);
      return esc(m[7]);
    });
  }

  const TAG_RE = /(^<\/?[\w:-]+)|("[^"]*"?|'[^']*'?)|([\w:@.-]+)|(\/?>$)/g;
  function tag(src) {
    return scan(src, TAG_RE, (m) => {
      if (m[1] || m[4]) return span('tag', m[1] || m[4]);
      if (m[2]) return span('str', m[2]);
      return span('attr', m[3]);
    });
  }

  const HTML_RE = /(<!--[\s\S]*?(?:-->|$))|(<(script|style)\b[^>]*>)([\s\S]*?)(?=<\/\3\s*>|$)|(<\/?[A-Za-z][^>]*>?)|(&[#\w]+;)/gi;
  function html(src) {
    return scan(src, HTML_RE, (m) => {
      if (m[1]) return span('comment', m[1]);
      if (m[2]) return tag(m[2]) + (m[3].toLowerCase() === 'script' ? js(m[4]) : css(m[4]));
      if (m[5]) return tag(m[5]);
      return span('num', m[6]);
    });
  }

  const LANGUAGES = { html, css, js };
  globalThis.highlightCode = (source, lang) => (LANGUAGES[lang] || esc)(String(source));
})();
