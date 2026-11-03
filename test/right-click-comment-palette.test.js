import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { addFirstSection, dispatchContextMenu, downloadText, loadApp, sectionAction } from './helpers.js';

const commentOf = (section) => section.querySelector(':scope > .ev-body > .ev-comment');
const paletteOf = (document) => document.querySelector('#evidence > .ev-section-palette');

test('a mouse right-click on the authored comment surface opens a type-only shared palette', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const comment = commentOf(section);
  const text = comment.querySelector(':scope > .ev-comment-text');
  const palette = paletteOf(document);

  const keyboardMenu = dispatchContextMenu(window, text, { button: 0 });
  assert.equal(keyboardMenu.defaultPrevented, true);
  assert.equal(palette.hasAttribute('data-palette-visible'), false);

  const touchMenu = dispatchContextMenu(window, text, { pointerType: 'touch' });
  assert.equal(touchMenu.defaultPrevented, true);
  assert.equal(palette.hasAttribute('data-palette-visible'), false);

  const mouseMenu = dispatchContextMenu(window, text, { x: 220, y: 140 });
  assert.equal(mouseMenu.defaultPrevented, true);
  assert.equal(palette.hasAttribute('data-palette-visible'), true);
  assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'Comment');
  assert.deepEqual(
    [...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action),
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'copy', 'copy-element', 'paste-after', 'delete'],
  );
  const action = palette.querySelector('[data-action="copy"]');
  assert.equal(action.tabIndex, 0);
  action.focus();
  assert.equal(document.activeElement, action);
  assert.equal(comment.hasAttribute('data-palette-active'), true);
  assert.equal(section.hasAttribute('data-palette-active'), false);
});

test('comment activation excludes its drag handle and inline action chrome', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const comment = commentOf(section);
  const text = comment.querySelector(':scope > .ev-comment-text');
  const handle = comment.querySelector(':scope > .ev-drag-handle');
  const controls = comment.querySelector(':scope > .ev-controls');
  const palette = paletteOf(document);

  dispatchContextMenu(window, text);
  const positionBefore = palette.style.cssText;
  dispatchContextMenu(window, handle, { x: 420, y: 220 });
  assert.equal(comment.hasAttribute('data-palette-active'), true);
  assert.equal(palette.style.cssText, positionBefore);

  dispatchContextMenu(window, controls.querySelector('button'), { x: 460, y: 240 });
  assert.equal(comment.hasAttribute('data-palette-active'), true);
  assert.equal(palette.style.cssText, positionBefore);
  assert.equal(window.getComputedStyle(controls).display, 'none');
});

test('comment palette actions retain delete and element-copy behavior', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const comment = commentOf(section);
  comment.querySelector(':scope > .ev-comment-text').textContent = 'comment action';
  const palette = paletteOf(document);

  dispatchContextMenu(window, comment.querySelector(':scope > .ev-comment-text'));
  const copyElement = palette.querySelector('[data-action="copy-element"]');
  copyElement.focus();
  assert.equal(document.activeElement, copyElement, 'the visible action remains keyboard accessible');
  copyElement.click();
  assert.match(latestOperationResult(document).message, /Copy ready|Copied element/);

  dispatchContextMenu(window, comment.querySelector(':scope > .ev-comment-text'));
  palette.querySelector('[data-action="paste-after"]').click();
  const pasted = comment.nextElementSibling;
  assert.ok(pasted.matches('.ev-comment'));
  assert.equal(pasted.querySelector(':scope > .ev-comment-text').textContent, 'comment action');

  dispatchContextMenu(window, pasted.querySelector(':scope > .ev-comment-text'));
  palette.querySelector('[data-action="delete"]').click();
  assert.equal(pasted.isConnected, false);
  dispatchContextMenu(window, comment.querySelector(':scope > .ev-comment-text'));
  palette.querySelector('[data-action="delete"]').click();
  assert.equal(comment.isConnected, false);
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
});

test('comment palette follows section palette positioning and dismissal rules', async () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const comment = commentOf(section);
  const palette = paletteOf(document);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
  palette.getBoundingClientRect = () => ({ width: 200, height: 100 });

  dispatchContextMenu(window, comment, { x: 10, y: 10 });
  assert.equal(palette.style.getPropertyValue('--ev-palette-left'), '108px');
  assert.equal(palette.style.getPropertyValue('--ev-palette-top'), '58px');

  document.getElementById('toolbar').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(palette.hasAttribute('data-palette-visible'), false);

  dispatchContextMenu(window, comment);
  comment.dispatchEvent(new window.MouseEvent('mouseout', {
    bubbles: true,
    relatedTarget: document.body,
  }));
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
});

test('comment toolbox chrome is serialization-neutral', async () => {
  const first = loadApp();
  const section = addFirstSection(first.document);
  sectionAction(section, 'add-comment').click();
  const comment = commentOf(section);
  comment.querySelector(':scope > .ev-comment-text').textContent = 'authored comment';
  dispatchContextMenu(first.window, comment);
  const saved = await downloadText((first.document.getElementById('save-btn').click(), first.downloads.find((entry) => entry.name)));
  const savedDocument = new JSDOM(saved).window.document;
  assert.equal(savedDocument.querySelector('#evidence > .ev-section-palette'), null);
  assert.equal(savedDocument.querySelector('[data-palette-active]'), null);
  assert.equal(savedDocument.querySelector('[data-palette-visible]'), null);
  assert.equal(savedDocument.querySelector('.ev-comment-text').textContent, 'authored comment');
});
