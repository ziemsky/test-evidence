import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  addFirstSection,
  createFileSystemEnv,
  dispatchContextMenu,
  downloadText,
  loadApp,
  pasteImage,
  sectionAction,
  stubImagePipeline,
  waitFor,
  assertCaretAtEnd,
} from './helpers.js';

// 0107 (SPEC §29): the property row's shared right-click toolbox carries the
// six in-section content adds above its existing tools, and each add inserts
// the new element immediately after the triggering property row — never at
// the end of the section.

const paletteOf = (document) => document.querySelector('#evidence > .ev-section-palette');
const bodyOf = (section) => section.querySelector(':scope > .ev-body');
const tagsOf = (body) => [...body.children].map((child) => '.' + child.className.split(' ')[0]);
const labelsOf = (palette) => [...palette.querySelectorAll(':scope > button')].map(
  (button) => button.querySelector(':scope > .ev-action-label')?.textContent,
);
const actionsOf = (palette) => [...palette.querySelectorAll(':scope > button')].map(
  (button) => button.dataset.action,
);

const ADDS = ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url'];
const PROPERTY_ACTIONS = [...ADDS, 'copy', 'copy-element', 'paste-after', 'delete'];

/** Section body laid out comment, property, comment — the property is mid-body. */
function appWithMidProperty({ fs } = {}) {
  const app = loadApp(undefined, fs ? { fs } : {});
  const section = addFirstSection(app.document);
  sectionAction(section, 'add-comment').click();
  sectionAction(section, 'add-property').click();
  sectionAction(section, 'add-comment').click();
  const property = section.querySelector(':scope > .ev-body > .ev-property');
  return { ...app, section, property };
}

function openPropertyPalette(window, property) {
  dispatchContextMenu(window, property.querySelector(':scope > .ev-prop-value'));
  return paletteOf(window.document);
}

test('the property toolbox presents the six adds at the top, then its existing tools', () => {
  const { window, property } = appWithMidProperty();
  const palette = openPropertyPalette(window, property);
  assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'Property');
  assert.deepEqual(actionsOf(palette), PROPERTY_ACTIONS, 'adds first, existing tools keep their order');
  assert.deepEqual(labelsOf(palette).slice(0, ADDS.length), [
    '+ comment', '+ code', '+ property', '+ screenshot', '+ file', '+ url',
  ], 'established labels from the section toolbox');
  assert.equal(property.hasAttribute('data-palette-active'), true);
});

test('+ comment / + code / + property insert immediately after the triggering property row', () => {
  const { window, section, property } = appWithMidProperty();
  const body = bodyOf(section);
  const palette = openPropertyPalette(window, property);

  palette.querySelector('[data-action="add-comment"]').click();
  assert.deepEqual(tagsOf(body), ['.ev-comment', '.ev-property', '.ev-comment', '.ev-comment'],
    'the new comment sits after the property, not at the end of the body');

  openPropertyPalette(window, property);
  palette.querySelector('[data-action="add-code"]').click();
  assert.deepEqual(tagsOf(body), ['.ev-comment', '.ev-property', '.ev-code', '.ev-comment', '.ev-comment'],
    'the new code row lands after the property, before the earlier add');

  openPropertyPalette(window, property);
  palette.querySelector('[data-action="add-property"]').click();
  assert.deepEqual(tagsOf(body),
    ['.ev-comment', '.ev-property', '.ev-property', '.ev-code', '.ev-comment', '.ev-comment'],
    'the new property lands immediately after the triggering row, in click order');
});

test('+ url inserts after the property row and auto-focuses its URL field', () => {
  const { window, document, section, property } = appWithMidProperty();
  const body = bodyOf(section);
  const palette = openPropertyPalette(window, property);

  palette.querySelector('[data-action="add-url"]').click();
  const urlRow = property.nextElementSibling;
  assert.equal(urlRow.classList.contains('ev-url'), true, 'the URL row is the property\'s next sibling');
  assert.deepEqual(tagsOf(body), ['.ev-comment', '.ev-property', '.ev-url', '.ev-comment']);
  assert.equal(document.activeElement, urlRow.querySelector(':scope > .ev-url-editor > .ev-url-input'),
    'the URL field takes focus, like the section toolbox');
  assertCaretAtEnd(urlRow.querySelector(':scope > .ev-url-editor > .ev-url-input'));
});

test('+ file attaches after the property row through the existing file lifecycle', async () => {
  const fs = createFileSystemEnv();
  const { window, section, property } = appWithMidProperty({ fs });
  const body = bodyOf(section);
  fs.env.sourceFile = new window.File(['evidence'], 'run.log');

  const palette = openPropertyPalette(window, property);
  const addFile = palette.querySelector('[data-action="add-file"]');
  assert.equal(addFile.disabled, false, 'file adds are enabled when File System Access is available');
  addFile.click();
  await waitFor(() => body.querySelector('.ev-file'));
  assert.equal(property.nextElementSibling, body.querySelector('.ev-file'),
    'the new file row is the property\'s next sibling');
  assert.deepEqual(tagsOf(body), ['.ev-comment', '.ev-property', '.ev-file', '.ev-comment']);
  assert.equal(body.querySelector('.ev-file > a').textContent, 'run.log');
});

test('+ file stays gated in fallback mode from the property toolbox', () => {
  const { window, property } = appWithMidProperty();
  const palette = openPropertyPalette(window, property);
  const addFile = palette.querySelector('[data-action="add-file"]');
  assert.equal(addFile.disabled, true, 'no File System Access → disabled');
  assert.equal(addFile.title, 'File attachments require File System Access');
});

test('+ screenshot: no following screenshot row → a plain pending shot after the property row', async () => {
  const { window, section, property } = appWithMidProperty();
  const body = bodyOf(section);
  stubImagePipeline(window);
  const palette = openPropertyPalette(window, property);

  palette.querySelector('[data-action="add-screenshot"]').click();
  const pending = body.querySelector('.ev-screenshot-pending');
  assert.equal(pending.parentElement, body, 'a plain pending shot, not inside a row');
  assert.equal(pending, property.nextElementSibling, 'immediately after the property row');

  pasteImage(window, pending);
  await waitFor(() => body.querySelector('.ev-shot-row'));
  const row = body.querySelector('.ev-shot-row');
  assert.equal(row.previousElementSibling, property,
    'pasting turns the pending shot into a single-shot row right after the property');
  assert.deepEqual(tagsOf(body), ['.ev-comment', '.ev-property', '.ev-shot-row', '.ev-comment']);
});

test('+ screenshot: a directly following screenshot row takes the pending placeholder at its end', async () => {
  const { window, section } = appWithMidProperty();
  const body = bodyOf(section);
  stubImagePipeline(window);
  // Comment, property, comment → drop the trailing comment, then give the
  // section a row: body is [property, shot-row].
  body.querySelector(':scope > .ev-comment:last-of-type').remove();
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, body.querySelector('.ev-screenshot-pending'));
  await waitFor(() => body.querySelector('.ev-shot-row img'));
  const property = body.querySelector('.ev-property');
  assert.equal(property.nextElementSibling, body.querySelector('.ev-shot-row'));

  const palette = openPropertyPalette(window, property);
  palette.querySelector('[data-action="add-screenshot"]').click();
  const pending = body.querySelector('.ev-screenshot-pending');
  assert.equal(pending.parentElement, body.querySelector('.ev-shot-row'),
    'the placeholder joins the end of the following screenshot row');
  assert.equal(pending, body.querySelector('.ev-shot-row').lastElementChild, 'at the row\'s end');

  pasteImage(window, pending);
  await waitFor(() => body.querySelectorAll('.ev-shot-row img').length === 2);
  assert.equal(body.querySelectorAll('.ev-shot-row').length, 1, 'one row with two shots — the add grew the row');
});

test('+ screenshot keeps the one-pending-placeholder rule when a placeholder already exists', () => {
  const { window, section, property } = appWithMidProperty();
  const body = bodyOf(section);
  sectionAction(section, 'add-screenshot').click();
  assert.equal(body.querySelectorAll('.ev-screenshot-pending').length, 1);

  const palette = openPropertyPalette(window, property);
  palette.querySelector('[data-action="add-screenshot"]').click();
  assert.equal(body.querySelectorAll('.ev-screenshot-pending').length, 1, 'exactly one placeholder at a time');
  const pending = body.querySelector('.ev-screenshot-pending');
  assert.equal(pending, property.nextElementSibling, 'the new click relocates it after the property row');
});

test('adds from a property row at the end of its body stay inside the section body', () => {
  const app = loadApp();
  const section = addFirstSection(app.document);
  sectionAction(section, 'add-property').click();
  const property = section.querySelector(':scope > .ev-body > .ev-property');
  const body = bodyOf(section);

  const palette = openPropertyPalette(app.window, property);
  palette.querySelector('[data-action="add-comment"]').click();
  assert.deepEqual(tagsOf(body), ['.ev-property', '.ev-comment'],
    'the new comment is the property\'s next sibling and the body\'s last child, still inside the body');
  assert.equal(body.lastElementChild, property.nextElementSibling);
});

test('the section toolbox is unchanged: its adds still append at the end of the body', () => {
  const { section, property } = appWithMidProperty();
  const body = bodyOf(section);
  sectionAction(section, 'add-property').click();
  assert.deepEqual(tagsOf(body), ['.ev-comment', '.ev-property', '.ev-comment', '.ev-property'],
    'the section add appends after the last child, not after the first property');
  assert.notEqual(body.lastElementChild, property);
});

test('drag handles and action controls do not transfer the property toolbox', () => {
  const { window, property } = appWithMidProperty();
  const palette = openPropertyPalette(window, property);
  const before = palette.style.cssText;
  dispatchContextMenu(window, property.querySelector(':scope > .ev-drag-handle'), { x: 420, y: 220 });
  assert.equal(palette.style.cssText, before, 'the drag handle is excluded from ownership');
  assert.equal(property.hasAttribute('data-palette-active'), true);
  dispatchContextMenu(window, property.querySelector(':scope > .ev-controls button'), { x: 460, y: 240 });
  assert.equal(palette.style.cssText, before, 'the row\'s own controls are excluded from ownership');
  assert.equal(property.hasAttribute('data-palette-active'), true);
});

test('the property toolbox refreshes with its owner across adds and re-openings', () => {
  const { window, property } = appWithMidProperty();
  const palette = openPropertyPalette(window, property);
  palette.querySelector('[data-action="add-code"]').click();
  assert.deepEqual(actionsOf(palette), PROPERTY_ACTIONS, 'the owner\'s toolbox stays put after the add');

  dispatchContextMenu(window, property.querySelector(':scope > .ev-prop-value'));
  assert.deepEqual(actionsOf(palette), PROPERTY_ACTIONS, 're-opening the property toolbox shows the adds again');
  assert.equal(property.hasAttribute('data-palette-active'), true);
});

test('adds from the property toolbox log their typed operations', () => {
  const { window, document, property } = appWithMidProperty();
  const logs = [];
  const originalLog = window.console.log;
  window.console.log = (...parts) => {
    const line = parts.join(' ');
    if (line.startsWith('Operation started: ') || line.startsWith('Operation finished: ')) logs.push(line);
    originalLog(...parts);
  };
  const palette = openPropertyPalette(window, property);
  palette.querySelector('[data-action="add-comment"]').click();
  assert.deepEqual(logs, [
    'Operation started: Add comment',
    'Operation finished: Add comment — success — Add comment completed',
  ]);
  logs.length = 0;
  openPropertyPalette(window, property);
  palette.querySelector('[data-action="add-property"]').click();
  assert.deepEqual(logs, [
    'Operation started: Add property',
    'Operation finished: Add property — success — Add property completed',
  ]);
});

test('the property toolbox chrome is serialization-neutral and the adds persist as content', async () => {
  const { window, document, section, property, downloads } = appWithMidProperty();
  const body = bodyOf(section);
  openPropertyPalette(window, property);
  const palette = paletteOf(document);
  palette.querySelector('[data-action="add-comment"]').click();
  openPropertyPalette(window, property); // the palette closes after each action
  palette.querySelector('[data-action="add-property"]').click();
  property.querySelector(':scope > .ev-prop-key').textContent = 'State';
  property.querySelector(':scope > .ev-prop-value').textContent = 'ready';

  document.getElementById('save-btn').click();
  const saved = await downloadText(downloads.find((entry) => entry.name));
  const savedDocument = new JSDOM(saved).window.document;

  assert.equal(savedDocument.querySelector('#evidence > .ev-section-palette'), null, 'no shared palette in the file');
  assert.equal(savedDocument.querySelector('[data-palette-active]'), null);
  const savedBody = savedDocument.querySelector('.ev-section > .ev-body');
  const savedTags = tagsOf(savedBody);
  assert.deepEqual(savedTags, ['.ev-comment', '.ev-property', '.ev-property', '.ev-comment', '.ev-comment'],
    'both adds persist after the triggering row');
  const savedProp = savedBody.querySelector('.ev-property');
  assert.equal(savedProp.querySelectorAll('.ev-controls button[data-action="add-comment"]').length, 0,
    'the legacy inline controls (adds included) are chrome — stripped on save');
  assert.equal(savedProp.querySelector('.ev-prop-key').textContent, 'State');
});
