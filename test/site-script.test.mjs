import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

// Page scripts share one global scope, so top-level names must not collide across files either.
const FILES = ['engine.js', 'common.js', 'trade.js'];
const read = (f) => readFileSync(new URL('../site/' + f, import.meta.url), 'utf8');

test('화면 스크립트 파일마다 구문이 유효하다', () => {
  for (const f of FILES) new Script(read(f), { filename: f });
});

test('화면 스크립트에 같은 이름의 맨 위 함수를 두 번 정의하지 않는다(파일끼리 포함)', () => {
  const names = FILES.flatMap((f) => [...read(f).matchAll(/^(?:async\s+)?function\s+(\w+)\s*\(/gm)].map((m) => m[1]));
  const twice = names.filter((name, i) => names.indexOf(name) !== i);
  assert.deepEqual(twice, []);
});

test('페이지가 필요한 스크립트를 순서대로 읽는다', () => {
  const src = (html) => [...readFileSync(new URL('../site/' + html, import.meta.url), 'utf8').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(src('index.html'), ['engine.js', 'common.js', 'trade.js']);
});
