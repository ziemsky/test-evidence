import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addFirstSection,
  appSource,
  dispatchContextMenu,
  loadApp,
  screenStyles,
  stylesheetRule,
} from './helpers.js';

const paletteOf = (document) => document.querySelector('#evidence > .ev-section-palette');
const titleOf = (section) => section.querySelector(':scope > .ev-title > .ev-title-text');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the animated halves carry the outline while the final palette box stays transparent', () => {
  const css = screenStyles();
  const opening = stylesheetRule(css, '#evidence > .ev-section-palette[data-palette-opening]');
  const closing = stylesheetRule(css, '#evidence > .ev-section-palette[data-palette-closing]');
  const closed = stylesheetRule(
    css,
    '#evidence > .ev-section-palette:not([data-palette-visible]):not([data-palette-opening]):not([data-palette-closing])',
  );
  const closingPlaceholder = stylesheetRule(
    css,
    '#evidence > .ev-section-palette[data-palette-closing] > .ev-palette-placeholder',
  );
  const placeholder = stylesheetRule(css, '#evidence > .ev-section-palette > .ev-palette-placeholder');
  const upper = stylesheetRule(css, '#evidence > .ev-section-palette > .ev-palette-placeholder[data-palette-half="upper"]');
  const lower = stylesheetRule(css, '#evidence > .ev-section-palette > .ev-palette-placeholder[data-palette-half="lower"]');

  assert.match(opening, /background:\s*transparent/);
  assert.match(opening, /border-color:\s*transparent/);
  assert.match(opening, /box-shadow:\s*none/);
  assert.match(closing, /opacity:\s*0/);
  assert.match(closing, /opacity\s+300ms/);
  assert.match(closed, /background:\s*transparent/);
  assert.match(closed, /border-color:\s*transparent/);
  assert.match(closed, /box-shadow:\s*none/);
  assert.match(closingPlaceholder, /display:\s*none/);
  assert.doesNotMatch(appSource(), /ev-palette-(upper|lower)-close/);
  assert.match(placeholder, /border:\s*1px\s+solid/);
  assert.match(upper, /transform-origin:\s*bottom\s+center/);
  assert.match(upper, /border-bottom:\s*0/);
  assert.match(lower, /transform-origin:\s*top\s+center/);
  assert.match(lower, /border-top:\s*0/);
  assert.match(appSource(), /ev-palette-upper-open\s+300ms/);
});

function enableCssAnimation(window) {
  // jsdom has no animation engine; exposing the browser event constructor
  // selects the real lifecycle path so the public phase contract is testable.
  window.AnimationEvent = function AnimationEvent() {};
}

test('the shared toolbox clamps final bounds before radiating and keeps controls inert until settled', async () => {
  const { document, window } = loadApp();
  enableCssAnimation(window);
  const section = addFirstSection(document);
  const palette = paletteOf(document);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
  palette.getBoundingClientRect = () => ({ width: 200, height: 100 });

  dispatchContextMenu(window, titleOf(section), { x: 10, y: 10 });
  assert.equal(palette.getAttribute('data-palette-phase'), 'opening');
  assert.equal(palette.hasAttribute('data-palette-visible'), true);
  assert.equal(palette.hasAttribute('data-palette-inert'), true);
  assert.equal(palette.style.getPropertyValue('--ev-palette-left'), '108px');
  assert.equal(palette.style.getPropertyValue('--ev-palette-top'), '58px');
  assert.deepEqual(
    [...palette.querySelectorAll('[data-palette-placeholder]')].map((el) => el.dataset.paletteHalf),
    ['lower', 'upper'],
  );

  palette.querySelector('[data-action="add-comment"]').click();
  assert.equal(section.querySelectorAll(':scope > .ev-body > .ev-comment').length, 0);

  await wait(350);
  assert.equal(palette.getAttribute('data-palette-phase'), 'settled');
  assert.equal(palette.hasAttribute('data-palette-inert'), false);
  assert.equal(palette.querySelector('[data-action="add-comment"]').tabIndex, 0);
  assert.equal(palette.hasAttribute('data-palette-opening'), false);
  assert.equal(palette.hasAttribute('data-palette-visible'), true);
});

test('handoff collapses the old owner and expands the new owner, then reverses on dismissal', async () => {
  const { document, window } = loadApp();
  enableCssAnimation(window);
  const first = addFirstSection(document);
  document.querySelector('.ev-add-section-btn').click();
  const second = document.querySelectorAll('#evidence > .ev-section')[1];
  const palette = paletteOf(document);

  dispatchContextMenu(window, titleOf(first), { x: 100, y: 100 });
  await wait(350);
  dispatchContextMenu(window, titleOf(second), { x: 400, y: 200 });
  assert.equal(palette.getAttribute('data-palette-phase'), 'closing');
  assert.equal(first.hasAttribute('data-palette-active'), false);
  assert.equal(second.hasAttribute('data-palette-active'), false);
  assert.equal(palette.hasAttribute('data-palette-inert'), true);

  await wait(700);
  assert.equal(palette.getAttribute('data-palette-phase'), 'settled');
  assert.equal(second.hasAttribute('data-palette-active'), true);
  assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'Section 2');
  assert.equal(palette.style.getPropertyValue('--ev-palette-left'), '400px');

  palette.dispatchEvent(new window.MouseEvent('mouseout', {
    bubbles: true,
    relatedTarget: document.body,
  }));
  await wait(190);
  assert.equal(palette.getAttribute('data-palette-phase'), 'closing');
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
  await wait(350);
  assert.equal(palette.getAttribute('data-palette-phase'), null);
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
});

test('reduced motion settles opening and dismissal immediately without hiding actions', () => {
  const { document, window } = loadApp();
  enableCssAnimation(window);
  window.matchMedia = () => ({ matches: true, media: '(prefers-reduced-motion: reduce)' });
  const section = addFirstSection(document);
  const palette = paletteOf(document);

  dispatchContextMenu(window, titleOf(section));
  assert.equal(palette.getAttribute('data-palette-phase'), 'settled');
  assert.equal(palette.hasAttribute('data-palette-inert'), false);
  assert.equal(palette.querySelector('[data-action="copy"]').tabIndex, 0);

  document.getElementById('toolbar').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(palette.getAttribute('data-palette-phase'), null);
  assert.equal(palette.hasAttribute('data-palette-visible'), false);
  assert.equal(palette.querySelector('[data-action="copy"]').tabIndex, -1);
});
