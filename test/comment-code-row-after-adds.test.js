import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  addFirstSection,
  createFileSystemEnv,
  dispatchContextMenu,
  downloadText,
  latestOperationResult,
  loadApp,
  pasteImage,
  sectionAction,
  stubImagePipeline,
  waitFor,
  assertCaretAtEnd,
} from './helpers.js';

const ADDS = ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url'];
const COMMENT_ACTIONS = [...ADDS, 'copy', 'copy-element', 'paste-after', 'delete'];
const CODE_ACTIONS = [...ADDS, 'soft-wrap', 'copy', 'copy-element', 'paste-after', 'delete'];
const paletteOf = (document) => document.querySelector('#evidence > .ev-section-palette');
const bodyOf = (section) => section.querySelector(':scope > .ev-body');
const tagsOf = (body) => [...body.children].map((row) => '.' + row.className.split(' ')[0]);

function appWithMiddleRows({ fs } = {}) {
  const app = loadApp(undefined, fs ? { fs } : {});
  const section = addFirstSection(app.document);
  sectionAction(section, 'add-comment').click();
  sectionAction(section, 'add-code').click();
  sectionAction(section, 'add-comment').click();
  const body = bodyOf(section);
  return { ...app, section, body, comment: body.children[0], code: body.children[1] };
}

for (const type of ['comment', 'code']) {
  test(`${type} file add keeps fallback gating and uses the existing attachment lifecycle`, async () => {
    const fallback = appWithMiddleRows();
    const fallbackPalette = openPalette(fallback.window, fallback[type]);
    assert.equal(fallbackPalette.querySelector('[data-action="add-file"]').disabled, true);

    const fs = createFileSystemEnv();
    const attached = appWithMiddleRows({ fs });
    fs.env.sourceFile = new attached.window.File(['evidence'], 'run.log');
    openPalette(attached.window, attached[type]).querySelector('[data-action="add-file"]').click();
    await waitFor(() => attached.body.querySelector('.ev-file'));
    assert.equal(attached[type].nextElementSibling, attached.body.querySelector('.ev-file'));
    assert.equal(attached.body.querySelector('.ev-file > a').textContent, 'run.log');
    assert.deepEqual(latestOperationResult(attached.document), {
      name: 'Attach file', outcome: 'success', message: 'File attached: run.log',
      log: 'Operation finished: Attach file — success — File attached: run.log',
    });
  });
}

function openPalette(window, row) {
  const surface = row.matches('.ev-comment')
    ? row.querySelector(':scope > .ev-comment-text')
    : row.querySelector(':scope > .ev-code-text');
  dispatchContextMenu(window, surface);
  return paletteOf(window.document);
}

for (const type of ['comment', 'code']) {
  test(`${type} toolbox puts the six adds first and preserves the existing tools`, () => {
    const { window, [type]: row } = appWithMiddleRows();
    const palette = openPalette(window, row);
    const expected = type === 'comment' ? COMMENT_ACTIONS : CODE_ACTIONS;
    assert.deepEqual([...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action), expected);
    assert.deepEqual([...palette.querySelectorAll(':scope > button .ev-action-label')].slice(0, ADDS.length)
      .map((label) => label.textContent), ['+ comment', '+ code', '+ property', '+ screenshot', '+ file', '+ url']);
    assert.equal(row.hasAttribute('data-palette-active'), true);
  });

  test(`${type} adds stay at the end of the owning section and preserve numbering`, () => {
    const { window, document, section, [type]: row } = appWithMiddleRows();
    sectionAction(section, 'add-subsection').click();
    bodyOf(section).appendChild(row);
    document.querySelector('button[data-action="add-section"]').click();
    const secondSection = [...document.querySelectorAll('#evidence > .ev-section')][1];
    const secondBody = bodyOf(secondSection);
    sectionAction(secondSection, 'add-comment').click();
    const secondBodyBefore = tagsOf(secondBody);
    const firstBody = bodyOf(section);

    openPalette(window, row).querySelector('[data-action="add-code"]').click();
    assert.equal(row.nextElementSibling, firstBody.lastElementChild);
    assert.equal(row.nextElementSibling.matches('.ev-code'), true);
    assert.deepEqual(tagsOf(secondBody), secondBodyBefore, 'the next section remains untouched');
    assert.deepEqual([...document.querySelectorAll('#evidence .ev-num')].map((number) => number.textContent),
      ['1', '1.1', '2'], 'section numbering stays in order');
  });

  test(`${type} add refreshes property alignment in its body`, () => {
    const { window, section, [type]: row } = appWithMiddleRows();
    sectionAction(section, 'add-property').click();
    sectionAction(section, 'add-property').click();
    const body = bodyOf(section);
    const properties = [...body.querySelectorAll(':scope > .ev-property')];
    properties[0].querySelector(':scope > .ev-prop-key').textContent = 'A';
    properties[1].querySelector(':scope > .ev-prop-key').textContent = 'Longest';
    window.__evidence.measureKeyWidth = (key) => key.textContent.length * 10;
    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 500 });

    openPalette(window, row).querySelector('[data-action="add-property"]').click();
    const aligned = [...body.querySelectorAll(':scope > .ev-property')];
    assert.equal(new Set(aligned.map((property) => property.getAttribute('data-key-w'))).size, 1);
    assert.equal(aligned[0].getAttribute('data-key-w'), '70', 'the longest key still sets the shared column');
  });

  test(`${type} adds insert after the owner and URL add focuses its field`, () => {
    const { window, document, body, [type]: row } = appWithMiddleRows();
    const palette = openPalette(window, row);
    palette.querySelector('[data-action="add-comment"]').click();
    assert.equal(row.nextElementSibling.matches('.ev-comment'), true);
    assert.equal(document.activeElement, row.nextElementSibling.querySelector('.ev-comment-text'));
    assertCaretAtEnd(row.nextElementSibling.querySelector('.ev-comment-text'));
    openPalette(window, row).querySelector('[data-action="add-code"]').click();
    assert.equal(row.nextElementSibling.matches('.ev-code'), true);
    assert.equal(document.activeElement, row.nextElementSibling.querySelector('.ev-code-text'));
    assertCaretAtEnd(row.nextElementSibling.querySelector('.ev-code-text'));
    openPalette(window, row).querySelector('[data-action="add-property"]').click();
    assert.equal(row.nextElementSibling.matches('.ev-property'), true);
    assert.equal(document.activeElement, row.nextElementSibling.querySelector('.ev-prop-key'));
    assertCaretAtEnd(row.nextElementSibling.querySelector('.ev-prop-key'));
    openPalette(window, row).querySelector('[data-action="add-url"]').click();
    assert.equal(row.nextElementSibling.matches('.ev-url'), true);
    assert.equal(document.activeElement, row.nextElementSibling.querySelector('.ev-url-input'));
    assertCaretAtEnd(row.nextElementSibling.querySelector('.ev-url-input'));
    assert.deepEqual(tagsOf(body), type === 'comment'
      ? ['.ev-comment', '.ev-url', '.ev-property', '.ev-code', '.ev-comment', '.ev-code', '.ev-comment']
      : ['.ev-comment', '.ev-code', '.ev-url', '.ev-property', '.ev-code', '.ev-comment', '.ev-comment']);
  });

  test(`${type} screenshot add joins a directly following screenshot row, otherwise inserts after owner`, async () => {
    const { window, section, body, [type]: row } = appWithMiddleRows();
    stubImagePipeline(window);
    sectionAction(section, 'add-screenshot').click();
    pasteImage(window, body.querySelector('.ev-screenshot-pending'));
    await waitFor(() => body.querySelector('.ev-shot-row img'));
    const palette = openPalette(window, row);
    palette.querySelector('[data-action="add-screenshot"]').click();
    assert.equal(body.querySelector('.ev-screenshot-pending').parentElement, body);
    assert.equal(body.querySelector('.ev-screenshot-pending'), row.nextElementSibling);

    // Move the image row immediately after the owner to exercise the container rule.
    body.querySelector('.ev-screenshot-pending').remove();
    sectionAction(section, 'add-screenshot').click();
    pasteImage(window, body.querySelector('.ev-screenshot-pending'));
    await waitFor(() => body.querySelector('.ev-shot-row img'));
    const shotRow = body.querySelector('.ev-shot-row');
    row.insertAdjacentElement('afterend', shotRow);
    openPalette(window, row).querySelector('[data-action="add-screenshot"]').click();
    const pending = shotRow.querySelector('.ev-screenshot-pending');
    assert.ok(pending);
    assert.equal(pending, shotRow.lastElementChild);
  });
}

test('code soft-wrap state remains intact across add actions and palette refreshes', () => {
  const { window, code } = appWithMiddleRows();
  let palette = openPalette(window, code);
  const softWrap = palette.querySelector('[data-action="soft-wrap"]');
  softWrap.click();
  assert.equal(code.hasAttribute('data-soft-wrap'), true);
  palette = openPalette(window, code);
  assert.equal(palette.querySelector('[data-action="soft-wrap"]').getAttribute('aria-pressed'), 'true');
  palette.querySelector('[data-action="add-code"]').click();
  assert.equal(code.hasAttribute('data-soft-wrap'), true);
  assert.deepEqual([...palette.querySelectorAll(':scope > button')].map((button) => button.dataset.action), CODE_ACTIONS);
});

test('comment and code toolbox chrome is stripped on save while added rows persist', async () => {
  const { window, document, body, comment, code, downloads } = appWithMiddleRows();
  openPalette(window, comment).querySelector('[data-action="add-comment"]').click();
  openPalette(window, code).querySelector('[data-action="add-property"]').click();
  document.getElementById('save-btn').click();
  const saved = await downloadText(downloads.find((entry) => entry.name));
  const savedDocument = new JSDOM(saved).window.document;
  assert.equal(savedDocument.querySelector('[data-palette-active]'), null);
  assert.equal(savedDocument.querySelector('#evidence > .ev-section-palette'), null);
  const savedBody = savedDocument.querySelector('.ev-section > .ev-body');
  assert.deepEqual(tagsOf(savedBody), tagsOf(body));
  assert.equal(savedBody.querySelectorAll('.ev-comment .ev-controls, .ev-code .ev-controls').length, 0);
});

test('comment and code content adds retain typed operation logging', () => {
  for (const type of ['comment', 'code']) {
    const { window, document, [type]: row } = appWithMiddleRows();
    openPalette(window, row).querySelector('[data-action="add-comment"]').click();
    assert.equal(latestOperationResult(document).name, 'Add comment');
    assert.equal(latestOperationResult(document).outcome, 'success');
  }
});
