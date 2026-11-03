import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, downloadText, addFirstSection } from './helpers.js';

// jsdom has no document.execCommand (browser API); stub it per-test and record calls,
// mirroring how helpers.js stubs the download APIs.
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

test('Enter inside a multi-line editable: preventDefault + insert a literal \\n (no block element)', () => {
  // 0035: title/key became single-line (Enter is a no-op there — see
  // single-line-fields.test.js); the newline behavior lives on in comment/value.
  const { document, window } = loadApp();
  const calls = stubExecCommand(document);
  const section = addFirstSection(document); // 0040: build the property row
  sectionAction(section, 'add-property').click();
  const value = section.querySelector(':scope > .ev-body > .ev-property > .ev-prop-value');
  const before = value.innerHTML;
  const ev = keydown(window, value, { key: 'Enter' });
  assert.equal(ev.defaultPrevented, true, 'Enter default action is prevented');
  assert.deepEqual(calls, [['insertText', '\n']], 'newline inserted via insertText, not default action');
  assert.equal(value.innerHTML, before, 'no <br>/<div>/block element introduced by the app itself');
});

test('Enter outside an editable is not intercepted', () => {
  const { document, window } = loadApp();
  const calls = stubExecCommand(document);
  const ev = keydown(window, document.body, { key: 'Enter' });
  assert.equal(ev.defaultPrevented, false, 'default action left alone outside editables');
  assert.deepEqual(calls, [], 'no insertText outside editables');
});

test('Ctrl/Cmd+B, +I, +U inside an editable: preventDefault, no formatting', () => {
  const { document, window } = loadApp();
  const calls = stubExecCommand(document);
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click(); // a fresh section has no comment yet
  for (const key of ['b', 'i', 'u']) {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const target = document.querySelector('.ev-comment-text');
      const ev = keydown(window, target, { key, ...mod });
      assert.equal(ev.defaultPrevented, true, `Ctrl/Cmd+${key.toUpperCase()} prevented`);
    }
  }
  assert.deepEqual(calls, [], 'no formatting command issued');
});

test('Ctrl/Cmd+B outside an editable is not intercepted', () => {
  const { document, window } = loadApp();
  const calls = stubExecCommand(document);
  const ev = keydown(window, document.body, { key: 'b', ctrlKey: true });
  assert.equal(ev.defaultPrevented, false);
  assert.deepEqual(calls, []);
});

// jsdom has no ClipboardEvent constructor; attach clipboardData to a plain Event.
function paste(window, target, { plain = '', html = '' } = {}) {
  const ev = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', {
    value: {
      items: [],
      getData: (type) => (type === 'text/plain' ? plain : type === 'text/html' ? html : ''),
    },
  });
  target.dispatchEvent(ev);
  return ev;
}

test('paste inside an editable: preventDefault + insert the plain text', () => {
  const { document, window } = loadApp();
  const calls = stubExecCommand(document);
  const section = addFirstSection(document); // 0040: build the property row
  sectionAction(section, 'add-property').click();
  const value = section.querySelector(':scope > .ev-body > .ev-property > .ev-prop-value');
  const ev = paste(window, value, { plain: 'line A\nline B', html: '<b>bold A</b><br>line B' });
  assert.equal(ev.defaultPrevented, true, 'rich-text default action is prevented');
  assert.deepEqual(calls, [['insertText', 'line A\nline B']], 'only text/plain is inserted, via insertText');
});

test('pasted rich content never enters the document', () => {
  const { document, window } = loadApp();
  stubExecCommand(document);
  const section = addFirstSection(document); // 0040: build the property row
  sectionAction(section, 'add-property').click();
  const value = section.querySelector(':scope > .ev-body > .ev-property > .ev-prop-value');
  paste(window, value, { plain: 'plain', html: '<b>bold</b><div>block</div>' });
  assert.equal(value.innerHTML, '', 'app itself inserted no markup into the editable');
});

test('paste outside an editable is not intercepted', () => {
  const { document, window } = loadApp();
  const calls = stubExecCommand(document);
  const ev = paste(window, document.body, { plain: 'hello' });
  assert.equal(ev.defaultPrevented, false);
  assert.deepEqual(calls, []);
});

test('a \\n in a text node round-trips through the saved file', async () => {
  const { document, downloads } = loadApp();
  const section = addFirstSection(document); // 0040: build the property row
  sectionAction(section, 'add-property').click();
  const value = section.querySelector(':scope > .ev-body > .ev-property > .ev-prop-value');
  value.textContent = 'line1\nline2';
  document.getElementById('save-btn').click();
  const text = await downloadText(downloads.find((d) => d.name));
  assert.ok(text.includes('line1\nline2'), 'newline present in the saved file');
  const reopened = loadApp(text);
  assert.equal(reopened.document.querySelector('.ev-prop-value').textContent, 'line1\nline2', 'newline adopted on reopen');
});

test('all editable text uses white-space: pre-wrap', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document); // 0040: build the property row
  sectionAction(section, 'add-property').click();
  sectionAction(section, 'add-comment').click();
  for (const sel of ['.ev-title-text', '.ev-comment-text', '.ev-prop-key', '.ev-prop-value']) {
    assert.equal(window.getComputedStyle(document.querySelector(sel)).whiteSpace, 'pre-wrap', sel);
  }
});

// The :empty::before hints are pure CSS (never in the DOM), so the stylesheet
// itself is the seam: check the locked selector → content pairs.
function cssRuleBodies(css, selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  const bodies = [];
  let m;
  while ((m = re.exec(css))) bodies.push(m[1]);
  return bodies;
}

test('empty-editable hints: locked :empty::before strings, muted, CSS-only', () => {
  const { document } = loadApp();
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  const locked = [
    ['.ev-title-text:empty::before', 'Untitled'],
    ['.ev-comment-text:empty::before', 'Comment…'],
    ['.ev-prop-key:empty::before', 'Key'],
    ['.ev-prop-value:empty::before', 'Value'],
  ];
  for (const [selector, hint] of locked) {
    const body = cssRuleBodies(css, selector).find((b) => b.includes(`content:`));
    assert.ok(body, `${selector} rule exists`);
    assert.ok(body.includes(hint), `${selector} shows "${hint}"`);
  }
  const allPlaceholderRules = cssRuleBodies(css, ':empty::before');
  assert.ok(allPlaceholderRules.some((b) => /\bcolor\s*:/.test(b)), 'placeholder text is muted via a color rule');
});

test('placeholder hints never get serialized into the saved file', async () => {
  const { document, downloads } = loadApp();
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-comment').click();
  document.getElementById('save-btn').click();
  const saved = new JSDOM(await downloadText(downloads.find((d) => d.name))).window.document;
  for (const el of saved.querySelectorAll('.ev-comment-text, .ev-prop-value')) {
    assert.equal(el.textContent, '', 'empty editables serialize with no hint text');
  }
});
