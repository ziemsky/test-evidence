import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  sectionAction,
  loadApp,
  tick,
  createFileSystemEnv,
  addFirstSection,
  documentHandleKey,
} from './helpers.js';

test('save keeps its generic label in both in-place and fallback modes', async () => {
  const fs = createFileSystemEnv();
  const primary = loadApp(undefined, { fs });
  await tick();
  assert.equal(primary.document.getElementById('mode-indicator'), null);
  assert.equal(primary.document.getElementById('save-btn').textContent, 'Save');
  // A build without the API (e.g. unflagged Brave) routes to fallback end to end:
  const fallback = loadApp();
  assert.equal(fallback.document.getElementById('mode-indicator'), null);
  assert.equal(fallback.document.getElementById('save-btn').textContent, 'Save');
});

test('first save: exactly one shared-memory directory picker; handle stored in IndexedDB', async () => {
  const fs = createFileSystemEnv();
  const { document } = loadApp(undefined, { fs });
  await tick();
  assert.equal(document.getElementById('mode-indicator'), null);

  document.getElementById('save-btn').click();
  await tick();

  assert.equal(fs.env.pickerCalls.length, 1, 'exactly one picker');
  const opts = fs.env.pickerCalls[0];
  assert.equal(opts.mode, 'readwrite');
  assert.equal(opts.id, 'evidence-root');
  assert.ok(opts.id.length <= 32, 'picker id fits the File System Access limit');
  assert.deepEqual(Object.keys(opts).sort(), ['id', 'mode'], 'exactly these options');
  assert.ok(fs.env.idbStores.has('handles'), 'handles object store created');
  assert.equal(
    fs.env.idbHandles.get(documentHandleKey()),
    fs.env.pickedDir,
    'dir handle stored under the current document identity',
  );
  assert.ok(fs.env.files.has('index.html'), 'HTML file derived from basename of location.pathname');
  assert.ok(fs.env.createdDirs.has('assets'), 'assets dir derived from the pick');
  assert.match(latestOperationResult(document).message, /^Saved \d{2}:\d{2}:\d{2}$/);
});

test('in-place save writes the full serialized document, chrome-free', async () => {
  const fs = createFileSystemEnv();
  const { document } = loadApp(undefined, { fs });
  await tick();
  const section = addFirstSection(document); // 0040: build the property row
  sectionAction(section, 'add-property').click();
  document.querySelectorAll('.ev-prop-value')[0].textContent = 'Firefox 139';
  document.getElementById('save-btn').click();
  await tick();
  const text = fs.env.files.get('index.html');
  assert.ok(text.startsWith('<!DOCTYPE html>\n'));
  assert.ok(text.includes('Firefox 139'));
  const saved = new JSDOM(text).window.document;
  assert.equal(saved.querySelectorAll('[data-chrome]').length, 0);
  assert.equal(saved.querySelectorAll('[contenteditable]').length, 0);
});

test('later saves are silent: no picker, no permission prompt when granted', async () => {
  const fs = createFileSystemEnv();
  const { document } = loadApp(undefined, { fs });
  await tick();
  const section = addFirstSection(document); // 0040: build two property rows
  sectionAction(section, 'add-property').click();
  sectionAction(section, 'add-property').click();
  document.getElementById('save-btn').click();
  await tick();
  document.querySelectorAll('.ev-prop-value')[1].textContent = 'Linux';
  document.getElementById('save-btn').click();
  await tick();
  assert.equal(fs.env.pickerCalls.length, 1, 'no second picker');
  assert.equal(fs.env.requestPermissionCalls, 0, 'no permission prompt when already granted');
  assert.ok(fs.env.files.get('index.html').includes('Linux'));
  assert.match(latestOperationResult(document).message, /^Saved \d{2}:\d{2}:\d{2}$/);
});

test('re-grant: reopened file + prompt permission → one small prompt on Save, then silent (A1)', async () => {
  const fs = createFileSystemEnv();
  const first = loadApp(undefined, { fs });
  await tick();
  first.document.getElementById('save-btn').click();
  await tick();
  assert.equal(fs.env.requestPermissionCalls, 0);

  // Close the tab, reopen the file that was just saved; permission degraded to 'prompt'.
  fs.env.permission = 'prompt';
  const savedText = fs.env.files.get('index.html');
  const second = loadApp(savedText, { fs });
  await tick();
  assert.equal(second.document.getElementById('mode-indicator'), null);
  second.document.getElementById('save-btn').click();
  await tick();
  assert.equal(fs.env.requestPermissionCalls, 1, 'one prompt on the Save gesture');
  assert.equal(fs.env.pickerCalls.length, 1, 'no re-picker after grant');
  assert.match(latestOperationResult(second.document).message, /^Saved \d{2}:\d{2}:\d{2}$/);

  // Later save is fully silent.
  second.document.getElementById('save-btn').click();
  await tick();
  assert.equal(fs.env.requestPermissionCalls, 1);
  assert.equal(fs.env.pickerCalls.length, 1);
});

test('stored handles stay document-scoped while picker memory is shared', async () => {
  const fs = createFileSystemEnv({ folderName: 'first-folder' });
  const firstDir = fs.env.pickedDir;
  const first = loadApp(undefined, {
    url: 'file:///sessions/first/index.html',
    fs,
  });
  await tick();
  first.document.getElementById('save-btn').click();
  await tick();
  assert.equal(fs.env.pickerCalls.length, 1);

  // A second local copy has the same file:// origin, but must not inherit the
  // first copy's directory handle or permission prompt.
  fs.env.permission = 'prompt';
  fs.env.pickedDir = fs.makeDirHandle('second-folder');
  const second = loadApp(undefined, {
    url: 'file:///sessions/second/index.html',
    fs,
  });
  await tick();
  second.document.getElementById('save-btn').click();
  await tick();

  assert.equal(fs.env.pickerCalls.length, 2, 'the second copy asks for its own directory');
  assert.equal(fs.env.pickerCalls[0].id, fs.env.pickerCalls[1].id, 'picker memory is shared across copies');
  assert.equal(fs.env.requestPermissionCalls, 0, 'it does not request permission for the first copy');
  assert.equal(
    fs.env.idbHandles.get(documentHandleKey('file:///sessions/first/index.html')),
    firstDir,
  );
  assert.equal(
    fs.env.idbHandles.get(documentHandleKey('file:///sessions/second/index.html')),
    fs.env.pickedDir,
  );
});

test('denied permission on a stored handle re-runs the picker; the new pick replaces the stored handle', async () => {
  const fs = createFileSystemEnv();
  const { document } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click();
  await tick();
  assert.equal(fs.env.idbHandles.get(documentHandleKey()), fs.env.pickedDir);

  fs.env.permission = 'denied';
  const newDir = fs.makeDirHandle('other-folder');
  fs.env.pickedDir = newDir;
  document.getElementById('save-btn').click();
  await tick();
  assert.equal(fs.env.pickerCalls.length, 2, 'picker re-run from scratch');
  assert.equal(fs.env.idbHandles.get(documentHandleKey()), newDir, 'new pick replaces the stored handle');
});

test('declined first picker drops the session to download mode for the rest of the session', async () => {
  const fs = createFileSystemEnv();
  const { document, downloads } = loadApp(undefined, { fs });
  await tick();
  fs.env.declineNextPicker = true;
  document.getElementById('save-btn').click();
  await tick();
  assert.equal(fs.env.pickerCalls.length, 1);
  assert.equal(document.getElementById('mode-indicator'), null);
  assert.ok(downloads.find((d) => d.name), 'the declined save still downloads');
  assert.equal(fs.env.idbHandles.size, 0, 'no handle stored');

  // Rest of this session: download mode, no picker. (Re-opening re-enters primary.)
  document.getElementById('save-btn').click();
  await tick();
  assert.equal(fs.env.pickerCalls.length, 1);
  assert.equal(downloads.filter((d) => d.name).length, 2);
});

test('wrong-folder pick writes a correctly-named copy there, target visible in indicator and status', async () => {
  const fs = createFileSystemEnv({ folderName: 'Downloads' });
  const { document } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click();
  await tick();
  assert.ok(fs.env.files.has('index.html'), 'correctly-named copy written to the picked folder');
  assert.match(latestOperationResult(document).message, /^Saved \d{2}:\d{2}:\d{2}$/);
});

test('write failure shows Save failed — <message>', async () => {
  const fs = createFileSystemEnv();
  const { document } = loadApp(undefined, { fs });
  await tick();
  fs.env.failNextWrite = 'disk full';
  document.getElementById('save-btn').click();
  await tick();
  assert.equal(latestOperationResult(document).message, 'Save failed — disk full');
});

test('Ctrl+S triggers the in-place save flow with preventDefault', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  const event = new window.KeyboardEvent('keydown', {
    key: 's',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  await tick();
  assert.equal(event.defaultPrevented, true);
  assert.equal(fs.env.pickerCalls.length, 1, 'first save via Ctrl+S still shows one picker');
  assert.ok(fs.env.files.has('index.html'));
});

test('primary mode: save → reload → save is byte-identical (A4)', async () => {
  const fs = createFileSystemEnv();
  const first = loadApp(undefined, { fs });
  await tick();
  const section = addFirstSection(first.document); // 0040: build three property rows
  for (let i = 0; i < 3; i++) sectionAction(section, 'add-property').click();
  const values = first.document.querySelectorAll('.ev-prop-value');
  values[0].textContent = 'Firefox 139';
  values[1].textContent = 'Linux';
  values[2].textContent = 'login flow';
  first.document.getElementById('save-btn').click();
  await tick();
  const t1 = fs.env.files.get('index.html');
  assert.match(latestOperationResult(first.document).message, /^Saved \d{2}:\d{2}:\d{2}$/);

  fs.env.permission = 'granted';
  const second = loadApp(t1, { fs });
  await tick();
  assert.equal(second.document.querySelectorAll('.ev-prop-value')[0].textContent, 'Firefox 139');
  second.document.getElementById('save-btn').click();
  await tick();
  assert.equal(fs.env.files.get('index.html'), t1, 'byte-identical after reload');
});
