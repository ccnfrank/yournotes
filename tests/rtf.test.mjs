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

test('rtfToHtml mantém negrito, itálico, riscado, fonte, tamanho e cor', () => {
  const raw = String.raw`{\rtf1{\fonttbl{\f0 Arial;}{\f1 Georgia;}}{\colortbl;\red255\green0\blue0;}\f0\fs24 a \b b\b0 \i\strike c\i0\strike0 \cf1\f1\fs36 d\par}`;
  assert.equal(
    Rtf.rtfToHtml(raw),
    '<div><span style="font-family:\'Arial\';font-size:12pt">a </span>'
      + '<span style="font-family:\'Arial\';font-size:12pt"><b>b</b></span>'
      + '<span style="font-family:\'Arial\';font-size:12pt"><i><s>c</s></i></span>'
      + '<span style="color:#ff0000;font-family:\'Georgia\';font-size:18pt">d</span></div>',
  );
});

test('rtfToHtml aplica o alinhamento de cada parágrafo e escapa o HTML', () => {
  const raw = String.raw`{\rtf1 \qc centro \& <x>\par \qj justo\par \ql\par}`;
  assert.equal(
    Rtf.rtfToHtml(raw),
    '<div style="text-align:center">centro &amp; &lt;x&gt;</div>'
      + '<div style="text-align:justify">justo</div><div><br></div>',
  );
});

test('rtfToText continua sem a formatação', () => {
  const raw = String.raw`{\rtf1{\colortbl;\red1\green2\blue3;}\cf1 \b Oi\b0\par x}`;
  assert.equal(Rtf.rtfToText(raw), 'Oi\nx');
});
