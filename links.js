// Ligações entre notas: tags em comum (automáticas) e ligações manuais guardadas em links.json
(() => {
  'use strict';

  const TAG_RE = /(^|\s)#(\p{L}[\p{L}\p{N}_-]*)/gu;

  // Tags são palavras com # no texto, sem diferenciar maiúsculas
  function extractTags(text) {
    const tags = new Set();
    for (const m of text.matchAll(TAG_RE)) tags.add(m[2].toLowerCase());
    return [...tags].sort();
  }

  const pairKey = ([a, b]) => `${a}\u0000${b}`;

  // Par ordenado alfabeticamente, para que (a, b) e (b, a) sejam o mesmo
  const orderedPair = (a, b) => (a < b ? [a, b] : [b, a]);

  // Pares de notas que compartilham pelo menos uma tag
  function automaticLinks(notes) {
    const pairs = [];
    for (let i = 0; i < notes.length; i++) {
      for (let j = i + 1; j < notes.length; j++) {
        if (notes[i].tags.some(tag => notes[j].tags.includes(tag))) {
          pairs.push(orderedPair(notes[i].name, notes[j].name));
        }
      }
    }
    return pairs.sort((x, y) => pairKey(x).localeCompare(pairKey(y)));
  }

  const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Nomes de notas citados no texto: o nome com extensão ou sem extensão, como palavra inteira
  // (sem diferenciar maiúsculas). Ex.: "veja b" cita b.txt
  function mentionedNames(text, names) {
    const found = [];
    for (const name of names) {
      const base = name.replace(/\.[^.]+$/, '');
      const alternatives = [...new Set([name, base])].map(escapeRegExp).join('|');
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, 'iu');
      if (re.test(text)) found.push(name);
    }
    return found;
  }

  // Ligação por menção: a nota que cita outra fica ligada a ela (sem auto-ligação)
  function mentionLinks(notes) {
    const pairs = [];
    for (const note of notes) {
      for (const other of note.mentions ?? []) {
        if (other !== note.name) pairs.push(orderedPair(note.name, other));
      }
    }
    return [...new Map(pairs.map(p => [pairKey(p), p])).values()].sort((x, y) => pairKey(x).localeCompare(pairKey(y)));
  }

  // Todas as ligações automáticas da teia: tags em comum e menções no texto
  function noteLinks(notes) {
    const names = new Set(notes.map(n => n.name));
    return normalizeLinks([...automaticLinks(notes), ...mentionLinks(notes)], names);
  }

  // Aceita o conteúdo já lido de links.json e devolve só pares válidos e únicos
  function normalizeLinks(list, existingNames) {
    if (!Array.isArray(list)) return [];
    const seen = new Map();
    for (const pair of list) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [a, b] = pair;
      if (typeof a !== 'string' || typeof b !== 'string' || a === b) continue;
      if (!existingNames.has(a) || !existingNames.has(b)) continue;
      const ordered = orderedPair(a, b);
      seen.set(pairKey(ordered), ordered);
    }
    return [...seen.values()].sort((x, y) => pairKey(x).localeCompare(pairKey(y)));
  }

  // JSON inválido vira lista vazia com a mensagem do erro
  function parseLinksFile(text) {
    try {
      const data = JSON.parse(text);
      return { links: Array.isArray(data?.links) ? data.links : [], error: null };
    } catch (e) {
      return { links: [], error: `links.json is not valid JSON: ${e.message}` };
    }
  }

  function serializeLinks(links) {
    const normalized = normalizeLinks(links, new Set(links.flat()));
    return JSON.stringify({ version: 1, links: normalized }, null, 2);
  }

  // Adiciona o par se ausente, remove se presente
  function toggleLink(links, a, b) {
    if (a === b) return links;
    const key = pairKey(orderedPair(a, b));
    const exists = links.some(pair => pairKey(pair) === key);
    if (exists) return links.filter(pair => pairKey(pair) !== key);
    return [...links, orderedPair(a, b)].sort((x, y) => pairKey(x).localeCompare(pairKey(y)));
  }

  const Links = { extractTags, automaticLinks, mentionedNames, mentionLinks, noteLinks, normalizeLinks, parseLinksFile, serializeLinks, toggleLink };

  if (typeof module !== 'undefined') module.exports = Links;
  if (typeof window !== 'undefined') window.Links = Links;
})();
