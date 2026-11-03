import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionAction,
  loadApp,
  appSource,
  stubImagePipeline,
  pasteImage,
  waitFor,
  addFirstSection,
} from './helpers.js';

// 0090: whole screenshot rows are pointer-drag units. The public seams are
// the live pointer lifecycle, window.__evidence.moveElement, and serialize()
// (the same seams used by the existing screenshot-drag coverage).

const bodyOf = (section) => section.querySelector(':scope > .ev-body');
const rowsOf = (section) => [...bodyOf(section).querySelectorAll(':scope > .ev-shot-row')];
const shotsOf = (row) => [...row.querySelectorAll(':scope > .ev-screenshot')];

async function pasteShot(section, window) {
  const before = section.querySelectorAll('.ev-screenshot img').length;
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, section.querySelector('.ev-screenshot-pending'));
  await waitFor(() => section.querySelectorAll('.ev-screenshot img').length === before + 1);
  return section.querySelectorAll('.ev-screenshot')[before];
}

function pointerEvent(window, type, x, y, button = 0) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  Object.defineProperty(ev, 'button', { value: button });
  return ev;
}

function setRect(el, left, top, right, bottom) {
  const rect = {
    left, top, right, bottom,
    x: left, y: top, width: right - left, height: bottom - top,
    toJSON: () => ({}),
  };
  el.getBoundingClientRect = () => rect;
}

function stubHit(window, element) {
  window.document.elementFromPoint = () => element;
}

function startDrag(window, handle, x, y) {
  handle.dispatchEvent(pointerEvent(window, 'pointerdown', x, y));
}

function movePointer(window, document, x, y) {
  document.dispatchEvent(pointerEvent(window, 'pointermove', x, y));
}

function releasePointer(window, document) {
  document.dispatchEvent(pointerEvent(window, 'pointerup', 0, 0));
}

function lineInfo(document) {
  const line = document.querySelector('.ev-drop-line');
  return line && { line, parent: line.parentElement, next: line.nextSibling };
}

test('row chrome is a first-child handle and is rebuilt after serialization', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  await pasteShot(section, window);
  const row = rowsOf(section)[0];

  assert.ok(row.firstElementChild.matches('.ev-drag-handle[data-chrome]'));
  assert.ok(row.children[1].matches('.ev-row-controls[data-chrome]'));
  assert.ok(row.querySelector(':scope > .ev-screenshot > .ev-drag-handle[data-chrome]'));

  const saved = new window.DOMParser().parseFromString(window.__evidence.serialize(), 'text/html');
  assert.equal(saved.querySelector('#evidence .ev-shot-row > .ev-drag-handle'), null);
  assert.equal(saved.querySelector('#evidence .ev-shot-row > .ev-row-controls'), null);
  assert.equal(saved.querySelectorAll('#evidence [data-chrome]').length, 0);

  const reopened = loadApp(window.__evidence.serialize());
  const reopenedRow = reopened.document.querySelector('#evidence .ev-shot-row');
  assert.ok(reopenedRow.firstElementChild.matches('.ev-drag-handle[data-chrome]'));
  assert.ok(reopenedRow.children[1].matches('.ev-row-controls[data-chrome]'));
});

test('row drag uses the threshold, dims the whole row, previews body gaps, and Escape cancels', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  const shot = await pasteShot(section, window);
  const row = rowsOf(section)[0];
  const body = bodyOf(section);
  setRect(row, 0, 100, 800, 300);
  stubHit(window, body);
  const logs = [];
  window.__operationLogs = logs;
  window.console.log = (...parts) => logs.push(parts.join(' '));

  startDrag(window, row.querySelector(':scope > .ev-drag-handle'), 400, 140);
  movePointer(window, document, 402, 143);
  assert.equal(row.classList.contains('ev-dragging'), false, 'sub-threshold movement does not start');
  assert.equal(lineInfo(document), null);

  movePointer(window, document, 400, 60);
  assert.equal(row.classList.contains('ev-dragging'), true, 'the whole row is dimmed');
  assert.equal(document.body.classList.contains('ev-dragging-active'), true);
  assert.equal(lineInfo(document).parent, body, 'row drags preview a section-body gap');
  assert.equal(lineInfo(document).next, row, 'the preview is before the existing row');
  assert.equal(row.contains(shot), true, 'the row remains in place while dragging');

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.deepEqual(logs, [
    'Operation started: Move',
    'Operation finished: Move — information — Move canceled',
  ]);
  assert.equal(latestOperationResult(document).outcome, 'information');
  assert.equal(lineInfo(document), null);
  assert.equal(row.classList.contains('ev-dragging'), false);
  assert.equal(document.body.classList.contains('ev-dragging-active'), false);
  assert.equal(body.firstElementChild, row, 'Escape leaves the row untouched');
});

test('row midpoint selects before or after and merging prepends/appends shots while retaining destination alignment', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const sourceSection = addFirstSection(document);
  const sourceA = await pasteShot(sourceSection, window);
  const sourceB = await pasteShot(sourceSection, window);
  const sourceRow = rowsOf(sourceSection)[0];
  sectionAction(sourceRow, 'row-valign-middle').click();
  sourceA.querySelector(':scope > .ev-caption').textContent = 'source caption';
  sourceA.setAttribute('data-size', 'small');
  sourceB.setAttribute('data-standalone', '');

  document.querySelector('button[data-action="add-section"]').click();
  const destinationSection = document.querySelectorAll('#evidence > .ev-section')[1];
  const destinationA = await pasteShot(destinationSection, window);
  const destinationB = await pasteShot(destinationSection, window);
  const destinationRow = rowsOf(destinationSection)[0];
  sectionAction(destinationRow, 'row-valign-bottom').click();
  const destinationBody = bodyOf(destinationSection);
  setRect(destinationRow, 0, 300, 800, 500);
  stubHit(window, destinationBody);
  const logs = [];
  window.console.log = (...parts) => logs.push(parts.join(' '));

  startDrag(window, sourceRow.querySelector(':scope > .ev-drag-handle'), 400, 150);
  movePointer(window, document, 400, 340); // upper half: before destination row
  let info = lineInfo(document);
  assert.equal(info.parent, destinationBody);
  assert.equal(info.next, destinationRow);
  releasePointer(window, document);

  assert.deepEqual(logs, [
    'Operation started: Move',
    'Operation finished: Move — success — Moved element',
  ]);
  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.deepEqual(shotsOf(destinationRow), [sourceA, sourceB, destinationA, destinationB]);
  assert.equal(sourceRow.isConnected, false, 'the source wrapper is discarded after a merge');
  assert.equal(destinationRow.getAttribute('data-valign'), 'bottom', 'destination alignment wins');
  assert.equal(sourceA.querySelector(':scope > .ev-caption').textContent, 'source caption');
  assert.equal(sourceA.getAttribute('data-size'), 'small');
  assert.equal(sourceB.hasAttribute('data-standalone'), true);
});

test('row move after a destination row appends in order and an isolated move preserves the wrapper', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const sourceSection = addFirstSection(document);
  const sourceA = await pasteShot(sourceSection, window);
  const sourceB = await pasteShot(sourceSection, window);
  const sourceRow = rowsOf(sourceSection)[0];
  sectionAction(sourceRow, 'row-halign-right').click();

  document.querySelector('button[data-action="add-section"]').click();
  const destinationSection = document.querySelectorAll('#evidence > .ev-section')[1];
  const destination = await pasteShot(destinationSection, window);
  const destinationRow = rowsOf(destinationSection)[0];
  const destinationBody = bodyOf(destinationSection);
  setRect(destinationRow, 0, 300, 800, 500);
  stubHit(window, destinationBody);

  startDrag(window, sourceRow.querySelector(':scope > .ev-drag-handle'), 400, 150);
  movePointer(window, document, 400, 460); // lower half: after destination row
  assert.equal(lineInfo(document).parent, destinationBody);
  assert.equal(lineInfo(document).next, null);
  releasePointer(window, document);
  assert.deepEqual(shotsOf(destinationRow), [destination, sourceA, sourceB]);
  assert.equal(destinationRow.getAttribute('data-halign'), null, 'destination alignment remains its default');

  const isolatedSection = addFirstSection(document);
  const isolatedBody = bodyOf(isolatedSection);
  stubHit(window, isolatedBody);
  const movedRow = destinationRow;
  const before = [...shotsOf(movedRow)];
  startDrag(window, movedRow.querySelector(':scope > .ev-drag-handle'), 400, 150);
  movePointer(window, document, 400, 900);
  assert.equal(lineInfo(document).parent, isolatedBody);
  releasePointer(window, document);
  assert.equal(movedRow.parentElement, isolatedBody);
  assert.equal(movedRow.getAttribute('data-halign'), null);
  assert.deepEqual(shotsOf(movedRow), before);
});

test('the lower half of a destination row appends to that row even when another row follows it', async () => {
  const savedSource = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence">'
      + '<section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Source</span></h2><div class="ev-body">'
      + '<div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="assets/source.png"></div></div>'
      + '</div></section>'
      + '<section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Destination</span></h2><div class="ev-body">'
      + '<div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="assets/first.png"></div></div>'
      + '<div class="ev-comment"><span class="ev-comment-text">between</span></div>'
      + '<div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="assets/second.png"></div></div>'
      + '</div></section>',
  );
  const { document, window } = loadApp(savedSource);
  const [sourceSection, destinationSection] = document.querySelectorAll('#evidence > .ev-section');
  const [source] = shotsOf(rowsOf(sourceSection)[0]);
  const sourceRow = rowsOf(sourceSection)[0];
  const [first] = shotsOf(rowsOf(destinationSection)[0]);
  const [secondRow] = rowsOf(destinationSection).slice(1);
  const second = shotsOf(secondRow)[0];
  const firstRow = rowsOf(destinationSection)[0];
  const comment = bodyOf(destinationSection).querySelector(':scope > .ev-comment');
  setRect(firstRow, 0, 300, 800, 400);
  setRect(comment, 0, 420, 800, 480);
  setRect(secondRow, 0, 500, 800, 600);
  stubHit(window, bodyOf(destinationSection));

  startDrag(window, sourceRow.querySelector(':scope > .ev-drag-handle'), 400, 150);
  movePointer(window, document, 400, 380); // lower half of firstRow
  const info = lineInfo(document);
  assert.equal(info.parent, bodyOf(destinationSection));
  assert.equal(info.next, comment, 'the body boundary after firstRow is before the comment');
  releasePointer(window, document);

  assert.deepEqual(shotsOf(firstRow), [first, source]);
  assert.deepEqual(shotsOf(secondRow), [second]);
  assert.equal(rowsOf(sourceSection).length, 0);
});

test('individual screenshot handles still perform image-level reordering', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  const first = await pasteShot(section, window);
  const second = await pasteShot(section, window);
  const row = rowsOf(section)[0];
  setRect(row, 0, 100, 700, 200);
  setRect(first, 0, 100, 200, 190);
  setRect(second, 212, 100, 412, 190);
  stubHit(window, bodyOf(section));

  startDrag(window, second.querySelector(':scope > .ev-drag-handle'), 300, 140);
  movePointer(window, document, 100, 115);
  assert.equal(lineInfo(document).parent, row, 'the image handle still targets image-level row gaps');
  releasePointer(window, document);
  assert.deepEqual(shotsOf(row), [second, first]);
});

test('a completed row move remains save/reload/save byte-idempotent', async () => {
  const first = loadApp();
  stubImagePipeline(first.window);
  const sourceSection = addFirstSection(first.document);
  await pasteShot(sourceSection, first.window);
  const sourceRow = rowsOf(sourceSection)[0];
  first.document.querySelector('button[data-action="add-section"]').click();
  const destinationSection = first.document.querySelectorAll('#evidence > .ev-section')[1];
  await pasteShot(destinationSection, first.window);
  sectionAction(rowsOf(destinationSection)[0], 'row-valign-bottom').click();
  assert.equal(first.window.__evidence.moveElement(sourceRow, bodyOf(destinationSection), null), true);

  const saved = first.window.__evidence.serialize();
  const reopened = loadApp(saved);
  assert.equal(reopened.window.__evidence.serialize(), saved);
});

test('dropping a row on its own current before or after gap is an exact no-op', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  await pasteShot(section, window);
  await pasteShot(section, window);
  const row = rowsOf(section)[0];
  sectionAction(row, 'row-valign-middle').click();
  const body = bodyOf(section);
  setRect(row, 0, 100, 800, 300);
  stubHit(window, body);
  const before = body.innerHTML;

  startDrag(window, row.querySelector(':scope > .ev-drag-handle'), 400, 140);
  movePointer(window, document, 400, 120); // before its midpoint
  releasePointer(window, document);
  assert.equal(body.innerHTML, before);

  startDrag(window, row.querySelector(':scope > .ev-drag-handle'), 400, 140);
  movePointer(window, document, 400, 280); // after its midpoint
  releasePointer(window, document);
  assert.equal(body.innerHTML, before);
});

test('row drags cancel over invalid chrome, auto-scroll at viewport edges, and cross into a nested section', async () => {
  const { document, window, downloads } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  const rowShot = await pasteShot(section, window);
  const row = rowsOf(section)[0];
  sectionAction(row, 'row-halign-right').click();
  const originalBody = bodyOf(section);
  setRect(row, 0, 100, 800, 300);
  const original = originalBody.innerHTML;
  const scrolls = [];
  window.scrollBy = (dx, dy) => scrolls.push([dx, dy]);

  startDrag(window, row.querySelector(':scope > .ev-drag-handle'), 400, 140);
  stubHit(window, document.getElementById('toolbar'));
  movePointer(window, document, 400, 10);
  movePointer(window, document, 400, 760);
  assert.deepEqual(scrolls, [[0, -12], [0, 12]]);
  assert.equal(lineInfo(document), null, 'invalid chrome hides the preview');
  releasePointer(window, document);
  assert.equal(originalBody.innerHTML, original, 'invalid release is a no-op');
  assert.equal(downloads.length, 0, 'moving never saves');

  sectionAction(section, 'add-subsection').click();
  const nested = bodyOf(section).querySelector(':scope > .ev-section');
  const nestedBody = bodyOf(nested);
  stubHit(window, nestedBody);
  startDrag(window, row.querySelector(':scope > .ev-drag-handle'), 400, 140);
  movePointer(window, document, 400, 420);
  assert.equal(lineInfo(document).parent, nestedBody);
  releasePointer(window, document);
  assert.equal(row.parentElement, nestedBody);
  assert.equal(row.getAttribute('data-halign'), 'right');
  assert.equal(shotsOf(row)[0], rowShot);
});
