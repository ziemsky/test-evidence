import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, appSource, downloadText } from './helpers.js';

// The content column is shared by every evidence row. Section numbers occupy
// the document-wide column immediately before it; the drag/selection gutter
// stays outside both columns.

function mainWith(html) {
  return appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>${html}</main>`,
  );
}

function sourceStyle() {
  const match = /<style>([\s\S]*?)<\/style>/.exec(appSource());
  assert.ok(match, 'the app has an embedded stylesheet');
  return match[1];
}

function sectionHtml(title = 'Section') {
  return `<section class="ev-section">
    <h2 class="ev-title"><span class="ev-text ev-title-text">${title}</span></h2>
    <div class="ev-body">
      <div class="ev-comment"><span class="ev-text ev-comment-text">comment</span></div>
      <div class="ev-code"><span class="ev-text ev-code-text">code</span></div>
      <div class="ev-property">
        <span class="ev-text ev-prop-key">Key</span><span class="ev-sep">:</span>
        <span class="ev-text ev-prop-value">Value</span>
      </div>
      <div class="ev-file"><a href="assets/log.txt">log.txt</a></div>
    </div>
  </section>`;
}

test('the shared column expands to the widest rendered section number', () => {
  const { document, window } = loadApp(mainWith(sectionHtml()));
  const root = document.getElementById('evidence');
  window.__evidence.measureSectionNumberWidth = (number) =>
    number.textContent === '1' ? 8 : 42;

  const number = document.querySelector('.ev-num');
  number.textContent = '10.12.3';
  window.__evidence.alignEvidenceColumns();

  assert.equal(root.style.getPropertyValue('--ev-number-width'), '42px');
  assert.equal(root.style.getPropertyValue('--ev-number-gap'), '12px');
  assert.equal(root.style.getPropertyValue('--ev-gutter-width'), '13.6px');
  assert.equal(root.style.getPropertyValue('--ev-content-start'), '67.6px');
});

test('recomputation narrows the shared column when the widest number disappears', () => {
  const { document, window } = loadApp(mainWith(
    sectionHtml('First') + sectionHtml('Second'),
  ));
  const widths = new Map([
    ['1', 8],
    ['2', 8],
    ['10.12.3', 42],
  ]);
  window.__evidence.measureSectionNumberWidth = (number) => widths.get(number.textContent) || 0;
  const numbers = [...document.querySelectorAll('.ev-num')];
  numbers[1].textContent = '10.12.3';
  window.__evidence.alignEvidenceColumns();
  assert.equal(document.getElementById('evidence').style.getPropertyValue('--ev-number-width'), '42px');

  numbers[1].textContent = '2';
  window.__evidence.alignEvidenceColumns();
  assert.equal(document.getElementById('evidence').style.getPropertyValue('--ev-number-width'), '8px');
  assert.equal(document.getElementById('evidence').style.getPropertyValue('--ev-content-start'), '33.6px');
});

test('renumber recomputes the layout column after structural changes', () => {
  const { document, window } = loadApp(mainWith(sectionHtml()));
  window.__evidence.measureSectionNumberWidth = (number) => number.textContent.length * 10;
  const root = document.getElementById('evidence');
  window.__evidence.alignEvidenceColumns();
  assert.equal(root.style.getPropertyValue('--ev-number-width'), '10px');

  for (let i = 0; i < 10; i++) {
    [...document.querySelectorAll('[data-action="add-section"]')].at(-1).click();
  }
  assert.equal(root.style.getPropertyValue('--ev-number-width'), '20px');
});

test('all evidence row families share the content-column CSS and retain a left gutter', () => {
  const css = sourceStyle();
  for (const selector of [
    'h2.ev-title',
    '.ev-comment',
    '.ev-code',
    '.ev-file',
    '.ev-property',
    '.ev-shot-row',
    '.ev-body > .ev-screenshot-pending',
    '.ev-body > .ev-screenshot',
  ]) {
    assert.match(css, new RegExp(`${selector.replace('.', '\\.')}[^{}]*\\{[^}]*padding-left: var\\(--ev-content-start\\)`));
  }
  assert.match(css, /\.ev-num\s*\{[^}]*display:\s*inline-block/);
  assert.match(css, /\.ev-num\s*\{[^}]*width:\s*var\(--ev-number-width\)/);
  assert.match(css, /\.ev-num\s*\{[^}]*text-align:\s*left/);
  assert.match(css, /\.ev-num\s*\{[^}]*margin-right:\s*var\(--ev-number-gap\)/);
  assert.match(css, /margin-left:\s*calc\(-1 \* var\(--ev-content-start\)\)/);
});

test('layout measurements are stripped from saved HTML', async () => {
  const { document, window, downloads } = loadApp(mainWith(sectionHtml()));
  window.__evidence.measureSectionNumberWidth = () => 42;
  window.__evidence.alignEvidenceColumns();
  document.getElementById('save-btn').click();
  const saved = await downloadText(downloads.find((d) => d.name));
  const savedDocument = new JSDOM(saved).window.document;

  assert.equal(savedDocument.querySelector('#evidence')?.getAttribute('style'), null);
});
