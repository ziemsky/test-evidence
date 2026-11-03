import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  addFirstSection,
  appSource,
  dispatchContextMenu,
  downloadText,
  loadApp,
  screenStyles,
  stylesheetRule,
} from './helpers.js';

const titleOf = (section) => section.querySelector(':scope > h2.ev-title > .ev-title-text');

test('the shared section palette remains hidden chrome with every existing action', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  const palette = document.querySelector('#evidence > .ev-section-palette');
  assert.equal(palette.getAttribute('data-chrome'), '');
  assert.deepEqual(
    [...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action),
    ['add-subsection', 'add-comment', 'add-code', 'add-property', 'add-screenshot',
      'add-file', 'add-url', 'add-section-after', 'copy', 'copy-element', 'paste-after', 'paste-here', 'delete'],
  );
  assert.ok([...palette.querySelectorAll('button')].every((button) => button.tabIndex === -1));
  assert.equal(section.hasAttribute('data-palette-active'), false);
});

test('right-click ownership updates the shared header and never creates competing palettes', () => {
  const { document, window } = loadApp();
  const first = addFirstSection(document);
  dispatchContextMenu(window, titleOf(first));
  const palette = document.querySelector('#evidence > .ev-section-palette');
  assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'Section 1');

  document.querySelector('.ev-add-section-btn').click();
  const second = document.querySelectorAll('#evidence > .ev-section')[1];
  dispatchContextMenu(window, titleOf(second));
  assert.equal(first.hasAttribute('data-palette-active'), false);
  assert.equal(second.hasAttribute('data-palette-active'), true);
  assert.equal(document.querySelectorAll('[data-section-palette]').length, 1);
  assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'Section 2');
});

test('keyboard focus does not open a palette, but visible palette controls remain keyboardable', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const title = titleOf(section);
  const palette = document.querySelector('#evidence > .ev-section-palette');

  title.focus();
  assert.equal(section.hasAttribute('data-palette-active'), false);

  dispatchContextMenu(window, title);
  const action = palette.querySelector('[data-action="copy"]');
  action.focus();
  assert.equal(document.activeElement, action);
  assert.equal(action.tabIndex, 0);
});

test('palette placement uses the right-click point and stays viewport-safe', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const palette = document.querySelector('#evidence > .ev-section-palette');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
  palette.getBoundingClientRect = () => ({ width: 200, height: 100 });

  dispatchContextMenu(window, titleOf(section), { x: 10, y: 10 });
  assert.equal(palette.style.getPropertyValue('--ev-palette-left'), '108px');
  assert.equal(palette.style.getPropertyValue('--ev-palette-top'), '58px');
  dispatchContextMenu(window, titleOf(section), { x: 250, y: 150 });
  assert.equal(palette.style.getPropertyValue('--ev-palette-left'), '250px');
  assert.equal(palette.style.getPropertyValue('--ev-palette-top'), '150px');
  dispatchContextMenu(window, titleOf(section), { x: 490, y: 290 });
  assert.equal(palette.style.getPropertyValue('--ev-palette-left'), '392px');
  assert.equal(palette.style.getPropertyValue('--ev-palette-top'), '242px');
});

test('the palette keeps its viewport-safe styling and remains absent from print and saves', async () => {
  const { document, window, downloads } = loadApp();
  const section = addFirstSection(document);
  dispatchContextMenu(window, titleOf(section));
  const css = screenStyles();
  const palette = stylesheetRule(css, '#evidence > .ev-section-palette');
  const active = stylesheetRule(css, '#evidence > .ev-section-palette[data-palette-visible]');
  const source = appSource();
  const printCss = source.slice(source.indexOf('@media print'));
  assert.match(palette, /position:\s*fixed/);
  assert.match(palette, /left:\s*var\(--ev-palette-left/);
  assert.match(palette, /top:\s*var\(--ev-palette-top/);
  assert.match(palette, /max-width:\s*calc\(100vw\s*-\s*1rem\)/);
  assert.match(palette, /max-height:\s*calc\(100vh\s*-\s*1rem\)/);
  assert.match(palette, /overflow-y:\s*auto/);
  assert.match(active, /transform:\s*translate\(-50%/);
  assert.match(printCss, /\.ev-controls[\s\S]*display:\s*none\s*!important/);

  document.getElementById('save-btn').click();
  const saved = await downloadText(downloads.find((entry) => entry.name));
  const savedDocument = new JSDOM(saved).window.document;
  assert.equal(savedDocument.querySelector('.ev-section-palette'), null);
  assert.equal(savedDocument.querySelector('[data-palette-active]'), null);
});
