import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, screenStyles, stylesheetRule } from './helpers.js';

// 0119: Help opens from the page-corner ? control, pushes evidence aside while
// space allows, and changes to a panel-corner x until the user closes it.

test('Help stays closed on boot and opens and closes only through ?', () => {
  const { document, window } = loadApp();
  let toggle = document.getElementById('help-toggle');
  let panel = document.getElementById('help-panel');

  assert.ok(toggle, 'the page has a Help toggle');
  assert.equal(toggle.closest('#toolbar'), null, 'the control is mounted at page level');
  assert.equal(toggle.textContent, '?');
  assert.equal(toggle.getAttribute('aria-label'), 'Open help');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), 'help-panel');
  assert.equal(panel.tagName, 'ASIDE');
  assert.ok(panel.hasAttribute('data-chrome'));
  assert.equal(panel.getAttribute('aria-hidden'), 'true');
  assert.ok(!document.body.classList.contains('help-open'));

  toggle.click();
  assert.ok(document.body.classList.contains('help-open'));
  assert.equal(toggle.textContent, 'x');
  assert.equal(panel.getAttribute('aria-hidden'), 'false');
  assert.equal(toggle.getAttribute('aria-label'), 'Close help');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(document.getElementById('evidence').isConnected, true, 'the evidence stays in the document');

  panel.querySelector('.help-topic-link').click();
  document.getElementById('evidence').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(document.body.classList.contains('help-open'), 'document clicks and Escape leave Help open');

  panel.querySelector('.help-topic-content').scrollTop = 120;
  document.querySelector('#evidence [data-action="add-section"]').click();
  toggle = document.getElementById('help-toggle');
  assert.equal(document.getElementById('help-panel'), panel, 'content refresh keeps the Help panel mounted');
  assert.ok(document.body.classList.contains('help-open'), 'content edits leave Help open');
  assert.equal(panel.getAttribute('aria-hidden'), 'false');
  assert.equal(panel.querySelector('.help-topic-content').scrollTop, 120, 'content edits preserve Help scroll position');
  assert.equal(toggle.textContent, 'x', 'the panel close control remains x after content refresh');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');

  toggle.click();
  assert.ok(!document.body.classList.contains('help-open'));
  assert.equal(toggle.textContent, '?');
  assert.equal(panel.getAttribute('aria-hidden'), 'true');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('Help topic navigation starts with a full-height table of contents', () => {
  const { document } = loadApp();
  const panel = document.getElementById('help-panel');
  const header = panel.querySelector('.help-header');
  const workspace = panel.querySelector('.help-workspace');
  const entries = [...panel.querySelectorAll('.help-topic-link')];
  const topics = [...panel.querySelectorAll('.help-topic')];
  const css = screenStyles();
  const resize = document.getElementById('help-resize-handle');

  assert.equal(header.textContent.trim(), 'Help');
  assert.equal(resize.getAttribute('role'), 'separator');
  assert.equal(resize.getAttribute('aria-orientation'), 'vertical');
  assert.ok(workspace, 'the content area follows the pinned heading');
  assert.deepEqual(entries.map((entry) => entry.textContent), [
    'First save for each session copy',
    'Copy between open document instances',
    'Move sections and subsections',
  ]);
  assert.deepEqual(topics.map((topic) => topic.dataset.topic), ['first-save', 'copy', 'move-sections']);
  assert.equal(workspace.classList.contains('help-split'), false, 'a fresh page load starts without a selected topic');
  assert.equal(entries.filter((entry) => entry.getAttribute('aria-current') === 'page').length, 0);
  assert.match(stylesheetRule(css, '.help-header'), /position:\s*sticky/);
  assert.match(stylesheetRule(css, '.help-toc'), /overflow-y:\s*auto/);
  assert.match(stylesheetRule(css, '.help-topic-content'), /overflow-y:\s*auto/);
  assert.match(stylesheetRule(css, '.help-divider'), /touch-action:\s*none/);
  assert.match(stylesheetRule(css, '#help-panel'), /position:\s*fixed/);
  assert.match(stylesheetRule(css, '#help-panel'), /right:\s*0/);
  assert.match(css, /body\.help-open\s*\{[^}]*--ev-help-shift-width:/);
  assert.match(stylesheetRule(css, 'body.help-open'), /--ev-help-shift-width:\s*var\(--ev-help-panel-width\)/);
  assert.match(stylesheetRule(css, '.panel-resize-handle'), /cursor:\s*col-resize/);
  assert.match(stylesheetRule(css, '.panel-resize-handle'), /touch-action:\s*none/);
  assert.match(stylesheetRule(css, '.help-resize-handle'), /display:\s*none/);
  assert.match(css, /--ev-content-column-width:\s*min\(100%,\s*var\(--ev-reading-measure\)\)/);
  assert.match(css, /@media\s*\(max-width:\s*1040px\)\s*\{\s*body\s*\{[^}]*--ev-help-panel-width:\s*100vw/);
  assert.match(css, /#help-panel\s*\{\s*width:\s*100vw\s*;\s*\}/,
    'a stored desktop width does not stop Help from filling a narrow viewport');
  const helpToggle = stylesheetRule(css, '#help-toggle');
  assert.match(helpToggle, /position:\s*fixed/);
  assert.match(helpToggle, /top:\s*8px/);
  assert.match(helpToggle, /right:\s*8px/);
});

test('selecting a Help topic splits the panel and resets its content to the top', () => {
  const { document } = loadApp();
  const panel = document.getElementById('help-panel');
  const workspace = panel.querySelector('.help-workspace');
  const links = [...panel.querySelectorAll('.help-topic-link')];
  const topicContent = panel.querySelector('.help-topic-content');
  const divider = panel.querySelector('.help-divider');

  links[0].click();
  assert.equal(workspace.classList.contains('help-split'), true);
  assert.equal(workspace.style.getPropertyValue('--help-toc-height'), '20%');
  assert.equal(links[0].getAttribute('aria-current'), 'page');
  assert.equal(links[1].hasAttribute('aria-current'), false);
  assert.equal(panel.querySelector('.help-topic[data-topic="first-save"]').hidden, false);
  assert.equal(panel.querySelector('.help-topic[data-topic="copy"]').hidden, true);
  assert.equal(divider.getAttribute('role'), 'separator');
  assert.equal(topicContent.scrollTop, 0);

  topicContent.scrollTop = 240;
  links[1].click();
  assert.equal(topicContent.scrollTop, 0, 'switching topics starts the selected topic at its top');
  assert.equal(panel.querySelector('.help-topic[data-topic="first-save"]').hidden, true);
  assert.equal(panel.querySelector('.help-topic[data-topic="copy"]').hidden, false);

  const firstSaveText = panel.querySelector('.help-topic[data-topic="first-save"]').textContent;
  assert.match(firstSaveText, /Chromium-based browser such as Chrome or Edge/i);
  assert.match(firstSaveText, /“Save” is unavailable/);
  assert.match(firstSaveText, /first save for each session copy/i);
  assert.equal(
    panel.querySelector('.help-topic[data-topic="first-save"] h4').textContent,
    'If you cancel the folder picker',
  );
  assert.equal(panel.querySelector('.help-topic[data-topic="cancel"]'), null);
});

test('the Help split is adjustable by pointer and keyboard and persists until page reload', () => {
  const { document, window } = loadApp();
  const panel = document.getElementById('help-panel');
  const workspace = panel.querySelector('.help-workspace');
  const links = [...panel.querySelectorAll('.help-topic-link')];
  const divider = panel.querySelector('.help-divider');
  const toggle = document.getElementById('help-toggle');

  links[0].click();
  assert.equal(divider.getAttribute('aria-valuenow'), '20');
  divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(divider.getAttribute('aria-valuenow'), '21');
  divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(divider.getAttribute('aria-valuenow'), '50');
  divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(divider.getAttribute('aria-valuenow'), '12');

  divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  const originalRect = workspace.getBoundingClientRect.bind(workspace);
  workspace.getBoundingClientRect = () => ({ ...originalRect(), top: 0, height: 1000, bottom: 1000 });
  divider.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientY: 100 }));
  window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientY: 300 }));
  window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
  assert.equal(divider.getAttribute('aria-valuenow'), '33');
  assert.match(getInlineStyleSource(workspace), /33%/);

  links[1].click();
  assert.equal(links[1].getAttribute('aria-current'), 'page');
  assert.equal(workspace.style.getPropertyValue('--help-toc-height'), '33%');
  toggle.click();
  toggle.click();
  assert.equal(links[1].getAttribute('aria-current'), 'page');
  assert.equal(workspace.style.getPropertyValue('--help-toc-height'), '33%');

  const fresh = loadApp().document.getElementById('help-panel');
  assert.equal(fresh.querySelector('.help-workspace').classList.contains('help-split'), false);
  assert.equal(fresh.querySelectorAll('.help-topic-link[aria-current="page"]').length, 0);
});

test('the Help left edge resizes the panel and body shift by pointer and keyboard', () => {
  const { document, window } = loadApp();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  window.dispatchEvent(new window.Event('resize'));

  const panel = document.getElementById('help-panel');
  panel.getBoundingClientRect = () => ({ left: 920, right: 1280, width: 360, top: 0, bottom: 800, height: 800 });
  const handle = document.getElementById('help-resize-handle');
  const toggle = document.getElementById('help-toggle');
  const css = screenStyles();
  assert.ok(handle, 'the left edge has a resize handle');
  assert.equal(handle.getAttribute('role'), 'separator');
  assert.equal(handle.getAttribute('aria-orientation'), 'vertical');
  assert.match(stylesheetRule(css, 'body.help-open'), /--ev-help-shift-width:\s*var\(--ev-help-panel-width\)/);
  assert.match(stylesheetRule(css, '#help-panel'), /width:\s*var\(--ev-help-panel-width\)/);
  toggle.click();

  handle.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 920 }));
  window.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 860 }));
  window.dispatchEvent(new window.MouseEvent('pointerup'));
  assert.equal(handle.getAttribute('aria-valuenow'), '420', 'moving the left edge left widens Help');
  assert.equal(document.body.style.getPropertyValue('--ev-help-panel-width'), '420px');

  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(handle.getAttribute('aria-valuenow'), '410', 'the left edge moves right');
  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(handle.getAttribute('aria-valuenow'), handle.getAttribute('aria-valuemin'));
  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(handle.getAttribute('aria-valuenow'), handle.getAttribute('aria-valuemax'));

  const selectedHelpWidth = document.body.style.getPropertyValue('--ev-help-panel-width');
  toggle.click();
  toggle.click();
  assert.equal(document.body.style.getPropertyValue('--ev-help-panel-width'), selectedHelpWidth, 'the width remains through close and reopen');
  assert.equal(handle.getAttribute('aria-valuenow'), selectedHelpWidth.replace('px', ''));

  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(document.body.style.getPropertyValue('--ev-help-panel-width'), selectedHelpWidth,
    'crossing into the full-screen layout keeps the session width');
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(document.body.style.getPropertyValue('--ev-help-panel-width'), selectedHelpWidth,
    'returning to the wide layout restores the selected width');

  const saved = new window.DOMParser().parseFromString(window.__evidence.serialize(), 'text/html');
  assert.equal(saved.body.getAttribute('style'), null, 'panel widths are not saved into the evidence file');
});

function getInlineStyleSource(element) {
  return element.getAttribute('style') || '';
}

test('Help explains the first save, browser requirement, and recovery after canceling the picker', () => {
  const { document } = loadApp();
  const text = document.getElementById('help-panel').textContent.replace(/\s+/g, ' ');

  assert.match(text, /first save for each session copy/i);
  assert.match(text, /folder containing the open HTML file/i);
  assert.match(text, /Ctrl\/Cmd\+S/);
  assert.doesNotMatch(text, /Copy ready — press Ctrl\/Cmd\+C/);
  assert.match(text, /Chrome or Edge may ask for permission again/i);
  assert.match(text, /Chromium-based browser such as Chrome or Edge/i);
  assert.match(text, /“copy element” button/);
  assert.match(text, /“paste after”/);
  assert.match(text, /“paste here”/);
  assert.match(text, /Click “Save”/);
  assert.match(text, /“Save” is unavailable/);
  assert.match(text, /cancel the folder picker/i);
  assert.match(text, /downloads for the rest of this page session/i);
  assert.match(text, /reload the original file/i);
});

test('saving strips Help chrome and reopens with the panel closed', () => {
  const { document, window } = loadApp();
  document.getElementById('help-toggle').click();
  document.querySelector('.help-topic-link').click();

  const savedHtml = window.__evidence.serialize();
  const saved = new window.DOMParser().parseFromString(savedHtml, 'text/html');
  assert.equal(saved.getElementById('help-panel'), null);
  assert.equal(saved.getElementById('help-toggle'), null);
  assert.ok(!saved.body.classList.contains('help-open'));

  const reopened = loadApp(savedHtml);
  assert.ok(!reopened.document.body.classList.contains('help-open'));
  assert.equal(reopened.document.getElementById('help-toggle').getAttribute('aria-expanded'), 'false');
});
