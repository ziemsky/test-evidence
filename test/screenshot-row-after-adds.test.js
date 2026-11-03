import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  addFirstSection,
  appSource,
  createFileSystemEnv,
  dispatchContextMenu,
  downloadText,
  loadApp,
  pasteImage,
  sectionAction,
  stubImagePipeline,
  waitFor,
} from './helpers.js';

const ADDS = ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url'];
const ROW_ACTIONS = [
  ...ADDS,
  'row-valign-top', 'row-valign-middle', 'row-valign-bottom',
  'row-halign-left', 'row-halign-center', 'row-halign-right',
];
const paletteOf = (document) => document.querySelector('#evidence > .ev-section-palette');
const bodyOf = (section) => section.querySelector(':scope > .ev-body');
const tagsOf = (body) => [...body.children].map((row) => '.' + row.className.split(' ')[0]);

function openPalette(window, target) {
  dispatchContextMenu(window, target);
  return paletteOf(window.document);
}

async function makeShotRow({ fs } = {}) {
  const app = loadApp(undefined, fs ? { fs } : {});
  stubImagePipeline(app.window);
  const section = addFirstSection(app.document);
  sectionAction(section, 'add-screenshot').click();
  pasteImage(app.window, section.querySelector('.ev-screenshot-pending'));
  await waitFor(() => section.querySelector('.ev-shot-row .ev-screenshot'));
  return { ...app, section, body: bodyOf(section), row: section.querySelector('.ev-shot-row') };
}

test('screenshot row toolbox puts all six content adds before its unchanged row controls', async () => {
  const { window, row } = await makeShotRow();
  const palette = openPalette(window, row);
  assert.deepEqual([...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action), ROW_ACTIONS);
  assert.deepEqual([...palette.querySelectorAll(':scope > button .ev-action-label')].slice(0, 6)
    .map((label) => label.textContent), ['+ comment', '+ code', '+ property', '+ screenshot', '+ file', '+ url']);
  assert.equal(row.hasAttribute('data-palette-active'), true);
});

test('non-screenshot row adds insert after the whole row as body-level content', async () => {
  const { window, document, section, body, row } = await makeShotRow();
  document.querySelector('button[data-action="add-section"]').click();
  const nextSection = [...document.querySelectorAll('#evidence > .ev-section')][1];
  sectionAction(nextSection, 'add-comment').click();
  const nextTags = tagsOf(bodyOf(nextSection));

  for (const [action, selector] of [
    ['add-comment', '.ev-comment'], ['add-code', '.ev-code'],
    ['add-property', '.ev-property'], ['add-url', '.ev-url'],
  ]) {
    openPalette(window, row).querySelector(`[data-action="${action}"]`).click();
    assert.equal(row.nextElementSibling.matches(selector), true, `${action} follows the whole row`);
    assert.equal(row.nextElementSibling.parentElement, body, `${action} is a body-level element`);
  }
  assert.equal(document.activeElement, row.nextElementSibling.querySelector('.ev-url-input'), 'URL add keeps its auto-focus');
  assert.deepEqual(tagsOf(bodyOf(nextSection)), nextTags, 'adds stay within the owning section');
  assert.equal(body.querySelectorAll(':scope > .ev-shot-row').length, 1, 'adds never split the row');
});

test('row-level file add follows the row and keeps the shared attachment flow', async () => {
  const fs = createFileSystemEnv();
  const { window, body, row } = await makeShotRow({ fs });
  fs.env.sourceFile = new window.File(['evidence'], 'row-after.png', { type: 'image/png' });
  openPalette(window, row).querySelector('[data-action="add-file"]').click();
  await waitFor(() => body.querySelector('.ev-file'));
  assert.equal(row.nextElementSibling.matches('.ev-file'), true);
  assert.equal(row.nextElementSibling.querySelector('a').textContent, 'row-after.png');

  const fallback = await makeShotRow();
  assert.equal(openPalette(fallback.window, fallback.row).querySelector('[data-action="add-file"]').disabled, true);
});

test('row-level screenshot joins the triggering row even when another screenshot row follows', async () => {
  const { window, section, body, row } = await makeShotRow();
  const followingRow = window.document.createElement('div');
  followingRow.className = 'ev-shot-row';
  body.appendChild(followingRow);

  openPalette(window, row).querySelector('[data-action="add-screenshot"]').click();
  const pending = row.querySelector('.ev-screenshot-pending');
  assert.ok(pending);
  assert.equal(row.lastElementChild, pending, 'placeholder is appended to the triggering row');
  assert.equal(followingRow.querySelector('.ev-screenshot-pending'), null);
  assert.equal(body.querySelectorAll('.ev-screenshot-pending').length, 1);
});

test('image toolbox screenshot add lands after that image inside its row', async () => {
  const { window, section, row } = await makeShotRow();
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, section.querySelector('.ev-screenshot-pending'));
  await waitFor(() => row.querySelectorAll(':scope > .ev-screenshot').length === 2);
  assert.notEqual(window.document.activeElement, row.querySelector('.ev-caption'), 'pasted images do not auto-focus captions');
  const [first, second] = row.querySelectorAll(':scope > .ev-screenshot');

  const palette = openPalette(window, first.querySelector(':scope > .ev-img'));
  assert.equal(palette.querySelectorAll(':scope > button[data-action^="add-"]').length, 1);
  assert.equal(palette.querySelector(':scope > button[data-action="add-screenshot"]').textContent.trim(), '+ screenshot');
  palette.querySelector('[data-action="add-screenshot"]').click();
  const pending = row.querySelector('.ev-screenshot-pending');
  assert.equal(first.nextElementSibling, pending);
  assert.equal(pending.nextElementSibling, second);
  assert.equal(row.querySelectorAll('.ev-screenshot-pending').length, 1);
});

test('pending screenshot is exclusive across section, row, and image toolboxes', async () => {
  const { window, section, row } = await makeShotRow();
  const image = row.querySelector('.ev-img');

  sectionAction(section, 'add-screenshot').click();
  assert.equal(section.querySelectorAll('.ev-screenshot-pending').length, 1);
  openPalette(window, row).querySelector('[data-action="add-screenshot"]').click();
  assert.equal(section.querySelectorAll('.ev-screenshot-pending').length, 1);
  assert.equal(row.querySelector('.ev-screenshot-pending'), row.lastElementChild);
  openPalette(window, image).querySelector('[data-action="add-screenshot"]').click();
  assert.equal(section.querySelectorAll('.ev-screenshot-pending').length, 1);
  assert.equal(image.closest('.ev-screenshot').nextElementSibling, row.querySelector('.ev-screenshot-pending'));
});

test('screenshot row and image toolbox chrome is stripped on save', async () => {
  const { window, document, row, downloads } = await makeShotRow();
  openPalette(window, row).querySelector('[data-action="add-comment"]').click();
  const image = row.querySelector('.ev-img');
  openPalette(window, image).querySelector('[data-action="add-screenshot"]').click();
  document.getElementById('save-btn').click();
  const savedDocument = new JSDOM(await downloadText(downloads.find((entry) => entry.name))).window.document;
  assert.equal(savedDocument.querySelector('#evidence > .ev-section-palette'), null);
  assert.equal(savedDocument.querySelector('[data-palette-active]'), null);
  assert.equal(savedDocument.querySelectorAll('#evidence [data-chrome]').length, 0);
  assert.equal(savedDocument.querySelector('.ev-shot-row .ev-screenshot-pending'), null);
  assert.equal(savedDocument.querySelector('.ev-shot-row + .ev-comment')?.matches('.ev-comment'), true,
    'the body-level comment persists after the row');
});
