import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  sectionAction,
  appSource,
  createFileSystemEnv,
  downloadText,
  loadApp,
  tick,
  waitFor,
  documentHandleKey,
} from './helpers.js';

// 0066: rename file (SPEC §27). Seams (pre-agreed, per prior art): the
// palette buttons clicked through the live DOM, the native prompt() stubbed
// on window (first input-bearing native modal the app uses), the in-memory
// File System Access env (its assets dir now supports entries() enumeration),
// operation logs and the __evidence.usedNames bookkeeping seam.

const SHOT_PALETTE = [
  'size-small', 'size-medium', 'size-large', 'size-page-width', 'size-original',
  'size-larger', 'size-smaller', 'standalone', 'open-image', 'rename-file', 'copy', 'paste-after', 'delete',
];

const FILE_ROW = '<div class="ev-file"><a href="assets/notes.pdf" target="_blank" rel="noopener">notes.pdf</a></div>';
const fileRowHtml = (href, label) =>
  `<div class="ev-file"><a href="${href}" target="_blank" rel="noopener">${label}</a></div>`;
const shotHtml = (src) =>
  `<div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="${src}" alt=""></div></div>`;

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

/** Remember the picked folder in the env's IndexedDB BEFORE loadApp so
 * boot's initMode restores the handle and the default 'granted' permission
 * makes disk-backed renames available (the 0059 restore pattern). */
function rememberFolder(fs) {
  fs.env.idbStores.add('handles');
  fs.env.idbHandles.set(documentHandleKey(), fs.env.pickedDir);
}

/** Stub the native prompt(); replies may be fixed or a function of the label. */
function stubPrompt(window, reply) {
  const calls = [];
  window.prompt = (label, defaultValue) => {
    calls.push({ label, defaultValue, permissionCalls: window.__permCalls ? window.__permCalls() : null });
    return typeof reply === 'function' ? reply(label, defaultValue) : reply;
  };
  return calls;
}

/** Count permission-guarantee invocations, observable from inside the stub. */
function trackPermissionCalls(window, fs) {
  let count = 0;
  const originalQuery = fs.env.pickedDir.queryPermission.bind(fs.env.pickedDir);
  const originalRequest = fs.env.pickedDir.requestPermission.bind(fs.env.pickedDir);
  fs.env.pickedDir.queryPermission = (...args) => { count += 1; return originalQuery(...args); };
  fs.env.pickedDir.requestPermission = (...args) => { count += 1; return originalRequest(...args); };
  window.__permCalls = () => count;
}

const status = (document) => latestOperationResult(document)?.message || '';

// ---------------------------------------------------------------------
// Chrome: palette placement, the fallback disabled state, save stripping
// ---------------------------------------------------------------------

test('the file-row palette reads rename file, copy, delete', () => {
  const { document } = loadWithBody(FILE_ROW);
  const controls = document.querySelector('.ev-file > .ev-controls');
  assert.deepEqual(
    [...controls.children].map((b) => b.dataset.action),
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'rename-file', 'copy', 'paste-after', 'delete'],
    'rename file immediately before copy',
  );
  assert.equal(sectionAction(controls, 'rename-file').textContent, 'rename file', 'the label is locked');
});

test('the screenshot palette carries rename file immediately before copy', () => {
  const { document } = loadWithBody(shotHtml('assets/shot.png'));
  const controls = document.querySelector('.ev-screenshot > .ev-controls');
  assert.deepEqual(
    [...controls.children].map((b) => b.dataset.action),
    SHOT_PALETTE,
    '… standalone, rename file, copy, delete',
  );
});

test('a data-URL screenshot has no name, so no rename button and no filename label', () => {
  const { document } = loadWithBody(shotHtml('data:image/png;base64,AAA'));
  const controls = document.querySelector('.ev-screenshot > .ev-controls');
  assert.deepEqual(
    [...controls.children].map((b) => b.dataset.action),
    ['size-small', 'size-medium', 'size-large', 'size-page-width', 'size-original', 'size-larger', 'size-smaller', 'standalone', 'open-image', 'copy', 'paste-after', 'delete'],
    'no rename button on a data-URL screenshot',
  );
  assert.equal(document.querySelector('.ev-screenshot > .ev-filename'), null, 'no §26 label either');
});

test('in fallback mode the button is visible but disabled, with the native tooltip', () => {
  const { document } = loadWithBody(FILE_ROW + shotHtml('assets/shot.png'));
  for (const selector of ['.ev-file', '.ev-screenshot']) {
    const button = document.querySelector(`${selector} [data-action="rename-file"]`);
    assert.ok(button, `visible in the ${selector} palette`);
    assert.equal(button.disabled, true, 'disabled in fallback');
    assert.equal(button.title, 'Renaming requires File System Access', 'the native tooltip');
  }
});

test('the button is chrome: stripped from a saved file, restored on reopen', async () => {
  const { document, downloads } = loadWithBody(FILE_ROW + shotHtml('assets/shot.png'));
  document.getElementById('save-btn').click();
  assert.ok(downloads.at(-1)?.blob, 'fallback Save downloads the full file');
  const savedText = await downloadText(downloads.at(-1));

  const savedDoc = new JSDOM(savedText).window.document;
  assert.equal(savedDoc.querySelectorAll('[data-action="rename-file"]').length, 0, 'absent from a saved file');
  assert.equal(savedDoc.querySelectorAll('.ev-file, .ev-screenshot').length, 2, 'the content rows themselves are saved');

  const reopened = loadApp(savedText);
  assert.equal(reopened.document.querySelectorAll('[data-action="rename-file"]').length, 2, 'restored on reopen — one per asset row');
});

// ---------------------------------------------------------------------
// The native prompt: wording, cancel, one-shot, trim and validation
// ---------------------------------------------------------------------

test('the click opens a native prompt labeled and pre-filled with the current name', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(
    fileRowHtml('assets/my%20notes.pdf', 'my notes.pdf'),
    fs,
  );
  fs.env.assetsFiles.set('my notes.pdf', new window.Blob(['bytes']));
  const calls = stubPrompt(window, 'renamed.pdf');
  await tick(); // initMode restores the remembered handle

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await waitFor(() => status(document).startsWith('Renamed'));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].label, 'Rename "my notes.pdf" to:', 'locked label, templated on the decoded current name');
  assert.equal(calls[0].defaultValue, 'my notes.pdf', 'pre-filled with the exact current name');
});

test('cancel reports information without permission requests or disk work', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  fs.env.permission = 'prompt'; // an operation would have to request
  const { window, document } = loadWithBody(FILE_ROW, fs);
  const original = new window.Blob(['kept']);
  fs.env.assetsFiles.set('notes.pdf', original);
  trackPermissionCalls(window, fs);
  stubPrompt(window, null); // cancel/Escape → null
  await tick(); // initMode restores the remembered handle
  const baseline = window.__permCalls();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await tick(); // settles: nothing should follow

  assert.equal(status(document), 'Rename file cancelled');
  assert.equal(latestOperationResult(document).outcome, 'information');
  assert.equal(window.__permCalls(), baseline, 'no permission request after a cancel');
  assert.equal(document.querySelector('.ev-file > a').getAttribute('href'), 'assets/notes.pdf', 'the reference is untouched');
  assert.equal(fs.env.assetsFiles.get('notes.pdf'), original, 'the asset is untouched');
  assert.equal(fs.env.removedAssets.length, 0);
});

test('the prompt is one-shot: no loop, and a second click re-opens it with the new name', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(FILE_ROW, fs);
  fs.env.assetsFiles.set('notes.pdf', new window.Blob(['bytes']));
  let next = 'renamed.pdf';
  const calls = stubPrompt(window, () => { const r = next; next = null; return r; });
  await tick();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await waitFor(() => status(document).startsWith('Renamed'));
  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await tick(); // the second prompt is cancelled (reply null)

  assert.equal(calls.length, 2, 'one prompt per click — no loop');
  assert.equal(calls[1].label, 'Rename "renamed.pdf" to:', 'the second prompt tracks the new name');
  assert.equal(status(document), 'Rename file cancelled');
  assert.equal(latestOperationResult(document).outcome, 'information');
});

test('the input is trimmed before any check', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(FILE_ROW, fs);
  fs.env.assetsFiles.set('notes.pdf', new window.Blob(['bytes']));
  stubPrompt(window, '  new name.pdf  ');
  await tick();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await waitFor(() => status(document).startsWith('Renamed'));

  assert.equal(document.querySelector('.ev-file > a').textContent, 'new name.pdf', 'trimmed on disk and in the row');
  assert.equal(document.querySelector('.ev-file > a').getAttribute('href'), 'assets/new%20name.pdf');
  assert.ok(fs.env.assetsFiles.has('new name.pdf'), 'the trimmed name is the disk name');
});

test('empty or separator/control-character names are rejected with the locked message', async () => {
  const cases = [
    ['', 'Rename failed — "" is not a valid filename'],
    ['   ', 'Rename failed — "" is not a valid filename'],
    ['a/b', 'Rename failed — "a/b" is not a valid filename'],
    ['a\\b', 'Rename failed — "a\\b" is not a valid filename'],
    ['tab\tname', 'Rename failed — "tab\tname" is not a valid filename'],
    ['nl\nname', 'Rename failed — "nl\nname" is not a valid filename'],
    ['c1\u009fname', 'Rename failed — "c1\u009fname" is not a valid filename'],
  ];
  for (const [input, expected] of cases) {
    const fs = createFileSystemEnv();
    rememberFolder(fs);
    fs.env.permission = 'prompt'; // validation must precede the permission request
    const { window, document } = loadWithBody(FILE_ROW, fs);
    fs.env.assetsFiles.set('notes.pdf', new window.Blob(['kept']));
    trackPermissionCalls(window, fs);
    stubPrompt(window, input);
    await tick(); // initMode restores the remembered handle
    const baseline = window.__permCalls();

    document.querySelector('.ev-file [data-action="rename-file"]').click();
    await tick();

    assert.equal(status(document), expected, `input ${JSON.stringify(input)}`);
    assert.equal(window.__permCalls(), baseline, 'no permission request for an invalid input');
    assert.equal(document.querySelector('.ev-file > a').getAttribute('href'), 'assets/notes.pdf', 'the reference is untouched');
    assert.equal(fs.env.removedAssets.length, 0, `no disk work for input ${JSON.stringify(input)}`);
  }
});

test('a case-insensitive match of the current name is a silent no-op', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  fs.env.permission = 'prompt'; // the no-op must precede the permission request
  const { window, document } = loadWithBody(
    fileRowHtml('assets/Notes.pdf', 'Notes.pdf'),
    fs,
  );
  const original = new window.Blob(['kept']);
  fs.env.assetsFiles.set('Notes.pdf', original);
  trackPermissionCalls(window, fs);
  stubPrompt(window, 'notes.pdf');
  await tick(); // initMode restores the remembered handle
  const baseline = window.__permCalls();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await tick();

  assert.equal(status(document), 'Rename file cancelled');
  assert.equal(latestOperationResult(document).outcome, 'information');
  assert.equal(window.__permCalls(), baseline, 'no permission request for a no-op');
  assert.equal(document.querySelector('.ev-file > a').getAttribute('href'), 'assets/Notes.pdf', 'the reference is untouched');
  assert.equal(fs.env.assetsFiles.get('Notes.pdf'), original, 'the asset is untouched');
  assert.equal(fs.env.removedAssets.length, 0);
});

// ---------------------------------------------------------------------
// The collision check: the real assets/ directory, case-insensitively
// ---------------------------------------------------------------------

test('a collision with a disk name is rejected through real directory entries, case-insensitively', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(FILE_ROW, fs);
  const other = new window.Blob(['other bytes']);
  fs.env.assetsFiles.set('OTHER.PDF', other); // a disk name no row references
  stubPrompt(window, 'other.pdf'); // differs in case only
  await tick();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await waitFor(() => status(document) !== '');

  assert.equal(status(document), 'Rename failed — "other.pdf" already exists', 'the locked collision message, templated on the entered name');
  assert.equal(document.querySelector('.ev-file > a').getAttribute('href'), 'assets/notes.pdf', 'the reference is untouched');
  assert.ok(!fs.env.assetsFiles.has('other.pdf'), 'no new file was created');
  assert.equal(fs.env.assetsFiles.get('OTHER.PDF'), other, 'the colliding disk name is untouched');
  assert.equal(fs.env.removedAssets.length, 0, 'the used-names set plays no part — the directory blocked it');
});

// ---------------------------------------------------------------------
// Gesture order and the permission guard
// ---------------------------------------------------------------------

test('the gesture runs prompt first, then ensurePermission', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  fs.env.permission = 'prompt';
  const { window, document } = loadWithBody(FILE_ROW, fs);
  fs.env.assetsFiles.set('notes.pdf', new window.Blob(['bytes']));
  trackPermissionCalls(window, fs);
  const calls = stubPrompt(window, 'renamed.pdf');
  await tick(); // initMode restores the remembered handle
  const baseline = window.__permCalls();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await waitFor(() => status(document).startsWith('Renamed'));

  assert.equal(calls[0].permissionCalls, baseline, 'no permission work before the prompt resolved');
  assert.equal(fs.env.requestPermissionCalls, 1, 'the request happened after the OK');
});

test('a declined permission reports Rename failed — permission not granted', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  fs.env.permission = 'denied';
  fs.env.requestPermissionOutcome = 'denied';
  const { window, document } = loadWithBody(FILE_ROW, fs);
  const original = new window.Blob(['kept']);
  fs.env.assetsFiles.set('notes.pdf', original);
  stubPrompt(window, 'renamed.pdf');
  await tick();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await waitFor(() => status(document) !== '');

  assert.equal(status(document), 'Rename failed — permission not granted');
  assert.equal(document.querySelector('.ev-file > a').getAttribute('href'), 'assets/notes.pdf', 'the reference is retained');
  assert.ok(!fs.env.assetsFiles.has('renamed.pdf'), 'no new file was created');
  assert.equal(fs.env.assetsFiles.get('notes.pdf'), original, 'the asset is untouched');
  assert.equal(fs.env.removedAssets.length, 0);
});

// ---------------------------------------------------------------------
// The disk operation: write-new-then-delete, every reference follows
// ---------------------------------------------------------------------

test('success: the bytes go to the new name first, the old is removed, every reference updates', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(
    fileRowHtml('assets/my%20notes.pdf', 'my notes.pdf') +
    fileRowHtml('assets/my%20notes.pdf', 'my notes.pdf') +
    shotHtml('assets/my%20notes.pdf'),
    fs,
  );
  const original = new window.Blob(['shared bytes']);
  fs.env.assetsFiles.set('my notes.pdf', original);
  stubPrompt(window, 'my notes v2.pdf');
  await tick();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await waitFor(() => status(document).startsWith('Renamed'));

  assert.ok(fs.env.assetsFiles.get('my notes v2.pdf') instanceof window.Blob, 'the new name exists on disk');
  assert.equal(await fs.env.assetsFiles.get('my notes v2.pdf').text(), 'shared bytes', 'the bytes survive the rename');
  assert.ok(!fs.env.assetsFiles.has('my notes.pdf'), 'the old name is gone');
  assert.deepEqual(fs.env.removedAssets, ['my notes.pdf']);

  const links = [...document.querySelectorAll('.ev-file > a')];
  assert.equal(links.length, 2, 'both file rows referencing the path update');
  for (const link of links) {
    assert.equal(link.getAttribute('href'), 'assets/my%20notes%20v2.pdf', 'the href is re-encoded');
    assert.equal(link.textContent, 'my notes v2.pdf', 'the link text follows');
  }
  const img = document.querySelector('.ev-screenshot > img.ev-img');
  assert.equal(img.getAttribute('src'), 'assets/my%20notes%20v2.pdf', 'the cross-type screenshot reference follows');
  assert.equal(document.querySelector('.ev-screenshot > .ev-filename').textContent, 'my notes v2.pdf', 'the §26 label refreshes');

  assert.match(status(document), /^Renamed \d{2}:\d{2}:\d{2}$/, 'success shows Renamed HH:MM:SS');
  assert.equal(fs.env.files.size, 0, 'no save is triggered');

  const usedNames = window.__evidence.usedNames;
  assert.ok(!usedNames.has('my%20notes.pdf'), 'the old name leaves the used-names set');
  assert.ok(usedNames.has('my%20notes%20v2.pdf'), 'the new name joins the used-names set');
});

test('renaming from the screenshot palette updates the file rows too', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(
    fileRowHtml('assets/shot.png', 'shot.png') + shotHtml('assets/shot.png'),
    fs,
  );
  fs.env.assetsFiles.set('shot.png', new window.Blob(['px']));
  stubPrompt(window, 'shot 2.png');
  await tick();

  document.querySelector('.ev-screenshot [data-action="rename-file"]').click();
  await waitFor(() => status(document).startsWith('Renamed'));

  const link = document.querySelector('.ev-file > a');
  assert.equal(link.getAttribute('href'), 'assets/shot%202.png');
  assert.equal(link.textContent, 'shot 2.png');
  assert.equal(document.querySelector('img.ev-img').getAttribute('src'), 'assets/shot%202.png');
  assert.deepEqual(fs.env.removedAssets, ['shot.png']);
});

test('a missing old file counts as success — no directory is created as a side effect', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(FILE_ROW, fs); // nothing on disk
  stubPrompt(window, 'renamed.pdf');
  await tick();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await waitFor(() => status(document).startsWith('Renamed'));

  assert.match(status(document), /^Renamed \d{2}:\d{2}:\d{2}$/, 'the requested final state is reached');
  assert.equal(document.querySelector('.ev-file > a').getAttribute('href'), 'assets/renamed.pdf', 'the reference follows');
  assert.ok(!fs.env.assetsFiles.has('renamed.pdf'), 'there were no bytes to write');
  assert.ok(!fs.env.createdDirs.has('assets'), 'no empty assets/ directory is created');
  assert.equal(fs.env.removedAssets.length, 0);
});

test('a failed delete orphans the old file — the rename stands and the failure is reported', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(FILE_ROW, fs);
  fs.env.assetsFiles.set('notes.pdf', new window.Blob(['bytes']));
  fs.env.failNextRemoveEntry = 'read-only file system';
  stubPrompt(window, 'renamed.pdf');
  await tick();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await waitFor(() => status(document) !== '');

  assert.equal(status(document), 'Rename failed — read-only file system', 'the failed step is reported');
  assert.ok(fs.env.assetsFiles.has('renamed.pdf'), 'the new name was written');
  assert.ok(fs.env.assetsFiles.has('notes.pdf'), 'the old file is orphaned on disk');
  assert.equal(document.querySelector('.ev-file > a').getAttribute('href'), 'assets/renamed.pdf', 'the rename stands: references update');
  assert.equal(document.querySelector('.ev-file > a').textContent, 'renamed.pdf');
});

test('a failed write changes nothing and reports Rename failed — <message>', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(FILE_ROW, fs);
  const original = new window.Blob(['bytes']);
  fs.env.assetsFiles.set('notes.pdf', original);
  fs.env.failNextAssetWrite = 'disk full';
  stubPrompt(window, 'renamed.pdf');
  await tick();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await waitFor(() => status(document) !== '');

  assert.equal(status(document), 'Rename failed — disk full');
  assert.ok(fs.env.assetsFiles.get('renamed.pdf') == null, 'no bytes reached the new name');
  assert.equal(fs.env.assetsFiles.get('notes.pdf'), original, 'the old file is untouched');
  assert.equal(document.querySelector('.ev-file > a').getAttribute('href'), 'assets/notes.pdf', 'no reference moved');
  assert.equal(fs.env.removedAssets.length, 0);
});

// ---------------------------------------------------------------------
// The example SVG renames like any asset; A4 after a rename
// ---------------------------------------------------------------------

test('the example SVG renames like any asset, and a later apply writes its canonical name anew', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadApp(undefined, { fs });
  window.confirm = () => true;
  await tick(); // initMode restores the remembered handle
  document.getElementById('example-btn').click();
  sectionAction(document, 'apply-example').click();
  await waitFor(() => (document.querySelector('img.ev-img')?.getAttribute('src') || '') === 'assets/example-ers1234-shortlist.svg');
  await tick();

  stubPrompt(window, 'renamed-example.svg');
  document.querySelector('.ev-screenshot [data-action="rename-file"]').click();
  await waitFor(() => status(document).startsWith('Renamed'));
  assert.equal(document.querySelector('img.ev-img').getAttribute('src'), 'assets/renamed-example.svg');
  assert.equal(document.querySelector('.ev-screenshot > .ev-filename').textContent, 'renamed-example.svg', 'the label follows');
  assert.ok(fs.env.assetsFiles.has('renamed-example.svg'), 'the bytes moved on disk');
  assert.deepEqual(fs.env.removedAssets, ['example-ers1234-shortlist.svg']);

  // a later apply writes the canonical name anew (§20 unchanged)
  document.getElementById('example-btn').click();
  sectionAction(document, 'apply-example').click();
  await waitFor(() => (document.querySelector('img.ev-img')?.getAttribute('src') || '') === 'assets/example-ers1234-shortlist.svg');
  assert.ok(fs.env.assetsFiles.has('example-ers1234-shortlist.svg'), 'the canonical name is written anew');
});

test('save → reload → save stays byte-identical after a rename (A4)', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadWithBody(
    fileRowHtml('assets/notes.pdf', 'notes.pdf') + shotHtml('assets/shot.png'),
    fs,
  );
  fs.env.assetsFiles.set('notes.pdf', new window.Blob(['n']));
  fs.env.assetsFiles.set('shot.png', new window.Blob(['s']));
  stubPrompt(window, 'renamed.pdf');
  await tick();

  document.querySelector('.ev-file [data-action="rename-file"]').click();
  await waitFor(() => status(document).startsWith('Renamed'));

  document.getElementById('save-btn').click();
  await waitFor(() => typeof fs.env.files.get('index.html') === 'string');
  const saved1 = fs.env.files.get('index.html');
  assert.ok(saved1.includes('renamed.pdf'), 'the save serializes the new name as ordinary content');
  const savedDoc = new JSDOM(saved1).window.document;
  assert.equal(savedDoc.querySelectorAll('[data-action="rename-file"]').length, 0, 'no rename chrome in the saved file (the app script is excluded — it is code, not chrome)');

  const reopened = loadApp(saved1, { fs });
  await tick();
  reopened.document.getElementById('save-btn').click();
  await waitFor(() => latestOperationResult(reopened.document)?.message.startsWith('Saved'));
  const saved2 = fs.env.files.get('index.html');
  assert.equal(saved2, saved1, 'byte-identical (A4)');
});
