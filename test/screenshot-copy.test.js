import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAction,
  loadApp,
  tick,
  createFileSystemEnv,
  waitFor,
  stubImagePipeline,
  pasteImage,
  addFirstSection,
} from './helpers.js';

// 0022: screenshot copy → PNG bytes on the clipboard (SPEC §9).
// Seams (same as copy.test.js): the copy button in the screenshot control
// row, the stubbed navigator.clipboard, and the save status. All stored
// images are already PNG (0021), so copy must never re-encode.

// jsdom has no ClipboardItem; the stub records the formats map the app
// hands to the constructor so tests can inspect the exact blob.
class ClipboardItemStub {
  constructor(formats) {
    this.formats = formats;
  }
}

function stubClipboardWrite(window, { failWith = null } = {}) {
  const calls = [];
  window.ClipboardItem = ClipboardItemStub;
  window.navigator.clipboard = {
    write: (items) => {
      calls.push(items);
      return failWith ? Promise.reject(new Error(failWith)) : Promise.resolve();
    },
  };
  return calls;
}

/** Seed `section` with one data-URL screenshot (fallback mode) and return the item. */
async function seedDataUrlScreenshot(window, document, section) {
  stubImagePipeline(window);
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  await waitFor(() => section.querySelector('.ev-screenshot img'));
  return section.querySelector('.ev-screenshot');
}

// Seed `section` with one on-disk (assets/) screenshot in primary mode with
// a granted handle, and return the item.
async function seedOnDiskScreenshot(window, document, section) {
  await tick();
  document.getElementById('save-btn').click(); // pick the folder, derive the assets dir
  await tick();
  stubImagePipeline(window);
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  await waitFor(() => section.querySelector('.ev-screenshot img'));
  return section.querySelector('.ev-screenshot');
}

test('screenshot copy (data-URL src) writes the PNG bytes, no re-encode (0022)', async () => {
  const { window, document } = loadApp();
  const pipeline = stubImagePipeline(window);
  const calls = stubClipboardWrite(window);
  const section = addFirstSection(document); // 0040: build the section
  const item = await seedDataUrlScreenshot(window, document, section);
  assert.ok(
    item.querySelector('img').getAttribute('src').startsWith('data:image/png;base64,'),
    'precondition: data-URL src',
  );
  const encodesBefore = pipeline.toBlobCalls.length;

  sectionAction(item, 'copy').click();
  await waitFor(() => calls.length === 1);

  assert.equal(calls.length, 1, 'clipboard.write called exactly once');
  const [clipboardItem] = calls[0];
  assert.ok(clipboardItem instanceof ClipboardItemStub, 'a ClipboardItem');
  assert.deepEqual(Object.keys(clipboardItem.formats), ['image/png'], 'the image/png format, exactly');
  const blob = clipboardItem.formats['image/png'];
  assert.equal(blob.type, 'image/png', 'the blob is typed image/png');
  // the stubbed PNG bytes are 'fake-png'; a base64 data-URL round-trips them exactly
  assert.equal(await blob.text(), 'fake-png', 'the stored PNG bytes — decode, not re-encode');
  assert.equal(pipeline.toBlobCalls.length, encodesBefore, 'no re-encode at copy time');
  assert.match(
    latestOperationResult(document).message,
    /^Copied \d{2}:\d{2}:\d{2}$/,
    'success in the save status, per the copy convention',
  );
});

test('screenshot copy (primary mode, handle granted) reads the PNG back through the stored handles (0022)', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const calls = stubClipboardWrite(window);
  const section = addFirstSection(document); // 0040: build the section
  const item = await seedOnDiskScreenshot(window, document, section);
  const src = item.querySelector('img').getAttribute('src');
  assert.ok(src.startsWith('assets/'), 'precondition: on-disk src');
  const diskBlob = fs.env.assetsFiles.get(src.slice('assets/'.length));

  sectionAction(item, 'copy').click();
  await waitFor(() => calls.length === 1);

  assert.equal(calls.length, 1);
  const blob = calls[0][0].formats['image/png'];
  assert.equal(blob, diskBlob, 'the exact blob read back via assetsDir.getFileHandle(name).getFile() — no re-encode');
  assert.equal(blob.type, 'image/png');
  assert.match(
    latestOperationResult(document).message,
    /^Copied \d{2}:\d{2}:\d{2}$/,
    'success in the save status',
  );
});

test('screenshot copy, permission not granted: no-op with a message in the save status (0022)', async () => {
  const fs = createFileSystemEnv();
  const { window, document } = loadApp(undefined, { fs });
  const calls = stubClipboardWrite(window);
  const section = addFirstSection(document); // 0040: build the section
  const item = await seedOnDiskScreenshot(window, document, section);
  fs.env.permission = 'denied'; // the handle exists but the gesture is refused

  sectionAction(item, 'copy').click();
  await tick();
  await tick();

  assert.equal(calls.length, 0, 'nothing written to the clipboard');
  assert.match(
    latestOperationResult(document).message,
    /^Copy failed — /,
    'the failure surfaces in the save status',
  );
});

test('screenshot copy, clipboard.write fails: message in the save status (0022)', async () => {
  const { window, document } = loadApp();
  const calls = stubClipboardWrite(window, { failWith: 'NotAllowedError' });
  const section = addFirstSection(document); // 0040: build the section
  const item = await seedDataUrlScreenshot(window, document, section);

  sectionAction(item, 'copy').click();
  await waitFor(() => calls.length === 1);

  assert.match(
    latestOperationResult(document).message,
    /^Copy failed — NotAllowedError$/,
    'the write failure surfaces in the save status',
  );
});
