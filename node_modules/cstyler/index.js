class cstyler {
  constructor() {
    this.styleMap = {
      // Text styles
      bold: ['\x1b[1m', '\x1b[22m'],
      italic: ['\x1b[3m', '\x1b[23m'],
      underline: ['\x1b[4m', '\x1b[24m'],
      dark: ['\x1b[2m', '\x1b[22m'],

      // Foreground colors
      red: ['\x1b[31m', '\x1b[39m'],
      green: ['\x1b[32m', '\x1b[39m'],
      yellow: ['\x1b[33m', '\x1b[39m'],
      blue: ['\x1b[34m', '\x1b[39m'],
      purple: ['\x1b[35m', '\x1b[39m'],
      gray: ['\x1b[90m', '\x1b[39m'],
      white: ['\x1b[97m', '\x1b[39m'],
      cyan: ['\x1b[36m', '\x1b[39m'],
      magenta: ['\x1b[35m', '\x1b[39m'],

      // Background colors
      bgRed: ['\x1b[41m', '\x1b[49m'],
      bgGreen: ['\x1b[42m', '\x1b[49m'],
      bgYellow: ['\x1b[43m', '\x1b[49m'],
      bgBlue: ['\x1b[44m', '\x1b[49m'],
      bgPurple: ['\x1b[45m', '\x1b[49m'],
      bgGray: ['\x1b[100m', '\x1b[49m'],
    };

    return this.createStyler([]);
  }

  createStyler(styles) {
    const styler = (text) =>
      styles.reduce((str, { open, close }) => open + str + close, text);

    const addStyle = (open, close) =>
      this.createStyler([...styles, { open, close }]);

    for (const [name, [open, close]] of Object.entries(this.styleMap)) {
      Object.defineProperty(styler, name, {
        get: () => addStyle(open, close),
      });
    }

    // RGB foreground color
    styler.rgb = (r, g, b) => {
      if (![r, g, b].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        console.error('Invalid RGB value. Falling back to white.');
        return addStyle('\x1b[37m', '\x1b[39m');
      }
      return addStyle(`\x1b[38;2;${r};${g};${b}m`, '\x1b[39m');
    };

    // Hex foreground color
    styler.hex = (hex) => {
      try {
        if (typeof hex !== 'string') throw new Error();
        hex = hex.replace(/^#/, '').slice(0, 6);
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return styler.rgb(r, g, b);
      } catch {
        console.error('Invalid hex color. Falling back to white.');
        return addStyle('\x1b[37m', '\x1b[39m');
      }
    };

    // HSL to RGB conversion helper
    function hslToRgb(h, s, l) {
      s /= 100;
      l /= 100;
      const k = (n) => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = (n) =>
        l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
    }

    styler.hsl = (h, s, l) => {
      if (
        typeof h !== 'number' ||
        h < 0 ||
        h > 360 ||
        typeof s !== 'number' ||
        s < 0 ||
        s > 100 ||
        typeof l !== 'number' ||
        l < 0 ||
        l > 100
      ) {
        console.error('Invalid HSL value. Falling back to white.');
        return addStyle('\x1b[37m', '\x1b[39m');
      }
      const [r, g, b] = hslToRgb(h, s, l);
      return styler.rgb(r, g, b);
    };

    // Parse tagged template literals with inline nested styles
    styler.tag = (strings, ...values) => {
      let fullText = '';
      for (let i = 0; i < strings.length; i++) {
        fullText += strings[i];
        if (i < values.length) fullText += values[i];
      }
      return this.parseInlineStyles(fullText);
    };

    // Helper: parse parameters string to array for hex, rgb, hsl
    this.parseParameters = (paramStr) => {
      // Remove spaces outside quotes, split by commas respecting quotes
      const params = [];
      let current = '';
      let inQuotes = false;
      for (let c of paramStr.trim()) {
        if (c === "'" || c === '"') {
          inQuotes = !inQuotes;
          current += c;
        } else if (c === ',' && !inQuotes) {
          if (current.length) params.push(current.trim());
          current = '';
        } else {
          current += c;
        }
      }
      if (current.length) params.push(current.trim());
      // Remove quotes from strings
      return params.map((p) => p.replace(/^['"]|['"]$/g, ''));
    };

    // Recursive parser for nested inline styles with support for parameterized styles
    this.parseInlineStyles = (text) => {
      const parse = (str, start = 0) => {
        let result = '';
        let i = start;

        while (i < str.length) {
          if (str[i] === '{') {
            // Find matching closing brace for nested block
            let level = 1;
            let j = i + 1;
            while (j < str.length && level > 0) {
              if (str[j] === '{') level++;
              else if (str[j] === '}') level--;
              j++;
            }
            if (level !== 0) {
              // Unmatched brace, treat literally
              result += str.slice(i);
              break;
            }

            // Extract content between braces
            const content = str.slice(i + 1, j - 1);

            // Find first space to separate styles from text
            const spaceIdx = content.indexOf(' ');

            if (spaceIdx === -1) {
              // No space, treat as literal text with braces
              result += '{' + content + '}';
            } else {
              const styleStr = content.slice(0, spaceIdx);
              const innerText = content.slice(spaceIdx + 1);

              // Parse styles separated by '.'
              // But styles may have params, like hex('#ff00ff'), rgb(255,0,0)
              const styleParts = [];

              let currentStyle = '';
              let parenLevel = 0;
              for (let ch of styleStr) {
                if (ch === '.' && parenLevel === 0) {
                  if (currentStyle) styleParts.push(currentStyle);
                  currentStyle = '';
                } else {
                  if (ch === '(') parenLevel++;
                  else if (ch === ')') parenLevel--;
                  currentStyle += ch;
                }
              }
              if (currentStyle) styleParts.push(currentStyle);

              // Parse inner text recursively (to support nested styles)
              const parsedInner = parse(innerText, 0);

              // Apply styles in order (left to right)
              let styledText = parsedInner;

              for (let style of styleParts.reverse()) {
                // Check if style has parameters (like hex(...))
                let name = style;
                let params = null;

                const paramStart = style.indexOf('(');
                if (paramStart !== -1 && style.endsWith(')')) {
                  name = style.slice(0, paramStart);
                  const paramStr = style.slice(paramStart + 1, -1);
                  params = this.parseParameters(paramStr);
                }

                // Handle styles
                if (name === 'hex' && params && params.length === 1) {
                  styledText = this.styleMap[name]
                    ? this.applyStyle(styledText, this.styleMap[name])
                    : styler.hex(params[0])(styledText);
                } else if (
                  name === 'rgb' &&
                  params &&
                  params.length === 3 &&
                  params.every((p) => !isNaN(p))
                ) {
                  styledText = styler.rgb(
                    parseInt(params[0]),
                    parseInt(params[1]),
                    parseInt(params[2])
                  )(styledText);
                } else if (
                  name === 'hsl' &&
                  params &&
                  params.length === 3 &&
                  params.every((p) => !isNaN(p))
                ) {
                  styledText = styler.hsl(
                    parseFloat(params[0]),
                    parseFloat(params[1]),
                    parseFloat(params[2])
                  )(styledText);
                } else if (this.styleMap[name]) {
                  const [open, close] = this.styleMap[name];
                  styledText = open + styledText + close;
                } else {
                  console.warn(`Unknown style: ${style}`);
                }
              }

              result += styledText;
            }

            i = j;
          } else {
            result += str[i];
            i++;
          }
        }

        return result;
      };
      return parse(text);
    };

    // Helper to apply raw style array (for internal use)
    this.applyStyle = (text, [open, close]) => open + text + close;

    return new Proxy(styler, {
      apply: (target, thisArg, args) => {
        // Tagged template literal usage
        if (Array.isArray(args[0]) && 'raw' in args[0]) {
          return styler.tag(...args);
        }
        // Direct call with string
        return styler(...args);
      },
      get: (target, prop) => {
        if (prop in styler) return styler[prop];
        console.warn(`Invalid style: ${String(prop)}`);
        return styler;
      },
    });
  }
}

module.exports = new cstyler();
