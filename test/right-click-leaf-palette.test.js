import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  addFirstSection,
  appSource,
  dispatchContextMenu,
  downloadText,
  createFileSystemEnv,
  loadApp,
  documentHandleKey,
  sectionAction,
  tick,
  waitFor,
} from './helpers.js';

const paletteOf = (document) => document.querySelector('#evidence > .ev-section-palette');

function fileApp(fs) {
  return loadApp(appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>' +
      '<section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">Files</span></h2>' +
      '<div class="ev-body"><div class="ev-file"><a href="assets/notes.pdf" target="_blank" rel="noopener">notes.pdf</a></div></div>' +
      '</section></main>',
  ), fs ? { fs } : {});
}

function addRows(document) {
  const section = addFirstSection(document);
  sectionAction(section, 'add-code').click();
  sectionAction(section, 'add-property').click();
  return {
    section,
    code: section.querySelector(':scope > .ev-body > .ev-code'),
    property: section.querySelector(':scope > .ev-body > .ev-property'),
  };
}

function authoredSurface(row) {
  return row.querySelector(':scope > .ev-code-text, :scope > .ev-prop-value, :scope > a');
}

test('code and property rows open type-specific shared palettes with mouse context menus only', () => {
  const { document, window } = loadApp();
  const { code, property } = addRows(document);
  const palette = paletteOf(document);

  dispatchContextMenu(window, authoredSurface(code), { button: 0 });
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
  dispatchContextMenu(window, authoredSurface(code), { pointerType: 'touch' });
  assert.equal(palette.hasAttribute('data-palette-visible'), false);

  dispatchContextMenu(window, authoredSurface(code));
  assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'Code');
  assert.deepEqual(
    [...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action),
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'soft-wrap', 'copy', 'copy-element', 'paste-after', 'delete'],
  );

  dispatchContextMenu(window, authoredSurface(property));
  assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'Property');
  assert.deepEqual(
    [...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action),
    // 0107 (SPEC §29): the six in-section content adds lead the toolbox,
    // above the property row's existing tools in their current order.
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'copy', 'copy-element', 'paste-after', 'delete'],
  );
  assert.equal(property.hasAttribute('data-palette-active'), true);
  assert.equal(code.hasAttribute('data-palette-active'), false);
});

test('leaf row drag handles and inline controls do not transfer palette ownership or reserve space', () => {
  const { document, window } = loadApp();
  const { code, property } = addRows(document);
  const palette = paletteOf(document);
  const rows = [code, property];

  for (const row of rows) {
    dispatchContextMenu(window, authoredSurface(row));
    const before = palette.style.cssText;
    dispatchContextMenu(window, row.querySelector(':scope > .ev-drag-handle'), { x: 420, y: 220 });
    assert.equal(palette.style.cssText, before);
    dispatchContextMenu(window, row.querySelector(':scope > .ev-controls button'), { x: 460, y: 240 });
    assert.equal(palette.style.cssText, before);
    assert.equal(window.getComputedStyle(row.querySelector(':scope > .ev-controls')).display, 'none');
  }

  const file = fileApp();
  const fileRow = file.document.querySelector('.ev-file');
  const filePalette = paletteOf(file.document);
  dispatchContextMenu(file.window, authoredSurface(fileRow));
  const filePosition = filePalette.style.cssText;
  dispatchContextMenu(file.window, fileRow.querySelector(':scope > .ev-drag-handle'), { x: 420, y: 220 });
  assert.equal(filePalette.style.cssText, filePosition);
  dispatchContextMenu(file.window, fileRow.querySelector(':scope > .ev-controls button'), { x: 460, y: 240 });
  assert.equal(filePalette.style.cssText, filePosition);
  assert.equal(file.window.getComputedStyle(fileRow.querySelector(':scope > .ev-controls')).display, 'none');
});

test('code soft-wrap state is reflected immediately in the shared palette', () => {
  const { document, window } = loadApp();
  const { code } = addRows(document);
  const palette = paletteOf(document);
  const surface = authoredSurface(code);

  dispatchContextMenu(window, surface);
  const softWrap = palette.querySelector('[data-action="soft-wrap"]');
  assert.equal(softWrap.getAttribute('aria-pressed'), 'false');
  softWrap.click();
  assert.equal(code.hasAttribute('data-soft-wrap'), true);

  dispatchContextMenu(window, surface);
  assert.equal(palette.querySelector('[data-action="soft-wrap"]').getAttribute('aria-pressed'), 'true');
  assert.equal(palette.querySelector('[data-action="soft-wrap"]').hasAttribute('data-active'), true);
});

test('file rows expose rename, copy, paste-after, and delete in the shared palette', async () => {
  const { document, window } = fileApp();
  const row = document.querySelector('.ev-file');
  const palette = paletteOf(document);
  const surface = authoredSurface(row);
  const clipboard = [];
  window.navigator.clipboard = { writeText: (text) => { clipboard.push(text); return Promise.resolve(); } };

  dispatchContextMenu(window, surface);
  assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'File');
  assert.deepEqual(
    [...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action),
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'rename-file', 'copy', 'paste-after', 'delete'],
  );
  assert.equal(palette.querySelector('[data-action="rename-file"]').disabled, true);
  palette.querySelector('[data-action="copy"]').click();
  await Promise.resolve();
  assert.deepEqual(clipboard, ['notes.pdf']);
});

test('file palette routes rename and confirmed delete through the existing file lifecycle', async () => {
  const fs = createFileSystemEnv();
  fs.env.idbStores.add('handles');
  fs.env.idbHandles.set(documentHandleKey(), fs.env.pickedDir);
  fs.env.assetsFiles.set('notes.pdf', new Blob(['file bytes'], { type: 'application/pdf' }));
  const { document, window } = fileApp(fs);
  await tick();
  assert.equal(document.getElementById('mode-indicator'), null);
  window.confirm = () => true;
  window.prompt = () => 'renamed.pdf';
  const row = document.querySelector('.ev-file');
  const palette = paletteOf(document);

  dispatchContextMenu(window, authoredSurface(row));
  assert.equal(palette.querySelector('[data-action="rename-file"]').disabled, false);
  palette.querySelector('[data-action="rename-file"]').click();
  await waitFor(() => row.querySelector(':scope > a').textContent === 'renamed.pdf');
  assert.deepEqual(fs.env.removedAssets, ['notes.pdf']);

  dispatchContextMenu(window, authoredSurface(row));
  palette.querySelector('[data-action="delete"]').click();
  await waitFor(() => !row.isConnected);
  assert.deepEqual(fs.env.removedAssets, ['notes.pdf', 'renamed.pdf']);
});

test('leaf palette chrome is serialization-neutral while authored rows remain intact', async () => {
  const first = loadApp();
  const { code, property } = addRows(first.document);
  code.querySelector(':scope > .ev-code-text').textContent = 'wrapped';
  property.querySelector(':scope > .ev-prop-key').textContent = 'State';
  property.querySelector(':scope > .ev-prop-value').textContent = 'ready';
  dispatchContextMenu(first.window, authoredSurface(code));
  const saved = await downloadText((first.document.getElementById('save-btn').click(), first.downloads.find((entry) => entry.name)));
  const savedDocument = new JSDOM(saved).window.document;

  assert.equal(savedDocument.querySelector('#evidence > .ev-section-palette'), null);
  assert.equal(savedDocument.querySelector('[data-palette-active]'), null);
  assert.equal(savedDocument.querySelector('[data-palette-visible]'), null);
  assert.equal(savedDocument.querySelector('.ev-code-text').textContent, 'wrapped');
  assert.equal(savedDocument.querySelector('.ev-prop-key').textContent, 'State');
  assert.equal(savedDocument.querySelector('.ev-prop-value').textContent, 'ready');

  const file = fileApp();
  const fileRow = file.document.querySelector('.ev-file');
  dispatchContextMenu(file.window, authoredSurface(fileRow));
  file.document.getElementById('save-btn').click();
  const fileSaved = await downloadText(file.downloads.find((entry) => entry.name));
  const fileSavedDocument = new JSDOM(fileSaved).window.document;
  assert.equal(fileSavedDocument.querySelector('#evidence > .ev-section-palette'), null);
  assert.equal(fileSavedDocument.querySelector('.ev-file > a').textContent, 'notes.pdf');
});
