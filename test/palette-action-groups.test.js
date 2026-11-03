import test from 'node:test';
import assert from 'node:assert/strict';
import { addFirstSection, loadApp } from './helpers.js';

const paletteOf = (document) => document.querySelector('#evidence > .ev-section-palette');

function groups(palette) {
  const result = [];
  let group = [];
  for (const child of palette.children) {
    if (child.matches('[data-palette-separator]')) {
      if (group.length) result.push(group);
      group = [];
    } else if (child.matches('button[data-action]')) {
      group.push(child.dataset.action);
    }
  }
  if (group.length) result.push(group);
  return result;
}

test('section toolbox separates add, clipboard, and destructive actions', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  section.querySelector(':scope > .ev-title > .ev-title-text')
    .dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));

  const palette = paletteOf(document);
  assert.deepEqual(groups(palette), [
    ['add-subsection', 'add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url', 'add-section-after'],
    ['copy', 'copy-element', 'paste-after', 'paste-here'],
    ['delete'],
  ]);
});

test('screenshot toolbox separates insertion, settings, clipboard, and deletion', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const screenshot = document.createElement('div');
  screenshot.className = 'ev-screenshot';
  screenshot.innerHTML = '<img class="ev-img" src="data:image/png;base64,abc"><span class="ev-caption"></span>';
  section.querySelector(':scope > .ev-body').appendChild(screenshot);
  screenshot.querySelector('.ev-img')
    .dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));

  assert.deepEqual(groups(paletteOf(document)), [
    ['add-screenshot'],
    ['size-small', 'size-medium', 'size-large', 'size-page-width', 'size-original', 'size-larger', 'size-smaller', 'standalone'],
    ['open-image'],
    ['copy', 'paste-after'],
    ['delete'],
  ]);
});

test('screenshot row toolbox separates content adds from its two alignment groups', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const row = document.createElement('div');
  row.className = 'ev-shot-row';
  row.innerHTML = '<div class="ev-screenshot"><img class="ev-img" src="data:image/png;base64,abc"></div>';
  section.querySelector(':scope > .ev-body').appendChild(row);
  row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));

  assert.deepEqual(groups(paletteOf(document)), [
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url'],
    ['row-valign-top', 'row-valign-middle', 'row-valign-bottom'],
    ['row-halign-left', 'row-halign-center', 'row-halign-right'],
  ]);
});

test('content row toolbox keeps all adds together and all clipboard actions together', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const comment = document.createElement('div');
  comment.className = 'ev-comment';
  comment.innerHTML = '<span class="ev-text ev-comment-text">Note</span>';
  section.querySelector(':scope > .ev-body').appendChild(comment);
  comment.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));

  assert.deepEqual(groups(paletteOf(document)), [
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url'],
    ['copy', 'copy-element', 'paste-after'],
    ['delete'],
  ]);
});
