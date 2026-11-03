import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { addFirstSection, downloadText, loadApp, sectionAction } from './helpers.js';

function enterValue(window, input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function keydown(window, target, key) {
  target.dispatchEvent(new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  }));
}

test('+ url adds an editing row and focuses the URL field', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);

  const addUrl = sectionAction(section, 'add-url');
  assert.ok(addUrl, 'the section toolbox offers + url');
  assert.equal(addUrl.textContent, '+ url');
  addUrl.click();

  const row = section.querySelector(':scope > .ev-body > .ev-url');
  assert.ok(row, 'the row is appended to the section');
  assert.equal(row.querySelector('.ev-url-input').placeholder, 'URL...');
  assert.equal(row.querySelector('.ev-text-input').placeholder, 'Text...');
  assert.equal(document.activeElement, row.querySelector('.ev-url-input'));
});

test('Enter commits trimmed URL and text as a new-tab bullet link', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  const url = row.querySelector('.ev-url-input');
  const text = row.querySelector('.ev-text-input');
  enterValue(window, url, '  example.com/path  ');
  enterValue(window, text, '  Open the result  ');

  keydown(window, text, 'Enter');

  const link = row.querySelector(':scope > a');
  assert.equal(link.getAttribute('href'), 'https://example.com/path');
  assert.equal(link.textContent, 'Open the result');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener');
  assert.equal(row.hasAttribute('data-editing'), false);
});

test('a provided scheme is retained and an empty label displays the URL', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  enterValue(window, row.querySelector('.ev-url-input'), '  mailto:qa@example.com  ');
  keydown(window, row.querySelector('.ev-url-input'), 'Enter');

  const link = row.querySelector(':scope > a');
  assert.equal(link.getAttribute('href'), 'mailto:qa@example.com');
  assert.equal(link.textContent, 'mailto:qa@example.com');
});

test('clicking outside commits the row; Escape keeps a new empty URL row', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  enterValue(window, row.querySelector('.ev-url-input'), 'https://example.org');
  enterValue(window, row.querySelector('.ev-text-input'), 'Example');
  document.body.click();
  assert.equal(row.querySelector(':scope > a').textContent, 'Example');
  assert.equal(row.hasAttribute('data-editing'), false);

  sectionAction(section, 'add-url').click();
  const emptyRow = section.querySelectorAll('.ev-url')[1];
  keydown(window, emptyRow.querySelector('.ev-url-input'), 'Escape');
  assert.ok(emptyRow.isConnected, 'Escape keeps the new row');
  assert.equal(emptyRow.querySelector(':scope > .ev-url-empty').textContent, 'URL...');
  assert.ok(emptyRow.hasAttribute('data-print-hidden'));
});

test('moving focus between URL fields does not exit edit mode', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  const url = row.querySelector('.ev-url-input');
  const text = row.querySelector('.ev-text-input');

  text.focus();
  assert.ok(row.hasAttribute('data-editing'));
  url.focus();
  assert.ok(row.hasAttribute('data-editing'));
});

test('empty URL rows are omitted from print output', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  const textInput = row.querySelector('.ev-text-input');
  textInput.value = 'Text without a URL';
  textInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.body.click();

  assert.ok(row.hasAttribute('data-print-hidden'));
  assert.equal(row.querySelector(':scope > .ev-url-empty').textContent, 'URL...');
  assert.equal(row.getAttribute('data-text'), 'Text without a URL');
  const printCss = document.querySelector('style').textContent.split('@media print')[1];
  assert.match(printCss, /\.ev-url\[data-print-hidden\]/);
});

test('printing a row while editing commits it to display mode', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  enterValue(window, row.querySelector('.ev-url-input'), 'https://evidence.example');

  window.dispatchEvent(new window.Event('beforeprint'));

  assert.equal(row.hasAttribute('data-editing'), false);
  assert.equal(row.querySelector(':scope > .ev-url-link').getAttribute('href'), 'https://evidence.example');
  assert.equal(row.hasAttribute('data-print-hidden'), false);
});

test('URL rows survive save and reload without editor chrome', async () => {
  const first = loadApp();
  const section = addFirstSection(first.document);
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  enterValue(first.window, row.querySelector('.ev-url-input'), ' https://evidence.example/case ');
  enterValue(first.window, row.querySelector('.ev-text-input'), ' Case evidence ');
  first.document.getElementById('save-btn').click();
  const saved = await downloadText(first.downloads.find((entry) => entry.name));
  const savedDocument = new JSDOM(saved).window.document;

  assert.equal(savedDocument.querySelectorAll('[data-chrome]').length, 0);
  assert.equal(savedDocument.querySelectorAll('.ev-url-input, .ev-text-input').length, 0);
  const second = loadApp(saved);
  const savedRow = second.document.querySelector('.ev-url');
  const link = savedRow.querySelector(':scope > a');
  assert.equal(link.getAttribute('href'), 'https://evidence.example/case');
  assert.equal(link.textContent, 'Case evidence');
  assert.equal(savedRow.getAttribute('data-text'), 'Case evidence');
});

test('URL toolbox offers edit first, then copy, copy element, and delete', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  enterValue(window, row.querySelector('.ev-url-input'), 'https://evidence.example');
  enterValue(window, row.querySelector('.ev-text-input'), 'Evidence');
  keydown(window, row.querySelector('.ev-text-input'), 'Enter');

  const inlineControls = row.querySelector(':scope > .ev-controls');
  assert.equal(window.getComputedStyle(inlineControls).display, 'none');

  const link = row.querySelector(':scope > .ev-url-link');
  const context = new window.MouseEvent('contextmenu', { bubbles: true, button: 2 });
  link.dispatchEvent(context);
  const palette = document.querySelector('#evidence > .ev-section-palette');
  assert.equal(palette.hasAttribute('data-palette-visible'), true);
  assert.equal(palette.querySelector(':scope > .ev-section-palette-header').textContent, 'URL');
  assert.deepEqual(
    [...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action),
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'edit', 'copy', 'copy-element', 'delete'],
  );
});

test('editing a saved URL focuses its URL field and Escape restores both saved values', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  enterValue(window, row.querySelector('.ev-url-input'), 'https://saved.example');
  enterValue(window, row.querySelector('.ev-text-input'), 'Saved label');
  keydown(window, row.querySelector('.ev-text-input'), 'Enter');
  row.querySelector(':scope > .ev-url-link').dispatchEvent(
    new window.MouseEvent('contextmenu', { bubbles: true, button: 2 }),
  );
  document.querySelector('[data-section-palette] [data-action="edit"]').click();

  const url = row.querySelector('.ev-url-input');
  const text = row.querySelector('.ev-text-input');
  assert.equal(document.activeElement, url);
  assert.equal(url.value, 'https://saved.example');
  assert.equal(text.value, 'Saved label');
  enterValue(window, url, 'https://changed.example');
  enterValue(window, text, 'Changed label');
  keydown(window, text, 'Escape');

  assert.equal(row.hasAttribute('data-editing'), false);
  assert.equal(row.querySelector(':scope > .ev-url-link').getAttribute('href'), 'https://saved.example');
  assert.equal(row.querySelector(':scope > .ev-url-link').textContent, 'Saved label');
  assert.equal(row.isConnected, true);
});

test('editing commits when focus leaves the row and retains edit mode between fields', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  enterValue(window, row.querySelector('.ev-url-input'), 'https://before.example');
  keydown(window, row.querySelector('.ev-url-input'), 'Enter');
  row.querySelector(':scope > .ev-url-link').dispatchEvent(
    new window.MouseEvent('contextmenu', { bubbles: true, button: 2 }),
  );
  document.querySelector('[data-section-palette] [data-action="edit"]').click();
  const url = row.querySelector('.ev-url-input');
  const text = row.querySelector('.ev-text-input');
  text.focus();
  assert.equal(row.hasAttribute('data-editing'), true);
  enterValue(window, url, ' https://after.example ');
  enterValue(window, text, ' After ');
  section.querySelector(':scope > .ev-title > .ev-title-text').focus();

  assert.equal(row.hasAttribute('data-editing'), false);
  assert.equal(row.querySelector(':scope > .ev-url-link').getAttribute('href'), 'https://after.example');
  assert.equal(row.querySelector(':scope > .ev-url-link').textContent, 'After');
});

test('copy copies the saved URL; copy element preserves URL and display text when pasted', async () => {
  const { document, window } = loadApp();
  const writes = [];
  window.navigator.clipboard = { writeText: (text) => { writes.push(text); return Promise.resolve(); } };
  const section = addFirstSection(document);
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  enterValue(window, row.querySelector('.ev-url-input'), 'https://evidence.example/case');
  enterValue(window, row.querySelector('.ev-text-input'), 'Case evidence');
  keydown(window, row.querySelector('.ev-text-input'), 'Enter');
  sectionAction(section, 'add-comment').click();
  const comment = section.querySelector('.ev-comment');
  comment.querySelector('.ev-comment-text').textContent = 'Paste target';
  row.querySelector(':scope > .ev-url-link').dispatchEvent(
    new window.MouseEvent('contextmenu', { bubbles: true, button: 2 }),
  );
  const palette = document.querySelector('[data-section-palette]');
  palette.querySelector('[data-action="copy"]').click();
  await Promise.resolve();
  assert.deepEqual(writes, ['https://evidence.example/case']);

  row.querySelector(':scope > .ev-url-link').dispatchEvent(
    new window.MouseEvent('contextmenu', { bubbles: true, button: 2 }),
  );
  palette.querySelector('[data-action="copy-element"]').click();
  sectionAction(comment, 'paste-after').click();
  const pasted = [...section.querySelectorAll(':scope > .ev-body > .ev-url')].at(-1);
  assert.ok(pasted !== row);
  assert.equal(pasted.querySelector(':scope > .ev-url-link').getAttribute('href'), 'https://evidence.example/case');
  assert.equal(pasted.querySelector(':scope > .ev-url-link').textContent, 'Case evidence');
});

test('deleting a URL row asks for confirmation and only removes it when accepted', () => {
  const { document, window } = loadApp();
  const confirmationMessages = [];
  let confirmDeletion = false;
  window.confirm = (message) => {
    confirmationMessages.push(message);
    return confirmDeletion;
  };
  const section = addFirstSection(document);
  section.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Keep section';
  sectionAction(section, 'add-comment').click();
  section.querySelector('.ev-comment-text').textContent = 'Keep comment';
  sectionAction(section, 'add-url').click();
  const row = section.querySelector('.ev-url');
  enterValue(window, row.querySelector('.ev-url-input'), 'https://remove.example');
  keydown(window, row.querySelector('.ev-url-input'), 'Enter');
  row.querySelector(':scope > .ev-url-link').dispatchEvent(
    new window.MouseEvent('contextmenu', { bubbles: true, button: 2 }),
  );

  document.querySelector('[data-section-palette] [data-action="delete"]').click();

  assert.deepEqual(confirmationMessages, ['Delete this URL row?']);
  assert.equal(row.isConnected, true, 'declining keeps the URL row');
  assert.equal(section.querySelector('.ev-comment-text').textContent, 'Keep comment');
  assert.equal(section.querySelector(':scope > .ev-title > .ev-title-text').textContent, 'Keep section');

  confirmDeletion = true;
  row.querySelector(':scope > .ev-url-link').dispatchEvent(
    new window.MouseEvent('contextmenu', { bubbles: true, button: 2 }),
  );
  document.querySelector('[data-section-palette] [data-action="delete"]').click();

  assert.deepEqual(confirmationMessages, ['Delete this URL row?', 'Delete this URL row?']);
  assert.equal(row.isConnected, false);
  assert.equal(section.querySelector('.ev-comment-text').textContent, 'Keep comment');
  assert.equal(section.querySelector(':scope > .ev-title > .ev-title-text').textContent, 'Keep section');
});
