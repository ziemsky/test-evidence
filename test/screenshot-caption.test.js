import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction,
  appSource,
  loadApp,
  downloadText,
  stubImagePipeline,
  pasteImage,
  waitFor,
  addFirstSection,
} from './helpers.js';

async function pasteScreenshot(document, window, section) {
  stubImagePipeline(window);
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  // 0051 (SPEC §23): a pasted shot lands in its section's .ev-shot-row
  await waitFor(() => section.querySelector('.ev-shot-row > .ev-screenshot'));
  return section.querySelector('.ev-shot-row > .ev-screenshot');
}

function keydown(window, target, init) {
  const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function pasteText(window, target, plain) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [], getData: (type) => (type === 'text/plain' ? plain : '') },
  });
  target.dispatchEvent(event);
  return event;
}

test('pasting a screenshot creates one empty caption beneath the image; its pending placeholder has none', async () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-screenshot').click();
  const pending = section.querySelector('.ev-screenshot-pending');
  assert.equal(pending.querySelector('.ev-caption'), null, 'placeholder carries no caption field');

  stubImagePipeline(window);
  pasteImage(window, document.body);
  await waitFor(() => section.querySelector('.ev-screenshot'));
  const screenshot = section.querySelector('.ev-screenshot');
  const caption = screenshot.querySelector(':scope > .ev-caption');
  assert.ok(caption, 'a caption is created with the real screenshot');
  assert.equal(caption.textContent, '', 'caption starts empty');
  assert.equal(caption.getAttribute('contenteditable'), 'true', 'caption is editable');
  assert.ok(!caption.hasAttribute('data-chrome'), 'caption is content, not chrome');
  assert.deepEqual(
    [...screenshot.children].map((el) => el.className),
    ['ev-drag-handle', 'ev-img', 'ev-text ev-caption', 'ev-controls'],
    'caption lives directly beneath the image and before controls',
  );
  assert.equal(screenshot.querySelector('img').getAttribute('alt'), '', 'an empty caption makes the image decorative');
});

test('caption accepts newline plain text and synchronizes alt live', async () => {
  const { document, window } = loadApp();
  const screenshot = await pasteScreenshot(document, window, addFirstSection(document));
  const caption = screenshot.querySelector('.ev-caption');
  const calls = [];
  document.execCommand = (command, unused, value) => { calls.push([command, value]); return true; };

  caption.focus();
  assert.equal(keydown(window, caption, { key: 'Enter' }).defaultPrevented, true, 'Enter is handled as plain text');
  assert.deepEqual(calls, [['insertText', '\n']], 'Enter inserts a literal newline');
  assert.equal(pasteText(window, caption, 'Referral\r\nready').defaultPrevented, true, 'paste is handled as plain text');
  assert.deepEqual(calls, [['insertText', '\n'], ['insertText', 'Referral\r\nready']], 'pasted newlines are preserved');

  caption.textContent = 'Referral\nready';
  caption.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(screenshot.querySelector('img').getAttribute('alt'), 'Referral\nready', 'non-empty caption becomes alt text');
  caption.textContent = '';
  caption.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(screenshot.querySelector('img').getAttribute('alt'), '', 'empty caption restores decorative alt');
});

test('empty caption hint is collapsed at rest and revealed by unit hover or caption focus', async () => {
  const source = appSource();
  assert.match(source, /\.ev-caption:empty::before\s*\{\s*content:\s*"Caption…"/, 'empty caption has the locked hint');
  assert.match(source, /\.ev-caption:empty::before\s*\{[^}]*font-style:\s*italic/, 'hint is italic');
  assert.match(source, /\.ev-caption:empty\s*\{[^}]*display:\s*none/, 'empty caption is collapsed at rest');
  assert.match(source, /\.ev-screenshot:hover\s*>\s*\.ev-caption:empty\s*\{[^}]*display:\s*block/, 'unit hover reveals the empty caption');
  assert.match(source, /\.ev-caption:empty:focus\s*\{[^}]*display:\s*block/, 'caption focus reveals the empty caption');
  assert.doesNotMatch(source, /\.ev-screenshot:focus-within\s*>\s*\.ev-caption/, 'palette focus does not reveal the caption');
  assert.match(source, /\.ev-caption\s*\{[^}]*display:\s*block/, 'populated captions remain visible at rest');
  assert.match(source, /\.ev-caption\s*\{[^}]*font-size:\s*0\.9em/, 'caption has locked typography');
  assert.match(source, /\.ev-caption\s*\{[^}]*margin-top:\s*0\.15em/, 'caption has the locked image gap');
  assert.match(source, /\.ev-text\s*\{[^}]*white-space:\s*pre-wrap/, 'caption preserves newlines and wraps long lines');
  assert.match(source, /\.ev-screenshot:focus-within\s*\{[^}]*background:\s*var\(--ev-focus-surface\)/, 'screenshot row gets the standard focus surface');
  assert.match(source, /\.ev-screenshot\s*>\s*\.ev-controls\s*\{[^}]*display:\s*none/, 'hidden controls reserve no space beneath the caption');

  const { document, window } = loadApp();
  const screenshot = await pasteScreenshot(document, window, addFirstSection(document));
  screenshot.querySelector('.ev-caption').focus();
  assert.ok(screenshot.matches(':focus-within'), 'caption focus covers the complete screenshot row');
  assert.deepEqual(
    [...screenshot.querySelectorAll('[data-action]')].map((button) => button.dataset.action),
    ['size-small', 'size-medium', 'size-large', 'size-page-width', 'size-original', 'size-larger', 'size-smaller', 'standalone', 'open-image', 'copy', 'paste-after', 'delete'],
    'the screenshot keeps its PNG copy control; the caption has none',
  );
});

test('caption travels with its screenshot when dragged and is removed by screenshot deletion', async () => {
  const { document, window } = loadApp();
  const first = addFirstSection(document);
  const secondButton = document.querySelector('#evidence > .ev-end-add-toolbox [data-action="add-section"]');
  secondButton.click();
  const second = document.querySelectorAll('#evidence > .ev-section')[1];
  const screenshot = await pasteScreenshot(document, window, first);
  screenshot.querySelector('.ev-caption').textContent = 'Moved caption';
  screenshot.querySelector('.ev-caption').dispatchEvent(new window.Event('input', { bubbles: true }));

  assert.equal(window.__evidence.moveElement(screenshot, second.querySelector('.ev-body'), null), true, 'move seam accepts screenshot leaf');
  assert.equal(second.querySelector('.ev-screenshot .ev-caption').textContent, 'Moved caption', 'caption travels with its image');
  second.querySelector('.ev-screenshot [data-action="delete"]').click();
  assert.equal(second.querySelector('.ev-screenshot'), null, 'deleting the screenshot deletes its caption');
});

for (const [caption, label] of [['Referral screen', 'populated'], ['', 'empty']]) {
  test(`A4: screenshot with ${label} caption saves and reloads byte-identically`, async () => {
    const first = loadApp();
    const screenshot = await pasteScreenshot(first.document, first.window, addFirstSection(first.document));
    const field = screenshot.querySelector('.ev-caption');
    field.textContent = caption;
    field.dispatchEvent(new first.window.Event('input', { bubbles: true }));
    first.document.getElementById('save-btn').click();
    const savedOnce = await downloadText(first.downloads.find((download) => download.name));
    const savedDocument = new JSDOM(savedOnce).window.document;
    assert.equal(savedDocument.querySelector('.ev-caption').textContent, caption, 'caption is serialized as content');
    assert.equal(savedDocument.querySelector('.ev-screenshot img').getAttribute('alt'), caption, 'synchronized alt is serialized');

    const second = loadApp(savedOnce);
    assert.equal(
      second.document.querySelector('.ev-caption').getAttribute('contenteditable'),
      'true',
      'boot restores editing without changing the saved caption content',
    );
    second.document.getElementById('save-btn').click();
    const savedTwice = await downloadText(second.downloads.find((download) => download.name));
    assert.equal(savedTwice, savedOnce, 'save → reload → save remains byte-identical');
  });
}
