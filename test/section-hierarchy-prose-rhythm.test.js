import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAction, addFirstSection, loadApp, screenStyles, stylesheetRule } from './helpers.js';

test('top-level section titles are anchors with a restrained boundary and spacious separation', () => {
  const css = screenStyles();
  const section = stylesheetRule(css, '#evidence > .ev-section');
  const title = stylesheetRule(css, '#evidence > .ev-section > .ev-title');

  assert.match(section, /margin-top:\s*var\(--ev-section-gap\)/);
  assert.match(section, /margin-bottom:\s*var\(--ev-section-gap\)/);
  assert.match(title, /border-bottom:\s*1px solid/);
  assert.match(title, /padding-top:\s*0\.65rem/);
  assert.match(title, /padding-bottom:\s*0\.45rem/);
  assert.match(title, /font-weight:\s*600/);
});

test('nested titles remain subordinate without a second rail or horizontal offset', () => {
  const css = screenStyles();
  const nested = stylesheetRule(css, '.ev-section .ev-section > .ev-title');

  assert.match(nested, /margin-top:\s*1\.35rem/);
  assert.match(nested, /margin-bottom:\s*0\.45rem/);
  assert.doesNotMatch(nested, /border-(?:top|right|bottom|left|color|style|width)/);
  assert.doesNotMatch(nested, /padding-left/);

  const { document } = loadApp();
  const top = addFirstSection(document);
  sectionAction(top, 'add-subsection').click();
  const nestedSection = top.querySelector(':scope > .ev-body > .ev-section');
  assert.equal(nestedSection.querySelectorAll(':scope > .ev-title > .ev-num').length, 1);
  assert.equal(nestedSection.querySelectorAll(':scope > .ev-title > .ev-drag-handle').length, 1);
  assert.equal(nestedSection.querySelector(':scope > .ev-title').style.paddingLeft, '');
});

test('prose rows have a readable measure and stable multiline rhythm', () => {
  const css = screenStyles();
  const root = stylesheetRule(css, '#evidence');
  const prose = stylesheetRule(css, '.ev-comment');
  const proseText = stylesheetRule(css, '.ev-comment > .ev-comment-text');

  assert.match(root, /--ev-prose-measure:\s*68ch/);
  assert.match(root, /--ev-prose-leading:\s*1\.65/);
  assert.match(prose, /width:\s*100%/);
  assert.match(prose, /max-width:\s*none/);
  assert.match(prose, /box-sizing:\s*border-box/);
  assert.match(prose, /line-height:\s*var\(--ev-prose-leading\)/);
  assert.match(prose, /overflow-wrap:\s*anywhere/);
  assert.match(prose, /margin-top:\s*0\.65em/);
  assert.match(prose, /margin-bottom:\s*0\.65em/);
  assert.match(proseText, /display:\s*inline-block/);
  assert.match(proseText, /max-width:\s*min\(100%,\s*var\(--ev-prose-measure\)\)/);
  assert.match(proseText, /overflow-wrap:\s*anywhere/);
  assert.match(css, /\.ev-text\s*\{[^{}]*white-space:\s*pre-wrap/);
});

test('multiline and long-token prose stays in its row with stable editing chrome', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const row = section.querySelector(':scope > .ev-body > .ev-comment');
  const text = row.querySelector('.ev-comment-text');
  const content = 'A readable evidence sentence followed by a deliberately long token: '
    + 'unbroken-evidence-token-that-must-wrap-within-the-prose-measure\n'
    + 'The next line remains part of the same comment row.';

  text.textContent = content;
  text.dispatchEvent(new window.Event('input', { bubbles: true }));
  text.focus();

  assert.equal(text.textContent, content, 'multiline authored prose is preserved verbatim');
  assert.equal(row.querySelectorAll(':scope > .ev-drag-handle').length, 1);
  assert.equal(row.matches(':focus-within'), true, 'the whole prose row owns the focus state');
  assert.equal(document.querySelectorAll('.ev-num').length, 1, 'the row does not create another number rail');
});

test('hierarchy treatment preserves the shared content line and left-side selection rails', () => {
  const css = screenStyles();
  const title = stylesheetRule(css, 'h2.ev-title');
  const number = stylesheetRule(css, '.ev-num');
  const rail = stylesheetRule(css, '.ev-section[data-rail="current"]::before');

  assert.match(title, /padding-left:\s*var\(--ev-content-start\)/);
  assert.match(number, /width:\s*var\(--ev-number-width\)/);
  assert.match(number, /text-align:\s*left/);
  assert.match(number, /margin-right:\s*var\(--ev-number-gap\)/);
  assert.match(rail, /left:\s*0/);
  assert.match(rail, /pointer-events:\s*none/);
});
