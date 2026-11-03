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

// 0061: file attachment controls and deletion. File rows gain the standard
// evidence-row interactions: focus wash, hover-revealed Copy/Delete
// controls, lossless filename copy, leaf-row reordering, and confirmed
// deletion of the shared asset plus every authored evidence item that
// references its path. Seams (pre-agreed, per prior art): the app's
// moveElement seam, the in-memory File System Access env, confirm() and
// clipboard stubs, and the embedded stylesheet's rule text (the focus/hover
// parity is also asserted through the shared focus-wash and hover-reveal
// suites' unit lists).

const CONFIRM_ONE = (filename) => `Delete file "${filename}" from this evidence and from assets?`;
const CONFIRM_MANY = (filename, count) =>
  `Delete file "${filename}" from assets and remove all ${count} references from this evidence?`;

const FILE_ROW = '<div class="ev-file"><a href="assets/notes.pdf" target="_blank" rel="noopener">notes.pdf</a></div>';

/** Load the app with one section whose body starts with the given row HTML. */
function loadWithBody(bodyHtml, fs) {
  return loadApp(appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>
      <section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">Files</span></h2>
        <div class="ev-body">${bodyHtml}</div>
      </section></main>`,
  ), fs ? { fs } : {});
}

function stubClipboard(window, { failMessage = null } = {}) {
  const calls = [];
  window.navigator.clipboard = {
    writeText: (text) => {
      calls.push(text);
      return failMessage ? Promise.reject(new Error(failMessage)) : Promise.resolve();
    },
  };
  return calls;
}

/** One file row whose link text and href match the given name/path. */
const fileRowHtml = (href, label) =>
  `<div class="ev-file"><a href="${href}" target="_blank" rel="noopener">${label}</a></div>`;

/**
 * Remember the picked folder in the env's IndexedDB BEFORE loadApp so
 * boot's initMode restores the handle and the default 'granted' permission
 * makes disk-backed deletion available (the 0059 restore pattern).
 */
function rememberFolder(fs) {
  fs.env.idbStores.add('handles');
  fs.env.idbHandles.set(documentHandleKey(), fs.env.pickedDir);
}

// ---------------------------------------------------------------------
// Chrome: the standard row shape, restored on boot and across save/reopen
// ---------------------------------------------------------------------

test('a file row has the drag handle, filename link, and controls as row chrome', () => {
  const { document } = loadWithBody(FILE_ROW);
  const row = document.querySelector('.ev-file');
  const children = [...row.children];

  assert.ok(children[0].matches('.ev-drag-handle[data-chrome]'), 'the standard chrome drag handle leads the row');
  assert.ok(children[1].matches('a'), 'the filename hyperlink follows the handle');
  const controls = children[2];
  assert.ok(controls.matches('.ev-controls[data-chrome]'), 'the control span follows the link');
  assert.deepEqual(
    [...controls.children].map((b) => b.dataset.action),
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'rename-file', 'copy', 'paste-after', 'delete'],
    'the six content adds lead, followed by the standard file controls (§27/§29)',
  );
  assert.equal(children.length, 3, 'no other children in the row');
});

test('file rows added through + file and file rows reopened from a saved file regain copy/delete', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const section = addFirstSection(document);
  fs.env.sourceFile = new window.File(['portable'], 'field notes.txt');

  sectionAction(section, 'add-file').click();
  await waitFor(() => section.querySelector('.ev-file'));
  assert.deepEqual(
    [...section.querySelector('.ev-file > .ev-controls').children].map((b) => b.dataset.action),
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'rename-file', 'copy', 'paste-after', 'delete'],
    'a freshly added file row carries the standard controls',
  );

  document.getElementById('save-btn').click();
  await waitFor(() => typeof fs.env.files.get('index.html') === 'string' && fs.env.files.get('index.html').includes('field notes.txt'));
  const savedText = fs.env.files.get('index.html');
  const saved = new JSDOM(savedText).window.document;
  assert.equal(saved.querySelector('.ev-file').querySelectorAll('[data-chrome]').length, 0, 'the controls are chrome — stripped on save');
  assert.equal(saved.querySelector('.ev-file a').outerHTML, '<a href="assets/field%20notes.txt" target="_blank" rel="noopener">field notes.txt</a>');

  const reopened = loadApp(savedText);
  assert.deepEqual(
    [...reopened.document.querySelector('.ev-file > .ev-controls').children].map((b) => b.dataset.action),
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'rename-file', 'copy', 'paste-after', 'delete'],
    'the controls are restored on reopen',
  );
  assert.ok(reopened.document.querySelector('.ev-file > .ev-drag-handle[data-chrome]'));
});

// ---------------------------------------------------------------------
// Copy: the exact displayed filename, with the shared status feedback
// ---------------------------------------------------------------------

test('file copy writes the exact displayed filename — never the encoded URL or the bytes', async () => {
  const { window, document } = loadWithBody(
    fileRowHtml('assets/report%20%231%20(final).bin', 'report #1 (final).bin'),
  );
  const calls = stubClipboard(window);
  const row = document.querySelector('.ev-file');

  sectionAction(row, 'copy').click();
  await Promise.resolve();

  assert.deepEqual(calls, ['report #1 (final).bin'], 'the displayed filename, byte for byte');
  assert.match(latestOperationResult(document).message, /^Copied \d{2}:\d{2}:\d{2}$/, 'success reports Copied HH:MM:SS');
});

test('a failed file copy reports Copy failed — <message> through the shared status area', async () => {
  const { window, document } = loadWithBody(FILE_ROW);
  stubClipboard(window, { failMessage: 'NotAllowedError' });

  document.querySelector('.ev-file [data-action="copy"]').click();
  await Promise.resolve();

  assert.equal(latestOperationResult(document).message, 'Copy failed — NotAllowedError');
});

// ---------------------------------------------------------------------
// Focus wash parity (the hover-reveal parity rides on the hover-reveal
// suite's REVEALED_UNITS, extended for .ev-file)
// ---------------------------------------------------------------------

test('the file row takes the row-level focus wash while any of its controls hold focus', () => {
  const { document } = loadWithBody(FILE_ROW);
  const row = document.querySelector('.ev-file');

  sectionAction(row, 'copy').focus();
  assert.ok(row.matches(':focus-within'), 'the row is focus-within while its copy button is focused');
  sectionAction(row, 'delete').focus();
  assert.ok(row.matches(':focus-within'), 'the wash stays on through the delete-confirmation moment');
});

// ---------------------------------------------------------------------
// Reordering: file rows are ordinary leaf rows
// ---------------------------------------------------------------------

test('a file row reorders within a section body and across sections through the move seam', () => {
  const { document } = loadWithBody(
    FILE_ROW +
    '<section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">Second</span></h2><div class="ev-body"></div></section>',
  );
  const move = document.defaultView.__evidence.moveElement;
  const body = document.querySelector('.ev-section > .ev-body');
  const otherBody = document.querySelectorAll('.ev-body')[1];
  const comment = document.createElement('div');
  comment.className = 'ev-comment';
  body.appendChild(comment);

  const row = body.querySelector('.ev-file');

  assert.equal(move(row, body, comment), true, 'within-section reorder is accepted');
  assert.equal(row.nextElementSibling, comment, 'the row landed before the comment');

  assert.equal(move(row, otherBody, null), true, 'cross-section reorder is accepted');
  assert.equal(otherBody.querySelector('.ev-file'), row, 'the row landed in the other section body');
  assert.equal(document.querySelectorAll('.ev-num').length, 2, 'numbering still covers both sections');
});

test('a file row is rejected at the top level and splits a screenshot row it lands inside', () => {
  const { document } = loadWithBody(
    '<div class="ev-shot-row">' +
    '<div class="ev-screenshot"><img class="ev-img" src="assets/shot-a.png" alt=""></div>' +
    '<div class="ev-screenshot"><img class="ev-img" src="assets/shot-b.png" alt=""></div>' +
    '</div>' +
    FILE_ROW,
  );
  const move = document.defaultView.__evidence.moveElement;
  const body = document.querySelector('.ev-body');
  const row = body.querySelector('.ev-file');
  const root = document.getElementById('evidence');

  assert.equal(move(row, root, null), false, 'the top level is never a leaf target');
  assert.equal(body.querySelector('.ev-file'), row, 'the row is still in its section body');

  const rowWrapper = body.querySelector('.ev-shot-row');
  const secondShot = rowWrapper.querySelectorAll('.ev-screenshot')[1];
  assert.equal(move(row, rowWrapper, secondShot), true, 'a file row dropped inside a row is a non-image drop');
  assert.deepEqual(
    [...body.children].map((el) => el.className),
    ['ev-shot-row', 'ev-file', 'ev-shot-row'],
    'first half, the file row, then the second half',
  );
  assert.equal(body.querySelectorAll('.ev-shot-row .ev-screenshot').length, 2, 'both shots survive the split');
});

// ---------------------------------------------------------------------
// Deletion: confirmed, asset-first, every reference
// ---------------------------------------------------------------------

test('a single reference confirms with the exact single wording, and declining changes nothing', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(FILE_ROW, fs);
  await tick(); // initMode restores the remembered handle
  const original = new window.Blob(['asset bytes']);
  fs.env.assetsFiles.set('notes.pdf', original);
  const confirmations = [];
  window.confirm = (message) => { confirmations.push(message); return false; };
  const body = document.querySelector('.ev-body');
  const bodyBefore = body.innerHTML;

  document.querySelector('.ev-file [data-action="delete"]').click();
  await waitFor(() => confirmations.length === 1);
  await tick(); // settles: nothing else follows a decline

  assert.deepEqual(confirmations, [CONFIRM_ONE('notes.pdf')], 'the exact single-reference wording');
  assert.equal(body.innerHTML, bodyBefore, 'declining changes nothing in the document');
  assert.equal(fs.env.assetsFiles.get('notes.pdf'), original, 'the asset is untouched');
  assert.equal(fs.env.removedAssets.length, 0);
  assert.equal(latestOperationResult(document).message, 'Delete cancelled');
  assert.equal(latestOperationResult(document).outcome, 'information');
  assert.equal(fs.env.files.size, 0, 'no save is triggered');
});

test('multiple references — file rows and a cross-type screenshot — confirm with the exact count wording', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(
    fileRowHtml('assets/shared.dat', 'shared.dat') +
    fileRowHtml('assets/shared.dat', 'shared.dat') +
    '<div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="assets/shared.dat" alt=""></div></div>',
    fs,
  );
  await tick(); // initMode restores the remembered handle
  fs.env.assetsFiles.set('shared.dat', new window.Blob(['x']));
  const confirmations = [];
  window.confirm = (message) => { confirmations.push(message); return false; };

  document.querySelector('.ev-file [data-action="delete"]').click();
  await waitFor(() => confirmations.length === 1);

  assert.deepEqual(confirmations, [CONFIRM_MANY('shared.dat', 3)], 'every authored reference counts, cross-type included');
  assert.equal(document.querySelectorAll('.ev-file').length, 2, 'decline: nothing removed');
});

test('confirming deletes the physical asset first and then every referencing evidence item', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(
    fileRowHtml('assets/shared.dat', 'shared.dat') +
    fileRowHtml('assets/shared.dat', 'shared.dat') +
    '<div class="ev-shot-row">' +
    '<div class="ev-screenshot"><img class="ev-img" src="assets/other.png" alt=""></div>' +
    '<div class="ev-screenshot"><img class="ev-img" src="assets/shared.dat" alt="the shared one"></div>' +
    '</div>',
    fs,
  );
  const original = new window.Blob(['shared bytes']);
  fs.env.assetsFiles.set('shared.dat', original);
  const other = new window.Blob(['other bytes']);
  fs.env.assetsFiles.set('other.png', other);
  window.confirm = () => true;
  await tick(); // initMode restores the remembered handle

  document.querySelector('.ev-file [data-action="delete"]').click();
  await waitFor(() => document.querySelectorAll('.ev-file').length === 0);

  assert.deepEqual(fs.env.removedAssets, ['shared.dat'], 'the shared asset is removed from disk');
  assert.equal(fs.env.assetsFiles.has('shared.dat'), false);
  assert.equal(fs.env.assetsFiles.get('other.png'), other, 'unrelated assets are untouched');
  assert.equal(document.querySelectorAll('.ev-file').length, 0, 'every file row referencing the path is removed');
  const row = document.querySelector('.ev-shot-row');
  assert.ok(row, 'the screenshot row keeps its remaining shot — it is not discarded');
  assert.equal(row.querySelectorAll('.ev-screenshot').length, 1);
  assert.equal(row.querySelector('img').getAttribute('src'), 'assets/other.png');
  assert.equal(latestOperationResult(document).message, 'File deleted: shared.dat');
  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.equal(fs.env.files.size, 0, 'deletion does not save the HTML document');
});

test('an emptied screenshot-row wrapper is cleaned up with the deleted shot', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(
    fileRowHtml('assets/solo.dat', 'solo.dat') +
    '<div class="ev-shot-row" data-valign="middle">' +
    '<div class="ev-screenshot"><img class="ev-img" src="assets/solo.dat" alt=""></div>' +
    '</div>',
    fs,
  );
  fs.env.assetsFiles.set('solo.dat', new window.Blob(['solo']));
  window.confirm = () => true;
  await tick(); // initMode restores the remembered handle

  document.querySelector('.ev-file [data-action="delete"]').click();
  await waitFor(() => document.querySelector('.ev-shot-row') === null);

  assert.equal(document.querySelector('.ev-file'), null);
  assert.equal(document.querySelector('.ev-shot-row'), null, 'the wrapper loses its last shot and is discarded');
  assert.deepEqual(fs.env.removedAssets, ['solo.dat']);
});

test('references in other sections are removed too — the match is document-wide', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadApp(appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>
      <section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">A</span></h2>
        <div class="ev-body">${fileRowHtml('assets/shared.dat', 'shared.dat')}</div>
      </section>
      <section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">B</span></h2>
        <div class="ev-body">
          <div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="assets/shared.dat" alt=""></div></div>
        </div>
      </section>
    </main>`,
  ), { fs });
  fs.env.assetsFiles.set('shared.dat', new window.Blob(['x']));
  window.confirm = (message) => message === CONFIRM_MANY('shared.dat', 2);
  await tick(); // initMode restores the remembered handle

  document.querySelector('.ev-file [data-action="delete"]').click();
  await waitFor(() => document.querySelector('.ev-file') === null);

  assert.equal(document.querySelectorAll('.ev-screenshot').length, 0, 'the cross-section screenshot reference is removed too');
  assert.equal(document.querySelectorAll('.ev-shot-row').length, 0, 'its row wrapper is cleaned up in its own section');
  assert.deepEqual(fs.env.removedAssets, ['shared.dat']);
  assert.equal(latestOperationResult(document).message, 'File deleted: shared.dat');
  assert.equal(latestOperationResult(document).outcome, 'success');
});

test('print keeps the file row — its chrome hidden, the linked filename only, no URL suffix', () => {
  const source = appSource();
  const print = source.slice(source.indexOf('@media print'));
  assert.match(print, /\[data-chrome\]:not\(\.ev-num\)[\s\S]*?display:\s*none !important;/, 'the handle and controls hide with every other chrome in print');
  assert.match(print, /\.ev-file\s*>\s*a::after\s*\{\s*content:\s*none !important;/, 'print never appends the link URL');
  const { document } = loadWithBody(FILE_ROW);
  assert.equal(document.querySelector('.ev-file').querySelector('a').textContent, 'notes.pdf', 'the linked filename is what prints');
});

test('a missing disk asset counts as a successful deletion', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(FILE_ROW, fs);
  // No assets/ entry for notes.pdf on disk.
  window.confirm = () => true;
  await tick(); // initMode restores the remembered handle

  document.querySelector('.ev-file [data-action="delete"]').click();
  await waitFor(() => document.querySelector('.ev-file') === null);

  assert.equal(fs.env.removedAssets.length, 0, 'there was nothing to remove');
  assert.ok(!fs.env.createdDirs.has('assets'), 'a missing asset does not create an empty assets/ directory as a side effect');
  assert.equal(latestOperationResult(document).message, 'File deleted: notes.pdf');
  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.equal(fs.env.files.size, 0);
});

test('a failed asset deletion retains every reference and reports the failure', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(
    fileRowHtml('assets/locked.dat', 'locked.dat') +
    fileRowHtml('assets/locked.dat', 'locked.dat'),
    fs,
  );
  const original = new window.Blob(['locked']);
  fs.env.assetsFiles.set('locked.dat', original);
  fs.env.failNextRemoveEntry = 'read-only file system';
  window.confirm = () => true;
  await tick(); // initMode restores the remembered handle

  document.querySelector('.ev-file [data-action="delete"]').click();
  await waitFor(() => latestOperationResult(document)?.message.startsWith('File not deleted —'));

  assert.equal(latestOperationResult(document).message, 'File not deleted — read-only file system');
  assert.equal(document.querySelectorAll('.ev-file').length, 2, 'every reference is retained');
  assert.equal(fs.env.assetsFiles.get('locked.dat'), original, 'the physical asset is untouched');
  assert.equal(fs.env.removedAssets.length, 0);
});

test('unobtainable permission follows the failure rule, in primary mode and in fallback mode', async () => {
  // Primary: the remembered handle exists but permission cannot be granted.
  const fs = createFileSystemEnv();
  fs.env.idbStores.add('handles');
  fs.env.idbHandles.set(documentHandleKey(), fs.env.pickedDir);
  fs.env.permission = 'denied';
  fs.env.requestPermissionOutcome = 'denied';
  const { window, document } = loadWithBody(FILE_ROW, fs);
  fs.env.assetsFiles.set('notes.pdf', new window.Blob(['kept']));
  window.confirm = () => true;
  await new Promise((r) => setTimeout(r, 0)); // let initMode restore the handle

  document.querySelector('.ev-file [data-action="delete"]').click();
  await waitFor(() => latestOperationResult(document)?.message.startsWith('File not deleted —'));

  assert.equal(latestOperationResult(document).message, 'File not deleted — permission not granted');
  assert.equal(document.querySelectorAll('.ev-file').length, 1, 'every reference is retained');
  assert.equal(fs.env.removedAssets.length, 0);
  assert.equal(fs.env.assetsFiles.has('notes.pdf'), true, 'the asset stays on disk');

  // Fallback: asset deletion is unavailable and the tool stays disabled.
  const fallback = loadWithBody(FILE_ROW);
  const fallbackDelete = fallback.document.querySelector('.ev-file [data-action="delete"]');
  assert.equal(fallbackDelete.disabled, true);
  assert.equal(fallbackDelete.title, 'Deleting attachments requires File System Access');
  fallbackDelete.click();
  assert.equal(fallback.document.querySelectorAll('.ev-file').length, 1, 'fallback mode keeps the references');
});

test('reference matching is by the persisted encoded asset URL, and the disk removal uses the decoded name', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(
    fileRowHtml('assets/my%20report.txt', 'my report.txt') +
    fileRowHtml('assets/my report.txt', 'my report.txt'), // hand-written, unencoded — a different asset URL
    fs,
  );
  const onDisk = new window.Blob(['disk bytes']);
  fs.env.assetsFiles.set('my report.txt', onDisk);
  window.confirm = () => true;
  await tick(); // initMode restores the remembered handle

  document.querySelector('.ev-file [data-action="delete"]').click();
  await waitFor(() => document.querySelectorAll('.ev-file').length === 1);

  assert.deepEqual(fs.env.removedAssets, ['my report.txt'], 'the disk name is the decoded filename');
  const survivor = document.querySelector('.ev-file > a');
  assert.equal(survivor.getAttribute('href'), 'assets/my report.txt', 'only the exact encoded path is a match');
  assert.equal(fs.env.assetsFiles.has('my report.txt'), false, 'the decoded name is the physical file — it is gone from disk');
});
