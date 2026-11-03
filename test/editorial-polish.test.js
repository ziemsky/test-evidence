import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, addFirstSection, appSource, downloadText, loadApp, screenStyles, stylesheetRule } from './helpers.js';

function screenCss() {
  return screenStyles().split('@media print')[0];
}

test('the editorial sheet uses shared quiet surfaces for focus, hover, and muted evidence chrome', () => {
  const css = screenCss();
  const tokens = stylesheetRule(css, ':root');
  const focus = stylesheetRule(css, '.ev-comment:focus-within');
  const hover = stylesheetRule(css, '.ev-shot-row:hover:not(:focus-within)');
  const number = stylesheetRule(css, '.ev-num');
  const caption = stylesheetRule(css, '.ev-caption');

  assert.match(tokens, /--ev-focus-surface:\s*rgba\(128,\s*128,\s*128,\s*0\.07\)/);
  assert.match(tokens, /--ev-focus-edge:\s*rgba\(0,\s*120,\s*215,\s*0\.55\)/);
  assert.match(tokens, /--ev-hover-surface:\s*rgba\(128,\s*128,\s*128,\s*0\.08\)/);
  assert.match(focus, /background:\s*var\(--ev-focus-surface\)/);
  assert.match(focus, /box-shadow:\s*inset 2px 0 0 var\(--ev-focus-edge\)/);
  assert.match(hover, /background:\s*var\(--ev-hover-surface\)/);
  assert.match(css, /\.ev-screenshot:hover\s*>\s*\.ev-controls\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.ev-shot-row:hover\s*>\s*\.ev-row-controls\s*\{[^}]*visibility:\s*visible/);
  assert.match(number, /opacity:\s*0\.56/);
  assert.match(caption, /color:\s*rgba\(128,\s*128,\s*128,\s*0\.84\)/);
});

test('focus treatment keeps the whole row identifiable without restoring a dominant wash', () => {
  const css = screenCss();
  const focusSelectors = [
    'h2.ev-title:focus-within',
    '.ev-doc-title:focus-within',
    '.ev-comment:focus-within',
    '.ev-code:focus-within',
    '.ev-file:focus-within',
    '.ev-property:focus-within',
    '.ev-screenshot:focus-within',
  ];

  for (const selector of focusSelectors) {
    const rule = stylesheetRule(css, selector);
    assert.match(rule, /background:\s*var\(--ev-focus-surface\)/, selector);
    assert.match(rule, /box-shadow:\s*inset 2px 0 0 var\(--ev-focus-edge\)/, selector);
    assert.match(rule, /padding-top:\s*2px/);
    assert.match(rule, /padding-bottom:\s*2px/);
  }
});

test('the complete example keeps its hierarchy, active editing seam, and screenshot metadata', () => {
  const { document, window } = loadApp();
  window.confirm = () => true;
  document.getElementById('example-btn').click();
  sectionAction(document, 'apply-example').click();

  assert.deepEqual(
    [...document.querySelectorAll('#evidence > .ev-section > .ev-title > .ev-title-text')].map((title) => title.textContent),
    ['Test objective', 'Test data', 'Preconditions', 'Test steps', 'Expected result', 'Evidence'],
  );
  assert.equal(document.querySelectorAll('#evidence .ev-section').length, 16, 'nested example hierarchy remains intact (6 top, 7 test-data, 3 test-step sections)');
  assert.equal(document.activeElement, document.querySelector('.ev-doc-title-text'), 'editing focus remains obvious at the title');
  const screenshot = document.querySelector('#evidence .ev-screenshot');
  assert.ok(screenshot, 'the example includes its intentional screenshot');
  assert.equal(screenshot.querySelector('.ev-caption').textContent, 'Referral before shortlist update');
  assert.ok(sectionAction(screenshot, 'copy'), 'screenshot controls remain available');
  assert.ok(document.querySelector('.ev-property'), 'structured evidence remains present');
  assert.ok(document.querySelector('.ev-code'), 'code evidence remains present');
});

test('narrow layout and print retain the shared bounds and remove screen-only polish', () => {
  const css = screenCss();
  const source = appSource();
  const body = stylesheetRule(css, 'body');
  const row = stylesheetRule(css, '.ev-shot-row');
  const image = stylesheetRule(css, '.ev-img');

  assert.match(body, /max-width:\s*none/);
  assert.match(body, /--ev-content-column-width:\s*min\(100%,\s*var\(--ev-reading-measure\)\)/);
  assert.match(body, /padding-left:\s*calc\(var\(--ev-toc-width\) \+ var\(--ev-page-gutter\)\)/);
  assert.match(row, /width:\s*min\(var\(--ev-media-measure\),/);
  assert.match(image, /max-width:\s*100%/);
  const narrowStart = source.indexOf('@media (max-width: 720px)');
  const printStart = source.indexOf('@media print');
  assert.ok(narrowStart >= 0 && narrowStart < printStart, 'phone layout is explicit and screen-only');
  const narrow = source.slice(narrowStart, printStart);
  assert.match(narrow, /body\s*\{[^}]*--ev-toc-width:\s*0px[^}]*padding-left:\s*var\(--ev-page-gutter\)/);
  assert.match(narrow, /#toc-panel\s*\{[^}]*display:\s*none/);
  assert.match(narrow, /#toolbar\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(narrow, /#toolbar \.toolbar-actions\s*\{[^}]*flex:\s*1 1 100%[^}]*flex-wrap:\s*wrap/);
  assert.match(row, /max-width:\s*100%/);
  assert.match(css, /\.ev-screenshot\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
  assert.match(
    source,
    /h2\.ev-title:focus-within,[\s\S]*?\.ev-screenshot:focus-within\s*\{[^}]*box-shadow:\s*none\s*!important/,
    'print removes the focus accent',
  );

  const { document } = loadApp();
  const section = addFirstSection(document);
  assert.equal(section.querySelector('.ev-title-text').textContent, '', 'a narrow-safe empty sheet remains editable');
});

test('visual polish is absent from saved authored HTML', async () => {
  const first = loadApp();
  const section = addFirstSection(first.document);
  section.querySelector('.ev-title-text').textContent = 'Results';
  first.document.getElementById('save-btn').click();
  const download = first.downloads.find((entry) => entry.name);
  const saved = await downloadText(download);
  const savedDocument = new JSDOM(saved).window.document;
  assert.equal(savedDocument.querySelector('#evidence').getAttribute('style'), null);
  assert.equal(savedDocument.querySelector('[data-chrome]'), null);
  assert.equal(savedDocument.querySelector('.ev-title-text').textContent, 'Results');
});
