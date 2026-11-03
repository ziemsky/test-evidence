import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, appSource, downloadText, stubImagePipeline, pasteImage, waitFor, addFirstSection } from './helpers.js';

// 0026: leaf-row drag & drop (SPEC §15, ticket 0025's locked decisions).
// Seams (pre-agreed in the 0025 spec):
//   1. the core move seam — window.__evidence.moveElement(row, target, before),
//      driven in jsdom; pointer math itself is out of jsdom's reach
//   2. the app source + boot DOM for the chrome wiring (0024 precedent)
//   3. the manual Chromium CDP checklist (recorded in the ticket)

const LEAF_ROWS = ['.ev-comment', '.ev-property', '.ev-screenshot'];

const nums = (document) =>
  [...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent);

const bodyOf = (section) => section.querySelector(':scope > .ev-body');

const leavesIn = (body) =>
  [...body.children].filter((el) => el.matches(LEAF_ROWS.join(', ')));

test('every leaf row type (comment, property, screenshot) carries a drag handle — first child, data-chrome', async (t) => {
  const { document, window } = loadApp();
  const section = addFirstSection(document); // 0040: build the section + rows
  for (let i = 0; i < 3; i++) sectionAction(section, 'add-property').click();
  const props = [...bodyOf(section).querySelectorAll(':scope > .ev-property')];
  assert.equal(props.length, 3, 'three property rows were added');
  for (const prop of props) {
    const first = prop.firstElementChild;
    assert.ok(first, 'the property row is not empty');
    assert.ok(first.matches('.ev-drag-handle'), `first child is the drag handle, got ${first.className}`);
    assert.ok(first.hasAttribute('data-chrome'), 'the handle is chrome');
  }

  const body = bodyOf(section);
  // a comment, through its own add button
  sectionAction(section, 'add-comment').click();
  const comment = body.querySelector(':scope > .ev-comment');
  assert.ok(comment.firstElementChild.matches('.ev-drag-handle[data-chrome]'), 'comment handle');

  // a screenshot, through the paste flow (the real item, not the placeholder)
  stubImagePipeline(window);
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  // 0051 (SPEC §23): a pasted shot lands inside its section's .ev-shot-row
  await waitFor(() => body.querySelector('.ev-shot-row > .ev-screenshot'));
  const shot = body.querySelector('.ev-shot-row > .ev-screenshot');
  assert.ok(shot, 'the pasted screenshot item exists');
  assert.ok(shot.firstElementChild.matches('.ev-drag-handle[data-chrome]'), 'screenshot handle');
});

test('a plain click on a handle does nothing — no move, no save, no chrome churn', () => {
  const { document, downloads } = loadApp();
  const section = addFirstSection(document); // 0040: build the section + row
  sectionAction(section, 'add-property').click();
  const body = bodyOf(section);
  const before = body.innerHTML;
  body.querySelector(':scope > .ev-property .ev-drag-handle').click();
  assert.equal(body.innerHTML, before, 'the row is untouched');
  assert.equal(downloads.length, 0, 'no save was triggered');
});

// ---------------------------------------------------------------------
// The core move seam: window.__evidence.moveElement(row, target, before)
// (0025's locked decision: one function = DOM move + renumber + chrome
// re-render). The pointer handlers feed it; jsdom cannot drive pointers,
// so the handlers' own contract (threshold, line, cancel) is covered by
// source assertions and the CDP checklist.
// ---------------------------------------------------------------------

test('move seam: reorders a leaf within its own section and recomputes numbering', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document); // 0040: build the section + rows
  for (let i = 0; i < 3; i++) sectionAction(section, 'add-property').click();
  const body = bodyOf(section);
  const keyEls = [...body.querySelectorAll(':scope > .ev-property > .ev-prop-key')];
  keyEls[0].textContent = 'Alpha';
  keyEls[1].textContent = 'Beta';
  keyEls[2].textContent = 'Gamma';
  assert.ok(window.__evidence && typeof window.__evidence.moveElement === 'function', 'the move seam is exposed');

  const keysOf = () => [...body.children].map((el) => el.querySelector('.ev-prop-key').textContent);
  assert.deepEqual(keysOf(), ['Alpha', 'Beta', 'Gamma'], 'starting order');

  const [a, , c] = [...body.children];
  window.__evidence.moveElement(c, body, a); // Gamma → first
  assert.deepEqual(keysOf(), ['Gamma', 'Alpha', 'Beta'], 'the leaf moved before the first row');
  assert.equal(nums(document)[0], '1', 'numbering recomputed and correct');

  window.__evidence.moveElement(body.children[0], body, body.children[2]); // Gamma → before Beta
  assert.deepEqual(keysOf(), ['Alpha', 'Gamma', 'Beta'], 'the leaf moved to a between-rows gap');

  window.__evidence.moveElement(body.children[1], body, null); // Gamma → after last
  assert.deepEqual(keysOf(), ['Alpha', 'Beta', 'Gamma'], 'the leaf moved to the after-last gap');
});

test('move seam: moves a leaf across sections and sub-sections, both directions; numbering follows', () => {
  const { document, window } = loadApp();
  const move = (el, target, before) => window.__evidence.moveElement(el, target, before);

  // build through the UI, as the numbering tests do:
  // 1 with subsection 1.1, plus a second top-level section 2
  const s1 = addFirstSection(document); // 0040: build the root section
  const s1body = bodyOf(s1);
  sectionAction(s1, 'add-subsection').click(); // 1.1
  const s11 = s1body.querySelector(':scope > .ev-section');
  // + section: the action sits in the toolbox below the last top-level section
  document.querySelector('.ev-add-section-btn').click();
  const s2el = document.querySelectorAll('#evidence > .ev-section')[1];
  assert.deepEqual(nums(document), ['1', '1.1', '2'], 'starting tree is 1 / 1.1 / 2');

  sectionAction(s1, 'add-comment').click();
  const leaf = s1body.querySelector(':scope > .ev-comment');
  assert.ok(leaf, 'a comment row exists in section 1');

  // down: 1 → 1.1
  move(leaf, bodyOf(s11), null);
  assert.equal(bodyOf(s11).querySelector('.ev-comment'), leaf, 'the leaf landed in the sub-section body');
  assert.deepEqual(nums(document), ['1', '1.1', '2'], 'numbering intact after moving down');

  // deeper: add a 1.1.1 and move the leaf into it
  sectionAction(s11, 'add-subsection').click();
  const s111 = bodyOf(s11).querySelector(':scope > .ev-section');
  move(leaf, bodyOf(s111), null);
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '2'], 'numbering intact after moving deeper');

  // back up two levels: 1.1.1 → 2
  move(leaf, bodyOf(s2el), null);
  assert.equal(s2el.contains(leaf), true, 'the leaf landed in the other top-level section');
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '2'], 'numbering intact after moving up');
});

test('move seam: the top level is never a leaf target, and dropping in place is a no-op', () => {
  const { document, window } = loadApp();
  const move = window.__evidence.moveElement.bind(window.__evidence);
  const root = document.getElementById('evidence');
  const section = addFirstSection(document); // 0040: build the section + rows
  for (let i = 0; i < 3; i++) sectionAction(section, 'add-property').click();
  const body = bodyOf(section);
  const leaf = body.children[1]; // the second property

  assert.equal(move(leaf, root, null), false, 'a top-level target is rejected');
  assert.equal(body.children[1], leaf, 'the row is still in its section');
  assert.equal(leaf.parentElement, body, 'parentage unchanged');

  const before = body.innerHTML;
  assert.equal(move(leaf, body, body.children[2]), true, 'an in-place gap is a valid (no-op) move');
  assert.equal(body.innerHTML, before, 'the DOM is exactly unchanged');
  assert.deepEqual(nums(document), ['1'], 'numbering still correct');
});

test('a move never triggers a save, and the saved file is free of handle and drop-line chrome', async () => {
  const { document, window, downloads } = loadApp();
  const move = window.__evidence.moveElement.bind(window.__evidence);
  const section = addFirstSection(document); // 0040: build the section + rows
  for (let i = 0; i < 3; i++) sectionAction(section, 'add-property').click();
  const keys = [...bodyOf(section).querySelectorAll(':scope > .ev-property > .ev-prop-key')];
  keys[2].textContent = 'Gamma';
  const body = bodyOf(section);
  assert.equal(document.getElementById('save-status'), null);

  move(body.children[2], body, body.children[0]);
  assert.equal(downloads.length, 0, 'no save happened on the move');
  assert.equal(document.getElementById('save-status'), null, 'the move has no visual status display');

  // a drop line sitting in a body at save time must not survive the save
  const line = document.createElement('div');
  line.className = 'ev-drop-line';
  line.setAttribute('data-chrome', '');
  body.appendChild(line);

  document.getElementById('save-btn').click();
  await waitFor(() => downloads.find((d) => d.name));
  const text = await downloadText(downloads.find((d) => d.name));
  // The class names occur in the app's own <style>/<script>; the *content*
  // is what must be chrome-free (same seam as the numbering idempotency test).
  const saved = new JSDOM(text).window.document;
  const content = saved.getElementById('evidence').innerHTML;
  assert.ok(!content.includes('ev-drop-line'), 'the drop line is stripped on save');
  assert.ok(!content.includes('ev-drag-handle'), 'the drag handles are stripped on save');
  assert.equal(saved.querySelectorAll('#evidence [data-chrome]').length, 0, 'no chrome of any kind in the saved content');
  assert.equal(saved.querySelectorAll('#evidence [contenteditable]').length, 0, 'no contenteditable in the saved content');
  assert.ok(content.includes('Gamma'), 'content is intact');
});

test('boot: a file that smuggled in a drop line and a stale handle comes up clean, with the handle re-rendered first-child', async () => {
  const { document, downloads } = loadApp();
  const section = addFirstSection(document); // 0040: build the section + row
  sectionAction(section, 'add-property').click();
  section.querySelector(':scope > .ev-body > .ev-property > .ev-prop-key').textContent = 'Env';
  document.getElementById('save-btn').click();
  await waitFor(() => downloads.find((d) => d.name));
  const base = await downloadText(downloads.find((d) => d.name));

  // inject chrome into the saved file the way a hand edit could leave it
  const dirty = base
    .replace('<span class="ev-text ev-prop-key">Env</span>',
      '<div class="ev-drop-line" data-chrome></div><span class="ev-drag-handle" data-chrome></span><span class="ev-text ev-prop-key">Env</span>');
  const reopened = loadApp(dirty);
  const row = reopened.document.querySelector('#evidence .ev-property');
  assert.equal(row.querySelector('.ev-drop-line'), null, 'the smuggled drop line is gone after boot');
  const handle = row.firstElementChild;
  assert.ok(handle.matches('.ev-drag-handle[data-chrome]'), 'the handle is re-rendered as the row\'s first child');
  assert.equal(row.querySelectorAll('.ev-drag-handle').length, 1, 'exactly one handle per row');
});

// ---------------------------------------------------------------------
// Source assertions (0024/0025 precedent): jsdom cannot evaluate pointer
// geometry or :hover, so the wiring itself is observed in the embedded
// source; the lifecycle around it is driven with real pointer events below.
// ---------------------------------------------------------------------

test('source: the drag is pointer-based and there is no native HTML5 drag & drop', () => {
  const source = appSource();
  assert.ok(!/draggable=/.test(source), 'no native draggable attribute anywhere');
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
    assert.ok(
      source.includes(`addEventListener('${type}'`),
      `a document-level ${type} listener is wired`,
    );
  }
});

test('source: the drop line is created as data-chrome', () => {
  const source = appSource();
  const factory = /function makeDropLine\(\) \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(factory, 'a drop-line factory exists');
  assert.ok(factory[0].includes('ev-drop-line'), 'it creates the ev-drop-line element');
  assert.ok(factory[0].includes('data-chrome'), 'it marks the line data-chrome');
});

// The drag lifecycle is real pointer-event behavior jsdom can exercise:
// the ~4px threshold, the dimmed-row visual, Esc cancel, and
// release-without-line cancel. Snapping geometry (elementFromPoint /
// getBoundingClientRect) has no layout in jsdom — that part is the CDP
// checklist's.
function pointerEvent(window, type, x, y, button = 0) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  Object.defineProperty(ev, 'button', { value: button });
  return ev;
}

test('lifecycle: movement under the ~4px threshold starts no drag; a handle click is a no-op', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document); // 0040: build the section + row
  sectionAction(section, 'add-property').click();
  const row = document.querySelector('#evidence .ev-property');
  const handle = row.querySelector('.ev-drag-handle');
  const before = document.getElementById('evidence').innerHTML;

  handle.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  document.dispatchEvent(pointerEvent(window, 'pointermove', 101, 100)); // 1px
  document.dispatchEvent(pointerEvent(window, 'pointermove', 102, 101)); // ~2.2px
  assert.equal(row.classList.contains('ev-dragging'), false, 'sub-threshold: the row is not dimmed');
  assert.equal(document.body.classList.contains('ev-dragging-active'), false, 'sub-threshold: no grabbing cursor');

  document.dispatchEvent(pointerEvent(window, 'pointerup', 102, 101));
  assert.equal(document.getElementById('evidence').innerHTML, before, 'a handle click moved nothing');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'no drop line was ever created');
});

test('lifecycle: past the threshold the row dims in place; Esc cancels with the DOM unchanged', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document); // 0040: build the section + row
  sectionAction(section, 'add-property').click();
  const row = document.querySelector('#evidence .ev-property');
  const handle = row.querySelector('.ev-drag-handle');
  const before = document.getElementById('evidence').innerHTML;

  handle.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  document.dispatchEvent(pointerEvent(window, 'pointermove', 110, 103)); // >4px → drag starts
  assert.equal(row.classList.contains('ev-dragging'), true, 'the dragged row is dimmed');
  assert.equal(document.body.classList.contains('ev-dragging-active'), true, 'grabbing cursor is on');
  assert.equal(row.parentElement, document.querySelector('#evidence .ev-body'), 'the row stays in its original position (no floating clone)');

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(row.classList.contains('ev-dragging'), false, 'Esc clears the dim');
  assert.equal(document.body.classList.contains('ev-dragging-active'), false, 'Esc clears the cursor');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'Esc removes the line');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'Esc changed nothing in the document');

  // a later release must not resurrect the drag
  document.dispatchEvent(pointerEvent(window, 'pointerup', 110, 103));
  assert.equal(document.getElementById('evidence').innerHTML, before, 'release after Esc is a no-op');
});

test('lifecycle: releasing while no line is shown cancels — the DOM is unchanged', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document); // 0040: build the section + row
  sectionAction(section, 'add-property').click();
  const row = document.querySelector('#evidence .ev-property');
  const handle = row.querySelector('.ev-drag-handle');
  const before = document.getElementById('evidence').innerHTML;

  handle.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  document.dispatchEvent(pointerEvent(window, 'pointermove', 110, 103)); // drag starts
  // jsdom has no layout: elementFromPoint finds no section, so the line is
  // never shown — exactly the "release over an invalid area" case.
  document.dispatchEvent(pointerEvent(window, 'pointerup', 110, 103));
  assert.equal(row.classList.contains('ev-dragging'), false, 'the dim is cleared');
  assert.equal(document.body.classList.contains('ev-dragging-active'), false, 'the cursor is cleared');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'no line left behind');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'nothing moved');
});

test('lifecycle: a pointerdown that is not on a leaf-row handle starts nothing', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document); // 0040: build the section + row
  sectionAction(section, 'add-property').click();
  const row = document.querySelector('#evidence .ev-property');
  row.querySelector('.ev-prop-key').dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  document.dispatchEvent(pointerEvent(window, 'pointermove', 200, 200));
  assert.equal(row.classList.contains('ev-dragging'), false, 'grabbing a row body never starts a drag (text selection stays safe)');
  document.dispatchEvent(pointerEvent(window, 'pointerup', 200, 200));
  assert.equal(document.body.classList.contains('ev-dragging-active'), false);
});

test('save idempotency (A4) still holds around a move: save → reopen → save is byte-identical', async () => {
  const first = loadApp();
  const section = addFirstSection(first.document); // 0040: build the section + rows
  for (let i = 0; i < 3; i++) sectionAction(section, 'add-property').click();
  first.window.__evidence.moveElement(
    bodyOf(section).children[2],
    bodyOf(section),
    null,
  );
  first.document.getElementById('save-btn').click();
  await waitFor(() => first.downloads.find((d) => d.name));
  const saved1 = await downloadText(first.downloads.find((d) => d.name));

  const second = loadApp(saved1);
  second.document.getElementById('save-btn').click();
  await waitFor(() => second.downloads.find((d) => d.name));
  const saved2 = await downloadText(second.downloads.find((d) => d.name));
  assert.equal(saved2, saved1, 'save → reopen → save is byte-identical');
});

// ---------------------------------------------------------------------
// 0027: section drag & drop (SPEC §15) — sections at any depth are
// draggable; a section moves its whole subtree, re-nests into another
// section's body, or is promoted via a top-level gap; a section can
// never be dropped onto itself or into its own content tree.
// ---------------------------------------------------------------------

const topSections = (document) => [...document.querySelectorAll('#evidence > .ev-section')];
const addBtns = (document) => [...document.querySelectorAll('#evidence .ev-add-section-btn')];

/** Build through the UI: 1 (Setup) / 1.1 (comment, property) / 1.1.1 (property) / 2 (comment). */
function buildTree(document) {
  const s1 = addFirstSection(document); // 0040: build the root section
  s1.querySelector(':scope > h2.ev-title > .ev-title-text').textContent = 'Setup';
  sectionAction(s1, 'add-subsection').click(); // 1.1
  const s11 = bodyOf(s1).querySelector(':scope > .ev-section');
  sectionAction(s11, 'add-comment').click();
  sectionAction(s11, 'add-property').click();
  sectionAction(s11, 'add-subsection').click(); // 1.1.1
  const s111 = bodyOf(s11).querySelector(':scope > .ev-section');
  sectionAction(s111, 'add-property').click();
  document.querySelector('.ev-add-section-btn').click(); // + section → 2
  const s2 = topSections(document)[1];
  sectionAction(s2, 'add-comment').click();
  return { s1, s11, s111, s2 };
}

test('every section title row carries a drag handle — first child of the h2, before the number, data-chrome, at any depth', () => {
  const { document } = loadApp();
  const { s1, s11, s111, s2 } = buildTree(document);
  for (const section of [s1, s11, s111, s2]) {
    const h2 = section.querySelector(':scope > h2.ev-title');
    const first = h2.firstElementChild;
    assert.ok(first && first.matches('.ev-drag-handle'), `the handle is the h2's first child (before the number), got ${first && first.className}`);
    assert.ok(first.hasAttribute('data-chrome'), 'the handle is chrome');
    assert.deepEqual(
      [...h2.children].map((el) => el.className),
      ['ev-drag-handle', 'ev-num', 'ev-text ev-title-text'],
      'handle, number, and title; section actions live in the shared palette',
    );
  }
});

test('move seam: dragging a section moves the whole subtree intact — structure and document order preserved', () => {
  const { document, window } = loadApp();
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const { s1, s11, s111, s2 } = buildTree(document);
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '2'], 'starting tree');

  const subShape = (root) =>
    [...root.querySelectorAll('.ev-section, .ev-comment, .ev-property, .ev-screenshot')].map((el) =>
      el.matches('.ev-section') ? 'S' : el.className,
    );
  const shapeBefore = subShape(s11);
  const orderBefore = [...bodyOf(s11).children].map((el) => el.className);

  assert.equal(move(s11, bodyOf(s2), bodyOf(s2).firstElementChild), true, 're-nest 1.1 into section 2, before its comment');
  assert.equal(bodyOf(s2).firstElementChild, s11, '1.1 is now a sub-section of 2');
  assert.ok(s11.contains(s111), 'the nested 1.1.1 traveled with it');
  assert.deepEqual(subShape(s11), shapeBefore, 'the subtree structure is identical');
  assert.deepEqual([...bodyOf(s11).children].map((el) => el.className), orderBefore, 'document order inside 1.1 is unchanged');
  assert.equal(bodyOf(s1).querySelector(':scope > .ev-section'), null, 'the old parent no longer holds the sub-section');
  assert.equal(bodyOf(s2).children[1], bodyOf(s2).querySelector(':scope > .ev-comment'), '1.1 landed before the comment');
  assert.deepEqual(nums(document), ['1', '2', '2.1', '2.1.1'], 'numbering recomputed (parent prefix + sibling index)');
});

test('move seam: dropping a sub-section at a top-level gap promotes it; the + section buttons re-render with no orphans or duplicates', () => {
  const { document, window } = loadApp();
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const { s1, s11, s2 } = buildTree(document);
  const root = document.getElementById('evidence');

  assert.equal(move(s11, root, s2), true, '1.1 → top level, before section 2');
  assert.deepEqual(topSections(document), [s1, s11, s2], '1.1 is a top-level section between 1 and 2');
  assert.deepEqual(nums(document), ['1', '2', '2.1', '3'], 'numbering recomputed after the promotion');

  const btns = addBtns(document);
  assert.equal(btns.length, 1, 'exactly one + section action (0115)');
  assert.equal(btns[0].parentElement, topSections(document).at(-1).nextElementSibling, 'the toolbox follows the last top-level section');

  // then reorder the top level itself, through the gap before section 2
  assert.equal(move(s2, root, s11), true, 'section 3 → before section 2');
  assert.deepEqual(topSections(document), [s1, s2, s11], '3 is now second');
  assert.deepEqual(nums(document), ['1', '2', '3', '3.1'], 'numbering recomputed (2.1 became 3.1)');
  assert.equal(addBtns(document).length, 1, 'button re-rendered again, no orphans or duplicates');
  assert.equal(
    addBtns(document)[0].parentElement,
    topSections(document).at(-1).nextElementSibling,
    'the toolbox follows the new last top-level section',
  );
});

test('move seam: a section re-nests into another section\'s body at multiple depths (nesting to any depth)', () => {
  const { document, window } = loadApp();
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const { s1, s111, s2 } = buildTree(document);

  assert.equal(move(s2, bodyOf(s111), null), true, 'top-level 2 → into 1.1.1 (three levels deep)');
  assert.equal(bodyOf(s111).lastElementChild, s2, '2 nested at the third level');
  assert.deepEqual(topSections(document), [s1], 'the top level lost section 2');
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '1.1.1.1'], 'numbering recomputed at the new depth');
  const btns = addBtns(document);
  assert.equal(btns.length, 1, 'one + section action left');
  assert.equal(btns[0].parentElement.previousElementSibling, s1, 'the toolbox follows the remaining top-level section');
});

test('move seam: cycle rejection — a section cannot be dropped onto itself or into its own content tree', () => {
  const { document, window } = loadApp();
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const { s1, s11, s111, s2 } = buildTree(document);
  const root = document.getElementById('evidence');
  const before = root.innerHTML;

  assert.equal(move(s1, bodyOf(s1), null), false, 'into its own body: rejected');
  assert.equal(move(s1, bodyOf(s11), null), false, 'into its own descendant\'s body: rejected');
  assert.equal(move(s1, bodyOf(s111), null), false, 'into its own grand-descendant\'s body: rejected');
  assert.equal(move(s1, root, s11), false, 'a top-level gap anchored to its own descendant: rejected');
  assert.equal(move(s1, bodyOf(s2), s111), false, 'a gap anchored to a node inside its own subtree: rejected');
  assert.equal(root.innerHTML, before, 'the DOM is exactly unchanged after every rejected drop');
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '2'], 'numbering intact');

  // a section may still move within its own *parent* body (an ancestor, not a descendant)
  const orderBefore = [...bodyOf(s11).children].map((el) => el.className);
  assert.equal(move(s111, bodyOf(s11), bodyOf(s11).firstElementChild), true, '1.1.1 reorders within its parent 1.1: allowed');
  assert.notDeepEqual([...bodyOf(s11).children].map((el) => el.className), orderBefore, '…and it actually moved');
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '2'], 'numbering still correct');
});

test('move seam: dropping a section in its own current gap is a valid no-op', () => {
  const { document, window } = loadApp();
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const { s1, s11 } = buildTree(document);
  const root = document.getElementById('evidence');
  const before = root.innerHTML;

  assert.equal(move(s1, root, s1), true, 'a top-level section in its own slot: valid no-op');
  assert.equal(move(s11, bodyOf(s1), s11), true, 'a sub-section in its own slot: valid no-op');
  assert.equal(root.innerHTML, before, 'the DOM is exactly unchanged');
});

test('a section drop never triggers a save, and the saved file is free of handle/line chrome', async () => {
  const { document, window, downloads } = loadApp();
  const { s11 } = buildTree(document);
  assert.equal(document.getElementById('save-status'), null);

  window.__evidence.moveElement(s11, document.getElementById('evidence'), null); // promote to top level
  assert.equal(downloads.length, 0, 'no save happened on the section drop');
  assert.equal(document.getElementById('save-status'), null, 'the drop has no visual status display');

  // a drop line left in the document at save time must not survive the save
  const line = document.createElement('div');
  line.className = 'ev-drop-line';
  line.setAttribute('data-chrome', '');
  document.querySelector('#evidence > .ev-section .ev-body').appendChild(line);

  document.getElementById('save-btn').click();
  await waitFor(() => downloads.find((d) => d.name));
  const text = await downloadText(downloads.find((d) => d.name));
  const saved = new JSDOM(text).window.document;
  const content = saved.getElementById('evidence').innerHTML;
  assert.ok(!content.includes('ev-drop-line'), 'the drop line is stripped on save');
  assert.ok(!content.includes('ev-drag-handle'), 'the drag handles are stripped on save');
  assert.equal(saved.querySelectorAll('#evidence [data-chrome]').length, 0, 'no chrome of any kind in the saved content');
  assert.equal(saved.querySelectorAll('#evidence [contenteditable]').length, 0, 'no contenteditable in the saved content');
  assert.ok(content.includes('Setup'), 'content is intact');
  assert.equal(saved.querySelectorAll('#evidence > .ev-section').length, 3, 'the promoted structure is what was saved');
});

test('save idempotency (A4) still holds around a section move: save → reopen → save is byte-identical', async () => {
  const first = loadApp();
  const { s11 } = buildTree(first.document);
  first.window.__evidence.moveElement(s11, first.document.getElementById('evidence'), null); // promote 1.1
  first.document.getElementById('save-btn').click();
  await waitFor(() => first.downloads.find((d) => d.name));
  const saved1 = await downloadText(first.downloads.find((d) => d.name));

  const second = loadApp(saved1);
  assert.equal(second.document.querySelectorAll('#evidence > .ev-section').length, 3, 'the reopened file has the promoted structure');
  second.document.getElementById('save-btn').click();
  await waitFor(() => second.downloads.find((d) => d.name));
  const saved2 = await downloadText(second.downloads.find((d) => d.name));
  assert.equal(saved2, saved1, 'save → reopen → save is byte-identical around a section move');
});

test('source: the section-title handle is created in the section factory and re-rendered at boot, both data-chrome', () => {
  const source = appSource();
  const factory = /function makeSection\(titleText\) \{[\s\S]*?return section;/.exec(source);
  assert.ok(factory, 'a section factory exists');
  assert.ok(factory[0].includes('makeDragHandle()'), 'makeSection adds the drag handle to the title row');
  const handle = /function makeDragHandle\(\) \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(handle, 'a handle factory exists');
  assert.ok(handle[0].includes('data-chrome'), 'the handle factory marks the handle data-chrome');
  const ensure = /function ensureSectionChrome\(section\) \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(ensure, 'the section chrome re-render exists');
  assert.ok(ensure[0].includes('makeDragHandle()'), 'boot re-renders the section-title handle');
});

test('lifecycle: a section-title handle starts a section drag; Esc cancels with the DOM unchanged', () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document); // 0040: build the section
  const handle = section.querySelector(':scope > h2.ev-title > .ev-drag-handle');
  const before = document.getElementById('evidence').innerHTML;

  handle.dispatchEvent(pointerEvent(window, 'pointerdown', 100, 100));
  document.dispatchEvent(pointerEvent(window, 'pointermove', 112, 103)); // >4px → drag starts
  assert.equal(section.classList.contains('ev-dragging'), true, 'the dragged section is dimmed in place (whole subtree)');
  assert.equal(document.body.classList.contains('ev-dragging-active'), true, 'grabbing cursor is on');

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(section.classList.contains('ev-dragging'), false, 'Esc clears the dim');
  assert.equal(document.body.classList.contains('ev-dragging-active'), false, 'Esc clears the cursor');
  assert.equal(document.querySelector('.ev-drop-line'), null, 'Esc removes the line');
  assert.equal(document.getElementById('evidence').innerHTML, before, 'Esc changed nothing in the document');

  document.dispatchEvent(pointerEvent(window, 'pointerup', 112, 103));
  assert.equal(document.getElementById('evidence').innerHTML, before, 'release after Esc is a no-op');
});
