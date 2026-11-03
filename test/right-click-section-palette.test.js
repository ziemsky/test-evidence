import test from 'node:test';
import assert from 'node:assert/strict';
import { addFirstSection, dispatchContextMenu, loadApp } from './helpers.js';

const bodyOf = (section) => section.querySelector(':scope > .ev-body');
const titleOf = (section) => section.querySelector(':scope > h2.ev-title');
const titleTextOf = (section) => section.querySelector(':scope > h2.ev-title > .ev-title-text');

const contextMenu = dispatchContextMenu;

function hover(window, target, relatedTarget = null) {
  target.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget }));
}

function unhover(window, target, relatedTarget = null) {
  target.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget }));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('only a mouse right-click on a section title opens the shared palette', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const palette = document.querySelector('#evidence > .ev-section-palette');
  const title = titleOf(section);

  hover(window, titleTextOf(section));
  titleTextOf(section).focus();
  assert.equal(section.hasAttribute('data-palette-active'), false, 'hover and focus do not activate');

  const keyboardMenu = contextMenu(window, titleTextOf(section), { button: 0 });
  assert.equal(keyboardMenu.defaultPrevented, true, 'the pane still suppresses the native menu');
  assert.equal(section.hasAttribute('data-palette-active'), false, 'keyboard context-menu activation is ignored');

  const touchMenu = contextMenu(window, titleTextOf(section), { pointerType: 'touch' });
  assert.equal(touchMenu.defaultPrevented, true);
  assert.equal(section.hasAttribute('data-palette-active'), false, 'touch does not activate');

  const mouseMenu = contextMenu(window, titleTextOf(section));
  assert.equal(mouseMenu.defaultPrevented, true);
  assert.equal(section.hasAttribute('data-palette-active'), true);
  assert.equal(palette.hasAttribute('data-palette-visible'), true);
});

test('title text, number, and whitespace activate, but the drag handle and body do not', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const title = titleOf(section);
  const number = title.querySelector(':scope > .ev-num');
  const text = titleTextOf(section);
  const handle = title.querySelector(':scope > .ev-drag-handle');
  const body = bodyOf(section);

  contextMenu(window, text);
  assert.equal(section.hasAttribute('data-palette-active'), true);

  contextMenu(window, number, { x: 220 });
  assert.equal(section.hasAttribute('data-palette-active'), true);

  contextMenu(window, title, { x: 320 });
  assert.equal(section.hasAttribute('data-palette-active'), true);

  const before = document.querySelector('#evidence > .ev-section-palette').style.cssText;
  contextMenu(window, handle, { x: 420 });
  assert.equal(section.hasAttribute('data-palette-active'), true, 'the handle is a no-op');
  assert.equal(document.querySelector('#evidence > .ev-section-palette').style.cssText, before);

  contextMenu(window, body, { x: 520 });
  assert.equal(section.hasAttribute('data-palette-active'), true, 'body context menus do not transfer ownership');
  hover(window, body);
  assert.equal(section.hasAttribute('data-palette-active'), true, 'body hover does not transfer ownership');
});

test('nested ownership follows only a directly targeted title', () => {
  const { document, window } = loadApp();
  const outer = addFirstSection(document);
  const palette = document.querySelector('#evidence > .ev-section-palette');
  contextMenu(window, titleTextOf(outer));
  palette.querySelector('[data-action="add-subsection"]').click();
  const inner = bodyOf(outer).querySelector(':scope > .ev-section');

  contextMenu(window, titleTextOf(outer));
  assert.equal(outer.hasAttribute('data-palette-active'), true);
  assert.equal(inner.hasAttribute('data-palette-active'), false);

  contextMenu(window, bodyOf(inner));
  assert.equal(outer.hasAttribute('data-palette-active'), true);
  assert.equal(inner.hasAttribute('data-palette-active'), false);

  contextMenu(window, titleTextOf(inner));
  assert.equal(outer.hasAttribute('data-palette-active'), false);
  assert.equal(inner.hasAttribute('data-palette-active'), true);
});

test('clicking outside the palette dismisses it', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const palette = document.querySelector('#evidence > .ev-section-palette');

  contextMenu(window, titleTextOf(section));
  assert.equal(section.hasAttribute('data-palette-active'), true);
  assert.equal(palette.hasAttribute('data-palette-visible'), true);

  document.getElementById('toolbar').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(section.hasAttribute('data-palette-active'), false);
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
});

test('completing a palette action dismisses the palette', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const palette = document.querySelector('#evidence > .ev-section-palette');

  contextMenu(window, titleTextOf(section));
  palette.querySelector('[data-action="add-comment"]').click();

  assert.equal(section.querySelectorAll(':scope > .ev-body > .ev-comment').length, 1);
  assert.equal(section.hasAttribute('data-palette-active'), false);
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
});

test('the palette is centered on the mouse point and clamped to the viewport', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const palette = document.querySelector('#evidence > .ev-section-palette');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
  palette.getBoundingClientRect = () => ({ width: 200, height: 100 });

  contextMenu(window, titleTextOf(section), { x: 250, y: 150 });
  assert.equal(palette.style.getPropertyValue('--ev-palette-left'), '250px');
  assert.equal(palette.style.getPropertyValue('--ev-palette-top'), '150px');

  contextMenu(window, titleTextOf(section), { x: 10, y: 10 });
  assert.equal(palette.style.getPropertyValue('--ev-palette-left'), '108px');
  assert.equal(palette.style.getPropertyValue('--ev-palette-top'), '58px');

  contextMenu(window, titleTextOf(section), { x: 490, y: 290 });
  assert.equal(palette.style.getPropertyValue('--ev-palette-left'), '392px');
  assert.equal(palette.style.getPropertyValue('--ev-palette-top'), '242px');
});

test('the combined title/palette region has exit grace, then dismisses', async () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const title = titleOf(section);
  const palette = document.querySelector('#evidence > .ev-section-palette');
  contextMenu(window, titleTextOf(section));

  unhover(window, title, palette);
  hover(window, palette, title);
  await wait(20);
  assert.equal(section.hasAttribute('data-palette-active'), true);

  unhover(window, palette, document.body);
  await wait(80);
  assert.equal(section.hasAttribute('data-palette-active'), true, 'exit grace is preserved');
  await wait(140);
  assert.equal(section.hasAttribute('data-palette-active'), false);
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
});

test('focus in authored section content does not prevent dismissal after leaving the region', async () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const title = titleOf(section);
  contextMenu(window, titleTextOf(section));
  titleTextOf(section).focus();
  unhover(window, title, document.getElementById('toolbar'));
  await wait(220);
  assert.equal(section.hasAttribute('data-palette-active'), false);
});

test('native context menus are suppressed only in the middle pane and palette actions remain keyboardable', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const title = titleTextOf(section);
  const palette = document.querySelector('#evidence > .ev-section-palette');
  const outside = document.querySelector('#toolbar');

  const outsideMenu = contextMenu(window, outside);
  assert.equal(outsideMenu.defaultPrevented, false);
  const insideMenu = contextMenu(window, title);
  assert.equal(insideMenu.defaultPrevented, true);
  const controlMenu = contextMenu(window, palette.querySelector('button'), { button: 0 });
  assert.equal(controlMenu.defaultPrevented, true);
  assert.equal(section.hasAttribute('data-palette-active'), true);

  const action = palette.querySelector('[data-action="copy"]');
  assert.equal(action.tabIndex, 0);
  action.focus();
  assert.equal(document.activeElement, action);
});
