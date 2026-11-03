import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAction, loadApp, addFirstSection } from './helpers.js';

// 0019: copy text fields — title / comment / property (SPEC §9).
// Seams: the UI buttons + the live DOM, and the save status.
// writeText is invoked from the click gesture (synchronously inside the
// click handler); navigator.clipboard is a browser API jsdom does not
// implement, so tests stub window.navigator.clipboard on the window
// (same pattern as the confirm() stubs in delete.test.js).
// Expected values are the SPEC's locked copy semantics (§9): title text
// only, comment text, property value only — never the key.

function stubClipboard(window) {
  const calls = [];
  window.navigator.clipboard = {
    writeText: (text) => {
      calls.push(text);
      return Promise.resolve();
    },
  };
  return calls;
}

const sectionCopyButton = (section) =>
  sectionAction(section, 'copy');

const rowCopyOverlayButton = (row) =>
  row.querySelector(':scope > .ev-copy-overlay > button[data-action="copy"]');

test('comment, code, and property rows expose an icon-only copy overlay without replacing their toolbox copy', () => {
  const { window, document } = loadApp();
  const calls = stubClipboard(window);
  const section = addFirstSection(document);

  sectionAction(section, 'add-comment').click();
  const comment = section.querySelector(':scope > .ev-body > .ev-comment');
  comment.querySelector(':scope > .ev-comment-text').textContent = 'comment text';

  sectionAction(section, 'add-code').click();
  const code = section.querySelector(':scope > .ev-body > .ev-code');
  code.querySelector(':scope > .ev-code-text').textContent = 'const answer = 42;';

  sectionAction(section, 'add-property').click();
  const property = section.querySelector(':scope > .ev-body > .ev-property');
  property.querySelector(':scope > .ev-prop-key').textContent = 'Browser';
  property.querySelector(':scope > .ev-prop-value').textContent = 'Firefox 140';

  for (const row of [comment, code, property]) {
    const overlay = row.querySelector(':scope > .ev-copy-overlay');
    const button = rowCopyOverlayButton(row);
    assert.ok(overlay, 'the row has a copy overlay');
    assert.ok(button, 'the overlay has a copy button');
    assert.ok(button.querySelector(':scope > .ev-action-icon'), 'the overlay reuses the copy icon');
    assert.equal(button.querySelector(':scope > .ev-action-label'), null, 'the overlay has no visible label');
    assert.equal(button.textContent, '', 'the button contains only the icon');
    assert.equal(row.querySelector(':scope > .ev-controls > button[data-action="copy"]') !== null, true,
      'the existing toolbox copy remains available');
  }

  rowCopyOverlayButton(comment).click();
  rowCopyOverlayButton(code).click();
  rowCopyOverlayButton(property).click();
  assert.deepEqual(calls, ['comment text', 'const answer = 42;', 'Firefox 140']);
});

test('copy preserves newlines exactly (pre-wrap text, SPEC §8/§9)', () => {
  const { window, document } = loadApp();
  const calls = stubClipboard(window);
  const s1 = addFirstSection(document);
  sectionAction(s1, 'add-comment').click();
  const comment = s1.querySelector(':scope > .ev-body > .ev-comment');
  comment.querySelector(':scope > .ev-comment-text').textContent = 'line one\nline two';

  sectionAction(comment, 'copy').click();

  assert.deepEqual(calls, ['line one\nline two'], 'the text exactly as stored, newlines intact');
});

test('a successful copy reports through the operation log', async () => {
  const { window, document } = loadApp();
  const calls = stubClipboard(window);
  const s1 = addFirstSection(document);
  s1.querySelector(':scope > h2.ev-title > .ev-title-text').textContent = 'Results';

  sectionCopyButton(s1).click();
  await Promise.resolve(); // writeText's thenable resolves as a microtask

  assert.deepEqual(calls, ['Results']);
  assert.match(latestOperationResult(document).message, /^Copied \d{2}:\d{2}:\d{2}$/, 'Copied HH:MM:SS, per the save-status convention');
});

test('a failed copy reports through the operation log', async () => {
  const { window, document } = loadApp();
  window.navigator.clipboard = {
    writeText: () => Promise.reject(new Error('NotAllowedError')),
  };
  const s1 = addFirstSection(document);

  sectionCopyButton(s1).click();
  await Promise.resolve();

  assert.match(latestOperationResult(document).message, /^Copy failed — NotAllowedError$/);
});

test('property copy writes the value only — never the key', () => {
  const { window, document } = loadApp();
  const calls = stubClipboard(window);
  const s1 = addFirstSection(document);
  sectionAction(s1, 'add-property').click();
  const prop = s1.querySelector(':scope > .ev-body > .ev-property');
  prop.querySelector(':scope > .ev-prop-value').textContent = 'Firefox 140';

  sectionAction(prop, 'copy').click();

  assert.deepEqual(calls, ['Firefox 140'], 'the value only — the key is never copied');
});

test('copying a property with an empty value copies the empty value, still never the key', () => {
  const { window, document } = loadApp();
  const calls = stubClipboard(window);
  const s1 = addFirstSection(document);
  sectionAction(s1, 'add-property').click();
  const prop = s1.querySelector(':scope > .ev-body > .ev-property'); // added with an empty value

  sectionAction(prop, 'copy').click();

  assert.deepEqual(calls, [''], 'empty value — the key is not a fallback');
});

test('comment copy writes the comment text', () => {
  const { window, document } = loadApp();
  const calls = stubClipboard(window);
  const s1 = addFirstSection(document);
  sectionAction(s1, 'add-comment').click();
  const comment = s1.querySelector(':scope > .ev-body > .ev-comment');
  comment.querySelector(':scope > .ev-comment-text').textContent = 'Console shows a TypeError on load';

  sectionAction(comment, 'copy').click();

  assert.deepEqual(calls, ['Console shows a TypeError on load'], 'the comment text');
});

test('section copy writes the title text only — no numbering prefix', () => {
  const { window, document } = loadApp();
  const calls = stubClipboard(window);
  const s1 = addFirstSection(document);
  s1.querySelector(':scope > h2.ev-title > .ev-title-text').textContent = 'Results';
  assert.equal(s1.querySelector(':scope > h2.ev-title > .ev-num').textContent, '1', 'precondition: section is numbered');

  sectionCopyButton(s1).click();

  assert.deepEqual(calls, ['Results'], 'the title text only — no numbering prefix, no control labels');
});
