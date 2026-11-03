import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAction, screenStyles, stylesheetRule } from './helpers.js';

test('property rows read as a compact definition-list group', () => {
  const css = screenStyles().split('@media print')[0];
  const property = stylesheetRule(css, '.ev-property');
  const key = stylesheetRule(css, '.ev-property > .ev-prop-key');
  const value = stylesheetRule(css, '.ev-property > .ev-prop-value');

  assert.match(property, /box-sizing:\s*border-box/);
  assert.match(property, /width:\s*100%/);
  assert.match(property, /padding-top:\s*0\.1em/);
  assert.match(property, /padding-bottom:\s*0\.1em/);
  assert.match(property, /padding-right:\s*0\.65em/);
  assert.doesNotMatch(property, /background\s*:/, 'property rows have no resting background');
  assert.doesNotMatch(property, /border-left\s*:/, 'property rows have no resting left edge');
  assert.match(key, /text-align:\s*right/);
  assert.match(key, /min-width:\s*var\(--key-w,\s*0px\)/);
  assert.match(value, /min-width:\s*0/);
});

test('code rows are inset evidence blocks with explicit wrapping states', () => {
  const css = screenStyles().split('@media print')[0];
  const code = stylesheetRule(css, '.ev-code');
  const wrapped = stylesheetRule(css, '.ev-code[data-soft-wrap]');

  assert.match(code, /box-sizing:\s*border-box/);
  assert.match(code, /width:\s*100%/);
  assert.match(code, /padding-top:\s*0\.75em/);
  assert.match(code, /padding-right:\s*1em/);
  assert.match(code, /padding-bottom:\s*0\.75em/);
  assert.match(code, /background:\s*rgba\(128,\s*128,\s*128,\s*0\.06\)/);
  assert.doesNotMatch(code, /border\s*:/, 'screen code rows have no enclosing border');
  assert.doesNotMatch(code, /border-left\s*:/, 'code rows have no separately pronounced resting left edge');
  assert.match(code, /border-radius:\s*4px/);
  assert.match(code, /padding-left:\s*var\(--ev-content-start\)/);
  assert.match(code, /overflow-x:\s*auto/);
  assert.match(code, /white-space:\s*pre/);
  assert.match(code, /font-family:\s*ui-monospace/);
  assert.match(wrapped, /white-space:\s*pre-wrap/);
  assert.match(wrapped, /overflow-wrap:\s*anywhere/);
});

test('file links are marked as list items', () => {
  const css = screenStyles().split('@media print')[0];
  const marker = stylesheetRule(css, '.ev-file::before');

  assert.match(marker, /content:\s*["']•\s*["']/);
  assert.doesNotMatch(css, /\.ev-file\s*>\s*a::before\s*\{/,
    'the bullet is outside the underlined link');
});
