import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, appSource, downloadText, waitFor, latestOperationResult, addFirstSection } from './helpers.js';

// 0112/0113/0114 (SPEC §21): TOC entry drag nesting zones. While a TOC drag is in
// flight the target is the ROW under the pointer plus the ZONE of that row it
// sits in: the row's right 33% is one band, the whole height of the row —
// "drop as a subsection" (append as last child of that section, available on
// every entry, childless ones included, and advertised by washing that band);
// the left 67% stacks the other two zones vertically, 50/50 — its top half is
// the line above the row at the row's own indent (before, at that depth) and
// its bottom half the line below the row at the row's own indent (after, in
// the row's own parent). The tree ends keep the 0111 meaning: above the
// first row = top-level position 1; below the last row = after the last
// top-level section. Cycle rule: no line and no wash on the dragged entry
// or any of its descendants (release there cancels); a drop in the current
// position is a no-op. Chrome only: line + wash render in #toc-tree, both
// data-chrome, at most one each, removed on drop/cancel; no save.
// Seams (pre-agreed in the ticket):
//   1. the zone mapper — window.__evidence.tocDropTarget(row, zone, section)
//      → { container, before } | null — testable without layout
//   2. the existing move seam — window.__evidence.moveElement(row, target,
//      before) — performs the mapped move (0025 precedent)
//   3. real pointer events for the drag lifecycle (threshold, dim surface,
//      Esc, release-without-line cancel, click suppression); pointer math
//      itself stays out of jsdom's reach, except geometry-stubbed
//      end-to-end drops (the 0055 stub-hit pattern)
//   4. the embedded source for the wiring (0024 precedent)

const TEMPLATE_MAIN =
  '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>';

function appWith(inner) {
  const source = appSource();
  assert.ok(source.includes(TEMPLATE_MAIN), 'the template main is the expected seam');
  return source.replace(TEMPLATE_MAIN, `<main id="evidence">${inner}</main>`);
}

const SECTION = (title) =>
  `<section class="ev-section">
    <h2 class="ev-title"><span class="ev-text ev-title-text">${title}</span></h2>
    <div class="ev-body"></div>
  </section>`;

const withBody = (section, bodyInner) =>
  section.replace('<div class="ev-body"></div>', `<div class="ev-body">${bodyInner}</div>`);

// 1 (A) / 1.1 (A1) / 1.2 (A2) / 1.2.1 (A21) / 2 (B) / 3 (C)
function deepMain() {
  const a = withBody(
    SECTION('A'),
    SECTION('A1') + withBody(SECTION('A2'), SECTION('A21')),
  );
  return appWith(a + SECTION('B') + SECTION('C'));
}

const sectionsOf = (document) => [...document.querySelectorAll('#evidence .ev-section')];
const sectionByTitle = (document, title) =>
  sectionsOf(document).find(
    (s) => s.querySelector(':scope > .ev-title > .ev-title-text').textContent === title,
  );
const bodyOf = (section) => section.querySelector(':scope > .ev-body');
const tocEntries = (document) => [...document.querySelectorAll('#toc-tree [data-action="toc-goto"]')];
const entryTexts = (document) => tocEntries(document).map((e) => e.textContent);
const entryPads = (document) => tocEntries(document).map((e) => e.style.paddingLeft);
const nums = (document) => [...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent);
const titlesInOrder = (document) =>
  sectionsOf(document).map((s) => s.querySelector(':scope > .ev-title > .ev-title-text').textContent);
const washedRows = (document) => [...document.querySelectorAll('#toc-tree .toc-drop-wash')];

function pointerEvent(window, type, x, y, button = 0) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  Object.defineProperty(ev, 'button', { value: button });
  return ev;
}

const dragStart = (window, document) =>
  document.dispatchEvent(pointerEvent(window, 'pointermove', 112, 103)); // >4px from (100,100)

const escape = (window, document) =>
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

/** Stub the tree's rendered geometry (jsdom has no layout — 0055 pattern). */
function stubTocGeometry(window, document) {
  const entries = tocEntries(document);
  let y = 40;
  const rows = entries.map((entry) => {
    const top = y;
    const bottom = top + 24;
    entry.getBoundingClientRect = () => ({
      left: 0, top, right: 240, bottom, x: 0, y: top, width: 240, height: 24, toJSON: () => ({}),
    });
    y = bottom;
    return { entry, top, bottom };
  });
  document.getElementById('toc-panel').getBoundingClientRect = () => ({
    left: 0, top: 0, right: 240, bottom: 800, x: 0, y: 0, width: 240, height: 800, toJSON: () => ({}),
  });
  const tree = document.getElementById('toc-tree');
  window.document.elementFromPoint = (x, py) => {
    if (x < 0 || x > 240) return null;
    if (py < rows[0].top) return null; // the pinned header, above the tree
    if (py > rows[rows.length - 1].bottom) {
      // the tree's own 8px bottom padding: the hit is the tree itself
      return py <= rows[rows.length - 1].bottom + 8 ? tree : null;
    }
    const row = rows.find((r) => py >= r.top && py < r.bottom);
    return row ? row.entry : null;
  };
  return rows;
}

// Zone points inside a stubbed 240px-wide, 24px-tall row. The cut is
// horizontal first: x ≥ 67% of the row width (≥ 161) is the INSIDE band at
// ANY height; the left 67% splits vertically at the row's mid-line — above
// it the BEFORE zone, below it the AFTER zone.
const INSIDE_X = 200; // 83% of the row → the inside band
const LEFT_X = 120;   // 50% of the row → the before/after stack
const BEFORE_ZONE = (row) => row.top + 2;
const INSIDE_ZONE = (row) => row.top + 12;
const AFTER_ZONE = (row) => row.top + 22;

// ---------------------------------------------------------------------
// 1. The zone mapper seam
// ---------------------------------------------------------------------

test('seam: window.__evidence.tocDropTarget is exposed as the TOC zone mapper', () => {
  const { window } = loadApp(deepMain());
  assert.equal(typeof window.__evidence.tocDropTarget, 'function', 'the zone mapper is exposed');
  assert.equal(typeof window.__evidence.moveElement, 'function', 'the move seam still exists');
});

test('zone model: before/after/inside map to the row section\'s own document positions', () => {
  const { document, window } = loadApp(deepMain());
  const root = document.getElementById('evidence');
  const [A, A1, A2, A21, B, C] = sectionsOf(document);
  const [eA, eA1, eA2, eA21, eB, eC] = tocEntries(document);
  const addToolbox = document.querySelector('#evidence > [data-add-toolbox]');
  const map = window.__evidence.tocDropTarget;

  // the dragged sections are chosen so the cycle rule does not exclude the
  // row (the rule itself has its own test below)
  const cases = [
    // before: the document gap immediately before the row, at the row's depth
    [eA1, 'before', C, bodyOf(A), A1, 'before 1.1: first-subsection re-nest slot'],
    [eA21, 'before', B, bodyOf(A2), A21, 'before 1.2.1: child slot inside 1.2'],
    [eB, 'before', A2, root, B, 'before 2: top level between 1 and 2 (promotion)'],
    [eC, 'before', A1, root, C, 'before 3'],
    // after: the next slot in the row's OWN parent
    [eA1, 'after', A2, bodyOf(A), A2, 'after 1.1: the next slot in section 1'],
    [eA21, 'after', B, bodyOf(A2), null, 'after 1.2.1 (last child of 1.2): append in 1.2'],
    [eA, 'after', C, root, B, 'after 1: top level between 1 and 2'],
    [eC, 'after', A1, root, addToolbox, 'after 3 (last top level): after the last top-level section'],
    // inside: append as last child — the new "become a subsection" target
    [eC, 'inside', A1, bodyOf(C), null, 'inside 3: a CHILDLESS section is a valid inside target'],
    [eA2, 'inside', B, bodyOf(A2), null, 'inside 1.2: a section WITH children (append last)'],
    [eA, 'inside', B, bodyOf(A), null, 'inside 1: top-level sections are inside targets too'],
  ];
  for (const [row, zone, drag, container, before, why] of cases) {
    const target = map(row, zone, drag);
    assert.ok(target, `${why} has a target`);
    assert.equal(target.container, container, `${why} — container`);
    assert.equal(target.before, before, `${why} — before`);
  }
});

test('zone model edge: non-entry rows, unknown zones, and non-section drags map to null', () => {
  const { document, window } = loadApp(deepMain());
  const [A] = sectionsOf(document);
  const [eA] = tocEntries(document);
  const map = window.__evidence.tocDropTarget;
  assert.equal(map(document.createElement('button'), 'before', A), null, 'a non-entry row is not a target');
  assert.equal(map(eA, 'sideways', A), null, 'an unknown zone is not a target');
  assert.equal(map(eA, 'before', null), null, 'no dragged section: no target');
  assert.equal(map(eA, 'before', document.createElement('div')), null, 'a non-section cannot be dragged');
});

// ---------------------------------------------------------------------
// 2. Cycle rule & no-op
// ---------------------------------------------------------------------

test('cycle rule: every zone on a descendant row is null; on the dragged row itself only inside is a cycle', () => {
  const { document, window } = loadApp(deepMain());
  const [A, , A2] = sectionsOf(document);
  const [eA, eA1, eA2, eA21] = tocEntries(document);
  const root = document.getElementById('evidence');
  const map = window.__evidence.tocDropTarget;

  // dragging 1 (A): every zone on 1.1, 1.2 and 1.2.1 is inside its own
  // subtree — including "after 1.2.1" (the append slot of A's own body)
  for (const zone of ['before', 'inside', 'after']) {
    assert.equal(map(eA1, zone, A), null, `${zone} 1.1 (own child): no target`);
    assert.equal(map(eA2, zone, A), null, `${zone} 1.2 (own child): no target`);
    assert.equal(map(eA21, zone, A), null, `${zone} 1.2.1 (own grandchild): no target`);
  }
  // the dragged row itself: before/after are its current position (a valid
  // no-op); inside is a cycle
  assert.notEqual(map(eA, 'before', A), null, 'before 1 itself: the current position (no-op)');
  assert.notEqual(map(eA, 'after', A), null, 'after 1 itself: the current position (no-op)');
  assert.equal(map(eA, 'inside', A), null, 'inside 1 itself: a cycle');
  // every other (non-descendant) row keeps all three zones
  for (const [row, why] of [[tocEntries(document)[4], '2'], [tocEntries(document)[5], '3']]) {
    for (const zone of ['before', 'inside', 'after']) {
      assert.notEqual(map(row, zone, A), null, `${zone} ${why}: unaffected by the cycle rule`);
    }
  }

  // dragging 1.2 (A2): its child 1.2.1 is excluded in every zone; siblings and
  // the top level are not
  for (const zone of ['before', 'inside', 'after']) assert.equal(map(eA21, zone, A2), null, `${zone} 1.2.1 (own child): no target`);
  for (const zone of ['before', 'inside', 'after']) assert.notEqual(map(eA1, zone, A2), null, `${zone} 1.1: a sibling, not a descendant`);
  assert.notEqual(map(eA2, 'before', A2), null, 'before 1.2 itself: the current position (allowed no-op)');
  assert.notEqual(map(eA, 'before', A2), null, 'before 1: promotion is fine');
});

test('no-op: a drop in the section\'s current position (before/after its own row) leaves the content DOM unchanged', () => {
  const { document, window } = loadApp(deepMain());
  const root = document.getElementById('evidence');
  const [A, , A2] = sectionsOf(document);
  const [eA2] = tocEntries(document).slice(2, 3); // 1.2 A2 (document order A, A1, A2, …)
  const map = window.__evidence.tocDropTarget;
  const before = root.innerHTML;

  const ownBefore = map(eA2, 'before', A2); // before 1.2 = A2's current position in 1
  assert.equal(window.__evidence.moveElement(A2, ownBefore.container, ownBefore.before), true, 'the mapped drop is a valid no-op');
  assert.equal(root.innerHTML, before, 'the before-own-row no-op changed nothing');

  const ownAfter = map(eA2, 'after', A2); // after 1.2 (last child of 1) = A2's current position
  assert.equal(ownAfter.container, bodyOf(A), 'the after target is A2\'s own parent');
  assert.equal(ownAfter.before, null, '…as an append (A2 is the parent\'s last child)');
  assert.equal(window.__evidence.moveElement(A2, ownAfter.container, ownAfter.before), true, 'the append no-op is valid');
  assert.equal(root.innerHTML, before, 'the after-own-row no-op changed nothing');

  assert.deepEqual(titlesInOrder(document), ['A', 'A1', 'A2', 'A21', 'B', 'C'], 'the tree is untouched');
  assert.deepEqual(entryTexts(document), ['1 A', '1.1 A1', '1.2 A2', '1.2.1 A21', '2 B', '3 C'], 'the TOC still matches');
});

// ---------------------------------------------------------------------
// 3. Drop: the mapped target through the existing move seam
// ---------------------------------------------------------------------

test('drop: the inside band on a CHILDLESS second-level section makes the dragged section its last child', () => {
  const { document, window, downloads } = loadApp(deepMain());
  const A1 = sectionByTitle(document, 'A1');
  const C = sectionByTitle(document, 'C');
  const eA1 = tocEntries(document)[1]; // 1.1 A1

  const target = window.__evidence.tocDropTarget(eA1, 'inside', C); // 1.1 has no children
  assert.equal(target.container, bodyOf(A1), 'the inside target is 1.1\'s own body');
  assert.equal(window.__evidence.moveElement(C, target.container, target.before), true, 'the mapped move lands');

  assert.deepEqual(titlesInOrder(document), ['A', 'A1', 'C', 'A2', 'A21', 'B'], 'C is 1.1\'s (only) child');
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '1.2', '1.2.1', '2'], 'numbering recomputed');
  assert.deepEqual(entryTexts(document), ['1 A', '1.1 A1', '1.1.1 C', '1.2 A2', '1.2.1 A21', '2 B'], 'TOC matches the new order');
  assert.deepEqual(entryPads(document), ['0em', '1em', '2em', '1em', '2em', '0em'], 'TOC depths match');
  assert.equal(downloads.length, 0, 'no save is triggered');
});

test('drop: the inside band on a section WITH children appends the whole dragged subtree last', () => {
  const { document, window } = loadApp(deepMain());
  const A2 = sectionByTitle(document, 'A2');
  const B = sectionByTitle(document, 'B');
  const eA2 = tocEntries(document)[2]; // 1.2 A2

  const target = window.__evidence.tocDropTarget(eA2, 'inside', B);
  assert.equal(window.__evidence.moveElement(B, target.container, target.before), true, 'the mapped move lands');

  assert.deepEqual(titlesInOrder(document), ['A', 'A1', 'A2', 'A21', 'B', 'C'], 'B is 1.2\'s last child, after 1.2.1');
  assert.deepEqual(nums(document), ['1', '1.1', '1.2', '1.2.1', '1.2.2', '2'], 'numbering recomputed');
  assert.deepEqual(entryTexts(document), ['1 A', '1.1 A1', '1.2 A2', '1.2.1 A21', '1.2.2 B', '2 C'], 'TOC matches the new order');
  assert.deepEqual(entryPads(document), ['0em', '1em', '1em', '2em', '2em', '0em'], 'TOC depths match');
});

test('drop: the after zone moves the section to the next slot in its own parent (0111 sibling-after)', () => {
  const first = loadApp(deepMain());
  {
    const { document, window } = first;
    const C = sectionByTitle(document, 'C');
    const [eA] = tocEntries(document);

    const target = window.__evidence.tocDropTarget(eA, 'after', C); // after 1 → between 1 and 2
    assert.equal(window.__evidence.moveElement(C, target.container, target.before), true, 'C → after 1');
    // A1/A2/A21 are nested inside A, so document order lists them before A closes
    assert.deepEqual(titlesInOrder(document), ['A', 'A1', 'A2', 'A21', 'C', 'B'], 'C is top level between 1 and 2');
    assert.deepEqual(nums(document), ['1', '1.1', '1.2', '1.2.1', '2', '3'], 'numbering recomputed');
  }
  const second = loadApp(deepMain());
  {
    const { document, window } = second;
    const A1 = sectionByTitle(document, 'A1');
    const eB = tocEntries(document)[4]; // 2 B

    const target = window.__evidence.tocDropTarget(eB, 'after', A1); // after 2 (B) → between B and C
    assert.equal(window.__evidence.moveElement(A1, target.container, target.before), true, 'A1 → after 2');
    assert.deepEqual(titlesInOrder(document), ['A', 'A2', 'A21', 'B', 'A1', 'C'], 'A1 is between 2 and 3');
    assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '2', '3', '4'], 'numbering recomputed');
  }
});

test('drop: the before zone moves before the row at the row\'s own depth (0111 sibling-before)', () => {
  const { document, window, downloads } = loadApp(deepMain());
  const A2 = sectionByTitle(document, 'A2');
  const eA1 = tocEntries(document)[1]; // 1.1 A1

  const target = window.__evidence.tocDropTarget(eA1, 'before', A2); // before 1.1 inside section A
  assert.equal(window.__evidence.moveElement(A2, target.container, target.before), true, 'the mapped move lands');

  assert.deepEqual(titlesInOrder(document), ['A', 'A2', 'A21', 'A1', 'B', 'C'], 'the whole subtree moved intact');
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '1.2', '2', '3'], 'numbering recomputed');
  assert.deepEqual(entryTexts(document), ['1 A', '1.1 A2', '1.1.1 A21', '1.2 A1', '2 B', '3 C'], 'TOC entries and numbers match the new order');
  assert.deepEqual(entryPads(document), ['0em', '1em', '2em', '1em', '0em', '0em'], 'TOC depths match the new nesting');
  assert.equal(tocEntries(document).length, sectionsOf(document).length, 'one entry per section still');
  assert.equal(downloads.length, 0, 'no save is triggered');
});

test('drop: the tree ends — above the first row is top-level position 1, below the last row is after the last top-level section', () => {
  const { document, window } = loadApp(deepMain());
  const A = sectionByTitle(document, 'A');
  const A1 = sectionByTitle(document, 'A1');
  const C = sectionByTitle(document, 'C');
  const [eA] = tocEntries(document); // 1 A (the first entry is always top level)
  const root = document.getElementById('evidence');

  const top = window.__evidence.tocDropTarget(eA, 'before', C);
  assert.equal(top.container, root, 'the top end container is #evidence');
  assert.equal(top.before, A, 'the top end anchors before the first top-level section');
  assert.equal(window.__evidence.moveElement(C, top.container, top.before), true, 'C → top-level position 1');
  assert.deepEqual(nums(document), ['1', '2', '2.1', '2.2', '2.2.1', '3'], 'numbering recomputed');

  // the first move re-rendered the panel: re-query the (now last) entry
  const lastEntry = tocEntries(document).at(-1);
  assert.equal(lastEntry.textContent, '3 B', 'B is now the last entry');
  const bottom = window.__evidence.tocDropTarget(lastEntry, 'after', A1);
  assert.equal(bottom.container, root, 'the bottom end container is #evidence');
  assert.equal(window.__evidence.moveElement(A1, bottom.container, bottom.before), true, 'A1 → after the last top-level section');
  assert.deepEqual(titlesInOrder(document), ['C', 'A', 'A2', 'A21', 'B', 'A1'], 'A1 is the last top-level section');
  assert.deepEqual(nums(document), ['1', '2', '2.1', '2.1.1', '3', '4'], 'numbering recomputed');
  assert.deepEqual(entryTexts(document), ['1 C', '2 A', '2.1 A2', '2.1.1 A21', '3 B', '4 A1'], 'TOC matches the new order');
});

// ---------------------------------------------------------------------
// 4. Drag lifecycle (real pointer events — no layout needed)
// ---------------------------------------------------------------------

test('lifecycle: a pointerdown on an entry arms the shared drag machine — the entry dims, the document section does not', () => {
  const { document, window } = loadApp(deepMain());
  const [A] = sectionsOf(document);
  const entry = tocEntries(document)[0];
  const before = document.getElementById('evidence').innerHTML;

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  assert.equal(entry.classList.contains('ev-dragging'), false, 'sub-threshold: not armed yet');
  dragStart(window, document); // >4px → the drag starts

  assert.equal(entry.classList.contains('ev-dragging'), true, 'the dragged entry is dimmed');
  assert.equal(A.classList.contains('ev-dragging'), false, 'the document section is untouched');
  assert.equal(document.body.classList.contains('ev-dragging-active'), true, 'the shared grabbing cursor is on');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'the document is untouched while dragging');
  assert.equal(latestOperationResult(document), null, 'the Move operation is in flight (started, not finished)');

  escape(window, document);
  assert.equal(entry.classList.contains('ev-dragging'), false, 'Esc clears the entry dim');
  assert.equal(document.body.classList.contains('ev-dragging-active'), false, 'Esc clears the cursor');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'Esc removes the line');
  assert.equal(washedRows(document).length, 0, 'Esc removes the wash');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'Esc changed nothing in the document');
  assert.equal(latestOperationResult(document).message, 'Move canceled', 'the Move operation completes as canceled (console only)');

  document.dispatchEvent(pointerEvent(window, 'pointerup', 112, 103));
  assert.equal(document.getElementById('evidence').innerHTML, before, 'a release after Esc is a no-op');
});

test('lifecycle: a ≤4px release is the entry click — the drag never starts and the section is scrolled to', () => {
  const { document, window } = loadApp(deepMain());
  const [, A1] = sectionsOf(document);
  const entry = tocEntries(document)[1]; // 1.1 A1
  const scrolls = [];
  window.HTMLElement.prototype.scrollIntoView = function (opts) { scrolls.push({ el: this, opts }); };

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  document.dispatchEvent(pointerEvent(window, 'pointermove', 102, 101)); // ~2.2px: under the threshold
  assert.equal(entry.classList.contains('ev-dragging'), false, 'sub-threshold: the entry is not dimmed');
  assert.equal(document.body.classList.contains('ev-dragging-active'), false, 'sub-threshold: no grabbing cursor');
  document.dispatchEvent(pointerEvent(window, 'pointerup', 102, 101));
  assert.equal(document.querySelector('.ev-drop-line'), null, 'no drop line was ever created');
  assert.equal(washedRows(document).length, 0, 'no wash was ever created');

  entry.click();
  assert.equal(scrolls.length, 1, 'the ≤4px click still navigates');
  assert.equal(scrolls[0].el, A1, '…to the entry section');
  assert.equal(scrolls[0].opts.behavior, 'smooth');
  assert.equal(latestOperationResult(document), null, 'a plain click logs no operation');
});

test('lifecycle: releasing while no line is shown cancels — nothing moved, the Move operation completes as canceled', () => {
  const { document, window } = loadApp(deepMain());
  const entry = tocEntries(document)[0];
  const before = document.getElementById('evidence').innerHTML;

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  dragStart(window, document); // >4px → the drag starts
  // jsdom has no elementFromPoint: over the tree the line never shows —
  // exactly the "release over an invalid area" case
  document.dispatchEvent(pointerEvent(window, 'pointerup', 112, 103));

  assert.equal(entry.classList.contains('ev-dragging'), false, 'the dim is cleared');
  assert.equal(document.body.classList.contains('ev-dragging-active'), false, 'the cursor is cleared');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'no line left behind');
  assert.equal(washedRows(document).length, 0, 'no wash left behind');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'nothing moved');
  const op = latestOperationResult(document);
  assert.equal(op.name, 'Move', 'the operation is the shared Move');
  assert.equal(op.message, 'Move canceled', '…completed as canceled, console only');
});

test('lifecycle: a real drag suppresses the entry click; the next genuine click still navigates', () => {
  const { document, window } = loadApp(deepMain());
  const [, A1] = sectionsOf(document);
  const entry = tocEntries(document)[1];
  const scrolls = [];
  window.HTMLElement.prototype.scrollIntoView = function () { scrolls.push(this); };

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  dragStart(window, document); // >4px: a real drag
  document.dispatchEvent(pointerEvent(window, 'pointerup', 112, 103)); // canceled (no line in jsdom)

  entry.click(); // the browser's own click after the release
  assert.equal(scrolls.length, 0, 'the post-drag click is suppressed — a real drag never navigates');

  entry.click(); // a fresh activation
  assert.deepEqual(scrolls, [A1], 'the next genuine click still navigates');
});

test('lifecycle: a fresh pointerdown clears a stale suppression — a later clean click navigates', () => {
  const { document, window } = loadApp(deepMain());
  const [, A1] = sectionsOf(document);
  const entry = tocEntries(document)[1];
  const scrolls = [];
  window.HTMLElement.prototype.scrollIntoView = function () { scrolls.push(this); };

  // a real drag, canceled with no line (jsdom) — the suppression is armed
  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  dragStart(window, document);
  document.dispatchEvent(pointerEvent(window, 'pointerup', 112, 103));

  // a fresh, clean click gesture on the same entry
  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  document.dispatchEvent(pointerEvent(window, 'pointerup', 101, 100)); // ≤4px: a click
  entry.click();
  assert.deepEqual(scrolls, [A1], 'the clean click navigates despite the earlier drag');
});

test('edge: the collapsed panel (hidden tree) has no drag surface', () => {
  const { document, window } = loadApp(deepMain());
  document.getElementById('toc-toggle').click(); // collapse
  const entry = tocEntries(document)[0];
  const before = document.getElementById('evidence').innerHTML;

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  dragStart(window, document);
  assert.equal(entry.classList.contains('ev-dragging'), false, 'no drag arms from the hidden tree');
  assert.equal(document.body.classList.contains('ev-dragging-active'), false, 'no grabbing cursor');
  document.dispatchEvent(pointerEvent(window, 'pointerup', 112, 103));
  assert.equal(document.getElementById('evidence').innerHTML, before, 'nothing changed');
});

test('edge: a zero-section document has no entries and nothing to drag', () => {
  const { document } = loadApp(); // bare document
  assert.equal(tocEntries(document).length, 0, 'no entries');
  assert.ok(document.querySelector('#toc-tree .toc-hint'), 'the hint stands in for the entries');
});

test('edge: a right-click or a non-primary button on an entry arms no drag', () => {
  const { document, window } = loadApp(deepMain());
  const entry = tocEntries(document)[0];
  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100, 2)); // right button
  dragStart(window, document);
  assert.equal(entry.classList.contains('ev-dragging'), false, 'a right-click does not arm a drag');
  document.dispatchEvent(pointerEvent(window, 'pointerup', 112, 103));
  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100, 1)); // middle button
  dragStart(window, document);
  assert.equal(entry.classList.contains('ev-dragging'), false, 'a middle-click does not arm a drag');
  document.dispatchEvent(pointerEvent(window, 'pointerup', 112, 103));
  assert.equal(document.body.classList.contains('ev-dragging-active'), false);
});

// ---------------------------------------------------------------------
// 5. Auto-scroll: the tree's own scrollport, never the page
// ---------------------------------------------------------------------

test('auto-scroll: near the tree scrollport edges the panel scrolls ~12px per tick; the page scroll is untouched', () => {
  const { document, window } = loadApp(deepMain());
  const panel = document.getElementById('toc-panel');
  panel.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 240, bottom: 800, x: 0, y: 0, width: 240, height: 800, toJSON: () => ({}),
  });
  const pageScrolls = [];
  window.scrollBy = (dx, dy) => pageScrolls.push([dx, dy]);
  const entry = tocEntries(document)[0];

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 120, 400));
  document.dispatchEvent(pointerEvent(window, 'pointermove', 120, 790)); // within 40px of the bottom edge
  assert.equal(panel.scrollTop, 12, 'the scrollport scrolls down 12px per tick');
  assert.equal(pageScrolls.length, 0, 'the page scroll is untouched');

  document.dispatchEvent(pointerEvent(window, 'pointermove', 120, 10)); // within 40px of the top edge
  assert.equal(panel.scrollTop, 0, 'at the top edge it scrolls back up');
  assert.equal(pageScrolls.length, 0, 'the page scroll is still untouched');

  document.dispatchEvent(pointerEvent(window, 'pointermove', 400, 790)); // over the document, outside the panel
  assert.equal(panel.scrollTop, 0, 'outside the panel the tree does not scroll');
});

// ---------------------------------------------------------------------
// 6. End-to-end pointer drops with stubbed geometry (the 0055 pattern)
// ---------------------------------------------------------------------

test('drop: the inside band shows the wash + the +1em line and appends the dragged section as last child', () => {
  const { document, window, downloads } = loadApp(deepMain());
  const rows = stubTocGeometry(window, document);
  const [A1] = [sectionByTitle(document, 'A1')];
  const C = sectionByTitle(document, 'C');
  const entry = tocEntries(document)[5]; // 3 C
  const scrolls = [];
  window.HTMLElement.prototype.scrollIntoView = function () { scrolls.push(this); };
  const before = document.getElementById('evidence').innerHTML;

  // press C's entry, drag up over the INSIDE band of 1.1 (A1 — childless)
  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 120, rows[5].top + 12));
  document.dispatchEvent(pointerEvent(window, 'pointermove', INSIDE_X, INSIDE_ZONE(rows[1])));

  const line = document.querySelector('.ev-drop-line');
  assert.ok(line, 'the drop line is shown in the inside band');
  assert.ok(line.hasAttribute('data-chrome'), 'the line is data-chrome');
  assert.equal(line.parentElement, document.getElementById('toc-tree'), 'the line renders in the TOC tree only');
  assert.equal(line.previousElementSibling, rows[1].entry, 'the line sits just below the washed row');
  assert.equal(line.style.marginLeft, '2em', '…indented +1em (child level: 1.1 is at 1em)');
  const wash = washedRows(document);
  assert.deepEqual(wash, [rows[1].entry], 'the washed row is exactly the target row');
  assert.ok(rows[1].entry.hasAttribute('data-chrome'), 'the wash is data-chrome');
  assert.equal(document.getElementById('evidence').querySelector('.ev-drop-line, .toc-drop-wash'), null, 'never in the document');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'the document is untouched while dragging');
  assert.equal(entry.classList.contains('ev-dragging'), true, 'the dragged entry is dimmed');
  assert.equal(C.classList.contains('ev-dragging'), false, 'the document section is untouched');

  document.dispatchEvent(pointerEvent(window, 'pointerup', INSIDE_X, INSIDE_ZONE(rows[1])));
  assert.deepEqual(titlesInOrder(document), ['A', 'A1', 'C', 'A2', 'A21', 'B'], 'C is 1.1\'s last child');
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '1.2', '1.2.1', '2'], 'numbering recomputed');
  assert.deepEqual(entryTexts(document), ['1 A', '1.1 A1', '1.1.1 C', '1.2 A2', '1.2.1 A21', '2 B'], 'the TOC re-rendered in the new order');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'the line is removed after the drop');
  assert.equal(washedRows(document).length, 0, 'the wash is removed after the drop');
  assert.equal(entry.classList.contains('ev-dragging'), false, 'the dim is cleared');
  assert.equal(document.body.classList.contains('ev-dragging-active'), false, 'the cursor is cleared');
  assert.equal(downloads.length, 0, 'no save is triggered');
  const op = latestOperationResult(document);
  assert.equal(op.name, 'Move', 'the shared Move operation');
  assert.equal(op.outcome, 'success');
  assert.equal(op.message, 'Moved section', '…completed as a moved section (console only)');

  // a completed drag suppresses the entry's navigation click
  tocEntries(document)[2].click(); // the re-rendered C entry
  assert.equal(scrolls.length, 0, 'no navigation from the post-drag click');
});

test('drop: the before zone shows the line above the row at the row\'s own indent (no wash) and moves before it', () => {
  const { document, window } = loadApp(deepMain());
  const rows = stubTocGeometry(window, document);
  const A2 = sectionByTitle(document, 'A2');
  const entry = tocEntries(document)[2]; // 1.2 A2
  const before = document.getElementById('evidence').innerHTML;

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 120, rows[2].top + 12));
  document.dispatchEvent(pointerEvent(window, 'pointermove', LEFT_X, BEFORE_ZONE(rows[4]))); // before zone of 2 B

  const line = document.querySelector('.ev-drop-line');
  assert.ok(line, 'the drop line is shown in the before zone');
  assert.equal(line.parentElement, document.getElementById('toc-tree'), 'the line renders in the tree');
  assert.equal(line.nextElementSibling, rows[4].entry, 'the line sits directly above the row');
  assert.equal(line.style.marginLeft, '', '…at the row\'s own indent (no child indent)');
  assert.equal(washedRows(document).length, 0, 'no wash in the before zone');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'the document is untouched while dragging');

  document.dispatchEvent(pointerEvent(window, 'pointerup', LEFT_X, BEFORE_ZONE(rows[4])));
  assert.deepEqual(titlesInOrder(document), ['A', 'A1', 'A2', 'A21', 'B', 'C'], 'A2 promoted before B (sibling-before)');
  assert.deepEqual(nums(document), ['1', '1.1', '2', '2.1', '3', '4'], 'numbering recomputed');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'the line is removed after the drop');
});

test('drop: the after zone shows the line below the row at the row\'s own indent (no wash) and moves after it in its parent', () => {
  const { document, window } = loadApp(deepMain());
  const rows = stubTocGeometry(window, document);
  const A1 = sectionByTitle(document, 'A1');
  const entry = tocEntries(document)[1]; // 1.1 A1
  const before = document.getElementById('evidence').innerHTML;

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 120, rows[1].top + 12));
  document.dispatchEvent(pointerEvent(window, 'pointermove', LEFT_X, AFTER_ZONE(rows[4]))); // after zone of 2 B

  const line = document.querySelector('.ev-drop-line');
  assert.ok(line, 'the drop line is shown in the after zone');
  assert.equal(line.parentElement, document.getElementById('toc-tree'), 'the line renders in the tree');
  assert.equal(line.previousElementSibling, rows[4].entry, 'the line sits directly below the row');
  assert.equal(line.nextElementSibling, rows[5].entry, '…before the next row');
  assert.equal(line.style.marginLeft, '', '…at the row\'s own indent');
  assert.equal(washedRows(document).length, 0, 'no wash in the after zone');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'the document is untouched while dragging');

  document.dispatchEvent(pointerEvent(window, 'pointerup', LEFT_X, AFTER_ZONE(rows[4])));
  assert.deepEqual(titlesInOrder(document), ['A', 'A2', 'A21', 'B', 'A1', 'C'], 'A1 moved after B (sibling-after)');
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '2', '3', '4'], 'numbering recomputed');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'the line is removed after the drop');
});

test('geometry: the right 33% band is the inside zone at ANY height; the left 67% splits 50/50 at the row\'s mid-line', () => {
  const { document, window } = loadApp(deepMain());
  const rows = stubTocGeometry(window, document);
  const entry = tocEntries(document)[5]; // 3 C
  entry.dispatchEvent(pointerEvent(window, 'pointerdown', LEFT_X, rows[5].top + 12));
  document.dispatchEvent(pointerEvent(window, 'pointermove', INSIDE_X, INSIDE_ZONE(rows[1])));

  const row = rows[1].entry; // 1.1 A1 — a 1em-indented row
  const line = () => document.querySelector('.ev-drop-line');
  const washed = () => washedRows(document);
  const belowRow = () => !!line() && line().previousElementSibling === row;
  const aboveRow = () => !!line() && line().nextElementSibling === row;
  const atChildIndent = () => !!line() && line().style.marginLeft === '2em';
  const atRowIndent = () => !!line() && line().style.marginLeft === '';

  // the inside band runs the row's whole height: its top and bottom edges,
  // and every height between, are the SAME zone (wash + child-indent line)
  for (const y of [rows[1].top + 1, INSIDE_ZONE(rows[1]), rows[1].bottom - 1]) {
    document.dispatchEvent(pointerEvent(window, 'pointermove', INSIDE_X, y));
    assert.deepEqual(washed(), [row], `the inside band washes the row at y=${y}`);
    assert.ok(belowRow(), `the inside line stays below the row at y=${y}`);
    assert.ok(atChildIndent(), '…at the child indent (+1em)');
  }
  // the band is wider than 0113's 25%: x = 71% of the row (well left of the
  // old 75% boundary) is inside now
  document.dispatchEvent(pointerEvent(window, 'pointermove', 170, INSIDE_ZONE(rows[1])));
  assert.deepEqual(washed(), [row], 'x = 71% of the row is inside');
  // the boundary itself (x = 67% of the row width = 160.8, so 161) is inside
  document.dispatchEvent(pointerEvent(window, 'pointermove', 161, INSIDE_ZONE(rows[1])));
  assert.deepEqual(washed(), [row], 'x = 67% of the row is inside');
  // just left of the boundary the inside zone is gone: the mid-line is the
  // before/after split, so the pointer lands in the after half
  document.dispatchEvent(pointerEvent(window, 'pointermove', 159, rows[1].top + 12));
  assert.deepEqual(washed(), [], 'the left 67% never washes');
  assert.ok(belowRow(), 'the line is below the row');
  assert.ok(atRowIndent(), '…at the row\'s own indent (after)');
  // above the mid-line in the left stack is the before zone
  document.dispatchEvent(pointerEvent(window, 'pointermove', LEFT_X, rows[1].top + 11));
  assert.ok(aboveRow(), 'the line is above the row');
  assert.ok(atRowIndent(), '…at the row\'s own indent (before)');
  assert.deepEqual(washed(), [], 'no wash in the before zone');
  // below it is the after zone
  document.dispatchEvent(pointerEvent(window, 'pointermove', LEFT_X, rows[1].top + 13));
  assert.ok(belowRow(), 'the line is below the row');
  assert.ok(atRowIndent(), '…at the row\'s own indent (after)');

  escape(window, document);
  assert.equal(document.querySelector('.ev-drop-line'), null, 'Esc leaves no line');
  assert.deepEqual(washed(), [], '…and no wash');
});

test('drop: the bottom end band (in the tree below the last row) maps to after the last top-level section', () => {
  const { document, window } = loadApp(deepMain());
  const rows = stubTocGeometry(window, document);
  const A1 = sectionByTitle(document, 'A1');
  const entry = tocEntries(document)[1]; // 1.1 A1
  const before = document.getElementById('evidence').innerHTML;

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 120, rows[1].top + 12));
  // in the tree's own 8px bottom padding, below the last row (3 C)
  document.dispatchEvent(pointerEvent(window, 'pointermove', 120, rows[5].bottom + 4));

  const line = document.querySelector('.ev-drop-line');
  assert.ok(line, 'the drop line is shown in the bottom end band');
  assert.equal(line.previousElementSibling, rows[5].entry, 'the line sits below the last row');
  assert.equal(line.nextElementSibling, null, '…and nothing follows it');
  assert.equal(washedRows(document).length, 0, 'no wash at the tree ends');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'the document is untouched while dragging');

  document.dispatchEvent(pointerEvent(window, 'pointerup', 120, rows[5].bottom + 4));
  assert.deepEqual(titlesInOrder(document), ['A', 'A2', 'A21', 'B', 'C', 'A1'], 'A1 is the last top-level section');
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '2', '3', '4'], 'numbering recomputed');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'the line is removed after the drop');
});

test('cycle: no line and no wash in ANY zone over the dragged subtree; a release there cancels', () => {
  const { document, window } = loadApp(deepMain());
  const rows = stubTocGeometry(window, document);
  const entry = tocEntries(document)[0]; // 1 A
  const before = document.getElementById('evidence').innerHTML;

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 120, rows[0].top + 12));
  // inside band of 1.1 (own child), before zone of 1.2.1 (own grandchild),
  // inside band of 1 (own row — "inside" itself)
  for (const [x, y] of [[INSIDE_X, INSIDE_ZONE(rows[1])], [LEFT_X, BEFORE_ZONE(rows[3])], [INSIDE_X, INSIDE_ZONE(rows[0])]]) {
    document.dispatchEvent(pointerEvent(window, 'pointermove', x, y));
    assert.equal(document.querySelector('.ev-drop-line'), null, `no line at (${x},${y})`);
    assert.equal(washedRows(document).length, 0, `no wash at (${x},${y})`);
  }
  assert.equal(entry.classList.contains('ev-dragging'), true, 'the drag itself is still in flight');

  document.dispatchEvent(pointerEvent(window, 'pointerup', INSIDE_X, INSIDE_ZONE(rows[1])));
  assert.equal(document.getElementById('evidence').innerHTML, before, 'the release there cancels — nothing moved');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'no line left behind');
  assert.equal(washedRows(document).length, 0, 'no wash left behind');
  assert.equal(latestOperationResult(document).message, 'Move canceled', '…logged as canceled, console only');
});

test('chrome: a drop on the dragged row\'s own before/after zone is a no-op (line shows, nothing moves, chrome refresh only)', () => {
  const { document, window } = loadApp(deepMain());
  const rows = stubTocGeometry(window, document);
  const entry = tocEntries(document)[2]; // 1.2 A2
  const before = document.getElementById('evidence').innerHTML;

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 120, rows[2].top + 12));
  document.dispatchEvent(pointerEvent(window, 'pointermove', LEFT_X, BEFORE_ZONE(rows[2]))); // before zone of its own row

  assert.ok(document.querySelector('.ev-drop-line'), 'the current-position line shows (a valid no-op)');
  document.dispatchEvent(pointerEvent(window, 'pointerup', LEFT_X, BEFORE_ZONE(rows[2])));
  assert.equal(document.getElementById('evidence').innerHTML, before, 'a current-position drop is a no-op');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'the line is removed');
  assert.equal(washedRows(document).length, 0, 'no wash left behind');
});

test('chrome: the wash is one row only, cleared (with the line) by Esc', () => {
  const { document, window } = loadApp(deepMain());
  const rows = stubTocGeometry(window, document);
  const entry = tocEntries(document)[5]; // 3 C
  const before = document.getElementById('evidence').innerHTML;

  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 120, rows[5].top + 12));
  document.dispatchEvent(pointerEvent(window, 'pointermove', INSIDE_X, INSIDE_ZONE(rows[1])));
  assert.equal(washedRows(document).length, 1, 'exactly one washed row while hovering');

  // move out to a sibling-zone row: the wash follows the pointer, one at a time
  document.dispatchEvent(pointerEvent(window, 'pointermove', INSIDE_X, INSIDE_ZONE(rows[4])));
  assert.deepEqual(washedRows(document), [rows[4].entry], 'the wash moved to the new row');
  assert.equal(document.querySelectorAll('#toc-tree .toc-drop-wash').length, 1, 'still exactly one');

  escape(window, document);
  assert.equal(washedRows(document).length, 0, 'Esc clears the wash');
  assert.equal(document.querySelector('#toc-tree [data-chrome]'), null, 'no data-chrome mark survives on any entry');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'Esc clears the line too');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'Esc changed nothing in the document');
});

// ---------------------------------------------------------------------
// 7. Chrome & serialization
// ---------------------------------------------------------------------

test('serialization: a save after a zone drag carries no TOC markup, no wash, and no drag state (panel expanded)', async () => {
  const first = loadApp(deepMain());
  const { document, window } = first;
  const A1 = sectionsOf(document)[1]; // 1.1 (document order: A, A1, A2, A21, B, C)
  const eB = tocEntries(document)[4]; // 2 B
  const target = window.__evidence.tocDropTarget(eB, 'inside', A1); // inside band: into B
  assert.equal(window.__evidence.moveElement(A1, target.container, target.before), true, 'the mapped move lands');

  // a leftover drop line + a leftover washed entry (an interrupted drag at save time)
  const line = document.createElement('div');
  line.className = 'ev-drop-line';
  line.setAttribute('data-chrome', '');
  document.getElementById('toc-tree').appendChild(line);
  const entry = tocEntries(document)[0];
  entry.classList.add('toc-drop-wash');
  entry.setAttribute('data-chrome', '');

  document.getElementById('save-btn').click();
  await waitFor(() => first.downloads.find((d) => d.name));
  const text = await downloadText(first.downloads.find((d) => d.name));
  const saved = new JSDOM(text).window.document;

  assert.equal(saved.getElementById('toc-panel'), null, 'no panel in the saved file');
  assert.equal(
    saved.body.querySelector('#toc-tree, .toc-header, [data-action="toc-goto"], [data-action="toggle-toc"]'),
    null,
    'no TOC markup of any kind',
  );
  assert.equal(saved.querySelector('.ev-drop-line'), null, 'the drop line does not survive the save');
  assert.equal(saved.querySelector('.toc-drop-wash'), null, 'the wash does not survive the save');
  assert.equal(saved.querySelector('.ev-dragging'), null, 'the dim class does not survive the save');
  assert.ok(!saved.body.classList.contains('toc-collapsed'), 'no TOC body-state marker');
  assert.equal(saved.querySelectorAll('[data-chrome]').length, 0, 'no data-chrome leakage');
  // the moved structure is what was saved
  assert.deepEqual(
    [...saved.querySelectorAll('#evidence .ev-section')].map((s) =>
      s.querySelector(':scope > .ev-title > .ev-title-text').textContent),
    ['A', 'A2', 'A21', 'B', 'A1', 'C'],
  );
});

test('serialization: a save mid-drag carries no body drag state (the grabbing cursor is chrome)', async () => {
  const first = loadApp(deepMain());
  const { document, window } = first;
  const entry = tocEntries(document)[0];
  // arm and start a TOC drag (the shared machine sets body.ev-dragging-active)
  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  document.dispatchEvent(pointerEvent(window, 'pointermove', 140, 140));
  assert.ok(document.body.classList.contains('ev-dragging-active'), 'the drag is in flight');

  document.getElementById('save-btn').click();
  await waitFor(() => first.downloads.find((d) => d.name));
  const saved = new JSDOM(await downloadText(first.downloads.find((d) => d.name))).window.document;
  assert.equal(saved.body.classList.contains('ev-dragging-active'), false, 'no drag state on the saved body');
  assert.equal(saved.querySelector('.ev-dragging'), null, 'the dim does not survive the save');
});

test('A4: save → reload → save is byte-identical after a zone drag, with the panel expanded and collapsed', async () => {
  const doZoneDrag = (r) => {
    const { document, window } = r;
    const A2 = sectionsOf(document)[2]; // 1.2
    const eB = tocEntries(document)[4]; // 2 B
    const target = window.__evidence.tocDropTarget(eB, 'inside', A2); // inside band: into B
    assert.equal(window.__evidence.moveElement(A2, target.container, target.before), true, 'the mapped move lands');
  };
  const saveText = async (r) => {
    r.document.getElementById('save-btn').click();
    await waitFor(() => r.downloads.find((d) => d.name));
    return downloadText(r.downloads.find((d) => d.name));
  };

  const a1 = loadApp(deepMain());
  doZoneDrag(a1);
  const s1 = await saveText(a1);
  const a2 = loadApp(s1);
  assert.equal(
    a2.document.getElementById('toc-toggle').getAttribute('aria-expanded'),
    'true',
    'the re-open boots expanded',
  );
  const s2 = await saveText(a2);
  assert.equal(s2, s1, 'byte-identical after a zone drag (expanded)');

  const c1 = loadApp(deepMain());
  doZoneDrag(c1);
  c1.document.getElementById('toc-toggle').click(); // collapse before the save
  const s3 = await saveText(c1);
  assert.ok(!new JSDOM(s3).window.document.body.classList.contains('toc-collapsed'), 'the collapsed marker is stripped');
  assert.equal(s3, s1, 'the collapsed save matches the expanded save — no TOC state anywhere');
  const c2 = loadApp(s3);
  c2.document.getElementById('toc-toggle').click();
  const s4 = await saveText(c2);
  assert.equal(s4, s3, 'byte-identical (collapsed)');
});

test('boot: a smuggled TOC panel (drop line, washed entry, dimmed entry, collapsed state) is re-created clean', () => {
  // a hand-edited file could carry TOC drag state — boot must tolerate it:
  // the panel is re-created (every boot is expanded), line, wash, and dim gone
  const smuggled = appWith(
    `<section class="ev-section">
      <h2 class="ev-title"><span class="ev-text ev-title-text">A</span></h2>
      <div class="ev-body"></div>
    </section>`,
  )
    .replace('<body>', '<body class="toc-collapsed">')
    .replace(
      '<main id="evidence">',
      '<nav id="toc-panel" data-chrome>'
      + '<div class="toc-header"><span class="toc-caption">Content</span><button id="toc-toggle">☰</button></div>'
      + '<div id="toc-tree"><div class="ev-drop-line" data-chrome></div>'
      + '<button class="toc-entry toc-drop-wash ev-dragging" data-chrome data-action="toc-goto" data-target="0">1 A</button></div>'
      + '</nav><main id="evidence">',
    );
  const { document } = loadApp(smuggled);
  assert.ok(!document.body.classList.contains('toc-collapsed'), 'the smuggled collapsed state is stripped');
  const panel = document.getElementById('toc-panel');
  assert.ok(panel.hasAttribute('data-chrome'), 'the panel is re-created as chrome');
  assert.equal(panel.querySelector('.ev-drop-line'), null, 'the smuggled drop line is gone');
  assert.equal(panel.querySelector('.toc-drop-wash'), null, 'the smuggled wash is gone');
  assert.equal(panel.querySelector('.ev-dragging'), null, 'the smuggled dim class is gone');
  assert.equal(panel.querySelectorAll('button[data-chrome]').length, 0, 'no smuggled data-chrome mark survives on an entry');
  assert.equal(tocEntries(document).length, 1, 'the tree is re-created from the document');
  assert.equal(tocEntries(document)[0].textContent, '1 A', '…with the live entry');
  assert.equal(document.getElementById('toc-toggle').getAttribute('aria-expanded'), 'true', 'boots expanded');
});

// ---------------------------------------------------------------------
// 8. Wiring (0024 precedent): source + boot DOM
// ---------------------------------------------------------------------

test('wiring: the shared pointerdown path accepts the TOC entry surface, and the click branch suppresses post-drag clicks', () => {
  const source = appSource();
  const pointerDown = /function onDocumentPointerDown\(event\) \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(pointerDown, 'the shared pointerdown handler exists');
  assert.ok(
    pointerDown[0].includes('toc-goto'),
    'the pointerdown path resolves the TOC entry surface',
  );
  assert.ok(
    pointerDown[0].includes('toc-collapsed'),
    'the collapsed panel (hidden tree) is excluded from the drag surface',
  );
  const tocBranch = /if \(action === 'toc-goto'\) \{[\s\S]*?\n    \}/.exec(source);
  assert.ok(tocBranch, 'the toc-goto click branch exists');
  assert.ok(
    tocBranch[0].includes('tocDragClickSuppressed'),
    'a completed (or cancelled) drag suppresses the entry click',
  );
});

test('wiring: the pointermove path resolves the row under the pointer and its zone (right 33% inside / left 67% 50-50), and renders the zone chrome', () => {
  const source = appSource();
  const zoneFn = /function tocZoneForPoint\(x, y\) \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(zoneFn, 'the TOC zone resolver exists');
  assert.ok(zoneFn[0].includes('getBoundingClientRect'), 'the zone is the pointer (x, y) within the row box');
  assert.ok(
    zoneFn[0].includes('TOC_ZONE_INSIDE_FRAC') && zoneFn[0].includes('TOC_ZONE_SPLIT_FRAC'),
    'the right-33% inside band and the 50/50 vertical split constants are used',
  );
  assert.ok(
    zoneFn[0].includes("'before'") && zoneFn[0].includes("'inside'") && zoneFn[0].includes("'after'"),
    'the resolver yields before / inside / after',
  );
  const positionFn = /function positionTocDropLine\(x, y\) \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(positionFn, 'the TOC drop-line positioning exists');
  assert.ok(positionFn[0].includes('tocDropTarget'), 'it maps the row + zone through the pure seam');
  assert.ok(positionFn[0].includes('setTocDropWash'), 'the inside band applies (and clears) the row wash');
  assert.ok(positionFn[0].includes('marginLeft'), 'the inside band indents the line to the child level');
  const washFn = /function setTocDropWash\(row\) \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(washFn, 'the wash helper exists');
  assert.ok(
    washFn[0].includes('toc-drop-wash') && washFn[0].includes('data-chrome'),
    'the wash is a class + data-chrome mark, set and cleared together',
  );
});

test('wiring: the TOC auto-scroll is off the tree scrollport with the §15 constants, not the page', () => {
  const source = appSource();
  const autoScrollToc = /function autoScrollTocTree\([\s\S]*?\n  \}/.exec(source);
  assert.ok(autoScrollToc, 'the TOC auto-scroll helper exists');
  assert.ok(autoScrollToc[0].includes('AUTO_SCROLL_EDGE_PX'), 'the ~40px edge constant is reused');
  assert.ok(autoScrollToc[0].includes('AUTO_SCROLL_STEP_PX'), 'the ~12px step constant is reused');
  assert.ok(autoScrollToc[0].includes('scrollTop'), 'it scrolls the scrollport, not the page');
  assert.ok(!autoScrollToc[0].includes('window.scrollBy'), 'the page scroll is untouched');
});

test('wiring: the boot DOM carries the entry surface the drag machine arms (one button per section, data-chrome panel)', () => {
  const { document } = loadApp(deepMain());
  const entries = tocEntries(document);
  assert.equal(entries.length, sectionsOf(document).length, 'one entry per section at boot');
  for (const entry of entries) {
    assert.equal(entry.tagName, 'BUTTON', 'the entry is a real button');
    assert.match(entry.dataset.target, /^\d+$/, 'the entry resolves its section by index');
  }
  assert.ok(document.getElementById('toc-panel').hasAttribute('data-chrome'), 'the panel (and its entries) is chrome');
});

// ---------------------------------------------------------------------
// 9. No regression: the existing TOC click/scroll and content-pane drag
//    behavior are untouched by the new surface
// ---------------------------------------------------------------------

test('regression: a TOC entry click still scrolls only (no focus change, no save, panel state unchanged)', () => {
  const { document, window, downloads } = loadApp(deepMain());
  const scrolls = [];
  window.HTMLElement.prototype.scrollIntoView = function () { scrolls.push(this); };
  const before = document.activeElement;
  const [C] = sectionsOf(document).slice(-1);
  const entry = tocEntries(document)[5]; // 3 C
  entry.click();
  assert.deepEqual(scrolls, [C], 'the matching section is scrolled into view');
  assert.equal(document.activeElement, before, 'the click focuses nothing');
  assert.equal(downloads.length, 0, 'no save triggered');
  assert.ok(!document.body.classList.contains('toc-collapsed'), 'panel state unchanged');
});

test('regression: the content-pane handle drag is unchanged (the entry surface adds nothing to its lifecycle)', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-property').click();
  const row = document.querySelector('#evidence .ev-property');
  const handle = row.querySelector('.ev-drag-handle');
  const before = document.getElementById('evidence').innerHTML;

  handle.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  document.dispatchEvent(pointerEvent(window, 'pointermove', 112, 103)); // >4px → the row drag starts
  assert.equal(row.classList.contains('ev-dragging'), true, 'the content-pane row still dims');
  escape(window, document);
  assert.equal(row.classList.contains('ev-dragging'), false, 'Esc still cancels it');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'the DOM is unchanged');

  // a pointerdown on a TOC entry does not disturb a content-pane drag that is
  // not in flight, and the two surfaces arm independently
  const entry = tocEntries(document)[0];
  entry.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  document.dispatchEvent(pointerEvent(window, 'pointermove', 112, 103));
  assert.equal(entry.classList.contains('ev-dragging'), true, 'the entry surface arms its own drag');
  assert.equal(document.body.classList.contains('ev-dragging-active'), true);
  escape(window, document);
  assert.equal(document.querySelector('.ev-drop-line'), null, 'nothing left behind');
});
