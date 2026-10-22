import { test } from 'node:test';
import assert from 'node:assert/strict';
import Links from '../links.js';

test('extractTags ignora # seguido de espaço ou número e normaliza para minúsculas', () => {
  assert.deepEqual(Links.extractTags('# título #Work #1 #ideia-2'), ['ideia-2', 'work']);
});

test('automaticLinks liga notas com tag em comum, sem auto-ligação', () => {
  const notes = [
    { name: 'a.txt', tags: ['work'] },
    { name: 'b.txt', tags: ['work', 'x'] },
    { name: 'c.txt', tags: [] },
  ];
  assert.deepEqual(Links.automaticLinks(notes), [['a.txt', 'b.txt']]);
});

test('normalizeLinks ordena, remove repetidos e nomes inexistentes', () => {
  const names = new Set(['a.txt', 'b.txt']);
  assert.deepEqual(
    Links.normalizeLinks([['b.txt', 'a.txt'], ['a.txt', 'b.txt'], ['a.txt', 'gone.txt'], 'lixo'], names),
    [['a.txt', 'b.txt']],
  );
});

test('parseLinksFile trata JSON inválido como vazio com erro', () => {
  const r = Links.parseLinksFile('{não é json');
  assert.deepEqual(r.links, []);
  assert.ok(r.error);
});

test('serializeLinks grava version 1 e pares ordenados', () => {
  const text = Links.serializeLinks([['b.txt', 'a.txt']]);
  assert.deepEqual(JSON.parse(text), { version: 1, links: [['a.txt', 'b.txt']] });
});

test('toggleLink adiciona e remove o mesmo par, em qualquer ordem', () => {
  let links = Links.toggleLink([], 'b.txt', 'a.txt');
  assert.deepEqual(links, [['a.txt', 'b.txt']]);
  links = Links.toggleLink(links, 'a.txt', 'b.txt');
  assert.deepEqual(links, []);
});

test('toggleLink ignora auto-ligação', () => {
  assert.deepEqual(Links.toggleLink([], 'a.txt', 'a.txt'), []);
});

test('uma nota se liga a todas as outras que compartilham alguma tag', () => {
  const notes = [
    { name: 'centro.txt', tags: ['work', 'ideia'] },
    { name: 'a.txt', tags: ['work'] },
    { name: 'b.txt', tags: ['ideia', 'casa'] },
    { name: 'c.txt', tags: ['casa'] },
  ];
  assert.deepEqual(Links.automaticLinks(notes), [
    ['a.txt', 'centro.txt'],
    ['b.txt', 'c.txt'],
    ['b.txt', 'centro.txt'],
  ]);
});

test('mentionedNames acha o nome da nota (sem extensão) como palavra inteira, sem diferenciar maiúsculas', () => {
  const names = ['b.txt', 'ideias.txt'];
  assert.deepEqual(Links.mentionedNames('veja a explicacao no B', names), ['b.txt']);
  assert.deepEqual(Links.mentionedNames('Veja IDEIAS agora', names), ['ideias.txt']);
});

test('mentionedNames ignora nomes que aparecem dentro de outra palavra', () => {
  assert.deepEqual(Links.mentionedNames('ideiasx e b2 e xb', ['b.txt', 'ideias.txt']), []);
});

test('mentionedNames aceita o nome com extensão', () => {
  assert.deepEqual(Links.mentionedNames('ver b.txt', ['b.txt']), ['b.txt']);
});

test('mentionLinks liga a nota que menciona à nota mencionada, sem auto-ligação', () => {
  const notes = [
    { name: 'a.txt', tags: [], mentions: ['b.txt', 'a.txt'] },
    { name: 'b.txt', tags: [], mentions: [] },
  ];
  assert.deepEqual(Links.mentionLinks(notes), [['a.txt', 'b.txt']]);
});

test('noteLinks junta tags e menções sem repetir o par', () => {
  const notes = [
    { name: 'a.txt', tags: ['work'], mentions: ['b.txt'] },
    { name: 'b.txt', tags: ['work'], mentions: [] },
    { name: 'c.txt', tags: [], mentions: ['a.txt'] },
  ];
  assert.deepEqual(Links.noteLinks(notes), [['a.txt', 'b.txt'], ['a.txt', 'c.txt']]);
});
