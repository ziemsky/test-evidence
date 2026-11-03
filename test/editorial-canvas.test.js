import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionAction,
  addFirstSection,
  createFileSystemEnv,
  downloadText,
  loadApp,
  screenStyles,
  stylesheetRule,
  tick,
} from './helpers.js';

test('the page provides a bounded reading canvas with a wider media lane', () => {
  const css = screenStyles();
  const body = stylesheetRule(css, 'body');
  const evidence = stylesheetRule(css, '#evidence');
  const screenshots = stylesheetRule(css, '.ev-shot-row');

  assert.match(body, /max-width:\s*none/);
  assert.match(body, /box-sizing:\s*border-box/);
  assert.match(body, /--ev-reading-measure:\s*72ch/);
  assert.match(body, /--ev-media-measure:\s*960px/);
  assert.match(body, /--ev-content-column-width:\s*min\(100%,\s*var\(--ev-reading-measure\)\)/);
  assert.match(evidence, /width:\s*var\(--ev-content-column-width\)/);
  assert.match(evidence, /margin-left:\s*auto/);
  assert.match(evidence, /margin-right:\s*auto/);
  assert.match(screenshots, /width:\s*min\(var\(--ev-media-measure\),/);
  assert.match(screenshots, /max-width:\s*100%/);
});

test('the document title is a restrained, focused identity treatment', () => {
  const css = screenStyles();
  const title = stylesheetRule(css, '.ev-doc-title');
  const focus = stylesheetRule(css, '.ev-doc-title:focus-within');

  assert.match(title, /display:\s*table/);
  assert.match(title, /width:\s*fit-content/);
  assert.match(title, /max-width:\s*100%/);
  assert.match(title, /border-bottom:\s*1px solid/);
  assert.match(focus, /background:\s*var\(--ev-focus-surface\)/);
});

test('save, print, and appearance controls share one quiet utility strip', () => {
  const { document } = loadApp();
  const toolbar = document.getElementById('toolbar');
  const actions = toolbar.querySelector('.toolbar-actions');
  const utilities = toolbar.querySelector('.toolbar-utilities');

  assert.ok(actions, 'save controls are grouped');
  assert.ok(utilities, 'print and appearance controls are grouped');
  assert.ok(actions.contains(document.getElementById('save-btn')));
  assert.equal(document.getElementById('mode-indicator'), null);
  assert.equal(document.getElementById('save-status'), null);
  assert.ok(utilities.contains(document.getElementById('print-btn')));
  assert.ok(utilities.contains(document.getElementById('theme-toggle')));
});

test('content edits and additions warn on Save until the document is saved', async () => {
  const app = loadApp();
  const save = app.document.getElementById('save-btn');
  assert.equal(save.classList.contains('has-unsaved-changes'), false);
  assert.equal(save.hasAttribute('title'), false);

  addFirstSection(app.document);
  await tick();
  assert.equal(save.classList.contains('has-unsaved-changes'), true);
  save.click();
  await downloadText(app.downloads.at(-1));
  await tick();
  assert.equal(save.classList.contains('has-unsaved-changes'), false);
  assert.equal(save.title, 'There are no current unsaved changes.');

  const title = app.document.querySelector('.ev-doc-title-text');
  title.textContent = 'Changed title';
  title.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await tick();

  assert.equal(save.classList.contains('has-unsaved-changes'), true);
  assert.equal(save.title, 'Unsaved changes — save to keep your edits.');

  save.click();
  await downloadText(app.downloads.at(-1));
  await tick();

  assert.equal(save.classList.contains('has-unsaved-changes'), false);
  assert.equal(save.title, 'There are no current unsaved changes.');
});

test('a failed save keeps the unsaved warning until a later save succeeds', async () => {
  const fs = createFileSystemEnv();
  const app = loadApp(undefined, { fs });
  await tick();
  const save = app.document.getElementById('save-btn');
  const title = app.document.querySelector('.ev-doc-title-text');
  title.textContent = 'Needs saving';
  title.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await tick();

  fs.env.failNextWrite = 'Disk full';
  save.click();
  await tick();
  assert.equal(save.classList.contains('has-unsaved-changes'), true);
  assert.equal(save.title, 'Unsaved changes — save to keep your edits.');

  save.click();
  await tick();
  assert.equal(save.classList.contains('has-unsaved-changes'), false);
  assert.equal(save.title, 'There are no current unsaved changes.');
});

test('the canvas keeps editing and save/reload behavior unchanged', async () => {
  const first = loadApp();
  const section = addFirstSection(first.document);
  section.querySelector('.ev-title-text').textContent = 'Results';
  sectionAction(section, 'add-comment').click();
  const comment = section.querySelector('.ev-comment-text');
  comment.textContent = 'line one\nline two';
  comment.dispatchEvent(new first.window.Event('input', { bubbles: true }));

  first.document.getElementById('save-btn').click();
  const saved = await downloadText(first.downloads.find((entry) => entry.name));
  const second = loadApp(saved);
  assert.equal(second.document.querySelector('.ev-title-text').textContent, 'Results');
  assert.equal(second.document.querySelector('.ev-comment-text').textContent, 'line one\nline two');
  second.document.getElementById('save-btn').click();
  const roundTrip = await downloadText(second.downloads.find((entry) => entry.name));
  assert.equal(roundTrip, saved, 'the visual canvas treatment is absent from saved output');
});
