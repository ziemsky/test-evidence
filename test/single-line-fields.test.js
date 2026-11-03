import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, downloadText, addFirstSection } from './helpers.js';

// 0035 (SPEC §8), extended by 0039: three fields are single-line — the
// document title (.ev-doc-title-text), the section title (.ev-title-text),
// and the property key (.ev-prop-key). Enter is a locked
// no-op there; pasted newlines collapse to single spaces. Comment text and
// property value keep the uniform multi-line model. Same seams as
// plain-text.test.js: the live DOM through dispatched events, plus the
// saved file text.

// jsdom has no document.execCommand; stub it per-test and record calls
// (same pattern as plain-text.test.js).
function stubExecCommand(document) {
  const calls = [];
  document.execCommand = (cmd, uiValue, value) => {
    calls.push([cmd, value]);
    return true;
  };
  return calls;
}

function keydown(window, target, init) {
  const ev = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

// jsdom has no ClipboardEvent constructor; attach clipboardData to a plain Event.
function paste(window, target, { plain = '' } = {}) {
  const ev = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', {
    value: { items: [], getData: (type) => (type === 'text/plain' ? plain : '') },
  });
  target.dispatchEvent(ev);
  return ev;
}

for (const sel of ['.ev-doc-title-text', '.ev-title-text', '.ev-prop-key']) {
  test(`Enter in ${sel}: preventDefault, nothing inserted, focus stays`, () => {
    const { document, window } = loadApp();
    // 0040: bare boot — build the section and property the other selectors need
    const section = addFirstSection(document);
    sectionAction(section, 'add-property').click();
    const calls = stubExecCommand(document);
    const el = document.querySelector(sel);
    el.focus();
    const ev = keydown(window, el, { key: 'Enter' });
    assert.equal(ev.defaultPrevented, true, 'Enter default action is prevented');
    assert.deepEqual(calls, [], 'nothing is inserted — the locked no-op');
    assert.equal(document.activeElement, el, 'focus stays in the field (no blur, no movement)');
  });
}

for (const [plain, label] of [
  ['foo\nbar', 'LF'],
  ['foo\r\nbar', 'CRLF'],
  ['foo\rbar', 'lone-CR'],
]) {
  for (const sel of ['.ev-doc-title-text', '.ev-title-text', '.ev-prop-key']) {
    test(`pasting ${label} into ${sel}: newlines collapse to a single space`, () => {
      const { document, window } = loadApp();
      // 0040: bare boot — build the section and property the other selectors need
      const section = addFirstSection(document);
      sectionAction(section, 'add-property').click();
      const calls = stubExecCommand(document);
      const el = document.querySelector(sel);
      const ev = paste(window, el, { plain });
      assert.equal(ev.defaultPrevented, true, 'paste default action is prevented');
      assert.deepEqual(calls, [['insertText', 'foo bar']], `"foo bar" inserted for ${label} paste`);
    });
  }
}

for (const sel of ['.ev-doc-title-text', '.ev-title-text', '.ev-prop-key']) {
  test(`pasted text without newlines in ${sel}: inserted verbatim`, () => {
    const { document, window } = loadApp();
    // 0040: bare boot — build the section and property the other selectors need
    const section = addFirstSection(document);
    sectionAction(section, 'add-property').click();
    const calls = stubExecCommand(document);
    const el = document.querySelector(sel);
    paste(window, el, { plain: 'foo bar' });
    assert.deepEqual(calls, [['insertText', 'foo bar']], 'no-newline text is untouched');
  });
}

for (const [sel, addComment] of [
  ['.ev-comment-text', true],
  ['.ev-prop-value', false],
]) {
  test(`Enter in ${sel}: multi-line model unchanged, literal \\n inserted`, () => {
    const { document, window } = loadApp();
    const section = addFirstSection(document); // 0040: build the section
    if (addComment) sectionAction(section, 'add-comment').click();
    else sectionAction(section, 'add-property').click();
    const calls = stubExecCommand(document);
    const el = document.querySelector(sel);
    const ev = keydown(window, el, { key: 'Enter' });
    assert.equal(ev.defaultPrevented, true, 'Enter default action is prevented');
    assert.deepEqual(calls, [['insertText', '\n']], 'literal newline still inserted');
  });

  test(`pasted newline in ${sel}: inserted verbatim`, () => {
    const { document, window } = loadApp();
    const section = addFirstSection(document); // 0040: build the section
    if (addComment) sectionAction(section, 'add-comment').click();
    else sectionAction(section, 'add-property').click();
    const calls = stubExecCommand(document);
    const el = document.querySelector(sel);
    paste(window, el, { plain: 'foo\nbar' });
    assert.deepEqual(calls, [['insertText', 'foo\nbar']], 'multi-line paste is untouched');
  });
}

test('title and key still wrap visually: white-space stays pre-wrap, no CSS change', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document); // 0040: build the section + property
  sectionAction(section, 'add-property').click();
  for (const sel of ['.ev-doc-title-text', '.ev-title-text', '.ev-prop-key']) {
    assert.equal(
      window.getComputedStyle(document.querySelector(sel)).whiteSpace,
      'pre-wrap',
      `${sel} keeps pre-wrap`,
    );
  }
});

test('saved file after pasting into title and key: no newline, no markers, no contenteditable', async () => {
  const { document, downloads, window } = loadApp();
  const section = addFirstSection(document); // 0040: build the section + property
  sectionAction(section, 'add-property').click();
  stubExecCommand(document);
  paste(window, document.querySelector('.ev-title-text'), { plain: 'My\nTitle' });
  paste(window, document.querySelector('.ev-prop-key'), { plain: 'my\r\nkey' });
  // the stub records the insertions; mirror them into the DOM as the app would,
  // then save and inspect the serialized text.
  document.querySelector('.ev-title-text').textContent = 'My Title';
  document.querySelector('.ev-prop-key').textContent = 'my key';
  document.getElementById('save-btn').click();
  const text = await downloadText(downloads.find((d) => d.name));
  assert.ok(text.includes('My Title'), 'collapsed title text is what is saved');
  assert.ok(text.includes('my key'), 'collapsed key text is what is saved');
  const saved = new JSDOM(text).window.document;
  assert.equal(saved.querySelector('.ev-title-text').textContent, 'My Title', 'no newline survives into the saved title');
  assert.equal(saved.querySelector('.ev-prop-key').textContent, 'my key', 'no newline survives into the saved key');
  assert.equal(saved.querySelector('[contenteditable]'), null, 'no contenteditable attribute persists');
});
