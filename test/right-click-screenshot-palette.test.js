import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  appSource,
  dispatchContextMenu,
  downloadText,
  loadApp,
  waitFor,
} from './helpers.js';

const paletteOf = (document) => document.querySelector('#evidence > .ev-section-palette');
const ROW_CONTROL_ACTIONS = [
  'row-valign-top', 'row-valign-middle', 'row-valign-bottom',
  'row-halign-left', 'row-halign-center', 'row-halign-right',
];

function screenshotApp({ src = 'assets/shot.png', size = 'medium', standalone = false } = {}) {
  const standaloneAttribute = standalone ? ' data-standalone=""' : '';
  return loadApp(appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>' +
      '<section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">Shots</span></h2>' +
      '<div class="ev-body"><div class="ev-shot-row" data-halign="right">' +
      `<div class="ev-screenshot" data-size="${size}"${standaloneAttribute}>` +
      `<img class="ev-img" src="${src}" alt="Caption">` +
      '<span class="ev-text ev-caption">Caption</span></div>' +
      '</div></div></section></main>',
  ));
}

function screenshotParts(document) {
  const screenshot = document.querySelector('.ev-screenshot');
  return {
    screenshot,
    image: screenshot.querySelector(':scope > .ev-img'),
    filename: screenshot.querySelector(':scope > .ev-filename'),
    caption: screenshot.querySelector(':scope > .ev-caption'),
    row: screenshot.closest('.ev-shot-row'),
  };
}

test('screenshot content owns the shared palette, with current screenshot state and asset actions', () => {
  const { document, window } = screenshotApp();
  const { screenshot, image, filename, caption, row } = screenshotParts(document);
  const palette = paletteOf(document);

  for (const target of [image, filename, caption]) {
    dispatchContextMenu(window, target);
    assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'Screenshot');
    assert.deepEqual(
      [...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action),
      [
        'add-screenshot',
        'size-small', 'size-medium', 'size-large', 'size-page-width', 'size-original',
        'size-larger', 'size-smaller', 'standalone', 'open-image', 'rename-file', 'copy', 'paste-after', 'delete',
      ],
    );
    assert.equal(palette.querySelector('[data-action="size-medium"]').hasAttribute('data-active'), true);
    assert.equal(palette.querySelector('[data-action="standalone"]').hasAttribute('data-active'), false);
    assert.equal(row.hasAttribute('data-palette-active'), false);
    assert.equal(screenshot.hasAttribute('data-palette-active'), true);
  }
});

test('screenshot palette refreshes size, standalone, and asset-name state', () => {
  const { document, window } = screenshotApp({ standalone: true });
  const { screenshot, image, row } = screenshotParts(document);
  const palette = paletteOf(document);

  dispatchContextMenu(window, image);
  assert.equal(palette.querySelector('[data-action="size-medium"]').hasAttribute('data-active'), true);
  assert.equal(palette.querySelector('[data-action="standalone"]').hasAttribute('data-active'), true);
  palette.querySelector('[data-action="size-small"]').click();
  assert.equal(screenshot.dataset.size, 'small');

  dispatchContextMenu(window, image);
  assert.equal(palette.querySelector('[data-action="size-small"]').hasAttribute('data-active'), true);
  palette.querySelector('[data-action="standalone"]').click();
  assert.equal(screenshot.hasAttribute('data-standalone'), false);
  dispatchContextMenu(window, image);
  assert.equal(palette.querySelector('[data-action="standalone"]').hasAttribute('data-active'), false);

  const dataUrl = screenshotApp({ src: 'data:image/png;base64,abc' });
  dispatchContextMenu(dataUrl.window, dataUrl.document.querySelector('.ev-img'));
  assert.equal(dataUrl.document.querySelector('[data-action="rename-file"]'), null);
  assert.equal(row.hasAttribute('data-palette-active'), false);
});

test('screenshot-row whitespace and alignment controls own a separate alignment palette', () => {
  const { document, window } = screenshotApp();
  const { row, image } = screenshotParts(document);
  const palette = paletteOf(document);
  const targets = [row, row.querySelector(':scope > .ev-row-controls')];

  for (const target of targets) {
    dispatchContextMenu(window, target);
    assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'Screenshot row');
    assert.deepEqual(
      [...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action).slice(6),
      ROW_CONTROL_ACTIONS,
    );
  }

  palette.querySelector('[data-action="row-valign-middle"]').click();
  assert.equal(row.getAttribute('data-valign'), 'middle');
  dispatchContextMenu(window, row);
  assert.equal(palette.querySelector('[data-action="row-valign-middle"]').hasAttribute('data-active'), true);
  dispatchContextMenu(window, image);
  assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'Screenshot');
});

test('screenshot handles do not take ownership, and legacy toolboxes are inert and layout-neutral', async () => {
  const first = screenshotApp();
  const { document, window } = first;
  const { screenshot, image, row } = screenshotParts(document);
  const palette = paletteOf(document);

  dispatchContextMenu(window, image);
  const before = palette.style.cssText;
  dispatchContextMenu(window, screenshot.querySelector(':scope > .ev-drag-handle'), { x: 420, y: 220 });
  assert.equal(screenshot.hasAttribute('data-palette-active'), true);
  assert.equal(palette.style.cssText, before);
  dispatchContextMenu(window, row.querySelector(':scope > .ev-drag-handle'), { x: 460, y: 240 });
  assert.equal(screenshot.hasAttribute('data-palette-active'), true);
  assert.equal(row.hasAttribute('data-palette-active'), false);
  assert.equal(window.getComputedStyle(screenshot.querySelector(':scope > .ev-controls')).display, 'none');
  assert.equal(window.getComputedStyle(row.querySelector(':scope > .ev-row-controls')).display, 'none');

  document.getElementById('save-btn').click();
  const saved = await downloadText(first.downloads.find((entry) => entry.name));
  const savedDocument = new JSDOM(saved).window.document;
  assert.equal(savedDocument.querySelector('#evidence > .ev-section-palette'), null);
  assert.equal(savedDocument.querySelector('.ev-shot-row > .ev-row-controls'), null);
  assert.equal(savedDocument.querySelector('.ev-screenshot > .ev-controls'), null);
});

test('screenshot palette keeps PNG copy and delete actions on the existing lifecycle', async () => {
  const { document, window } = screenshotApp({ src: 'data:image/png;base64,iVBORw0KGgo=' });
  const { image, row } = screenshotParts(document);
  const writes = [];
  window.ClipboardItem = class ClipboardItem {
    constructor(formats) { this.formats = formats; }
  };
  window.navigator.clipboard = {
    write(items) { writes.push(items); return Promise.resolve(); },
  };
  const palette = paletteOf(document);

  dispatchContextMenu(window, image);
  palette.querySelector('[data-action="copy"]').click();
  await waitFor(() => writes.length === 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].formats['image/png'].type, 'image/png');

  dispatchContextMenu(window, image);
  palette.querySelector('[data-action="delete"]').click();
  assert.equal(row.isConnected, false);
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
});
