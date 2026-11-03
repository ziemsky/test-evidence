import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  addFirstSection,
  appSource,
  dispatchContextMenu,
  loadApp,
} from './helpers.js';

const paletteOf = (document) => document.querySelector('#evidence > .ev-section-palette');

function mixedApp() {
  return loadApp(appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>' +
      '<section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">Mixed</span></h2>' +
      '<div class="ev-body">' +
      '<div class="ev-comment"><span class="ev-text ev-comment-text">Comment</span></div>' +
      '<div class="ev-code"><span class="ev-text ev-code-text">Code</span></div>' +
      '<div class="ev-shot-row"><div class="ev-screenshot" data-size="medium">' +
      '<img class="ev-img" src="data:image/png;base64,abc" alt="Shot">' +
      '<span class="ev-text ev-caption">Shot</span></div></div>' +
      '</div></section></main>',
  ));
}

function pointerEvent(window, type, x, y, button = 0) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  Object.defineProperty(event, 'button', { value: button });
  return event;
}

test('cross-type handoff has one owner and ignores whitespace and every interaction chrome', () => {
  const { document, window } = mixedApp();
  const section = document.querySelector('.ev-section');
  const comment = document.querySelector('.ev-comment');
  const code = document.querySelector('.ev-code');
  const row = document.querySelector('.ev-shot-row');
  const screenshot = document.querySelector('.ev-screenshot');
  const palette = paletteOf(document);

  dispatchContextMenu(window, section.querySelector(':scope > .ev-title > .ev-title-text'));
  assert.equal(palette.querySelector('.ev-section-palette-header').textContent, 'Section 1');
  dispatchContextMenu(window, comment.querySelector(':scope > .ev-comment-text'));
  assert.equal(palette.querySelector('.ev-section-palette-header').textContent, 'Comment');
  dispatchContextMenu(window, code.querySelector(':scope > .ev-code-text'));
  assert.equal(palette.querySelector('.ev-section-palette-header').textContent, 'Code');
  dispatchContextMenu(window, screenshot.querySelector(':scope > .ev-img'));
  assert.equal(palette.querySelector('.ev-section-palette-header').textContent, 'Screenshot');
  assert.equal(screenshot.hasAttribute('data-palette-active'), true);
  assert.equal(document.querySelectorAll('[data-palette-active]').length, 1);

  const position = palette.style.cssText;
  dispatchContextMenu(window, row.querySelector(':scope > .ev-row-controls'), { x: 420, y: 220 });
  assert.equal(palette.querySelector('.ev-section-palette-header').textContent, 'Screenshot row');
  assert.equal(row.hasAttribute('data-palette-active'), true);
  assert.equal(screenshot.hasAttribute('data-palette-active'), false);

  dispatchContextMenu(window, row, { x: 460, y: 240 });
  assert.equal(palette.querySelector('.ev-section-palette-header').textContent, 'Screenshot row');
  assert.equal(row.hasAttribute('data-palette-active'), true);
  assert.equal(screenshot.hasAttribute('data-palette-active'), false);
  const rowPosition = palette.style.cssText;

  dispatchContextMenu(window, palette.querySelector(':scope > button'), { x: 400, y: 200 });
  assert.equal(palette.style.cssText, rowPosition);
  assert.equal(row.hasAttribute('data-palette-active'), true);

  dispatchContextMenu(window, screenshot.querySelector(':scope > .ev-drag-handle'), { x: 480, y: 260 });
  assert.equal(palette.style.cssText, rowPosition);
  assert.equal(row.hasAttribute('data-palette-active'), true);

  dispatchContextMenu(window, section.querySelector(':scope > .ev-body'), { x: 500, y: 280 });
  assert.equal(palette.style.cssText, rowPosition);
  assert.equal(row.hasAttribute('data-palette-active'), true);
});

test('palette stays within the combined region, then dismisses on escape, outside, and stale-owner refresh', async () => {
  const { document, window } = mixedApp();
  const comment = document.querySelector('.ev-comment');
  const text = comment.querySelector(':scope > .ev-comment-text');
  const palette = paletteOf(document);

  dispatchContextMenu(window, text);
  text.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(palette.hasAttribute('data-palette-visible'), true);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
  assert.equal(comment.hasAttribute('data-palette-active'), false);

  dispatchContextMenu(window, text);
  document.getElementById('toolbar').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(palette.hasAttribute('data-palette-visible'), false);

  dispatchContextMenu(window, text);
  comment.remove();
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
  assert.equal(document.querySelector('[data-palette-active]'), null);

  const codeRow = document.querySelector('.ev-code');
  dispatchContextMenu(window, codeRow.querySelector(':scope > .ev-code-text'));
  codeRow.dispatchEvent(new window.MouseEvent('mouseout', {
    bubbles: true,
    relatedTarget: document.body,
  }));
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
});

test('only mouse context menus in the evidence pane suppress native menus and activate palettes', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const title = section.querySelector(':scope > .ev-title > .ev-title-text');
  const palette = paletteOf(document);

  const hover = new window.MouseEvent('mouseover', { bubbles: true });
  title.dispatchEvent(hover);
  title.focus();
  assert.equal(palette.hasAttribute('data-palette-visible'), false);

  const keyboard = dispatchContextMenu(window, title, { button: 0 });
  const touch = dispatchContextMenu(window, title, { pointerType: 'touch' });
  assert.equal(keyboard.defaultPrevented, true);
  assert.equal(touch.defaultPrevented, true);
  assert.equal(palette.hasAttribute('data-palette-visible'), false);

  const mouse = dispatchContextMenu(window, title);
  assert.equal(mouse.defaultPrevented, true);
  assert.equal(palette.hasAttribute('data-palette-visible'), true);

  const toolbarMenu = dispatchContextMenu(window, document.getElementById('toolbar'));
  const tocMenu = dispatchContextMenu(window, document.getElementById('toc-panel'));
  assert.equal(toolbarMenu.defaultPrevented, false);
  assert.equal(tocMenu.defaultPrevented, false);
  assert.equal(palette.hasAttribute('data-palette-visible'), true);
});

test('active drag suppresses the shared palette and restores its valid owner on cancel', () => {
  const { document, window } = mixedApp();
  const screenshot = document.querySelector('.ev-screenshot');
  const handle = screenshot.querySelector(':scope > .ev-drag-handle');
  const palette = paletteOf(document);

  dispatchContextMenu(window, screenshot.querySelector(':scope > .ev-img'));
  handle.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  document.dispatchEvent(pointerEvent(window, 'pointermove', 110, 103));
  assert.equal(document.body.classList.contains('ev-dragging-active'), true);
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
  assert.equal(screenshot.hasAttribute('data-palette-active'), false);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  assert.equal(document.body.classList.contains('ev-dragging-active'), false);
  assert.equal(palette.hasAttribute('data-palette-visible'), true);
  assert.equal(screenshot.hasAttribute('data-palette-active'), true);
});

test('right-click activation and palette state do not enter saved output', async () => {
  const { document, window, downloads } = mixedApp();
  const screenshot = document.querySelector('.ev-screenshot');
  dispatchContextMenu(window, screenshot.querySelector(':scope > .ev-img'));
  document.getElementById('save-btn').click();
  const saved = await downloads.find((entry) => entry.name).blob.text();
  const savedDocument = new JSDOM(saved).window.document;
  assert.equal(savedDocument.querySelector('.ev-section-palette'), null);
  assert.equal(savedDocument.querySelector('[data-palette-active]'), null);
  assert.equal(savedDocument.querySelector('[data-palette-visible]'), null);
  assert.ok(savedDocument.querySelector('.ev-screenshot'));

  const printCss = appSource().slice(appSource().indexOf('@media print'));
  assert.match(printCss, /\[data-chrome\]:not\(\.ev-num\)[\s\S]*display:\s*none\s*!important/);
});
