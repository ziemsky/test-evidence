import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAction,
  loadApp,
  appSource,
  stubImagePipeline,
  pasteImage,
  waitFor,
  addFirstSection,
} from './helpers.js';

// 0055 (SPEC §15): spatially accurate screenshot drop targeting.
// Seams (repo convention — jsdom has no layout, so rendered geometry is
// stubbed deterministically and REAL pointer events drive the app):
//   1. pointerdown/pointermove/pointerup on the live document with a
//      stubbed elementFromPoint + per-element getBoundingClientRect —
//      the app's spatial math runs for real
//   2. the core move seam — window.__evidence.moveElement(row, target,
//      before, opts) — for the deterministic join/isolated decisions
//   3. the embedded source for the locked boundary constant and the
//      vertical drop-line rule (source text alone never substitutes for
//      the spatial behavior above)

const bodyOf = (section) => section.querySelector(':scope > .ev-body');
const rowsOf = (section) => [...bodyOf(section).querySelectorAll(':scope > .ev-shot-row')];
const shotsOf = (container) => [...container.querySelectorAll(':scope > .ev-screenshot')];

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

/** Stub an element's rendered box (jsdom has no layout). */
function setRect(el, left, top, right, bottom) {
  const rect = {
    left, top, right, bottom,
    x: left, y: top, width: right - left, height: bottom - top,
    toJSON: () => ({}),
  };
  el.getBoundingClientRect = () => rect;
}

/**
 * Point the app's hit-testing at a fixed element. The drag engine uses
 * elementFromPoint only to resolve the innermost section
 * (hit.closest('.ev-section')); all spatial decisions come from the
 * stubbed getBoundingClientRect boxes.
 */
function stubHit(window, element) {
  window.document.elementFromPoint = () => element;
}

function dragFrom(window, handle, x, y) {
  handle.dispatchEvent(pointerEvent(window, 'pointerdown', x, y));
}

function movePointer(window, document, x, y) {
  document.dispatchEvent(pointerEvent(window, 'pointermove', x, y));
}

function releasePointer(window, document) {
  document.dispatchEvent(pointerEvent(window, 'pointerup', 0, 0));
}

/** The current drop-line preview: { line, parent, next, vertical }. */
function lineInfo(document) {
  const line = document.querySelector('.ev-drop-line');
  if (!line) return null;
  return {
    line,
    parent: line.parentElement,
    next: line.nextSibling,
    vertical: line.classList.contains('ev-drop-line-vertical'),
  };
}

const escape = (window, document) =>
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

// ---------------------------------------------------------------------
// In-row targeting (containment wins): 2-D gaps — a vertical segment at a
// side-by-side seam, a horizontal line between wrapped lines, before the
// first line and after the last. The preview and the release agree.
// ---------------------------------------------------------------------

test('in-row: a pointer over a side-by-side seam previews a vertical line between the images; release performs the previewed insert', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s = addFirstSection(document);
  const a = await pasteShot(s, window);
  const b = await pasteShot(s, window);
  const c = await pasteShot(s, window);
  const row = rowsOf(s)[0];
  sectionAction(row, 'row-valign-middle').click();

  // Rendered geometry: three side-by-side shots on one line (column-gap 12px)
  setRect(row, 0, 100, 700, 190);
  setRect(a, 0, 100, 200, 190);
  setRect(b, 212, 100, 412, 190);
  setRect(c, 424, 100, 624, 190);
  stubHit(window, bodyOf(s));

  dragFrom(window, c.querySelector('.ev-drag-handle'), 500, 140); // press over c
  movePointer(window, document, 206, 145); // the seam between a (→200) and b (212→)

  const info = lineInfo(document);
  assert.ok(info, 'the drop line is shown');
  assert.equal(info.parent, row, 'the preview is inside the row — a join, never the body');
  assert.equal(info.next, b, '…at the seam: before the second image');
  assert.equal(info.vertical, true, 'a side-by-side seam previews a vertical segment');

  releasePointer(window, document);
  assert.deepEqual(shotsOf(rowsOf(s)[0]), [a, c, b], 'release performs exactly the previewed operation');
  assert.equal(rowsOf(s).length, 1, 'one row: no extraction into the section body');
  assert.equal(rowsOf(s)[0], row, '…in the same wrapper');
  assert.equal(rowsOf(s)[0].getAttribute('data-valign'), 'middle', 'the row keeps its alignment');
  assert.equal(rowsOf(s)[0].querySelectorAll('.ev-row-controls').length, 1, 'one shared layout palette');
  assert.equal(bodyOf(s).querySelector(':scope > .ev-screenshot'), null, 'no bare body child');
});

test('in-row: a pointer over an image inside its own row reorders within the row — never an extraction into the body', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s = addFirstSection(document);
  const a = await pasteShot(s, window);
  const b = await pasteShot(s, window);
  const c = await pasteShot(s, window);
  const row = rowsOf(s)[0];

  setRect(row, 0, 100, 700, 190);
  setRect(a, 0, 100, 200, 190);
  setRect(b, 212, 100, 412, 190);
  setRect(c, 424, 100, 624, 190);
  stubHit(window, bodyOf(s));

  dragFrom(window, b.querySelector('.ev-drag-handle'), 300, 140);
  movePointer(window, document, 100, 115); // over a, near the row's top edge → before the first image

  const info = lineInfo(document);
  assert.equal(info.parent, row, 'inside the row: the preview is the row\'s own before-first gap');
  assert.equal(info.next, a, '…before the first image');
  assert.equal(info.vertical, false, 'before-first previews a full-width horizontal line');

  releasePointer(window, document);
  assert.deepEqual(shotsOf(rowsOf(s)[0]), [b, a, c], 'reordered within the row');
  assert.equal(rowsOf(s).length, 1, 'still exactly one row');
});

test('in-row: dropping a shot in its own current position is still a no-op (preview at its own seam, release changes nothing)', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s = addFirstSection(document);
  const a = await pasteShot(s, window);
  const b = await pasteShot(s, window);
  const c = await pasteShot(s, window);
  const row = rowsOf(s)[0];

  setRect(row, 0, 100, 700, 190);
  setRect(a, 0, 100, 200, 190);
  setRect(b, 212, 100, 412, 190);
  setRect(c, 424, 100, 624, 190);
  stubHit(window, bodyOf(s));
  const before = bodyOf(s).innerHTML;

  dragFrom(window, b.querySelector('.ev-drag-handle'), 300, 140);
  movePointer(window, document, 206, 145); // the seam immediately before b itself
  assert.equal(lineInfo(document).next, b, 'the preview snaps to b\'s own seam');
  releasePointer(window, document);
  assert.equal(bodyOf(s).innerHTML, before, 'an in-place drop never moves the shot or rebuilds the row');
});

test('in-row: a wrapped row (2+2) — the seam on the second line inserts between those images; the line gap inserts before the line', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s = addFirstSection(document);
  const s0 = await pasteShot(s, window);
  const s1 = await pasteShot(s, window);
  const s2 = await pasteShot(s, window);
  const s3 = await pasteShot(s, window);
  const row = rowsOf(s)[0];

  // Rendered geometry: two lines of two (line 1: s0 s1, line 2: s2 s3)
  setRect(row, 0, 100, 700, 290);
  setRect(s0, 0, 100, 200, 190);
  setRect(s1, 212, 100, 412, 190);
  setRect(s2, 0, 200, 200, 290);
  setRect(s3, 212, 200, 412, 290);
  stubHit(window, bodyOf(s));

  // the seam between s2 and s3 on the second line
  dragFrom(window, s0.querySelector('.ev-drag-handle'), 100, 145);
  movePointer(window, document, 206, 245);
  let info = lineInfo(document);
  assert.equal(info.parent, row, 'the preview is inside the row');
  assert.equal(info.next, s3, '…at the second line\'s seam: before s3');
  assert.equal(info.vertical, true, 'a wrapped-line seam is a vertical segment');
  releasePointer(window, document);
  assert.deepEqual(shotsOf(rowsOf(s)[0]), [s1, s2, s0, s3], 'inserted between the wrapped-line images (s0 before s3)');
});

test('in-row: the gap between two wrapped lines previews a horizontal line in the row gap; release inserts before the new line', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s = addFirstSection(document);
  const s0 = await pasteShot(s, window);
  const s1 = await pasteShot(s, window);
  const s2 = await pasteShot(s, window);
  const s3 = await pasteShot(s, window);
  const row = rowsOf(s)[0];

  setRect(row, 0, 100, 700, 290);
  setRect(s0, 0, 100, 200, 190);
  setRect(s1, 212, 100, 412, 190);
  setRect(s2, 0, 200, 200, 290);
  setRect(s3, 212, 200, 412, 290);
  stubHit(window, bodyOf(s));

  dragFrom(window, s3.querySelector('.ev-drag-handle'), 300, 245);
  movePointer(window, document, 300, 195); // the row gap between the two lines
  const info = lineInfo(document);
  assert.equal(info.parent, row, 'the preview is inside the row');
  assert.equal(info.next, s2, '…in the line gap: before the first image of the second line');
  assert.equal(info.vertical, false, 'a line gap is a full-width horizontal line');
  releasePointer(window, document);
  assert.deepEqual(shotsOf(rowsOf(s)[0]), [s0, s1, s3, s2], 'inserted before the second line');
});

test('in-row: mixed sizes and a vertically-centered short shot — same-line is vertical overlap, so the seam sits between their rendered boxes', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s = addFirstSection(document);
  const s0 = await pasteShot(s, window);
  const s1 = await pasteShot(s, window);
  const s2 = await pasteShot(s, window);
  sectionAction(s0, 'size-small').click();
  sectionAction(s1, 'size-small').click();
  sectionAction(s2, 'standalone').click(); // a full-line shot on its own line
  const row = rowsOf(s)[0];
  sectionAction(row, 'row-valign-middle').click();

  // Line 1: a tall shot and a SHORT centered shot (tops differ — same line
  // by vertical overlap, not by top); line 2: s2.
  setRect(row, 0, 100, 800, 350);
  setRect(s0, 0, 100, 320, 250);
  setRect(s1, 332, 125, 732, 225);
  setRect(s2, 0, 260, 400, 350);
  stubHit(window, bodyOf(s));

  dragFrom(window, s2.querySelector('.ev-drag-handle'), 200, 300);
  movePointer(window, document, 326, 240); // the seam between s0 (→320) and s1 (332→), near the line's bottom
  const info = lineInfo(document);
  assert.equal(info.parent, row, 'the preview is inside the row');
  assert.equal(info.next, s1, '…at the seam between the mixed-size pair: before s1');
  assert.equal(info.vertical, true, '…as a vertical segment spanning the line');
  releasePointer(window, document);
  assert.deepEqual(shotsOf(rowsOf(s)[0]), [s0, s2, s1], 'inserted between the mixed-size images');
  assert.ok(s2.hasAttribute('data-standalone'), 'the standalone state rode along with the moved shot');
  assert.equal(rowsOf(s)[0].querySelectorAll('.ev-row-controls').length, 1, 'one shared palette for the mixed row');
});

// ---------------------------------------------------------------------
// Body gaps: the deterministic 24px "adjacent" boundary. A gap joins a
// row while the pointer is within 24px of the row's rendered box (the row
// above: at its end; the row below: at its start); beyond it the drop is
// isolated — a new single-image row at the gap. The preview is rendered
// inside the destination row for a join, at the body gap for an isolated
// drop, and the release performs the preview.
// ---------------------------------------------------------------------

/** Section s with a two-shot row (100–290) and a comment (310–400); section 2 with an outsider shot E. */
async function rowThenComment(document, window) {
  const s = addFirstSection(document);
  const a = await pasteShot(s, window);
  const b = await pasteShot(s, window);
  const row = rowsOf(s)[0];
  setRect(row, 0, 100, 800, 290);
  setRect(a, 0, 100, 800, 190);
  setRect(b, 0, 200, 800, 290);
  sectionAction(s, 'add-comment').click();
  const comment = bodyOf(s).querySelector(':scope > .ev-comment');
  setRect(comment, 0, 310, 800, 400);
  document.querySelector('button[data-action="add-section"]').click();
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  const e = await pasteShot(s2, window);
  setRect(rowsOf(s2)[0], 0, 500, 800, 590);
  setRect(e, 0, 500, 800, 590);
  return { s, row, comment, e };
}

test('adjacent at the row end: a pointer just below a row (within 24px) previews the row\'s own after-last gap; release joins at the end', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const { s, row, e } = await rowThenComment(document, window);
  stubHit(window, bodyOf(s));

  dragFrom(window, e.querySelector('.ev-drag-handle'), 400, 540);
  movePointer(window, document, 400, 297); // 7px below the row's bottom edge — inside the boundary

  const info = lineInfo(document);
  assert.equal(info.parent, row, 'the preview identifies the destination container: inside the row');
  assert.equal(info.next, null, '…at its after-last gap (the line is the row\'s last child)');
  assert.equal(info.vertical, false, 'a row-end join previews a full-width line');

  releasePointer(window, document);
  assert.equal(rowsOf(s).length, 1, 'the shot joined the row — no new row at the body level');
  assert.equal(rowsOf(s)[0], row);
  assert.equal(rowsOf(s)[0].lastElementChild, e, '…at the row\'s end');
  assert.equal(rowsOf(document.querySelectorAll('#evidence > .ev-section')[1]).length, 0, 'the emptied source row is discarded');
  assert.equal(rowsOf(s)[0].querySelectorAll('.ev-row-controls').length, 1, 'one shared layout palette for the joined row');
});

test('adjacent at the row start: a pointer just above a row (within 24px) previews the row\'s own before-first gap; release joins at the start', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  // comment (100–190) then a single-shot row (210–300)
  const s = addFirstSection(document);
  sectionAction(s, 'add-comment').click();
  const comment = bodyOf(s).querySelector(':scope > .ev-comment');
  setRect(comment, 0, 100, 800, 190);
  const a = await pasteShot(s, window);
  const row = rowsOf(s)[0];
  setRect(row, 0, 210, 800, 300);
  setRect(a, 0, 210, 800, 300);
  document.querySelector('button[data-action="add-section"]').click();
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  const e = await pasteShot(s2, window);
  setRect(rowsOf(s2)[0], 0, 400, 800, 490);
  setRect(e, 0, 400, 800, 490);
  stubHit(window, bodyOf(s));

  dragFrom(window, e.querySelector('.ev-drag-handle'), 400, 440);
  movePointer(window, document, 400, 205); // 5px above the row's top edge — inside the boundary

  const info = lineInfo(document);
  assert.equal(info.parent, row, 'the preview identifies the destination container: inside the row');
  assert.equal(info.next, a, '…at its before-first gap');

  releasePointer(window, document);
  assert.deepEqual(shotsOf(rowsOf(s)[0]), [e, a], 'joined at the row\'s start — before the first image');
  assert.equal(rowsOf(s2).length, 0, 'the emptied source row is discarded');
});

test('the boundary is deterministic: at the row end, 24px below joins while 25px below is isolated — the preview flips, and release performs the previewed operation', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  // a single two-shot row (100–290) as the body's only item
  const s = addFirstSection(document);
  const a = await pasteShot(s, window);
  const b = await pasteShot(s, window);
  const row = rowsOf(s)[0];
  setRect(row, 0, 100, 800, 290);
  setRect(a, 0, 100, 800, 190);
  setRect(b, 0, 200, 800, 290);
  document.querySelector('button[data-action="add-section"]').click();
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  const e = await pasteShot(s2, window);
  setRect(rowsOf(s2)[0], 0, 500, 800, 590);
  setRect(e, 0, 500, 800, 590);
  stubHit(window, bodyOf(s));

  dragFrom(window, e.querySelector('.ev-drag-handle'), 400, 540);
  movePointer(window, document, 400, 314); // exactly 24px below the row
  let info = lineInfo(document);
  assert.equal(info.parent, row, 'at 24px the preview is the join (inside the row)');
  assert.equal(info.next, null, '…at the row\'s end');

  movePointer(window, document, 400, 315); // 25px below: beyond the boundary
  info = lineInfo(document);
  assert.equal(info.parent, bodyOf(s), 'at 25px the preview flips to the isolated drop (the body gap)');
  assert.equal(info.next, null, '…after the row');

  releasePointer(window, document);
  const body = bodyOf(s);
  assert.equal(bodyOf(s).querySelectorAll('.ev-shot-row').length, 2, 'a new single-image row was created — no join');
  assert.equal(body.lastElementChild, body.querySelectorAll('.ev-shot-row')[1], '…at the previewed body gap (after the row)');
  assert.equal(shotsOf(body.querySelectorAll('.ev-shot-row')[1])[0], e, 'the moved node itself, alone');
  assert.ok(!body.querySelectorAll('.ev-shot-row')[1].hasAttribute('data-valign')
    && !body.querySelectorAll('.ev-shot-row')[1].hasAttribute('data-halign'), 'the new row takes the top/center defaults');
  assert.ok(body.querySelectorAll('.ev-shot-row')[1].querySelector(':scope > .ev-row-controls'), '…with its own (hidden) layout controls');
  assert.deepEqual(shotsOf(row), [a, b], 'the source row is intact');
});

test('beyond the boundary at the row start: an isolated drop creates a new single-image row before the row', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s = addFirstSection(document);
  const a = await pasteShot(s, window);
  const row = rowsOf(s)[0];
  setRect(row, 0, 100, 800, 190);
  setRect(a, 0, 100, 800, 190);
  document.querySelector('button[data-action="add-section"]').click();
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  const e = await pasteShot(s2, window);
  setRect(rowsOf(s2)[0], 0, 500, 800, 590);
  setRect(e, 0, 500, 800, 590);
  stubHit(window, bodyOf(s));

  dragFrom(window, e.querySelector('.ev-drag-handle'), 400, 540);
  movePointer(window, document, 400, 80); // 20px above the row: still the join
  let info = lineInfo(document);
  assert.equal(info.parent, row, 'within 24px above the row: the join preview');
  movePointer(window, document, 400, 70); // 30px above: beyond the boundary
  info = lineInfo(document);
  assert.equal(info.parent, bodyOf(s), 'beyond the boundary: the isolated preview at the body gap');
  assert.equal(info.next, row, '…before the row');

  releasePointer(window, document);
  const body = bodyOf(s);
  const rows = body.querySelectorAll('.ev-shot-row');
  assert.equal(rows.length, 2, 'a new single-image row before the row');
  assert.equal(rows[0], body.firstElementChild, '…as the body\'s first item');
  assert.equal(shotsOf(rows[0])[0], e, 'the moved node, alone');
  assert.deepEqual(shotsOf(row), [a], 'the original row is intact after it');
});

test('a gap touching no container is isolated even when a row exists further away (not all section whitespace joins the nearest row)', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  // row (100–290), comment (310–400), property (420–510)
  const s = addFirstSection(document);
  const a = await pasteShot(s, window);
  const b = await pasteShot(s, window);
  const row = rowsOf(s)[0];
  setRect(row, 0, 100, 800, 290);
  setRect(a, 0, 100, 800, 190);
  setRect(b, 0, 200, 800, 290);
  sectionAction(s, 'add-comment').click();
  sectionAction(s, 'add-property').click();
  const comment = bodyOf(s).querySelector(':scope > .ev-comment');
  const property = bodyOf(s).querySelector(':scope > .ev-property');
  setRect(comment, 0, 310, 800, 400);
  setRect(property, 0, 420, 800, 510);
  document.querySelector('button[data-action="add-section"]').click();
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  const e = await pasteShot(s2, window);
  setRect(rowsOf(s2)[0], 0, 600, 800, 690);
  setRect(e, 0, 600, 800, 690);
  stubHit(window, bodyOf(s));

  // mid-comment: 65px below the row (beyond the boundary), equidistant from
  // the (row, comment) and (comment, property) gap boundaries → the TIE goes
  // to the earlier gap; neither neighbor of that gap is within the boundary
  dragFrom(window, e.querySelector('.ev-drag-handle'), 400, 640);
  movePointer(window, document, 400, 355);
  const info = lineInfo(document);
  assert.equal(info.parent, bodyOf(s), 'isolated preview at the body gap');
  assert.equal(info.next, comment, '…the earlier gap on the tie: before the comment');

  releasePointer(window, document);
  const body = bodyOf(s);
  assert.deepEqual([...body.children], [row, body.querySelectorAll('.ev-shot-row')[1], comment, property],
    'a new single-image row between the row and the comment');
  assert.equal(shotsOf(body.querySelectorAll('.ev-shot-row')[1])[0], e, 'the moved node, alone');
  assert.deepEqual(shotsOf(row), [a, b], 'the existing row is untouched');
});

test('hand-edited adjacent rows: a gap within both rows\' zones joins the nearer row; an exact tie goes to the earlier row', async () => {
  // boot trusts wrappers: two adjacent rows are a hand-edited (locked) case
  const savedSource = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">T</span></h2><div class="ev-body">'
    + '<div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="assets/a.png"></div><div class="ev-screenshot"><img class="ev-img" src="assets/b.png"></div></div>'
    + '<div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="assets/c.png"></div></div>'
    + '</div></section>',
  );
  const { document, window } = loadApp(savedSource);
  const body = document.querySelector('#evidence .ev-body');
  const [row1, row2] = [...body.querySelectorAll(':scope > .ev-shot-row')];
  const [a, b] = shotsOf(row1);
  const [c] = shotsOf(row2);
  // row1 (a: 100–190, b: 200–290), row2 (c: 310–400)
  setRect(row1, 0, 100, 800, 290);
  setRect(a, 0, 100, 800, 190);
  setRect(b, 0, 200, 800, 290);
  setRect(row2, 0, 310, 800, 400);
  setRect(c, 0, 310, 800, 400);
  stubHit(window, body);

  // 15px below row1 / 5px above row2 → the NEARER row (row2) at its start
  dragFrom(window, a.querySelector('.ev-drag-handle'), 400, 140);
  movePointer(window, document, 400, 305);
  let info = lineInfo(document);
  assert.equal(info.parent, row2, 'the nearer row wins: row2');
  assert.equal(info.next, c, '…at its start');
  releasePointer(window, document);
  assert.deepEqual(shotsOf(row2), [a, c], 'a joined row2 at its start');
  assert.deepEqual(shotsOf(row1), [b], 'row1 keeps its remainder');

  // exact tie (midpoint 195/305 → 300: 10px from both) → the EARLIER row (row1) at its end
  dragFrom(window, c.querySelector('.ev-drag-handle'), 400, 350);
  movePointer(window, document, 400, 300);
  info = lineInfo(document);
  assert.equal(info.parent, row1, 'an exact tie goes to the earlier row in document order');
  assert.equal(info.next, null, '…at its end');
  releasePointer(window, document);
  assert.deepEqual(shotsOf(row1), [b, c], 'c joined row1 at its end');
  assert.deepEqual(shotsOf(row2), [a], 'row2 keeps its remaining shot (single-image rows are retained)');
});

test('an empty section body is one drop zone: an isolated new single-image row with working layout controls', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s = addFirstSection(document);
  assert.equal(bodyOf(s).children.length, 0, 'the section body is empty');
  document.querySelector('button[data-action="add-section"]').click();
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  const e = await pasteShot(s2, window);
  setRect(rowsOf(s2)[0], 0, 500, 800, 590);
  setRect(e, 0, 500, 800, 590);
  stubHit(window, bodyOf(s));

  dragFrom(window, e.querySelector('.ev-drag-handle'), 400, 540);
  movePointer(window, document, 400, 150);
  const info = lineInfo(document);
  assert.equal(info.parent, bodyOf(s), 'the preview is at the body');
  assert.equal(info.next, null, '…the empty body\'s single zone (append)');

  releasePointer(window, document);
  const row = bodyOf(s).querySelector(':scope > .ev-shot-row');
  assert.ok(row, 'a new single-image row was created');
  assert.equal(shotsOf(row)[0], e, 'the moved node, alone');
  assert.ok(!row.hasAttribute('data-valign') && !row.hasAttribute('data-halign'), 'top/center defaults');
  const strip = row.querySelector(':scope > .ev-row-controls');
  assert.ok(strip && strip.hasAttribute('data-chrome'), 'layout controls are present (chrome, rebuilt)');
  sectionAction(strip, 'row-halign-left').click();
  assert.equal(row.getAttribute('data-halign'), 'left', '…and they work');
  sectionAction(row, 'row-halign-center').click();
  assert.equal(row.hasAttribute('data-halign'), false, 'center restores the omitted default');
});

// ---------------------------------------------------------------------
// The move seam (window.__evidence.moveElement): the 0054 baseline
// (DOM-adjacency join) is unchanged for direct calls; opts.isolated forces
// the spatially isolated outcome; non-image units ignore opts.
// ---------------------------------------------------------------------

test('move seam: the 0054 baseline is unchanged for direct calls, and opts.isolated forces a new single-image row at a row-touching gap', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const move = (row, target, before, opts) => window.__evidence.moveElement(row, target, before, opts);
  const { s, row, comment, e } = await rowThenComment(document, window);
  const body = bodyOf(s);

  assert.equal(move(e, body, comment), true, 'direct call at a row-touching gap: the 0054 baseline joins the row');
  assert.equal(rowsOf(s).length, 1, '…no new row');
  assert.equal(row.lastElementChild, e, '…at the row\'s end');
  window.__evidence.moveElement(e, body, comment, { isolated: true }); // take it back, isolated
  assert.equal(rowsOf(s).length, 2, 'opts.isolated: a new single-image row is created instead');
  assert.equal(body.children[1], rowsOf(s)[1], '…at the same gap (before the comment)');
  assert.equal(shotsOf(rowsOf(s)[1])[0], e, 'the moved node, alone');
  assert.deepEqual(shotsOf(row), shotsOf(row).filter((x) => x !== e), 'the original row kept its remaining shots');
  assert.ok(!rowsOf(s)[1].hasAttribute('data-valign') && !rowsOf(s)[1].hasAttribute('data-halign'), 'top/center defaults');
});

test('move seam: a non-image unit ignores opts.isolated — it still splits a row dropped at its inside gap', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const move = (row, target, before, opts) => window.__evidence.moveElement(row, target, before, opts);
  const s = addFirstSection(document);
  const a = await pasteShot(s, window);
  const b = await pasteShot(s, window);
  const row = rowsOf(s)[0];
  sectionAction(row, 'row-valign-middle').click();
  sectionAction(s, 'add-comment').click();
  const comment = bodyOf(s).querySelector(':scope > .ev-comment');

  assert.equal(move(comment, row, b, { isolated: true }), true, 'a comment at an in-row gap…');
  const body = bodyOf(s);
  const rows = rowsOf(s);
  assert.equal(rows.length, 2, '…still splits the row (opts is inert for non-images)');
  assert.equal(rows[0].getAttribute('data-valign'), 'middle', 'the first half keeps the alignment');
  assert.equal(body.children[1], comment, 'the comment sits between the halves');
});

// ---------------------------------------------------------------------
// Cross-container moves & lifecycle: the preview agrees with the release
// across sections; Esc and invalid destinations cancel with the DOM
// unchanged; non-image drags keep the baseline split; auto-scroll stands.
// ---------------------------------------------------------------------

test('cross-section transfer: a shot dragged over another section\'s row previews that row\'s gap; release joins it and the source keeps its remainder', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s1 = addFirstSection(document);
  const a = await pasteShot(s1, window);
  const b = await pasteShot(s1, window);
  const row1 = rowsOf(s1)[0];
  setRect(row1, 0, 100, 800, 290);
  setRect(a, 0, 100, 800, 190);
  setRect(b, 0, 200, 800, 290);
  document.querySelector('button[data-action="add-section"]').click();
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  const c = await pasteShot(s2, window);
  const d = await pasteShot(s2, window);
  const row2 = rowsOf(s2)[0];
  setRect(row2, 0, 400, 800, 590);
  setRect(c, 0, 400, 800, 490);
  setRect(d, 0, 500, 800, 590);
  sectionAction(row2, 'row-valign-bottom').click();
  stubHit(window, bodyOf(s2));

  dragFrom(window, a.querySelector('.ev-drag-handle'), 400, 140);
  movePointer(window, document, 400, 495); // the gap between c and d inside row2

  const info = lineInfo(document);
  assert.equal(info.parent, row2, 'the preview is inside the destination row (the other section)');
  assert.equal(info.next, d, '…between its images');

  releasePointer(window, document);
  assert.deepEqual(shotsOf(rowsOf(s2)[0]), [c, a, d], 'the shot joined row2 in the previewed order');
  assert.equal(rowsOf(s2)[0], row2, '…into the same wrapper');
  assert.equal(rowsOf(s2)[0].getAttribute('data-valign'), 'bottom', 'the destination row\'s alignment stands');
  assert.equal(rowsOf(s2)[0].querySelectorAll('.ev-row-controls').length, 1, 'one shared palette for the joined row');
  assert.deepEqual(shotsOf(row1), [b], 'the source keeps a single-image row for the remainder');
  assert.equal(row1, rowsOf(s1)[0], '…the same wrapper');
});

test('cross-section transfer into a subsection: the innermost section under the pointer owns the gaps', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s1 = addFirstSection(document);
  s1.querySelector(':scope > h2.ev-title > .ev-title-text').textContent = 'Top';
  sectionAction(s1, 'add-subsection').click();
  const sub = bodyOf(s1).querySelector(':scope > .ev-section');
  const a = await pasteShot(s1, window);
  const row1 = rowsOf(s1)[0];
  setRect(row1, 0, 100, 800, 190);
  setRect(a, 0, 100, 800, 190);
  const c = await pasteShot(sub, window);
  const rowSub = rowsOf(sub)[0];
  setRect(rowSub, 0, 300, 800, 390);
  setRect(c, 0, 300, 800, 390);
  stubHit(window, bodyOf(sub)); // the pointer is inside the subsection

  dragFrom(window, a.querySelector('.ev-drag-handle'), 400, 140);
  movePointer(window, document, 400, 380); // 10px below the subsection row: within the join boundary

  const info = lineInfo(document);
  assert.equal(info.parent, rowSub, 'the innermost section\'s row is the destination — not the parent\'s');
  assert.equal(info.next, null, '…at its end');
  releasePointer(window, document);
  assert.deepEqual(shotsOf(rowSub), [c, a], 'joined the subsection row');
  assert.equal(rowsOf(s1).length, 0, 'the parent row is emptied and discarded');
});

test('Esc cancels a drag with the preview shown — the DOM and the row settings are untouched', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const { s, row, e } = await rowThenComment(document, window);
  sectionAction(row, 'row-valign-middle').click();
  stubHit(window, bodyOf(s));
  const before = document.getElementById('evidence').innerHTML;

  dragFrom(window, e.querySelector('.ev-drag-handle'), 400, 540);
  movePointer(window, document, 400, 297); // the row-end join preview
  assert.equal(lineInfo(document).parent, row, 'the preview is up');
  escape(window, document);

  assert.equal(lineInfo(document), null, 'Esc removes the preview');
  assert.equal(document.getElementById('evidence').innerHTML, before, '…and nothing moved');
  assert.equal(row.getAttribute('data-valign'), 'middle', 'the row\'s settings are untouched');
  assert.equal(rowsOf(document.querySelectorAll('#evidence > .ev-section')[1]).length, 1, 'the source row is intact');

  releasePointer(window, document); // a later release must not resurrect the drag
  assert.equal(document.getElementById('evidence').innerHTML, before, 'release after Esc is a no-op');
});

test('an invalid destination shows no preview; releasing there cancels the move', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const { s, e } = await rowThenComment(document, window);
  stubHit(window, bodyOf(s));
  const before = document.getElementById('evidence').innerHTML;

  dragFrom(window, e.querySelector('.ev-drag-handle'), 400, 540);
  movePointer(window, document, 400, 297); // valid: the line shows
  assert.ok(lineInfo(document), 'a valid preview is up');
  stubHit(window, document.getElementById('toolbar')); // over the toolbar: no section
  movePointer(window, document, 400, 20);
  assert.equal(lineInfo(document), null, 'over a non-section area the preview disappears');
  releasePointer(window, document);

  assert.equal(document.getElementById('evidence').innerHTML, before, 'the release over the invalid area cancels — nothing moved');
  assert.equal(document.body.classList.contains('ev-dragging-active'), false, 'the drag state is fully cleared');
});

test('a non-image pointer drag keeps the baseline: a comment dropped at an in-row gap still splits the row', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s = addFirstSection(document);
  const a = await pasteShot(s, window);
  const b = await pasteShot(s, window);
  const row = rowsOf(s)[0];
  sectionAction(row, 'row-valign-middle').click();
  setRect(row, 0, 100, 800, 290);
  setRect(a, 0, 100, 800, 190);
  setRect(b, 0, 200, 800, 290);
  sectionAction(s, 'add-comment').click();
  const comment = bodyOf(s).querySelector(':scope > .ev-comment');
  setRect(comment, 0, 310, 800, 400);
  stubHit(window, bodyOf(s));

  dragFrom(window, comment.querySelector('.ev-drag-handle'), 400, 350);
  movePointer(window, document, 400, 195); // the in-row gap between the (stacked, full-width) shots

  const info = lineInfo(document);
  assert.equal(info.parent, row, 'the baseline preview: the line inside the row');
  assert.equal(info.next, b, '…at the gap');
  assert.equal(info.vertical, false, 'the baseline stays horizontal for non-image drags');

  releasePointer(window, document);
  const body = bodyOf(s);
  const rows = rowsOf(s);
  assert.equal(rows.length, 2, 'the row split into two around the comment');
  assert.deepEqual(shotsOf(rows[0]), [a], 'the first half keeps its image');
  assert.equal(rows[0].getAttribute('data-valign'), 'middle', '…and the target\'s alignment');
  assert.equal(body.children[1], comment, 'the comment sits between the halves');
  assert.deepEqual(shotsOf(rows[1]), [b], 'the second half');
  assert.ok(!rows[1].hasAttribute('data-valign'), '…is a fresh default row');
});

test('auto-scroll near the viewport edges continues to work during a shot drag', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const { s } = await rowThenComment(document, window);
  stubHit(window, bodyOf(s));
  const scrolls = [];
  window.scrollBy = (dx, dy) => scrolls.push([dx, dy]);
  const e = bodyOf(document.querySelectorAll('#evidence > .ev-section')[1]).querySelector('.ev-screenshot');

  dragFrom(window, e.querySelector('.ev-drag-handle'), 400, 540);
  movePointer(window, document, 400, 10); // within 40px of the top edge
  movePointer(window, document, 400, 760); // within 40px of the bottom (innerHeight 768)
  movePointer(window, document, 400, 400); // mid-page: no scroll

  assert.deepEqual(scrolls, [[0, -12], [0, 12]], 'the existing 40px-edge / 12px-step auto-scroll is intact');
  escape(window, document);
});

// ---------------------------------------------------------------------
// Locked constants & the vertical preview rule (the source seam — the
// spatial behavior itself is covered by the pointer-driven tests above).
// ---------------------------------------------------------------------

test('source: the 24px adjacency boundary is a named constant, and the vertical seam rule stretches a 2px line to its flex line', () => {
  const source = appSource();
  const m = /var SHOT_JOIN_ZONE_PX = (\d+);/.exec(source);
  assert.ok(m, 'the SHOT_JOIN_ZONE_PX constant exists');
  assert.equal(m[1], '24', 'the deterministic "adjacent" boundary is 24px');
  const rule = /\.ev-shot-row > \.ev-drop-line\.ev-drop-line-vertical\s*\{([^}]*)\}/.exec(source);
  assert.ok(rule, 'the vertical drop-line rule exists');
  assert.match(rule[1], /width:\s*2px/);
  assert.match(rule[1], /align-self:\s*stretch/);
});
