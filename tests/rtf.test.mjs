import { test } from 'node:test';
import assert from 'node:assert/strict';
import Rtf from '../rtf.js';

test('rtfToText lê parágrafos, tabs e formatação sem mostrar os controles', () => {
  const raw = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times New Roman;}}\f0\fs24 \b Olá\b0 mundo\par segunda\tab linha}`;
  // o espaço depois de \b0 é delimitador do controle, não texto
  assert.equal(Rtf.rtfToText(raw), 'Olámundo\nsegunda\tlinha');
});

test('rtfToText pula destinos como fonttbl, colortbl e \\* ignorados', () => {
  const raw = String.raw`{\rtf1{\fonttbl{\f0 Arial;}}{\colortbl;\red0\green0\blue0;}{\*\generator Foo;}texto}`;
  assert.equal(Rtf.rtfToText(raw), 'texto');
});

test('rtfToText decodifica \\uN com o fallback e \\\'hh em cp1252', () => {
  assert.equal(Rtf.rtfToText(String.raw`{\rtf1\ansi \u233?t\'e9}`), 'été');
  assert.equal(Rtf.rtfToText(String.raw`{\rtf1\uc1 \u-3968?}`), String.fromCharCode(65536 - 3968));
});

test('rtfToText trata \\emdash e escapes de chaves e barra', () => {
  assert.equal(Rtf.rtfToText(String.raw`{\rtf1 a\emdash b \{x\} \\}`), 'a—b {x} \\');
});

test('textToRtf e rtfToText são inversos para texto com acentos, quebras e símbolos', () => {
  const text = 'Olá, {mundo} \\ “aspas”\nlinha dois\tcom tab';
  const rtf = Rtf.textToRtf(text);
  assert.ok(rtf.startsWith('{\\rtf1'));
  assert.equal(Rtf.rtfToText(rtf), text);
});

test('textToRtf normaliza quebras de linha do Windows', () => {
  assert.equal(Rtf.rtfToText(Rtf.textToRtf('a\r\nb')), 'a\nb');
});
