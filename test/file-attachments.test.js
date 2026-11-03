import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  sectionAction,
  addFirstSection,
  appSource,
  createFileSystemEnv,
  loadApp,
  tick,
  waitFor,
  documentHandleKey,
} from './helpers.js';

// 0059 seams: the section + file control, the browser picker/file-system
// boundaries, and the resulting authored file row/link.

const OVERWRITE_WARNING = (filename) =>
  `An asset named "${filename}" already exists. Overwrite it? Existing evidence that links to this name will use the replacement. Consider renaming the file before adding it.`;

test('an on-disk asset collision shows the exact warning and declining is a silent no-op', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const section = addFirstSection(document);
  const original = new window.Blob(['original bytes']);
  fs.env.assetsFiles.set('shared.dat', original);
  fs.env.sourceFile = new window.File(['replacement bytes'], 'shared.dat');
  const confirmations = [];
  window.confirm = (message) => {
    confirmations.push(message);
    return false;
  };

  sectionAction(section, 'add-file').click();
  await waitFor(() => confirmations.length === 1);
  await tick();

  assert.deepEqual(confirmations, [OVERWRITE_WARNING('shared.dat')]);
  assert.equal(fs.env.assetsFiles.get('shared.dat'), original, 'existing bytes are untouched');
  assert.equal(section.querySelector('.ev-file'), null, 'no authored row is appended');
  assert.equal(latestOperationResult(document).message, 'Attach file cancelled');
  assert.equal(latestOperationResult(document).outcome, 'information');
  assert.equal(fs.env.files.size, 0, 'the HTML document is not saved');
});

test('confirmed overwrites replace shared asset bytes and append duplicate file references', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const section = addFirstSection(document);
  fs.env.sourceFile = new window.File(['first'], 'shared.txt');
  sectionAction(section, 'add-file').click();
  await waitFor(() => section.querySelectorAll('.ev-file').length === 1);

  const confirmations = [];
  window.confirm = (message) => {
    confirmations.push(message);
    return true;
  };
  fs.env.sourceFile = new window.File(['second'], 'shared.txt');
  sectionAction(section, 'add-file').click();
  await waitFor(() => section.querySelectorAll('.ev-file').length === 2);

  assert.deepEqual(confirmations, [OVERWRITE_WARNING('shared.txt')]);
  assert.equal(await fs.env.assetsFiles.get('shared.txt').text(), 'second');
  assert.deepEqual(
    [...section.querySelectorAll('.ev-file > a')].map((link) => link.getAttribute('href')),
    ['assets/shared.txt', 'assets/shared.txt'],
    'both authored rows resolve through the replaced shared path',
  );
  assert.equal(latestOperationResult(document).message, 'File attached: shared.txt');
  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.equal(fs.env.files.size, 0, 'overwriting does not save the HTML document');
});

test('a failed confirmed replacement preserves existing bytes and authored evidence', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const section = addFirstSection(document);
  const body = section.querySelector(':scope > .ev-body');
  const original = new window.Blob(['original']);
  fs.env.assetsFiles.set('linked.pdf', original);
  body.appendChild(document.createRange().createContextualFragment(
    '<div class="ev-file"><a href="assets/linked.pdf" target="_blank" rel="noopener">linked.pdf</a></div>',
  ));
  const authoredBefore = body.innerHTML;
  fs.env.sourceFile = new window.File(['replacement'], 'linked.pdf');
  fs.env.failNextAssetClose = 'device unavailable';
  window.confirm = () => true;

  sectionAction(section, 'add-file').click();
  await waitFor(() => latestOperationResult(document)?.message.startsWith('File not added —'));

  assert.equal(fs.env.assetsFiles.get('linked.pdf'), original, 'replacement is committed only by close');
  assert.equal(body.innerHTML, authoredBefore, 'existing evidence remains and no row is appended');
  assert.equal(latestOperationResult(document).message, 'File not added — device unavailable');
  assert.equal(fs.env.files.size, 0, 'failure does not save the HTML document');
});

test('+ file acquires the evidence folder, copies the exact file, and appends an encoded link', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const section = addFirstSection(document);
  const bytes = new Uint8Array([0, 255, 17, 42]);
  fs.env.sourceFile = new window.File([bytes], 'report #1 (final).bin');

  sectionAction(section, 'add-file').click();
  await waitFor(() => section.querySelector('.ev-file'));

  assert.equal(fs.env.pickerCalls.length, 1);
  assert.equal(fs.env.pickerCalls[0].mode, 'readwrite');
  assert.equal(fs.env.pickerCalls[0].id, 'evidence-root');
  assert.equal(fs.env.idbHandles.get(documentHandleKey()), fs.env.pickedDir, 'picked folder is remembered');
  assert.equal(JSON.stringify(fs.env.sourcePickerCalls), JSON.stringify([{ multiple: false }]), 'one file, with no type filter');
  const stored = fs.env.assetsFiles.get('report #1 (final).bin');
  assert.deepEqual([...new Uint8Array(await stored.arrayBuffer())], [...bytes], 'source bytes are unchanged');

  const link = section.querySelector('.ev-file > a');
  assert.equal(link.textContent, 'report #1 (final).bin');
  assert.equal(link.getAttribute('href'), 'assets/report%20%231%20(final).bin');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener');
  assert.equal(latestOperationResult(document).message, 'File attached: report #1 (final).bin');
  assert.equal(latestOperationResult(document).outcome, 'success');
});

test('the persistent + file action creates a section on an empty document and appends the file there', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  fs.env.sourceFile = new window.File(['evidence bytes'], 'evidence.txt');

  const addFile = document.querySelector('#evidence > [data-add-toolbox] button[data-action="add-file"]');
  assert.ok(addFile);
  assert.equal(addFile.disabled, false, 'the persistent file action is available in primary mode');
  addFile.click();
  await waitFor(() => document.querySelector('#evidence > .ev-section > .ev-body > .ev-file'));

  const section = document.querySelector('#evidence > .ev-section');
  assert.equal(section.querySelector(':scope > .ev-body > .ev-file > a').textContent, 'evidence.txt');
  assert.equal(section.nextElementSibling, document.querySelector('#evidence > [data-add-toolbox]'));
});

test('+ file restores the remembered folder and requests permission before opening the source picker', async () => {
  const fs = createFileSystemEnv();
  fs.env.idbStores.add('handles');
  fs.env.idbHandles.set(documentHandleKey(), fs.env.pickedDir);
  fs.env.permission = 'prompt';
  fs.env.requestPermissionOutcome = 'granted';
  const { window, document } = loadApp(undefined, { fs });
  fs.env.sourceFile = new window.File(['restored'], 'restored.txt');
  const section = addFirstSection(document);
  await tick();

  sectionAction(section, 'add-file').click();
  await waitFor(() => section.querySelector('.ev-file'));

  assert.equal(fs.env.requestPermissionCalls, 1);
  assert.equal(fs.env.pickerCalls.length, 0, 'remembered folder avoids the folder picker');
  assert.equal(fs.env.sourcePickerCalls.length, 1);
});

test('cancelling either picker is a silent no-op, including after remembered permission is denied', async () => {
  const folderFs = createFileSystemEnv();
  folderFs.env.idbStores.add('handles');
  folderFs.env.idbHandles.set(documentHandleKey(), folderFs.env.pickedDir);
  folderFs.env.permission = 'prompt';
  folderFs.env.requestPermissionOutcome = 'denied';
  folderFs.env.declineNextPicker = true;
  const folderApp = loadApp(undefined, { fs: folderFs });
  const folderSection = addFirstSection(folderApp.document);
  await tick();

  sectionAction(folderSection, 'add-file').click();
  await tick();
  await tick();

  assert.equal(folderFs.env.requestPermissionCalls, 1);
  assert.equal(folderFs.env.pickerCalls.length, 1, 'denied remembered access offers the folder picker');
  assert.equal(folderFs.env.sourcePickerCalls.length, 0);
  assert.equal(folderSection.querySelector('.ev-file'), null);
  assert.equal(latestOperationResult(folderApp.document).message, 'Attach file cancelled');
  assert.equal(latestOperationResult(folderApp.document).outcome, 'information');
  assert.equal(folderApp.document.getElementById('mode-indicator'), null);

  const sourceFs = createFileSystemEnv();
  sourceFs.env.declineNextSourcePicker = true;
  const sourceApp = loadApp(undefined, { fs: sourceFs });
  const sourceSection = addFirstSection(sourceApp.document);
  sectionAction(sourceSection, 'add-file').click();
  await tick();
  await tick();

  assert.equal(sourceFs.env.sourcePickerCalls.length, 1);
  assert.equal(sourceSection.querySelector('.ev-file'), null);
  assert.equal(sourceFs.env.assetsFiles.size, 0);
  assert.equal(latestOperationResult(sourceApp.document).message, 'Attach file cancelled');
  assert.equal(latestOperationResult(sourceApp.document).outcome, 'information');
  assert.equal(sourceApp.document.getElementById('mode-indicator'), null);
});

test('+ file accepts an empty file without validation', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const section = addFirstSection(document);
  fs.env.sourceFile = new window.File([], 'empty');

  sectionAction(section, 'add-file').click();
  await waitFor(() => section.querySelector('.ev-file'));

  assert.equal(fs.env.assetsFiles.get('empty').size, 0);
  assert.equal(section.querySelector('.ev-file > a').textContent, 'empty');
});

test('a close failure leaves authored content unchanged and reports the failure', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const section = addFirstSection(document);
  const body = section.querySelector(':scope > .ev-body');
  fs.env.sourceFile = new window.File(['bytes'], 'broken.dat');
  fs.env.failNextAssetClose = 'disk full';

  sectionAction(section, 'add-file').click();
  await waitFor(() => latestOperationResult(document)?.message.startsWith('File not added —'));

  assert.equal(body.querySelector('.ev-file'), null, 'no authored row is appended');
  assert.equal(latestOperationResult(document).message, 'File not added — disk full');
  assert.equal(fs.env.files.size, 0, 'the HTML document was not automatically saved');
});

test('a non-cancellation folder-picker failure is reported without changing authored content', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const section = addFirstSection(document);
  await tick();
  window.showDirectoryPicker = () => Promise.reject(new Error('picker unavailable'));

  sectionAction(section, 'add-file').click();
  await waitFor(() => latestOperationResult(document)?.message.startsWith('File not added —'));

  assert.equal(section.querySelector('.ev-file'), null);
  assert.equal(latestOperationResult(document).message, 'File not added — picker unavailable');
});

test('every section places + file immediately after + screenshot and fallback disables it without hiding links', () => {
  const existing = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>
      <section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">Files</span></h2>
        <div class="ev-body"><div class="ev-file"><a href="assets/already%20saved.pdf" target="_blank" rel="noopener">already saved.pdf</a></div></div>
      </section></main>`,
  );
  const { document } = loadApp(existing);
  const top = document.querySelector('.ev-section');
  sectionAction(top, 'add-subsection').click();

  for (const section of document.querySelectorAll('.ev-section')) {
    const actions = [...document.querySelector('#evidence > .ev-section-palette').querySelectorAll(':scope > button')]
      .map((button) => button.dataset.action);
    assert.equal(actions.indexOf('add-file'), actions.indexOf('add-screenshot') + 1);
    const button = sectionAction(section, 'add-file');
    assert.equal(button.disabled, true);
    assert.equal(button.title, 'File attachments require File System Access');
  }

  const row = top.querySelector('.ev-file');
  assert.equal(row.querySelector('a').textContent, 'already saved.pdf');
  assert.equal(row.querySelector('a').getAttribute('href'), 'assets/already%20saved.pdf');
  assert.ok(row.querySelector(':scope > .ev-drag-handle[data-chrome]'), 'row chrome is restored');
});

test('+ file is disabled when the browser can pick the evidence folder but cannot pick an arbitrary source file', () => {
  const fs = createFileSystemEnv();
  const fsWithoutSourcePicker = {
    install(window) {
      fs.install(window);
      delete window.showOpenFilePicker;
    },
  };
  const { document } = loadApp(undefined, { fs: fsWithoutSourcePicker });
  const section = addFirstSection(document);
  const button = sectionAction(section, 'add-file');

  assert.equal(document.getElementById('mode-indicator'), null);
  assert.equal(button.disabled, true);
  assert.equal(button.title, 'File attachments require File System Access');
});

test('+ file preserves the previously focused field', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const section = addFirstSection(document);
  sectionAction(section, 'add-property').click();
  const field = section.querySelector('.ev-prop-value');
  const button = sectionAction(section, 'add-file');
  fs.env.sourceFile = new window.File(['x'], 'focus.txt');
  field.focus();

  const down = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  button.dispatchEvent(down);
  button.click();
  await waitFor(() => section.querySelector('.ev-file'));

  assert.equal(down.defaultPrevented, true, 'mouse activation does not focus the control');
  assert.equal(document.activeElement, field);
});

test('file rows save as clean authored links, regain chrome on reopen, and print without a URL suffix', async () => {
  const fs = createFileSystemEnv();
  const first = loadApp(undefined, { fs });
  const section = addFirstSection(first.document);
  fs.env.sourceFile = new first.window.File(['portable'], 'field notes.txt');

  sectionAction(section, 'add-file').click();
  await waitFor(() => section.querySelector('.ev-file'));
  assert.equal(fs.env.files.size, 0, 'adding the file does not save the HTML document');

  first.document.getElementById('save-btn').click();
  await waitFor(() => typeof fs.env.files.get('index.html') === 'string' && fs.env.files.get('index.html').includes('field notes.txt'));
  const savedText = fs.env.files.get('index.html');
  const saved = new JSDOM(savedText).window.document;
  const savedRow = saved.querySelector('.ev-file');
  assert.equal(savedRow.querySelectorAll('[data-chrome]').length, 0);
  assert.equal(savedRow.textContent, 'field notes.txt');
  assert.equal(savedRow.querySelector('a').outerHTML, '<a href="assets/field%20notes.txt" target="_blank" rel="noopener">field notes.txt</a>');

  const reopened = loadApp(savedText);
  assert.equal(reopened.document.querySelector('.ev-file > a').textContent, 'field notes.txt');
  assert.ok(reopened.document.querySelector('.ev-file > .ev-drag-handle[data-chrome]'));

  assert.match(
    appSource(),
    /@media print[\s\S]*?\.ev-file\s*>\s*a::after\s*\{\s*content:\s*none\s*!important;/,
    'print never appends the link URL',
  );
});
