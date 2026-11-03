import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  appSource,
  createFileSystemEnv,
  dispatchContextMenu,
  downloadText,
  latestOperationResult,
  loadApp,
  documentHandleKey,
  pasteImage,
  sectionAction,
  stubImagePipeline,
  waitFor,
  assertCaretAtEnd,
} from './helpers.js';

const ADDS = ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url'];
const FILE_ACTIONS = [...ADDS, 'rename-file', 'copy', 'paste-after', 'delete'];
const URL_ACTIONS = [...ADDS, 'edit', 'copy', 'copy-element', 'delete'];
const paletteOf = (document) => document.querySelector('#evidence > .ev-section-palette');
const bodyOf = (section) => section.querySelector(':scope > .ev-body');
const tagsOf = (body) => [...body.children].map((row) => '.' + row.className.split(' ')[0]);

function fileUrlApp({ fs } = {}) {
  const source = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>' +
      '<section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">Evidence</span></h2>' +
      '<div class="ev-body"><div class="ev-file"><a href="assets/notes.pdf" target="_blank" rel="noopener">notes.pdf</a></div>' +
      '</div></section></main>',
  );
  const app = loadApp(source, fs ? { fs } : {});
  const section = app.document.querySelector('#evidence > .ev-section');
  sectionAction(section, 'add-url').click();
  const body = bodyOf(section);
  return {
    ...app,
    section,
    body,
    file: body.querySelector(':scope > .ev-file'),
    url: body.querySelector(':scope > .ev-url'),
  };
}

function openPalette(window, row) {
  const surface = row.matches('.ev-file')
    ? row.querySelector(':scope > a')
    : row.querySelector(':scope > .ev-url-link, :scope > .ev-url-empty');
  dispatchContextMenu(window, surface);
  return paletteOf(window.document);
}

for (const type of ['file', 'url']) {
  test(`${type} toolbox puts the six adds before its existing tools`, () => {
    const { window, [type]: row } = fileUrlApp();
    const palette = openPalette(window, row);
    const expected = type === 'file' ? FILE_ACTIONS : URL_ACTIONS;
    assert.deepEqual([...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action), expected);
    assert.deepEqual([...palette.querySelectorAll(':scope > button .ev-action-label')].slice(0, ADDS.length)
      .map((label) => label.textContent), ['+ comment', '+ code', '+ property', '+ screenshot', '+ file', '+ url']);
    assert.equal(row.hasAttribute('data-palette-active'), true);
    const position = palette.style.cssText;
    dispatchContextMenu(window, row.querySelector(':scope > .ev-drag-handle'), { x: 420, y: 220 });
    dispatchContextMenu(window, row.querySelector(':scope > .ev-controls button'), { x: 460, y: 240 });
    assert.equal(palette.style.cssText, position, 'drag and action controls do not transfer toolbox ownership');
    assert.equal(row.hasAttribute('data-palette-active'), true);
  });

  test(`${type} adds stay within the owning section and insert immediately after the row`, () => {
    const { window, document, section, body, [type]: row } = fileUrlApp();
    document.querySelector('button[data-action="add-section"]').click();
    const nextSection = [...document.querySelectorAll('#evidence > .ev-section')][1];
    const nextBody = bodyOf(nextSection);
    sectionAction(nextSection, 'add-comment').click();
    const nextBodyBefore = tagsOf(nextBody);
    if (type === 'url') body.appendChild(row);

    openPalette(window, row).querySelector('[data-action="add-comment"]').click();
    assert.equal(row.nextElementSibling.matches('.ev-comment'), true);
    assert.equal(row.nextElementSibling.parentElement, body);
    openPalette(window, row).querySelector('[data-action="add-code"]').click();
    assert.equal(row.nextElementSibling.matches('.ev-code'), true);
    openPalette(window, row).querySelector('[data-action="add-property"]').click();
    assert.equal(row.nextElementSibling.matches('.ev-property'), true);
    assert.deepEqual(tagsOf(nextBody), nextBodyBefore, 'adds never cross into the next section');
    assert.deepEqual([...document.querySelectorAll('#evidence .ev-num')].map((number) => number.textContent), ['1', '2']);
  });

  test(`${type} screenshot add inserts after the row or joins a following screenshot row`, async () => {
    const { window, section, body, [type]: row } = fileUrlApp();
    stubImagePipeline(window);
    if (type === 'url') body.appendChild(row);
    openPalette(window, row).querySelector('[data-action="add-screenshot"]').click();
    let pending = body.querySelector('.ev-screenshot-pending');
    assert.equal(pending.parentElement, body);
    assert.equal(pending, row.nextElementSibling);

    sectionAction(section, 'add-screenshot').click();
    pasteImage(window, body.querySelector('.ev-screenshot-pending'));
    await waitFor(() => body.querySelector('.ev-shot-row img'));
    const shotRow = body.querySelector('.ev-shot-row');
    row.insertAdjacentElement('afterend', shotRow);
    openPalette(window, row).querySelector('[data-action="add-screenshot"]').click();
    pending = shotRow.querySelector('.ev-screenshot-pending');
    assert.ok(pending);
    assert.equal(pending, shotRow.lastElementChild);
  });
}

test('file add stays gated in fallback and uses the existing asset overwrite flow', async () => {
  const fallback = fileUrlApp();
  const fallbackAdd = openPalette(fallback.window, fallback.file).querySelector('[data-action="add-file"]');
  assert.equal(fallbackAdd.disabled, true);
  assert.equal(fallbackAdd.title, 'File attachments require File System Access');

  const fs = createFileSystemEnv();
  const app = fileUrlApp({ fs });
  fs.env.idbStores.add('handles');
  fs.env.idbHandles.set(documentHandleKey(), fs.env.pickedDir);
  fs.env.assetsFiles.set('notes.pdf', new Blob(['old bytes'], { type: 'application/pdf' }));
  fs.env.sourceFile = new app.window.File(['replacement'], 'notes.pdf');
  let warning = '';
  app.window.confirm = (message) => { warning = message; return true; };

  const addFile = openPalette(app.window, app.file).querySelector('[data-action="add-file"]');
  assert.equal(addFile.disabled, false, 'File System Access enables the row action');
  addFile.click();
  await waitFor(() => app.body.querySelectorAll('.ev-file').length === 2);
  const added = app.file.nextElementSibling;
  assert.equal(added.matches('.ev-file'), true);
  assert.deepEqual(tagsOf(app.body), ['.ev-file', '.ev-file', '.ev-url']);
  assert.match(warning, /Overwrite it\?/);
  assert.equal((await fs.env.assetsFiles.get('notes.pdf').text()), 'replacement');
  assert.equal(latestOperationResult(app.document).outcome, 'success');
  assert.equal(latestOperationResult(app.document).message, 'File attached: notes.pdf');
});

test('URL add auto-focuses its editor and refreshes the URL owner toolbox', () => {
  const { window, document, body, url } = fileUrlApp();
  let palette = openPalette(window, url);
  palette.querySelector('[data-action="add-url"]').click();
  const added = url.nextElementSibling;
  assert.equal(added.matches('.ev-url'), true);
  assert.equal(document.activeElement, added.querySelector('.ev-url-input'));
  assertCaretAtEnd(added.querySelector('.ev-url-input'));
  palette = openPalette(window, url);
  assert.deepEqual([...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action), URL_ACTIONS);
  assert.deepEqual(tagsOf(body), ['.ev-file', '.ev-url', '.ev-url']);
});

test('file toolbox adds a focused URL and URL toolbox attaches a file after its owner', async () => {
  const fs = createFileSystemEnv();
  const app = fileUrlApp({ fs });
  fs.env.sourceFile = new app.window.File(['more evidence'], 'additional.log');

  openPalette(app.window, app.url).querySelector('[data-action="add-file"]').click();
  await waitFor(() => app.body.querySelectorAll('.ev-file').length === 2);
  const newFile = app.url.nextElementSibling;
  assert.equal(newFile.matches('.ev-file'), true);
  assert.notEqual(app.document.activeElement, newFile.querySelector('a'), 'file rows remain outside the text-field focus behavior');

  openPalette(app.window, app.file).querySelector('[data-action="add-url"]').click();
  const newUrl = app.file.nextElementSibling;
  assert.equal(newUrl.matches('.ev-url'), true);
  assert.equal(app.document.activeElement, newUrl.querySelector('.ev-url-input'));
  assertCaretAtEnd(newUrl.querySelector('.ev-url-input'));
});

test('file and URL toolbox chrome is serialization-neutral while added rows persist', async () => {
  const { window, document, file, url, downloads } = fileUrlApp();
  openPalette(window, file).querySelector('[data-action="add-comment"]').click();
  openPalette(window, url).querySelector('[data-action="add-code"]').click();
  document.getElementById('save-btn').click();
  const savedDocument = new JSDOM(await downloadText(downloads.find((entry) => entry.name))).window.document;
  assert.equal(savedDocument.querySelector('#evidence > .ev-section-palette'), null);
  assert.equal(savedDocument.querySelector('[data-palette-active]'), null);
  assert.equal(savedDocument.querySelectorAll('#evidence [data-chrome]').length, 0);
  assert.deepEqual(tagsOf(savedDocument.querySelector('.ev-section > .ev-body')),
    ['.ev-file', '.ev-comment', '.ev-url', '.ev-code']);
});
