import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, appSource, downloadText, addFirstSection } from './helpers.js';

// 0033: hover ancestor rails (0030's locked decision; SPEC §5.3/§16). While
// the pointer is anywhere inside a section's subtree, a quiet chain of rails
// is lit: a 2px accent-blue line at the current (innermost) section's own
// left edge plus one 2px faint-neutral line per containing ancestor, stepped
// −6px per level into the page margin (three visible steps; deeper ancestors
// clamp onto the third). The chain is `data-rail` marks (current / a1 / a2 /
// a3) set by one small delegated hover handler; CSS draws the lines from the
// marks. jsdom cannot evaluate :hover, so the marks — not computed styles —
// are the live-DOM assertion target (dispatchEvent seam), and the line look
// is asserted on the stylesheet rule text (0024's prior art). The chain
// clears as soon as the pointer leaves the outermost lit section, is fully
// suppressed while a drag is in flight, never triggers a save, and is
// stripped from the saved file (§5.3.4).
// Seams (pre-agreed in the ticket, per 0024/0031/0032 prior art):
//   1. the live DOM through mouseover/mouseout (dispatchEvent)
//   2. the stylesheet rule text
//   3. the saved file text (downloadText + the A4 idempotency property)

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------

/** Parse the embedded <style> block into [{ selectors, declarations }] (0024's rule-text seam). */
function styleRules() {
  const source = appSource();
  const match = /<style>([\s\S]*?)<\/style>/.exec(source);
  assert.ok(match, 'an embedded <style> block exists');
  const css = match[1].replace(/\/\*[\s\S]*?\*\//g, ' '); // drop comments
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({
      selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
      declarations: m[2].split(';').map((d) => d.trim()).filter(Boolean),
    });
  }
  return rules;
}

/** All declarations that apply to one exact selector (shared + own rules). */
const declsFor = (rules, sel) =>
  rules.flatMap((r) => (r.selectors.includes(sel) ? r.declarations : []));

/** Per-section [label, data-rail] pairs, in document order (null = unmarked).
 * The label is the section's number (plus its title when it has one) — UI-built
 * sections are created with empty titles, so the position-based number is the
 * stable identity. */
const marks = (document) =>
  [...document.querySelectorAll('#evidence .ev-section')].map((s) => {
    const num = s.querySelector(':scope > h2.ev-title > .ev-num')?.textContent ?? '?';
    const title = s.querySelector(':scope > h2.ev-title > .ev-title-text')?.textContent ?? '';
    return [title ? `${num} ${title}` : num, s.getAttribute('data-rail')];
  });

const titleOf = (section) => section.querySelector(':scope > h2.ev-title > .ev-title-text');

const bodyOf = (section) => section.querySelector(':scope > .ev-body');

const hover = (window, target, relatedTarget = null) =>
  target.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget }));

const unhover = (window, target, relatedTarget = null) =>
  target.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget }));

/** Build through the UI (0031's tree): 1 / 1.1 / 1.1.1 / 2. 0040: the
 * root section is built, not inherited; UI-built sections keep empty
 * titles, so the position-based number is each section's identity. */
function buildTree(document) {
  const s1 = addFirstSection(document);
  sectionAction(s1, 'add-subsection').click(); // 1.1
  const s11 = bodyOf(s1).querySelector(':scope > .ev-section');
  sectionAction(s11, 'add-subsection').click(); // 1.1.1
  const s111 = bodyOf(s11).querySelector(':scope > .ev-section');
  document.querySelector('.ev-add-section-btn').click(); // + section → 2
  const s2 = [...document.querySelectorAll('#evidence > .ev-section')][1];
  return { s1, s11, s111, s2 };
}

// A six-level nest (depths 0..5) plus a second top-level section:
// 1 / 1.1 / 1.1.1 / 1.1.1.1 / 1.1.1.1.1 / 1.1.1.1.1.1 / 2 — five
// ancestors above the innermost section, so the a3 clamp is exercised.
function sixDeepTree() {
  const inner = `
      <section class="ev-section">
        <h2 class="ev-title"><span class="ev-text ev-title-text">A11111</span></h2>
        <div class="ev-body"></div>
      </section>`;
  const wrap = (title, body) => `
      <section class="ev-section">
        <h2 class="ev-title"><span class="ev-text ev-title-text">${title}</span></h2>
        <div class="ev-body">${body}</div>
      </section>`;
  return appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence">${wrap('A', wrap('A1', wrap('A11', wrap('A111', wrap('A1111', inner)))))}
      <section class="ev-section">
        <h2 class="ev-title"><span class="ev-text ev-title-text">B</span></h2>
        <div class="ev-body"></div>
      </section>
    </main>`,
  );
}

// ---------------------------------------------------------------------
// The stylesheet: the line look, keyed on the rail marker
// ---------------------------------------------------------------------

test('styles: the current section line is 2px accent blue at its own left edge, full height', () => {
  const rules = styleRules();
  const sel = '.ev-section[data-rail="current"]::before';
  const d = declsFor(rules, sel);
  assert.ok(d.length, `a rule draws the current line (${sel})`);
  for (const want of [
    'width: 2px',
    'background: rgba(0, 120, 215, 0.45)',
    'left: 0',
    'top: 0',
    'bottom: 0',
    'position: absolute',
    'pointer-events: none',
  ]) {
    assert.ok(d.includes(want), `the current line sets ${want} (got ${d.join('; ')})`);
  }
});

test('styles: the three ancestor lines are 2px faint neutral at −6 / −12 / −18px, full height', () => {
  const rules = styleRules();
  const steps = [
    ['a1', 'left: -6px'],
    ['a2', 'left: -12px'],
    ['a3', 'left: -18px'],
  ];
  for (const [rail, left] of steps) {
    const sel = `.ev-section[data-rail="${rail}"]::before`;
    const d = declsFor(rules, sel);
    assert.ok(d.length, `a rule draws the ${rail} line (${sel})`);
    for (const want of [
      'width: 2px',
      'background: rgba(128, 128, 128, 0.35)',
      left,
      'top: 0',
      'bottom: 0',
      'position: absolute',
      'pointer-events: none',
    ]) {
      assert.ok(d.includes(want), `the ${rail} line sets ${want} (got ${d.join('; ')})`);
    }
  }
});

test('styles: the rail rules shift no layout and block no pointer events', () => {
  const rules = styleRules();
  const railRules = rules.filter((r) => r.selectors.some((s) => s.includes('data-rail')));
  assert.ok(railRules.length, 'rail rules exist');
  for (const r of railRules) {
    for (const d of r.declarations) {
      assert.ok(
        !d.startsWith('margin') && !d.startsWith('border') && !d.startsWith('padding'),
        `no rail rule changes layout (got "${d}" in ${r.selectors.join(', ')} { ${r.declarations.join('; ')} })`,
      );
    }
  }
});

// ---------------------------------------------------------------------
// The live DOM: the marks through mouseover/mouseout
// ---------------------------------------------------------------------

test('hovering a top-level section marks a single current line — no ancestors', () => {
  const { document, window } = loadApp(); // 0040: build the top-level section
  const s1 = addFirstSection(document);
  hover(window, titleOf(s1));
  assert.deepEqual(marks(document), [['1', 'current']], 'the hovered section is current, nothing else is marked');

  // Any element in the subtree: a leaf row, not just the title row.
  sectionAction(s1, 'add-property').click();
  const prop = s1.querySelector('.ev-property');
  hover(window, prop.querySelector('.ev-prop-value'));
  assert.deepEqual(marks(document), [['1', 'current']], 'a leaf row inside the subtree keeps the single current mark');
});

test('hovering a deep leaf row lights the full ancestor chain — current / a1 / a2', () => {
  const { document, window } = loadApp();
  const { s1, s11, s111, s2 } = buildTree(document);
  sectionAction(s111, 'add-comment').click();
  const comment = bodyOf(s111).querySelector('.ev-comment');

  hover(window, comment.querySelector('.ev-comment-text'));
  assert.deepEqual(marks(document), [['1', 'a2'], ['1.1', 'a1'], ['1.1.1', 'current'], ['2', null]]);
});

test('hovering a nested section title lights that section and its ancestors', () => {
  const { document, window } = loadApp();
  const { s1, s11, s111, s2 } = buildTree(document);
  hover(window, titleOf(s11));
  assert.deepEqual(marks(document), [['1', 'a1'], ['1.1', 'current'], ['1.1.1', null], ['2', null]]);
});

test('a section deeper than the third step clamps onto a3', () => {
  const { document, window } = loadApp(sixDeepTree());
  const sections = [...document.querySelectorAll('#evidence .ev-section')];
  const innermost = sections[5]; // 1.1.1.1.1.1 — five ancestors above it

  hover(window, titleOf(innermost));
  assert.deepEqual(
    marks(document),
    [
      ['1 A', 'a3'],
      ['1.1 A1', 'a3'],
      ['1.1.1 A11', 'a3'],
      ['1.1.1.1 A111', 'a2'],
      ['1.1.1.1.1 A1111', 'a1'],
      ['1.1.1.1.1.1 A11111', 'current'],
      ['2 B', null],
    ],
    'current / a1 / a2 / a3, with the deeper ancestors clamped onto a3',
  );
});

test('the marks track the pointer — a new hover relights a different chain', () => {
  const { document, window } = loadApp();
  const { s1, s11, s111, s2 } = buildTree(document);
  hover(window, titleOf(s111));
  assert.deepEqual(marks(document), [['1', 'a2'], ['1.1', 'a1'], ['1.1.1', 'current'], ['2', null]]);

  hover(window, titleOf(s2));
  assert.deepEqual(marks(document), [['1', null], ['1.1', null], ['1.1.1', null], ['2', 'current']], 'the old chain is gone, the new one lit');
});

test('the chain clears as soon as the pointer leaves the outermost lit section', () => {
  const { document, window } = loadApp();
  const { s1, s11, s111, s2 } = buildTree(document);
  hover(window, titleOf(s111)); // outermost lit section: 1
  assert.ok(marks(document).some(([, rail]) => rail !== null), 'the chain is lit');

  unhover(window, titleOf(s111), titleOf(s2)); // pointer into a different subtree
  assert.deepEqual(
    marks(document).map(([, rail]) => rail),
    [null, null, null, null],
    'leaving the outermost lit section clears every mark',
  );

  hover(window, titleOf(s111));
  unhover(window, titleOf(s111), null); // pointer leaves the document
  assert.deepEqual(
    marks(document).map(([, rail]) => rail),
    [null, null, null, null],
    'leaving the page clears every mark',
  );
});

test('staying inside the lit subtree keeps the marks', () => {
  const { document, window } = loadApp();
  const { s1, s11, s111 } = buildTree(document);
  hover(window, titleOf(s111)); // outermost lit section: 1
  unhover(window, titleOf(s111), bodyOf(s1)); // pointer moves within the lit subtree
  assert.deepEqual(marks(document), [['1', 'a2'], ['1.1', 'a1'], ['1.1.1', 'current'], ['2', null]], 'a move inside the subtree keeps the chain lit');
});

test('while a drag is in flight the rails are suppressed and resume on the next plain hover', () => {
  const { document, window } = loadApp();
  const { s1, s11, s111, s2 } = buildTree(document);
  const body = document.body;

  document.body.classList.add('ev-dragging-active');
  hover(window, titleOf(s111));
  assert.deepEqual(
    marks(document).map(([, rail]) => rail),
    [null, null, null, null],
    'a hover during a drag is refused — no marks appear',
  );

  body.classList.remove('ev-dragging-active');
  hover(window, titleOf(s2));
  assert.deepEqual(marks(document), [['1', null], ['1.1', null], ['1.1.1', null], ['2', 'current']], 'the chain resumes on the next plain hover');

  document.body.classList.add('ev-dragging-active');
  hover(window, titleOf(s1)); // a plain hover while the (new) drag is in flight
  assert.deepEqual(
    marks(document).map(([, rail]) => rail),
    [null, null, null, null],
    'marks stay cleared while the drag is in flight',
  );
});

// ---------------------------------------------------------------------
// The saved file: the marker is stripped; hovering never saves
// ---------------------------------------------------------------------

test('save: hovering never triggers a save and the saved file carries no rail marker', async () => {
  const { document, window, downloads } = loadApp();
  const { s111 } = buildTree(document);
  hover(window, titleOf(s111));
  assert.equal(downloads.length, 0, 'a plain hover triggers no save');

  document.getElementById('save-btn').click();
  const entry = downloads.find((d) => d.name);
  assert.ok(entry, 'the explicit Save downloaded the file');
  const text = await downloadText(entry);
  const saved = new JSDOM(text).window.document;
  assert.equal(saved.querySelectorAll('#evidence [data-rail]').length, 0, 'no data-rail attribute in the saved content');
  assert.ok(!saved.getElementById('evidence').innerHTML.includes('data-rail'), 'the marker is gone from the evidence markup');

  const reopened = loadApp(text);
  assert.deepEqual(
    [...reopened.document.querySelectorAll('#evidence [data-rail]')],
    [],
    'the reopened file boots with no rail marks',
  );
});

test('A4: with rails in play, save → reload → save stays byte-identical on a nested tree', async () => {
  const first = loadApp();
  const { s111 } = buildTree(first.document);
  hover(first.window, titleOf(s111));
  assert.equal(first.downloads.length, 0, 'the hover itself saves nothing');
  first.document.getElementById('save-btn').click();
  const s1 = await downloadText(first.downloads.find((d) => d.name));
  assert.ok(
    !new JSDOM(s1).window.document.getElementById('evidence').innerHTML.includes('data-rail'),
    'the first saved content carries no rail marker (hovered while marked)',
  );

  const second = loadApp(s1);
  second.document.getElementById('save-btn').click();
  const s2 = await downloadText(second.downloads.find((d) => d.name));
  assert.equal(s2, s1, 'byte-identical after the first save');
});
