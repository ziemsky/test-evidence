import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  sectionAction,
  loadApp,
  addFirstSection,
  downloadText,
  waitFor,
  assertCaretAtEnd,
  screenStyles,
  stylesheetRule,
} from './helpers.js';

function bodyRows(section) {
  return [...section.querySelectorAll(':scope > .ev-body > .ev-comment, :scope > .ev-body > .ev-code, :scope > .ev-body > .ev-property')];
}

function rowActions(row) {
  return [...row.querySelectorAll(':scope > .ev-controls button')].map((button) => button.dataset.action);
}

function copyElement(row) {
  sectionAction(row, 'copy-element').click();
}

function pasteAfter(row) {
  sectionAction(row, 'paste-after').click();
}

function pasteHere(section) {
  sectionAction(section, 'paste-here').click();
}

function nativeClipboardData() {
  const values = new Map();
  return {
    types: [],
    setData(type, value) {
      values.set(type, value);
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData(type) {
      return values.get(type) || '';
    },
  };
}

function runNativeCopy(window) {
  const clipboardData = nativeClipboardData();
  window.document.execCommand = (command) => {
    assert.equal(command, 'copy');
    const event = new window.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    window.document.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return clipboardData;
}

function runNativePaste(window, clipboardData, target = window.document) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  target.dispatchEvent(event);
  return event;
}

test('supported rows expose copy element and system paste targets without a local copy', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  sectionAction(section, 'add-code').click();
  sectionAction(section, 'add-property').click();

  const rows = bodyRows(section);
  assert.deepEqual(rows.map(rowActions), [
    // 0108 (SPEC §29): comment and code legacy chrome mirror the row toolbox.
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'copy', 'copy-element', 'paste-after', 'delete'],
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'soft-wrap', 'copy', 'copy-element', 'paste-after', 'delete'],
    // 0107 (SPEC §29): the property row's legacy chrome mirrors its shared
    // toolbox — the six in-section content adds lead.
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'copy', 'copy-element', 'paste-after', 'delete'],
  ]);
  assert.equal(document.querySelectorAll('[data-action="paste-after"]').length, 4,
    'rows and sections expose system paste-after targets before a local copy');
  assert.ok(sectionAction(section, 'paste-here'));

  copyElement(rows[0]);

  assert.equal(document.querySelectorAll('[data-action="paste-after"]').length, 4);
  assert.ok(sectionAction(section, 'paste-here'));
  assert.match(latestOperationResult(document).message, /Copy ready — press Ctrl\/Cmd\+C/);
});

test('copy element snapshots authored content independently and pastes across row types', () => {
  const { document } = loadApp();
  const sourceSection = addFirstSection(document);
  sectionAction(document, 'add-section').click();
  const targetSection = [...document.querySelectorAll('#evidence > .ev-section')].at(-1);
  sectionAction(sourceSection, 'add-property').click();
  const source = sourceSection.querySelector('.ev-property');
  source.querySelector('.ev-prop-key').textContent = 'Browser';
  source.querySelector('.ev-prop-value').textContent = 'Firefox';
  copyElement(source);

  source.querySelector('.ev-prop-key').textContent = 'Changed';
  source.querySelector('.ev-prop-value').textContent = 'Later';
  sectionAction(source, 'delete').click();

  sectionAction(targetSection, 'add-comment').click();
  const target = targetSection.querySelector('.ev-comment');
  pasteAfter(target);
  const pasted = target.nextElementSibling;
  assert.ok(pasted.matches('.ev-property'));
  assert.equal(pasted.querySelector('.ev-prop-key').textContent, 'Browser');
  assert.equal(pasted.querySelector('.ev-prop-value').textContent, 'Firefox');
  assert.equal(document.activeElement, pasted.querySelector('.ev-prop-key'));
  assertCaretAtEnd(pasted.querySelector('.ev-prop-key'));
  assert.match(latestOperationResult(document).message, /^Pasted element \d{2}:\d{2}:\d{2}$/);
});

test('pasting a text row places the caret after its existing content', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const source = section.querySelector('.ev-comment');
  source.querySelector('.ev-comment-text').textContent = 'Copied comment';
  copyElement(source);

  pasteAfter(source);
  const pasted = source.nextElementSibling.querySelector('.ev-comment-text');
  assert.equal(document.activeElement, pasted);
  assert.equal(pasted.textContent, 'Copied comment');
  assertCaretAtEnd(pasted);
});

test('pasting a URL row opens its editor with the caret at the end', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-url').click();
  const source = section.querySelector('.ev-url');
  const sourceInputs = source.querySelector('.ev-url-input');
  sourceInputs.value = 'https://example.test/path';
  source.querySelector('.ev-text-input').value = 'Example';
  sectionAction(section, 'add-comment').click();
  const target = section.querySelector('.ev-comment');

  copyElement(source);
  pasteAfter(target);

  const pasted = target.nextElementSibling;
  const pastedInput = pasted.querySelector('.ev-url-input');
  assert.ok(pasted.matches('.ev-url[data-editing]'));
  assert.equal(document.activeElement, pastedInput);
  assert.equal(pastedInput.value, 'https://example.test/path');
  assertCaretAtEnd(pastedInput);
});

test('copy element uses native copy data without asynchronous clipboard access', () => {
  const sourceApp = loadApp();
  let writes = 0;
  let reads = 0;
  sourceApp.window.navigator.clipboard = {
    write() { writes++; return Promise.reject(new Error('async write must not run')); },
    writeText() { writes++; return Promise.reject(new Error('async write must not run')); },
    read() { reads++; return Promise.reject(new Error('async read must not run')); },
    readText() { reads++; return Promise.reject(new Error('async read must not run')); },
  };
  const clipboardData = runNativeCopy(sourceApp.window);
  const sourceSection = addFirstSection(sourceApp.document);
  sectionAction(sourceSection, 'add-comment').click();
  const source = sourceSection.querySelector('.ev-comment');
  source.querySelector('.ev-comment-text').textContent = 'from another document';
  copyElement(source);

  assert.ok(clipboardData.types.includes('web application/x-test-evidence-element+json'));
  assert.match(clipboardData.getData('text/plain'), /^test-evidence-element\/v1:/);
  assert.equal(writes, 0);
  assert.equal(reads, 0);
});

test('cross-document paste consumes one armed target and does not repeat on native paste', async () => {
  const sourceApp = loadApp();
  const sourceClipboard = runNativeCopy(sourceApp.window);
  const sourceSection = addFirstSection(sourceApp.document);
  sectionAction(sourceSection, 'add-comment').click();
  const source = sourceSection.querySelector('.ev-comment');
  source.querySelector('.ev-comment-text').textContent = 'from another document';
  copyElement(source);

  const destinationApp = loadApp();
  let reads = 0;
  destinationApp.window.navigator.clipboard = {
    read() { reads++; return Promise.reject(new Error('async read must not run')); },
    readText() { reads++; return Promise.reject(new Error('async read must not run')); },
  };
  const destinationSection = addFirstSection(destinationApp.document);
  sectionAction(destinationSection, 'add-comment').click();
  const target = destinationSection.querySelector('.ev-comment');
  target.querySelector('.ev-comment-text').textContent = 'destination';
  pasteAfter(target);

  assert.equal(destinationSection.querySelectorAll('.ev-comment').length, 1);
  assert.match(latestOperationResult(destinationApp.document).message, /Ctrl\/Cmd\+V/);
  assert.equal(target.querySelector('[data-action="paste-after"]').getAttribute('data-clipboard-target'), 'paste-after');

  destinationApp.document.getElementById('save-btn').click();
  const saved = await downloadText(destinationApp.downloads.find((entry) => entry.name));
  assert.equal(new JSDOM(saved).window.document.querySelector('[data-clipboard-target]'), null);

  const firstPaste = runNativePaste(destinationApp.window, sourceClipboard);
  await waitFor(() => destinationSection.querySelectorAll('.ev-comment').length === 2);
  assert.equal(firstPaste.defaultPrevented, true);
  assert.equal(target.nextElementSibling.querySelector('.ev-comment-text').textContent, 'from another document');
  assert.equal(destinationApp.document.activeElement, target.nextElementSibling.querySelector('.ev-comment-text'));
  assert.equal(target.querySelector('[data-action="paste-after"]').hasAttribute('data-clipboard-target'), false);
  assert.equal(reads, 0);

  runNativePaste(destinationApp.window, sourceClipboard);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(destinationSection.querySelectorAll('.ev-comment').length, 2);
  assert.equal(reads, 0);
});

test('a local row snapshot is consumed once so the next target accepts external content', async () => {
  const sourceApp = loadApp();
  const sourceClipboard = runNativeCopy(sourceApp.window);
  const sourceSection = addFirstSection(sourceApp.document);
  sectionAction(sourceSection, 'add-comment').click();
  sourceSection.querySelector('.ev-comment-text').textContent = 'external content';
  copyElement(sourceSection.querySelector('.ev-comment'));

  const destinationApp = loadApp();
  const destinationSection = addFirstSection(destinationApp.document);
  sectionAction(destinationSection, 'add-comment').click();
  sectionAction(destinationSection, 'add-comment').click();
  const localSource = destinationSection.querySelectorAll('.ev-comment')[0];
  const externalTarget = destinationSection.querySelectorAll('.ev-comment')[1];
  localSource.querySelector('.ev-comment-text').textContent = 'local content';
  copyElement(localSource);

  pasteAfter(localSource);
  assert.equal(destinationSection.querySelectorAll('.ev-comment').length, 3);
  assert.equal(destinationApp.document.querySelectorAll('[data-clipboard-source]').length, 0);

  pasteAfter(externalTarget);
  assert.equal(destinationSection.querySelectorAll('.ev-comment').length, 3,
    'a consumed local snapshot is not pasted a second time');
  assert.equal(externalTarget.querySelector('[data-action="paste-after"]').getAttribute('data-clipboard-target'), 'paste-after');
  assert.match(latestOperationResult(destinationApp.document).message, /Ctrl\/Cmd\+V/);

  runNativePaste(destinationApp.window, sourceClipboard);
  await waitFor(() => destinationSection.querySelectorAll('.ev-comment').length === 4);
  assert.equal(externalTarget.nextElementSibling.querySelector('.ev-comment-text').textContent, 'external content');

  pasteAfter(externalTarget);
  assert.equal(externalTarget.querySelector('[data-action="paste-after"]').getAttribute('data-clipboard-target'), 'paste-after');
});

test('an incompatible local target preserves the snapshot for a compatible retry', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const comment = section.querySelector('.ev-comment');
  comment.querySelector('.ev-comment-text').textContent = 'local content';
  copyElement(comment);

  sectionAction(section, 'paste-after').click();
  assert.equal(section.querySelectorAll('.ev-comment').length, 1);
  assert.equal(latestOperationResult(document).message, 'Paste failed — rows can only paste after a row');

  pasteAfter(comment);
  assert.equal(section.querySelectorAll('.ev-comment').length, 2);
  assert.equal(comment.nextElementSibling.querySelector('.ev-comment-text').textContent, 'local content');
});

test('text fallback parsing, target changes, and Escape cancellation are safe', async () => {
  const sourceApp = loadApp();
  const sourceClipboard = runNativeCopy(sourceApp.window);
  const sourceSection = addFirstSection(sourceApp.document);
  sectionAction(sourceSection, 'add-comment').click();
  sourceSection.querySelector('.ev-comment-text').textContent = 'fallback content';
  copyElement(sourceSection.querySelector('.ev-comment'));

  const destinationApp = loadApp();
  const destinationSection = addFirstSection(destinationApp.document);
  sectionAction(destinationSection, 'add-comment').click();
  sectionAction(destinationSection, 'add-code').click();
  const target = destinationSection.querySelector('.ev-comment');
  const otherTarget = destinationSection.querySelector('.ev-code');
  pasteAfter(target);
  assert.equal(target.querySelector('[data-action="paste-after"]').getAttribute('data-clipboard-target'), 'paste-after');
  pasteAfter(otherTarget);
  assert.equal(target.querySelector('[data-action="paste-after"]').hasAttribute('data-clipboard-target'), false);
  assert.equal(otherTarget.querySelector('[data-action="paste-after"]').getAttribute('data-clipboard-target'), 'paste-after');
  destinationApp.document.dispatchEvent(new destinationApp.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(otherTarget.querySelector('[data-action="paste-after"]').hasAttribute('data-clipboard-target'), false);

  pasteAfter(target);
  const fallback = nativeClipboardData();
  fallback.setData('text/plain', sourceClipboard.getData('text/plain'));
  runNativePaste(destinationApp.window, fallback);
  await waitFor(() => destinationSection.querySelectorAll('.ev-comment').length === 2);

  const invalidApp = loadApp();
  const invalidSection = addFirstSection(invalidApp.document);
  sectionAction(invalidSection, 'add-comment').click();
  const secondTarget = invalidSection.querySelector('.ev-comment');
  pasteAfter(secondTarget);
  const malformed = nativeClipboardData();
  malformed.setData('text/plain', 'test-evidence-element/v1:{"not":"valid"}');
  const malformedPaste = runNativePaste(invalidApp.window, malformed);
  assert.equal(malformedPaste.defaultPrevented, true);
  assert.equal(invalidSection.querySelectorAll('.ev-comment').length, 1);
  assert.equal(secondTarget.querySelector('[data-action="paste-after"]').hasAttribute('data-clipboard-target'), false);

  runNativePaste(invalidApp.window, sourceClipboard);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(invalidSection.querySelectorAll('.ev-comment').length, 1,
    'an invalid external paste requires a new target before a later paste');
});

test('structured fallback is not inserted into an editable without an armed target', () => {
  const sourceApp = loadApp();
  const sourceClipboard = runNativeCopy(sourceApp.window);
  const sourceSection = addFirstSection(sourceApp.document);
  sectionAction(sourceSection, 'add-comment').click();
  const source = sourceSection.querySelector('.ev-comment');
  source.querySelector('.ev-comment-text').textContent = 'external content';
  copyElement(source);

  const destinationApp = loadApp();
  const destinationSection = addFirstSection(destinationApp.document);
  sectionAction(destinationSection, 'add-comment').click();
  const field = destinationSection.querySelector('.ev-comment-text');
  field.textContent = 'keep this text';
  const paste = runNativePaste(destinationApp.window, {
    types: ['text/plain'],
    getData(type) {
      return type === 'text/plain' ? sourceClipboard.getData('text/plain') : '';
    },
  }, field);

  assert.equal(paste.defaultPrevented, true);
  assert.equal(field.textContent, 'keep this text');
});

test('paste after consumes the local snapshot and paste here requires a new copy', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-code').click();
  const source = section.querySelector('.ev-code');
  const raw = '  first line\n\n\tlast line\n';
  source.querySelector('.ev-code-text').textContent = raw;
  source.setAttribute('data-soft-wrap', '');
  copyElement(source);

  pasteAfter(source);
  pasteAfter(source);
  const copies = [...section.querySelectorAll(':scope > .ev-body > .ev-code')];
  assert.equal(copies.length, 2);
  assert.deepEqual(copies.map((row) => row.querySelector('.ev-code-text').textContent), [raw, raw]);
  assert.ok(copies.every((row) => row.hasAttribute('data-soft-wrap')));
  assert.equal(sectionAction(source, 'paste-after').getAttribute('data-clipboard-target'), 'paste-after');

  const empty = sectionAction(document, 'add-section').closest('#evidence');
  sectionAction(empty, 'add-section').click();
  const emptySection = [...document.querySelectorAll('#evidence > .ev-section')].at(-1);
  copyElement(source);
  pasteHere(emptySection);
  assert.equal(emptySection.querySelectorAll(':scope > .ev-body > .ev-code').length, 1);
  assert.equal(document.activeElement, emptySection.querySelector('.ev-code-text'));
  assert.equal(document.querySelectorAll('.ev-code').length, 3);
});

test('next copy element replaces the local fallback, and external copy is unchanged', async () => {
  const { window, document, downloads } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  sectionAction(section, 'add-property').click();
  const comment = section.querySelector('.ev-comment');
  const property = section.querySelector('.ev-property');
  comment.querySelector('.ev-comment-text').textContent = 'comment text';
  property.querySelector('.ev-prop-key').textContent = 'Key';
  property.querySelector('.ev-prop-value').textContent = 'property value';
  const external = [];
  window.navigator.clipboard = { writeText: (text) => { external.push(text); return Promise.resolve(); } };

  copyElement(comment);
  copyElement(property);
  external.length = 0;
  pasteAfter(comment);
  assert.equal(comment.nextElementSibling.matches('.ev-property'), true);
  assert.equal(comment.nextElementSibling.querySelector('.ev-prop-value').textContent, 'property value');

  sectionAction(property, 'copy').click();
  await Promise.resolve();
  assert.deepEqual(external, ['property value']);

  window.confirm = () => true;
  document.getElementById('example-btn').click();
  document.querySelector('#example-menu [data-action="apply-example"]').click();
  assert.ok(sectionAction(document, 'paste-here'));
  assert.ok(sectionAction(document, 'paste-after'));
  assert.deepEqual(downloads, []);
});

test('pasted rows are ordinary saved content and reopen without copied chrome', async () => {
  const first = loadApp();
  const section = addFirstSection(first.document);
  sectionAction(section, 'add-comment').click();
  const source = section.querySelector('.ev-comment');
  source.querySelector('.ev-comment-text').textContent = 'line one\nline two';
  copyElement(source);
  pasteAfter(source);
  const pasted = source.nextElementSibling;
  first.document.getElementById('save-btn').click();
  const saved = await downloadText(first.downloads.find((entry) => entry.name));
  const savedDocument = new JSDOM(saved).window.document;
  assert.equal(savedDocument.querySelectorAll('[data-chrome]').length, 0);
  assert.equal(savedDocument.querySelectorAll('[data-action="copy-element"]').length, 0);
  assert.equal(savedDocument.querySelectorAll('.ev-comment-text').length, 2);
  assert.equal([...savedDocument.querySelectorAll('.ev-comment-text')].at(-1).textContent, 'line one\nline two');

  const reopened = loadApp(saved);
  assert.equal(reopened.document.querySelectorAll('.ev-comment').length, 2);
  assert.equal(reopened.document.querySelectorAll('.ev-comment-text')[1].textContent, 'line one\nline two');
  assert.ok(reopened.document.querySelector('[data-action="paste-after"]'));
  assert.equal(pasted.querySelector('.ev-comment-text').textContent, 'line one\nline two');
});

test('an armed external paste shows guidance at its insertion point and moves when retargeted', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const target = section.querySelector('.ev-comment');

  pasteAfter(target);

  let cue = document.querySelector('[role="status"]');
  assert.ok(cue, 'arming an external target shows a status placeholder');
  assert.equal(cue.textContent, 'Press Ctrl+V to paste from clipboard');
  assert.equal(target.nextElementSibling, cue, 'paste-after places the cue immediately after its row');
  assert.ok(cue.hasAttribute('data-chrome'), 'the cue is temporary document chrome');
  assert.equal(target.querySelector('[data-action="paste-after"]').dataset.clipboardTarget, 'paste-after');

  pasteHere(section);

  cue = document.querySelector('[role="status"]');
  assert.equal(section.querySelector(':scope > .ev-body').lastElementChild, cue,
    'paste-here moves the cue to the end of the selected section body');
  assert.equal(target.querySelector('[data-action="paste-after"]').hasAttribute('data-clipboard-target'), false,
    'retargeting clears the previous destination marker');
  assert.equal(sectionAction(section, 'paste-here').dataset.clipboardTarget, 'paste-here');
});

test('armed paste guidance spans the content panel and adapts its shortcut for macOS', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  pasteHere(section);
  const cue = document.querySelector('[role="status"]');
  assert.equal(cue.textContent, 'Press Ctrl+V to paste from clipboard');

  const styles = stylesheetRule(screenStyles(), '.ev-paste-target-pending');
  assert.match(styles, /box-sizing:\s*border-box/);
  assert.match(styles, /width:\s*100%/);
  assert.match(styles, /border:\s*1px dashed/);
  assert.match(styles, /border-radius:\s*6px/);
  assert.match(styles, /text-align:\s*center/);

  const mac = loadApp(undefined, {
    beforeParse(window) {
      Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' });
    },
  });
  const macSection = addFirstSection(mac.document);
  pasteHere(macSection);
  assert.equal(mac.document.querySelector('[role="status"]').textContent,
    'Press ⌘+V to paste from clipboard');
});

test('armed paste guidance clears on Escape and any paste attempt and stays out of saved evidence', async () => {
  const { document, window, downloads } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const target = section.querySelector('.ev-comment');

  pasteAfter(target);
  assert.ok(document.querySelector('.ev-paste-target-pending'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelector('.ev-paste-target-pending'), null);

  pasteAfter(target);
  const unrelatedPaste = runNativePaste(window, nativeClipboardData());
  assert.equal(unrelatedPaste.defaultPrevented, true, 'the armed target consumes unrelated content as before');
  assert.equal(document.querySelector('.ev-paste-target-pending'), null);
  assert.equal(target.querySelector('[data-action="paste-after"]').hasAttribute('data-clipboard-target'), false);

  pasteAfter(target);
  document.getElementById('save-btn').click();
  const saved = await downloadText(downloads.find((entry) => entry.name));
  assert.equal(new JSDOM(saved).window.document.querySelector('.ev-paste-target-pending'), null);
});
