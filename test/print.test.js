import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, addFirstSection, appSource, downloadText, loadApp } from './helpers.js';

// 0056: printing is a browser media concern, so the public seam is the
// embedded @media print stylesheet. These assertions deliberately inspect
// selectors and declarations rather than app internals or screen styles.

function printStyles() {
  const source = appSource();
  const start = source.indexOf('@media print');
  assert.notEqual(start, -1, 'the app has a print-only media rule');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(open + 1, i).replace(/\/\*[\s\S]*?\*\//g, ' ');
  }
  assert.fail('the print media rule is closed');
}

function rule(css, selector) {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) return match[2].replace(/\s+/g, ' ');
  }
  assert.fail(`print rule exists for ${selector}`);
}

test('print CSS explicitly removes chrome while retaining authored section numbers and screenshots', () => {
  const css = printStyles();
  const hidden = rule(css, '[data-chrome]:not(.ev-num)');
  assert.match(hidden, /display:\s*none\s*!important/, 'generated interface chrome is absent');
  for (const selector of ['#toolbar', '#toc-panel', '.ev-controls', '.ev-drag-handle', '.ev-add-section-btn', '.ev-screenshot-pending', '.ev-drop-line']) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${selector} is explicitly suppressed`);
  }
  assert.doesNotMatch(css, /\.ev-num\s*\{[^}]*display\s*:\s*none/, 'section numbers remain authored evidence');
  assert.doesNotMatch(css, /\.ev-(doc-title|title|comment|property)\s*\{[^}]*display\s*:\s*none/, 'text evidence remains visible');
  assert.doesNotMatch(css, /\.ev-screenshot\s*\{[^}]*display\s*:\s*none/, 'screenshots remain authored evidence');
  assert.doesNotMatch(css, /\.ev-caption\s*\{[^}]*display\s*:\s*none/, 'captions remain authored evidence');
  assert.match(rule(css, '.ev-caption:empty'), /display:\s*none\s*!important/, 'empty caption hints remain absent on paper');
  assert.match(
    css,
    /\.ev-comment\[data-print-hidden\]\s*,\s*\.ev-code\[data-print-hidden\]\s*,\s*\.ev-property\[data-print-hidden\]\s*,\s*\.ev-url\[data-print-hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    'empty comments, code, incomplete properties, and URL rows are absent',
  );
  assert.doesNotMatch(css, /\.ev-caption\s*\{[^}]*display\s*:\s*none\s*!important/, 'populated captions remain printable');
  assert.match(rule(css, '.ev-section[data-rail]::before'), /display:\s*none\s*!important/, 'hover rails are absent');
  assert.match(rule(css, '.ev-screenshot:focus-within'), /background:\s*transparent\s*!important/, 'focus washes are absent');
  assert.match(rule(css, '.ev-shot-row:hover'), /background:\s*transparent\s*!important/, 'hover washes are absent');
});

test('Print and the theme toggle share the toolbar and Print opens the browser dialogue', () => {
  const { document, window } = loadApp();
  let printCalls = 0;
  window.print = () => { printCalls++; };

  const printButton = document.getElementById('print-btn');
  const themeButton = document.getElementById('theme-toggle');
  assert.ok(printButton, 'the Print button is present');
  assert.equal(printButton.textContent, 'Print');
  assert.equal(printButton.dataset.action, 'print');
  assert.ok(themeButton, 'the appearance toggle is present');
  assert.equal(printButton.nextElementSibling, themeButton, 'the appearance toggle sits beside Print');
  assert.equal(themeButton.nextElementSibling, null, 'the appearance toggle ends the utility strip');

  printButton.click();
  assert.equal(printCalls, 1, 'clicking Print delegates to window.print()');
});

test('print CSS provides an ink-friendly printable layout with controlled page breaks', () => {
  const css = printStyles();
  assert.match(rule(css, 'html'), /background:\s*white/);
  assert.match(rule(css, 'html'), /color:\s*black/);
  assert.match(rule(css, 'body.toc-collapsed'), /max-width:\s*none/);
  assert.match(rule(css, 'body.toc-collapsed'), /padding:\s*0/);
  assert.match(rule(css, '.ev-img'), /max-width:\s*100%/);
  assert.match(rule(css, '.ev-shot-row'), /flex-wrap:\s*wrap/);
  assert.match(rule(css, '#evidence'), /width:\s*100%/, 'evidence uses the printable page width');
  assert.match(rule(css, '.ev-shot-row'), /width:\s*100%/, 'screenshot rows use the printable page width');
  assert.match(rule(css, '.ev-shot-row'), /padding-left:\s*0/, 'screen content offsets do not narrow print rows');
  assert.doesNotMatch(css, /\.ev-shot-row[^}]*display\s*:\s*none/, 'screenshot rows remain grouped');
  assert.doesNotMatch(css, /\.ev-screenshot\[data-(?:standalone|size)[^}]*display\s*:\s*none/, 'standalone and chosen sizes remain available');
  assert.match(rule(css, '.ev-shot-row > .ev-screenshot'), /break-inside:\s*avoid/);
  assert.match(rule(css, '.ev-doc-title'), /break-after:\s*avoid-page/);
  assert.match(rule(css, '.ev-code'), /border:\s*none/);
});

test('empty comments and incomplete properties are excluded from print eligibility', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  sectionAction(section, 'add-property').click();

  const commentText = section.querySelector('.ev-comment-text');
  const property = section.querySelector('.ev-property');
  const key = property.querySelector('.ev-prop-key');
  const value = property.querySelector('.ev-prop-value');
  const input = (field) => field.dispatchEvent(new window.Event('input', { bubbles: true }));

  assert.ok(commentText.closest('.ev-comment').hasAttribute('data-print-hidden'));
  assert.ok(property.hasAttribute('data-print-hidden'));

  commentText.textContent = '\n  \t';
  input(commentText);
  assert.ok(commentText.closest('.ev-comment').hasAttribute('data-print-hidden'));

  commentText.textContent = 'captured evidence';
  input(commentText);
  assert.ok(!commentText.closest('.ev-comment').hasAttribute('data-print-hidden'));

  key.textContent = 'status';
  input(key);
  assert.ok(property.hasAttribute('data-print-hidden'));
  value.textContent = '  ';
  input(value);
  assert.ok(property.hasAttribute('data-print-hidden'));

  value.textContent = '0';
  input(value);
  assert.ok(!property.hasAttribute('data-print-hidden'));
  value.textContent = 'false';
  input(value);
  assert.ok(!property.hasAttribute('data-print-hidden'));

  key.textContent = '  ';
  input(key);
  assert.ok(property.hasAttribute('data-print-hidden'));
});

test('empty code snippets are excluded from print eligibility', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-code').click();

  const code = section.querySelector('.ev-code');
  const codeText = code.querySelector('.ev-code-text');
  const input = () => codeText.dispatchEvent(new window.Event('input', { bubbles: true }));

  assert.equal(codeText.textContent, '', 'the Code… placeholder is CSS-only');
  assert.ok(code.hasAttribute('data-print-hidden'));

  codeText.textContent = '\n  \t';
  input();
  assert.ok(code.hasAttribute('data-print-hidden'));

  codeText.textContent = '0';
  input();
  assert.ok(!code.hasAttribute('data-print-hidden'));

  codeText.textContent = '';
  input();
  window.dispatchEvent(new window.Event('beforeprint'));
  assert.ok(code.hasAttribute('data-print-hidden'));
});

test('print refreshes eligibility before printing without persisting print-only state', async () => {
  const { document, window, downloads } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  sectionAction(section, 'add-property').click();

  const comment = section.querySelector('.ev-comment');
  const property = section.querySelector('.ev-property');
  comment.querySelector('.ev-comment-text').textContent = 'captured evidence';
  property.querySelector('.ev-prop-key').textContent = 'status';
  property.querySelector('.ev-prop-value').textContent = 'passed';

  window.dispatchEvent(new window.Event('beforeprint'));
  assert.ok(!comment.hasAttribute('data-print-hidden'));
  assert.ok(!property.hasAttribute('data-print-hidden'));

  property.querySelector('.ev-prop-value').textContent = '';
  window.dispatchEvent(new window.Event('beforeprint'));
  assert.ok(property.hasAttribute('data-print-hidden'));

  document.getElementById('save-btn').click();
  const saved = await downloadText(downloads.find((entry) => entry.name));
  const savedDocument = new JSDOM(saved).window.document;
  assert.equal(savedDocument.querySelectorAll('#evidence [data-print-hidden]').length, 0);
});
