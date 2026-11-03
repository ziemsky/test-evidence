import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionAction,
  loadApp,
  addFirstSection,
  downloadText,
  appSource,
  screenStyles,
  stylesheetRule,
  assertCaretAtEnd,
} from './helpers.js';

function addCode(section) {
  sectionAction(section, 'add-code').click();
  return section.querySelector(':scope > .ev-body > .ev-code:last-child');
}

function stubClipboard(window) {
  const calls = [];
  window.navigator.clipboard = { writeText: (text) => { calls.push(text); return Promise.resolve(); } };
  return calls;
}

function paste(window, target, plain, html = '<b>formatted</b>') {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [], getData: (type) => type === 'text/plain' ? plain : type === 'text/html' ? html : '' },
  });
  target.dispatchEvent(event);
  return event;
}

// 0058/0117: code snippets use the established UI/live-DOM seam. Creating
// authored code focuses its new editable field and leaves the caret ready.

test('a section offers + code after + comment and focuses the new code snippet', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  const title = section.querySelector(':scope > .ev-title > .ev-title-text');
  title.focus();

  assert.deepEqual(
    [...document.querySelector('#evidence > .ev-section-palette').querySelectorAll(':scope > button')].map((button) => button.dataset.action),
    ['add-subsection', 'add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url', 'add-section-after', 'copy', 'copy-element', 'paste-after', 'paste-here', 'delete'],
  );

  sectionAction(section, 'add-code').click();

  const code = section.querySelector(':scope > .ev-body > .ev-code');
  assert.ok(code, 'the section receives a first-class code row');
  assert.ok(code.firstElementChild.matches('.ev-drag-handle[data-chrome]'), 'the drag handle is first');
  assert.ok(code.querySelector(':scope > .ev-code-text[contenteditable="true"]'), 'the text is inline-editable');
  const field = code.querySelector('.ev-code-text');
  assert.equal(document.activeElement, field, 'creation focuses the new code field');
  assertCaretAtEnd(field);
});

test('code chrome does not create an extra line above the authored text', () => {
  const { document } = loadApp();
  const code = addCode(addFirstSection(document));
  const css = screenStyles();

  assert.match(stylesheetRule(css, '.ev-code'), /position:\s*relative/);
  assert.match(stylesheetRule(css, '.ev-code > .ev-drag-handle'), /position:\s*absolute/);
  assert.ok(code.firstElementChild.matches('.ev-drag-handle[data-chrome]'), 'the grab handler remains mounted');
  assert.ok(code.querySelector(':scope > .ev-controls[data-chrome]'), 'the toolbox controls remain mounted');
});

test('pointer creation leaves focus in the new code field', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  const title = section.querySelector(':scope > .ev-title > .ev-title-text');
  const add = sectionAction(section, 'add-code');
  title.focus();

  const down = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  add.dispatchEvent(down);
  if (!down.defaultPrevented) add.focus(); // mirrors the browser's default mousedown focus action
  add.click();

  assert.equal(down.defaultPrevented, true, 'the delegated pointer path prevents button focus');
  const field = section.querySelector(':scope > .ev-body > .ev-code .ev-code-text');
  assert.equal(document.activeElement, field, 'the new code field takes focus after creation');
  assertCaretAtEnd(field);
});

test('a code snippet accepts plain multiline editing and renders as unwrapped monospace text', () => {
  const { document, window } = loadApp();
  const code = addCode(addFirstSection(document));
  const field = code.querySelector('.ev-code-text');
  const calls = [];
  document.execCommand = (command, unused, text) => { calls.push([command, text]); return true; };

  const pasteEvent = paste(window, field, '  const value = 1;\n\n  return value;\n');
  const tab = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  field.dispatchEvent(tab);

  assert.equal(pasteEvent.defaultPrevented, true, 'rich paste is replaced by text/plain');
  assert.deepEqual(calls, [['insertText', '  const value = 1;\n\n  return value;\n']], 'the exact raw text is inserted');
  assert.equal(tab.defaultPrevented, false, 'Tab retains normal browser focus navigation');
  assert.equal(window.getComputedStyle(code).whiteSpace, 'pre');
  assert.match(window.getComputedStyle(code).fontFamily, /monospace/i);
  assert.equal(code.querySelector('.ev-code-text').textContent, '', 'the app inserts no HTML itself');
});

test('copy, soft wrap, save/reopen, move, and delete preserve a snippet as authored content', async () => {
  const first = loadApp();
  const section = addFirstSection(first.document);
  const code = addCode(section);
  const raw = '  first line\n\n\tlast line\n';
  code.querySelector('.ev-code-text').textContent = raw;
  const copied = stubClipboard(first.window);
  const wrap = sectionAction(code, 'soft-wrap');

  assert.deepEqual([...code.querySelectorAll(':scope > .ev-controls button')].map((button) => button.dataset.action),
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'soft-wrap', 'copy', 'copy-element', 'paste-after', 'delete']);
  assert.equal(wrap.getAttribute('aria-pressed'), 'false', 'wrap starts off');
  sectionAction(code, 'copy').click();
  wrap.click();
  assert.deepEqual(copied, [raw], 'copy is lossless raw text');
  assert.ok(code.hasAttribute('data-soft-wrap'), 'wrap state is authored content');
  assert.equal(wrap.getAttribute('aria-pressed'), 'true');
  assert.equal(first.window.getComputedStyle(code).whiteSpace, 'pre-wrap', 'layout changes immediately');

  const secondCode = addCode(section);
  secondCode.querySelector('.ev-code-text').textContent = 'second';
  assert.ok(!secondCode.hasAttribute('data-soft-wrap'), 'wrap remains local to its own snippet');
  const body = section.querySelector(':scope > .ev-body');
  assert.equal(first.window.__evidence.moveElement(code, body, secondCode), true, 'the established move seam accepts code rows');
  assert.equal(body.firstElementChild, code, 'the snippet moves as a normal leaf row');

  first.document.getElementById('save-btn').click();
  const saved = await downloadText(first.downloads.find((entry) => entry.name));
  assert.match(saved, /data-soft-wrap/, 'the local wrap state serializes');
  assert.doesNotMatch(saved.match(/<main id="evidence">[\s\S]*?<\/main>/)[0], /data-chrome|contenteditable/, 'saved content is clean');

  const reopened = loadApp(saved);
  const restored = reopened.document.querySelector('.ev-code');
  assert.equal(restored.querySelector('.ev-code-text').textContent, raw, 'indentation, blank line, and trailing newline survive');
  assert.ok(restored.hasAttribute('data-soft-wrap'), 'wrap state reopens');
  assert.equal(sectionAction(restored, 'soft-wrap').getAttribute('aria-pressed'), 'true', 'chrome restores statefully');
  sectionAction(restored, 'delete').click();
  assert.equal(restored.isConnected, false, 'delete has leaf-row parity');
});

test('the print stylesheet keeps snippets visible and reflows only wrapped snippets', () => {
  const source = appSource();
  const print = source.slice(source.indexOf('@media print'));
  assert.doesNotMatch(print, /\.ev-code\s*\{[^}]*display\s*:\s*none/, 'code remains printable evidence');
  assert.match(print, /\.ev-code\s*\{[^}]*border:\s*none/, 'print removes the code boundary');
  assert.match(print, /\.ev-code\s*\{[^}]*overflow\s*:\s*visible/, 'print avoids clipped long lines');
  assert.match(print, /\.ev-code\[data-soft-wrap\]\s*\{[^}]*white-space\s*:\s*pre-wrap/, 'only opted-in snippets reflow for print');
});
