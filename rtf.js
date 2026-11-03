// Conversão entre RTF, HTML do editor e texto puro. O editor mantém a formatação
// (negrito, itálico, riscado, fontes, tamanhos, cores e alinhamento). O RTF guarda tudo isso;
// .txt e .md guardam só o texto
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

  const ALIGN_BY_CONTROL = { ql: 'left', qc: 'center', qr: 'right', qj: 'justify' };
  const CONTROL_BY_ALIGN = { left: '\\ql', center: '\\qc', right: '\\qr', justify: '\\qj' };

  // Tamanhos do seletor de fonte do editor (valores 1 a 7 do execCommand fontSize), em pt
  const FONT_SIZE_PT = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };

  const CONTROL_RE = /\\(?:([a-zA-Z]+)(-?\d+)? ?|'([0-9a-fA-F]{2})|(\*)|([\\{}])|(\r?\n))/y;
  const TABLE_RE = /\{\\(fonttbl|colortbl)\b/y;
  const cp1252 = new TextDecoder('windows-1252');

  const plainFormat = () => ({ b: false, i: false, s: false, color: null, font: null, size: null, align: 'left' });

  // Posição da chave que fecha o grupo aberto em `start`
  function groupEnd(raw, start) {
    let depth = 0;
    for (let k = start; k < raw.length; k += 1) {
      const c = raw[k];
      if (c === '\\') k += 1;
      else if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) return k;
      }
    }
    return raw.length - 1;
  }

  // \fonttbl: cada entrada é \fN ... Nome;
  function readFonts(table, fonts) {
    const re = /\\f(\d+)((?:\\[a-zA-Z]+-?\d* ?)*)([^;{}]*);/g;
    for (const m of table.matchAll(re)) fonts[Number(m[1])] = m[3].trim();
  }

  // \colortbl: a primeira entrada (antes do primeiro ;) é a cor automática
  function readColors(table, colors) {
    const entries = table.replace(/^\{\\colortbl/, '').replace(/\}$/, '').split(';');
    entries.forEach((entry, index) => {
      const r = /\\red(\d+)/.exec(entry);
      const g = /\\green(\d+)/.exec(entry);
      const b = /\\blue(\d+)/.exec(entry);
      colors[index] = r && g && b ? rgbToHex(Number(r[1]), Number(g[1]), Number(b[1])) : null;
    });
  }

  // Lê o RTF e devolve uma lista de textos com formatação e de quebras de parágrafo
  function parseRtf(raw) {
    const items = [];       // { text, fmt } ou { par: true, align }
    const fonts = [];
    const colors = [];
    const groups = [];
    let fmt = plainFormat();
    let skip = false;       // dentro de um destino ignorado
    let uc = 1;             // quantos caracteres de fallback seguem cada \uN
    let fallbackLeft = 0;   // fallbacks ainda a pular
    let groupStart = false; // o próximo controle é o primeiro do grupo (pode ser um destino)
    let i = 0;

    const emit = text => {
      if (skip) return;
      if (fallbackLeft > 0) {
        fallbackLeft -= 1;
        return;
      }
      items.push({ text, fmt: { ...fmt } });
    };
    const paragraph = () => {
      if (!skip) items.push({ par: true, align: fmt.align });
    };

    while (i < raw.length) {
      const c = raw[i];
      if (c === '{') {
        TABLE_RE.lastIndex = i;
        const table = TABLE_RE.exec(raw);
        if (table) {
          // tabelas são lidas de uma vez e não entram no texto
          const end = groupEnd(raw, i);
          const body = raw.slice(i, end + 1);
          if (table[1] === 'fonttbl') readFonts(body, fonts);
          else readColors(body, colors);
          i = end + 1;
          groupStart = false;
          continue;
        }
        groups.push({ skip, uc, fmt: { ...fmt } });
        groupStart = true;
        i += 1;
      } else if (c === '}') {
        const saved = groups.pop() ?? { skip: false, uc: 1, fmt: plainFormat() };
        ({ skip, uc } = saved);
        fmt = saved.fmt;
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
          const on = param === undefined || Number(param) !== 0; // \b é ligado, \b0 desliga
          if (word === 'par') paragraph();
          else if (word === 'line') emit('\n');
          else if (word === 'tab') {
            if (!skip) items.push({ text: '\t', fmt: { ...fmt } });
          } else if (word === 'uc') uc = Number(param);
          else if (word === 'u') {
            let code = Number(param);
            if (code < 0) code += 65536;
            emit(String.fromCharCode(code));
            fallbackLeft = uc;
          } else if (NAMED_SYMBOLS[word]) emit(NAMED_SYMBOLS[word]);
          else if (word === 'b') fmt.b = on;
          else if (word === 'i') fmt.i = on;
          else if (word === 'strike') fmt.s = on;
          else if (word === 'plain') Object.assign(fmt, { b: false, i: false, s: false, color: null, font: null, size: null });
          else if (word === 'pard') fmt.align = 'left';
          else if (ALIGN_BY_CONTROL[word]) fmt.align = ALIGN_BY_CONTROL[word];
          else if (word === 'cf') fmt.color = colors[Number(param)] ?? null;
          else if (word === 'f') fmt.font = fonts[Number(param)] ?? null;
          else if (word === 'fs') fmt.size = Number(param) > 0 ? Number(param) / 2 : null;
        } else if (hex !== undefined) {
          emit(cp1252.decode(Uint8Array.of(parseInt(hex, 16))));
        } else if (symbol !== undefined) {
          emit(symbol);
        } else if (lineBreak !== undefined) {
          paragraph();
        }
        groupStart = false;
      } else {
        // espaços e quebras de linha no código RTF não são texto
        if (c !== '\r' && c !== '\n') emit(c);
        groupStart = false;
        i += 1;
      }
    }
    return items;
  }

  // Só texto: \par vira quebra de linha, \tab vira tab, \uN vira o caractere
  function rtfToText(raw) {
    return parseRtf(raw).map(it => (it.par ? '\n' : it.text)).join('');
  }

  const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Cada parágrafo vira um <div>; o estilo do texto vira <b>, <i>, <s> e <span>
  function rtfToHtml(raw) {
    const paragraphs = [];
    let runs = [];
    for (const it of parseRtf(raw)) {
      if (it.par) {
        paragraphs.push({ align: it.align, runs });
        runs = [];
      } else {
        runs.push(it);
      }
    }
    if (runs.length) paragraphs.push({ align: 'left', runs });
    return paragraphs.map(p => {
      const align = p.align === 'left' ? '' : ` style="text-align:${p.align}"`;
      return `<div${align}>${runsToHtml(p.runs) || '<br>'}</div>`;
    }).join('');
  }

  // Junta textos seguidos com o mesmo estilo num só elemento
  function runsToHtml(runs) {
    let html = '';
    let k = 0;
    while (k < runs.length) {
      const f = runs[k].fmt;
      const key = styleKey(f);
      let text = '';
      while (k < runs.length && styleKey(runs[k].fmt) === key) {
        text += runs[k].text;
        k += 1;
      }
      html += wrapRun(text, f);
    }
    return html;
  }

  const styleKey = f => [f.b, f.i, f.s, f.color, f.font, f.size].join('|');

  function wrapRun(text, f) {
    let out = escapeHtml(text).replace(/\n/g, '<br>');
    if (!out) return '';
    if (f.s) out = `<s>${out}</s>`;
    if (f.i) out = `<i>${out}</i>`;
    if (f.b) out = `<b>${out}</b>`;
    const css = [];
    if (f.color) css.push(`color:${f.color}`);
    if (f.font) css.push(`font-family:'${f.font.replace(/['"<>&]/g, '')}'`);
    if (f.size) css.push(`font-size:${f.size}pt`);
    return css.length ? `<span style="${escapeHtml(css.join(';'))}">${out}</span>` : out;
  }

  // Texto simples: acentos viram \uN, quebras viram \par
  function textToRtf(text) {
    let body = '';
    const clean = text.replace(/\r\n?/g, '\n');
    for (let i = 0; i < clean.length; i += 1) {
      const ch = clean[i];
      if (ch === '\n') body += '\\par\n';
      else body += rtfChar(ch);
    }
    return `{\\rtf1\\ansi\\uc1\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 ${body}}`;
  }

  // Um caractere escrito em RTF (sem quebra de linha)
  function rtfChar(ch) {
    if (ch === '\\') return '\\\\';
    if (ch === '{') return '\\{';
    if (ch === '}') return '\\}';
    if (ch === '\t') return '\\tab ';
    const code = ch.charCodeAt(0);
    if (code < 128) return ch;
    return `\\u${code > 32767 ? code - 65536 : code}?`;
  }

  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(n => Math.min(255, n).toString(16).padStart(2, '0')).join('');

  // Aceita #rgb, #rrggbb e rgb(r, g, b), que é como o navegador devolve a cor do estilo
  function normalizeColor(value) {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (hex) {
      const full = hex[1].length === 3 ? [...hex[1]].map(ch => ch + ch).join('') : hex[1];
      return `#${full.toLowerCase()}`;
    }
    const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(value.trim());
    return rgb ? rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])) : null;
  }

  // Tamanho em pt; px vira pt (1 px = 0,75 pt)
  function toPt(value) {
    const m = /^([\d.]+)(pt|px)?$/.exec(value.trim());
    if (!m) return null;
    const n = Number(m[1]);
    return m[2] === 'px' ? n * 0.75 : n;
  }

  const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI']);

  function alignOf(el) {
    const value = el.style?.textAlign || el.getAttribute('align') || '';
    return ['center', 'right', 'justify'].includes(value) ? value : 'left';
  }

  // Formatação herdada pelo elemento: negrito, itálico, riscado, fonte, cor e tamanho
  function formatOf(el, fmt) {
    const next = { ...fmt };
    const tag = el.tagName;
    if (tag === 'B' || tag === 'STRONG') next.b = true;
    if (tag === 'I' || tag === 'EM') next.i = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.s = true;
    if (tag === 'FONT') {
      const color = el.getAttribute('color');
      const face = el.getAttribute('face');
      const size = Number(el.getAttribute('size'));
      if (color) next.color = normalizeColor(color) ?? next.color;
      if (face) next.font = face.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (FONT_SIZE_PT[size]) next.size = FONT_SIZE_PT[size];
    }
    const st = el.style;
    if (st) {
      if (st.color) next.color = normalizeColor(st.color) ?? next.color;
      if (st.fontFamily && st.fontFamily !== 'inherit') next.font = st.fontFamily.split(',')[0].trim().replace(/['"]/g, '');
      if (st.fontSize) next.size = toPt(st.fontSize) ?? next.size;
      if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) next.b = true;
      if (st.fontStyle === 'italic') next.i = true;
      if ((st.textDecoration || '').includes('line-through')) next.s = true;
    }
    return next;
  }

  // Coleta o texto de um nó com seu estilo. <br> final de bloco não é quebra (é o marcador de linha vazia)
  function inlineRuns(node, fmt, runs) {
    if (node.nodeType === 3) {
      runs.push({ text: node.nodeValue, fmt });
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.tagName === 'BR') {
      if (node.nextSibling) runs.push({ text: '\n', fmt });
      return;
    }
    if (BLOCK_TAGS.has(node.tagName) && runs.length) runs.push({ text: '\n', fmt });
    const own = formatOf(node, fmt);
    for (const child of node.childNodes) inlineRuns(child, own, runs);
  }

  // Lê o HTML do editor (um elemento raiz) e devolve os parágrafos com seus textos formatados
  function htmlParagraphs(root) {
    const paragraphs = [];
    let loose = null; // parágrafo para texto solto, fora de um bloco
    for (const child of root.childNodes) {
      if (child.nodeType === 1 && BLOCK_TAGS.has(child.tagName)) {
        loose = null;
        const runs = [];
        inlineRuns(child, plainFormat(), runs);
        paragraphs.push({ align: alignOf(child), runs });
      } else {
        if (!loose) {
          loose = { align: 'left', runs: [] };
          paragraphs.push(loose);
        }
        inlineRuns(child, plainFormat(), loose.runs);
      }
    }
    return paragraphs;
  }

  // Gera RTF a partir do HTML do editor, com tabelas de fontes e cores
  function htmlToRtf(root) {
    const fonts = ['Arial'];   // \f0 é a fonte padrão
    const colors = [];         // \cf1 é colors[0]; \cf0 é a cor automática
    const fontIndex = name => {
      let k = fonts.indexOf(name);
      if (k < 0) {
        fonts.push(name);
        k = fonts.length - 1;
      }
      return k;
    };
    const colorIndex = hex => {
      let k = colors.indexOf(hex);
      if (k < 0) {
        colors.push(hex);
        k = colors.length - 1;
      }
      return k + 1;
    };

    let body = '';
    for (const p of htmlParagraphs(root)) {
      body += `\\pard${CONTROL_BY_ALIGN[p.align]} `;
      let k = 0;
      while (k < p.runs.length) {
        const f = p.runs[k].fmt;
        const key = styleKey(f);
        let text = '';
        while (k < p.runs.length && styleKey(p.runs[k].fmt) === key) {
          text += p.runs[k].text;
          k += 1;
        }
        if (!text) continue;
        const controls = [];
        if (f.b) controls.push('\\b');
        if (f.i) controls.push('\\i');
        if (f.s) controls.push('\\strike');
        if (f.color) controls.push(`\\cf${colorIndex(f.color)}`);
        if (f.font) controls.push(`\\f${fontIndex(f.font)}`);
        if (f.size) controls.push(`\\fs${Math.round(f.size * 2)}`);
        const clean = text.replace(/\r\n?/g, '\n');
        let escaped = '';
        for (let at = 0; at < clean.length; at += 1) escaped += clean[at] === '\n' ? '\\line ' : rtfChar(clean[at]);
        // o espaço só separa um controle do texto; sem controles, ele seria lido como texto
        body += controls.length ? `{${controls.join('')} ${escaped}}` : `{${escaped}}`;
      }
      body += '\\par\n';
    }

    const fontTable = fonts.map((name, k) => {
      let encoded = '';
      for (let at = 0; at < name.length; at += 1) encoded += rtfChar(name[at]);
      return `{\\f${k} ${encoded};}`;
    }).join('');
    const colorTable = colors.map(hex => {
      const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
      return `\\red${r}\\green${g}\\blue${b};`;
    }).join('');
    return `{\\rtf1\\ansi\\uc1\\deff0{\\fonttbl${fontTable}}{\\colortbl;${colorTable}}\\f0\\fs24 ${body}}`;
  }

  const Rtf = { rtfToText, rtfToHtml, textToRtf, htmlToRtf };

  if (typeof module !== 'undefined') module.exports = Rtf;
  if (typeof window !== 'undefined') window.Rtf = Rtf;
})();
