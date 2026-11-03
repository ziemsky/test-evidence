import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  loadApp, addFirstSection, sectionAction, tick, createFileSystemEnv, waitFor,
  appSource, stubImagePipeline, pasteImage, documentHandleKey,
} from './helpers.js';

function captureOperationLogs(window) {
  const entries = [];
  window.__operationLogs = entries;
  window.console.log = (...parts) => entries.push(parts.join(' '));
  return entries;
}

test('save has no toolbar status display and logs its successful completion', async () => {
  const { window, document } = loadApp();
  const logs = captureOperationLogs(window);

  document.getElementById('save-btn').click();

  assert.equal(document.getElementById('mode-indicator'), null);
  assert.equal(document.getElementById('save-status'), null);
  assert.deepEqual(logs.map((line) => line.split(' — ')[0]), [
    'Operation started: Save',
    'Operation finished: Save',
  ]);
  assert.match(logs[1], /success/);
  assert.match(logs[1], /Downloaded /);
});

test('operation completions stay in the browser console without visual status elements', () => {
  const { window, document } = loadApp();
  const logs = captureOperationLogs(window);

  assert.equal(document.getElementById('operation-status'), null);
  document.getElementById('save-btn').click();

  assert.equal(document.getElementById('operation-status'), null,
    'completing an operation does not create a bottom status bar');
  assert.deepEqual(logs.map((line) => line.split(' — ')[0]), [
    'Operation started: Save',
    'Operation finished: Save',
  ]);
  assert.match(logs[1], /success/);
  assert.match(logs[1], /Downloaded /);
  assert.equal(document.getElementById('mode-indicator'), null);
  assert.equal(document.getElementById('save-status'), null);

  const serialized = new JSDOM(window.__evidence.serialize()).window.document;
  assert.equal(serialized.getElementById('save-status'), null,
    'toolbar controls are not persisted');
});

test('copy failure is categorized as an error and logged with its completion message', async () => {
  const { window, document } = loadApp();
  window.navigator.clipboard = { writeText: () => Promise.reject(new Error('NotAllowedError')) };
  const section = addFirstSection(document);
  const logs = captureOperationLogs(window);

  sectionAction(section, 'copy').click();
  await Promise.resolve();

  assert.equal(document.getElementById('save-status'), null);
  assert.equal(document.getElementById('operation-status'), null);
  assert.equal(logs.length, 2);
  assert.match(logs[0], /Operation started: Copy/);
  assert.match(logs[1], /Operation finished: Copy — error — Copy failed — NotAllowedError/);
});

test('an add operation logs its completion without a toolbar status display', async () => {
  const { window, document } = loadApp();
  const section = addFirstSection(document);
  const logs = captureOperationLogs(window);

  sectionAction(section, 'add-comment').click();
  await Promise.resolve();

  assert.equal(document.getElementById('save-status'), null);
  assert.match(logs[0], /Operation started: Add comment/);
  assert.match(logs[1], /Operation finished: Add comment — success —/);
});

test('paste, delete, and screenshot operations log categorized completions', async () => {
  const { window, document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const comment = section.querySelector('.ev-comment');
  const logs = captureOperationLogs(window);

  sectionAction(comment, 'copy-element').click();
  assert.equal(latestOperationResult(document).outcome, 'information');
  assert.match(logs[0], /Operation started: Copy element/);
  assert.match(logs[1], /Operation finished: Copy element — information — Copy ready/);

  logs.length = 0;
  sectionAction(comment, 'paste-after').click();
  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.match(logs[0], /Operation started: Paste/);
  assert.match(logs[1], /Operation finished: Paste — success — Pasted element/);

  logs.length = 0;
  section.querySelectorAll('.ev-comment')[1].querySelector('[data-action="delete"]').click();
  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.match(logs[0], /Operation started: Delete/);
  assert.match(logs[1], /Operation finished: Delete — success — Delete completed/);

  logs.length = 0;
  sectionAction(section, 'add-screenshot').click();
  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.match(logs[0], /Operation started: Add screenshot/);
  assert.match(logs[1], /Operation finished: Add screenshot — success/);

});

test('a successful attachment logs after the file has been written', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const section = addFirstSection(document);
  fs.env.sourceFile = new window.File(['evidence'], 'run.log');
  const logs = captureOperationLogs(window);

  sectionAction(section, 'add-file').click();
  await waitFor(() => latestOperationResult(document)?.message === 'File attached: run.log');

  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.deepEqual(logs, [
    'Operation started: Attach file',
    'Operation finished: Attach file — success — File attached: run.log',
  ]);
});

test('screenshot paste and file rename finish with their own operation results', async () => {
  const { window, document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-screenshot').click();
  stubImagePipeline(window);
  const logs = captureOperationLogs(window);

  pasteImage(window, document.body);
  await waitFor(() => latestOperationResult(document)?.message === 'Screenshot pasted');

  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.deepEqual(logs, [
    'Operation started: Paste screenshot',
    'Operation finished: Paste screenshot — success — Screenshot pasted',
  ]);

  const fs = createFileSystemEnv();
  fs.env.idbStores.add('handles');
  fs.env.idbHandles.set(documentHandleKey(), fs.env.pickedDir);
  const html = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>' +
      '<section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">Files</span></h2>' +
      '<div class="ev-body"><div class="ev-file"><a href="assets/run.log">run.log</a></div></div></section></main>',
  );
  const renamed = loadApp(html, { fs });
  fs.env.assetsFiles.set('run.log', new renamed.window.Blob(['logs']));
  renamed.window.prompt = () => 'run-renamed.log';
  await tick();
  const renameLogs = captureOperationLogs(renamed.window);

  renamed.document.querySelector('[data-action="rename-file"]').click();
  await waitFor(() => latestOperationResult(renamed.document)?.message.startsWith('Renamed'));

  assert.equal(latestOperationResult(renamed.document).outcome, 'success');
  assert.match(renameLogs[0], /Operation started: Rename file/);
  assert.match(renameLogs[1], /Operation finished: Rename file — success — Renamed/);
});
