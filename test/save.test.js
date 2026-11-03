import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  sectionAction,
  loadApp,
  downloadText,
  addFirstSection,
  createFileSystemEnv,
  tick,
} from './helpers.js';

test('boot renders the Save action without mode or status displays — no + section button (0023)', () => {
  const { document } = loadApp();
  const toolbar = document.getElementById('toolbar');
  assert.ok(toolbar, 'toolbar exists');
  assert.ok(toolbar.hasAttribute('data-chrome'), 'toolbar is chrome');
  assert.ok(document.getElementById('save-btn'));
  assert.ok(!document.getElementById('add-section-btn'), 'the toolbar + section button is retired');
  assert.ok(!toolbar.querySelector('.ev-add-section-btn'), 'no + section button in the toolbar');
  assert.equal(document.getElementById('mode-indicator'), null);
  assert.equal(document.getElementById('save-status'), null);
  assert.ok(!document.getElementById('evidence').contains(toolbar), 'toolbar is not inside the evidence root');
});

test('save stays labeled Save when download fallback is active', () => {
  const { document } = loadApp();
  assert.equal(document.getElementById('save-btn').textContent, 'Save');
});

test('save shows Saving... with its glow until an in-place save completes', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  addFirstSection(document);

  window.showDirectoryPicker = () => Promise.resolve(fs.env.pickedDir);

  const save = document.getElementById('save-btn');
  save.click();
  assert.equal(save.textContent, 'Saving...');
  assert.equal(save.classList.contains('has-unsaved-changes'), true);
  assert.equal(save.disabled, true);

  await tick();
  assert.equal(save.textContent, 'Saved');
  assert.equal(save.classList.contains('has-unsaved-changes'), false);
  assert.equal(save.disabled, false);
});

test('clicking Save downloads the whole file named after the file basename', async () => {
  const { document, downloads } = loadApp();
  const section = addFirstSection(document);
  section.querySelector(':scope > h2.ev-title > .ev-title-text').textContent = 'Results';
  document.getElementById('save-btn').click();
  const entry = downloads.find((d) => d.name);
  assert.ok(entry, 'a download happened');
  assert.equal(document.getElementById('save-btn').textContent, 'Saved');
  assert.equal(entry.name, 'index.html');
  const text = await downloadText(entry);
  assert.ok(text.startsWith('<!DOCTYPE html>\n'), 'serialized with doctype');
  assert.ok(text.includes('<main id="evidence">'), 'full document serialized');
  assert.ok(text.includes('Results'), 'evidence content present');
});

test('typed values are included in the saved file as readable plain HTML', async () => {
  const { document, downloads } = loadApp();
  const section = addFirstSection(document);
  for (let i = 0; i < 3; i++) sectionAction(section, 'add-property').click();
  const values = document.querySelectorAll('.ev-prop-value');
  values[0].textContent = 'Firefox 139.0.1';
  values[1].textContent = 'Linux';
  values[2].textContent = 'login flow';
  document.getElementById('save-btn').click();
  const text = await downloadText(downloads.find((d) => d.name));
  assert.ok(text.includes('Firefox 139.0.1'));
  assert.ok(text.includes('Linux'));
  assert.ok(text.includes('login flow'));
});

test('saved file contains no data-chrome elements and no contenteditable attributes', async () => {
  const { document, downloads } = loadApp();
  const section = addFirstSection(document);
  section.querySelector(':scope > h2.ev-title > .ev-title-text').textContent = 'Results';
  sectionAction(section, 'add-property').click();
  section.querySelector(':scope > .ev-body > .ev-property > .ev-prop-key').textContent = 'Tool';
  document.getElementById('save-btn').click();
  const text = await downloadText(downloads.find((d) => d.name));
  // Parse the saved file (scripts not executed) and assert structurally:
  const saved = new JSDOM(text).window.document;
  assert.equal(saved.querySelectorAll('[data-chrome]').length, 0, 'no data-chrome elements');
  assert.equal(saved.querySelectorAll('[contenteditable]').length, 0, 'no contenteditable attributes');
  // and the content is readable, greppable plain HTML:
  assert.ok(text.includes('>Results<') || text.includes('>Results '), 'title visible as plain HTML');
  assert.match(text, />Tool</);
  assert.match(text, /<main id="evidence"/);
});

test('Ctrl+S saves and is preventDefault-ed', async () => {
  const { document, window, downloads } = loadApp();
  const event = new window.KeyboardEvent('keydown', {
    key: 's',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, 'Ctrl+S preventDefault');
  assert.ok(downloads.find((d) => d.name), 'download happened');
});

test('Cmd+S saves (mac)', async () => {
  const { document, window, downloads } = loadApp();
  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }),
  );
  assert.ok(downloads.find((d) => d.name), 'download happened');
});

test('plain "s" keydown does not save', async () => {
  const { document, window, downloads } = loadApp();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
  assert.equal(downloads.find((d) => d.name), undefined);
});

test('save status shows Downloaded HH:MM:SS after a save', async () => {
  const { document, downloads } = loadApp();
  document.getElementById('save-btn').click();
  assert.ok(downloads.find((d) => d.name));
  assert.match(latestOperationResult(document).message, /^Downloaded \d{2}:\d{2}:\d{2}$/);
});

test('reopening a saved file adopts its content exactly as-is', async () => {
  const first = loadApp();
  const section = addFirstSection(first.document);
  section.querySelector(':scope > h2.ev-title > .ev-title-text').textContent = 'Results';
  sectionAction(section, 'add-property').click();
  section.querySelector(':scope > .ev-body > .ev-property > .ev-prop-value').textContent = 'Brave 138';
  first.document.getElementById('save-btn').click();
  const savedText = await downloadText(first.downloads.find((d) => d.name));

  const second = loadApp(savedText);
  const adopted = second.document.querySelectorAll('.ev-prop-value');
  assert.equal(adopted[0].textContent, 'Brave 138');
  assert.equal(second.document.querySelectorAll('#evidence > .ev-section').length, 1);
  assert.equal(second.document.querySelector('.ev-title-text').textContent, 'Results');
});
