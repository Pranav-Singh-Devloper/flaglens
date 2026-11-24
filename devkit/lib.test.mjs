import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDotenv, renderDotenv, envVarSuffix, normaliseBaseUrl } from './lib.mjs';

test('parseDotenv handles comments, export, quotes and trailing comments', () => {
  const env = parseDotenv(
    ['# comment', 'A=1', 'export B=two', 'C="with space # not comment"', "D='single'", 'E=plain # trailing', '', 'bad line'].join('\n'),
  );
  assert.deepEqual(env, { A: '1', B: 'two', C: 'with space # not comment', D: 'single', E: 'plain' });
});

test('renderDotenv round-trips through parseDotenv', () => {
  const text = renderDotenv(['header', ['URL', 'http://localhost:8000'], ['TEXT', 'has space'], '', ['K', 'abc.def']]);
  assert.match(text, /^# header\n/);
  assert.deepEqual(parseDotenv(text), { URL: 'http://localhost:8000', TEXT: 'has space', K: 'abc.def' });
});

test('envVarSuffix makes safe variable names', () => {
  assert.equal(envVarSuffix('Development'), 'DEVELOPMENT');
  assert.equal(envVarSuffix('Staging EU (west)'), 'STAGING_EU_WEST');
});

test('normaliseBaseUrl strips trailing slashes', () => {
  assert.equal(normaliseBaseUrl('http://localhost:8000///'), 'http://localhost:8000');
});
