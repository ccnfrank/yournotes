// Conversão entre RTF e texto puro. O editor só trabalha com texto: a formatação
// (negrito, fontes, cores) não é mantida ao salvar um arquivo .rtf
(() => {
  'use strict';

  // Destinos que não são texto visível: o conteúdo deles é ignorado
  const SKIP_DESTINATIONS = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'fldinst', 'header', 'footer',
    'headerl', 'headerr', 'footerl', 'footerr', 'listtable', 'listoverridetable', 'themedata',
    'colorschememapping', 'latentstyles', 'rsidtbl', 'generator', 'xmlopen', 'xmlattrs',
  ]);

  // Símbolos com nome que o RTF escreve como controle, ex.: \emdash
  const NAMED_SYMBOLS = {
    emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•',
  };

  const CONTROL_RE = /\\(?:([a-zA-Z]+)(-?\d+)? ?|'([0-9a-fA-F]{2})|(\*)|([\\{}])|(\r?\n))/y;
  const cp1252 = new TextDecoder('windows-1252');

  // Lê o RTF e devolve só o texto: \par vira quebra de linha, \tab vira tab, \uN vira o caractere
  function rtfToText(raw) {
    let out = '';
    const groups = [];
    let skip = false;     // dentro de um destino ignorado
    let uc = 1;           // quantos caracteres de fallback seguem cada \uN
    let fallbackLeft = 0; // fallbacks ainda a pular
    let groupStart = false; // o próximo controle é o primeiro do grupo (pode ser um destino)
    let i = 0;

    const emit = text => {
      if (skip) return;
      if (fallbackLeft > 0) {
        fallbackLeft -= 1;
        return;
      }
      out += text;
    };

    while (i < raw.length) {
      const c = raw[i];
      if (c === '{') {
        groups.push({ skip, uc });
        groupStart = true;
        i += 1;
      } else if (c === '}') {
        ({ skip, uc } = groups.pop() ?? { skip: false, uc: 1 });
        groupStart = false;
        i += 1;
      } else if (c === '\\') {
        CONTROL_RE.lastIndex = i;
        const m = CONTROL_RE.exec(raw);
        if (!m) { // barra solta no fim do texto
          i += 1;
          continue;
        }
        i = CONTROL_RE.lastIndex;
        const [, word, param, hex, star, symbol, lineBreak] = m;
        if (star !== undefined) {
          if (groupStart) skip = true; // \* marca um destino que o leitor não conhece
        } else if (word !== undefined) {
          if (groupStart && SKIP_DESTINATIONS.has(word)) skip = true;
          if (word === 'par' || word === 'line') {
            if (!skip) out += '\n';
          } else if (word === 'tab') {
            if (!skip) out += '\t';
          } else if (word === 'uc') {
            uc = Number(param);
          } else if (word === 'u') {
            let code = Number(param);
            if (code < 0) code += 65536;
            emit(String.fromCharCode(code));
            fallbackLeft = uc;
          } else if (NAMED_SYMBOLS[word]) {
            emit(NAMED_SYMBOLS[word]);
          }
        } else if (hex !== undefined) {
          emit(cp1252.decode(Uint8Array.of(parseInt(hex, 16))));
        } else if (symbol !== undefined) {
          emit(symbol);
        } else if (lineBreak !== undefined) {
          if (!skip) out += '\n';
        }
        groupStart = false;
      } else {
        // espaços e quebras de linha no código RTF não são texto
        if (c !== '\r' && c !== '\n') emit(c);
        groupStart = false;
        i += 1;
      }
    }
    return out;
  }

  // Gera um RTF simples com o texto: acentos viram \uN, quebras viram \par
  function textToRtf(text) {
    let body = '';
    const clean = text.replace(/\r\n?/g, '\n');
    for (let i = 0; i < clean.length; i += 1) {
      const ch = clean[i];
      const code = clean.charCodeAt(i);
      if (ch === '\\') body += '\\\\';
      else if (ch === '{') body += '\\{';
      else if (ch === '}') body += '\\}';
      else if (ch === '\n') body += '\\par\n';
      else if (ch === '\t') body += '\\tab ';
      else if (code < 128) body += ch;
      else body += `\\u${code > 32767 ? code - 65536 : code}?`;
    }
    return `{\\rtf1\\ansi\\uc1\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 ${body}}`;
  }

  const Rtf = { rtfToText, textToRtf };

  if (typeof module !== 'undefined') module.exports = Rtf;
  if (typeof window !== 'undefined') window.Rtf = Rtf;
})();
