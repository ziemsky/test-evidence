import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAction, appSource } from './helpers.js';

// 0024: hover reveal for per-row action buttons; amended by 0026 (the
// leaf-row drag handles) and 0027 (the section-title drag handle).
// Section and screenshot palettes now reclaim their space while hidden; other
// chrome retains the visibility-based hide/reveal treatment.
// Seam: the app source's embedded style block, read through appSource()
// (the single-file app's CSS text is the highest-fidelity observable
// artifact of the reveal — jsdom cannot evaluate :hover). Prior art:
// structural/source assertions in the add-section-buttons and save tests.

// The revealed units: [owning-row selector, revealed direct-child selector].
// Visibility-based units retain their space. Section and screenshot palettes
// use display-based hiding, tested separately below; their drag handles and
// the screenshot row's control strip retain visibility-based hiding.
const REVEALED_UNITS = [
  // [owning-row selector, revealed direct-child selector]
  ['.ev-comment', '.ev-controls'],
  ['.ev-code', '.ev-controls'],
  ['.ev-property', '.ev-controls'],
  ['h2.ev-title', '.ev-drag-handle'],
  ['.ev-comment', '.ev-drag-handle'],
  ['.ev-code', '.ev-drag-handle'],
  ['.ev-file', '.ev-drag-handle'],
  ['.ev-url', '.ev-drag-handle'],
  ['.ev-file', '.ev-controls'], // 0061
  ['.ev-property', '.ev-drag-handle'],
  ['.ev-screenshot', '.ev-drag-handle'],
  ['.ev-shot-row', '.ev-drag-handle'], // 0090
  ['.ev-shot-row', '.ev-row-controls'], // 0051
];

/** Parse the embedded <style> block into [{ selectors, declarations, body }]. */
function styleRules() {
  const source = appSource();
  const match = /<style>([\s\S]*?)<\/style>/.exec(source);
  assert.ok(match, 'an embedded <style> block exists');
  const css = match[1].replace(/\/\*[\s\S]*?\*\//g, ' '); // drop comments
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const declarations = m[2].split(';').map((d) => d.trim()).filter(Boolean);
    rules.push({ selectors, declarations, body: m[2] });
  }
  return rules;
}

const visibilityRules = (rules) =>
  rules.filter((r) => !r.selectors.some((selector) => selector.includes('.ev-section-palette')) &&
    r.declarations.some((d) => d.startsWith('visibility')));

const hidingRules = (rules) =>
  visibilityRules(rules).filter((r) => r.declarations.includes('visibility: hidden'));

const revealRules = (rules) =>
  visibilityRules(rules).filter((r) => r.declarations.includes('visibility: visible'));

test('the shared section palette stays mounted but is visually and interactively hidden at rest', () => {
  const rules = styleRules();
  const declarations = (selector) => rules.filter((r) => r.selectors.includes(selector))
    .flatMap((r) => r.declarations);
  assert.ok(declarations('#evidence > .ev-section-palette').includes('opacity: 0'));
  assert.ok(declarations('#evidence > .ev-section-palette').includes('visibility: hidden'));
  assert.ok(declarations('#evidence > .ev-section-palette').includes('pointer-events: none'));
  assert.ok(declarations('#evidence > .ev-section-palette').some((d) => d.startsWith('transition:')));
  assert.ok(declarations('#evidence > .ev-section-palette[data-palette-visible]')
    .includes('visibility: visible'));
});

test('screenshot palettes occupy space only on hover, including inside screenshot rows', () => {
  const rules = styleRules();
  const declarations = (selector) => rules.filter((r) => r.selectors.includes(selector))
    .flatMap((r) => r.declarations);
  assert.ok(declarations('.ev-screenshot > .ev-controls').includes('display: none'));
  assert.ok(declarations('.ev-screenshot:hover > .ev-controls').includes('display: flex'));
  assert.ok(!declarations('.ev-shot-row > .ev-screenshot > .ev-controls')
    .some((d) => d.startsWith('display')), 'row styling cannot override the hidden display state');
  assert.ok(declarations('.ev-shot-row > .ev-screenshot > .ev-controls').includes('flex-wrap: wrap'));
});

test('the control spans, drag handles, and row strips default to visibility: hidden — via visibility, never display', () => {
  const rules = styleRules();
  const hiding = hidingRules(rules);
  assert.ok(hiding.length >= 1, 'a hiding rule exists');
  // Every revealed unit is hidden by default, each via its owning-row
  // descendant selector.
  for (const [row, child] of REVEALED_UNITS) {
    assert.ok(
      hiding.some((r) => r.selectors.includes(row + ' > ' + child)),
      `${row} > ${child} is hidden by default`,
    );
  }
  // The hiding rule is visibility-based only: no display declaration in it,
  // and nothing hidden except the revealed units themselves.
  const unitSuffixes = REVEALED_UNITS.map(([, child]) => ' > ' + child);
  for (const r of hiding) {
    assert.ok(
      !r.declarations.some((d) => d.startsWith('display')),
      'the hiding rule uses visibility, not display',
    );
    assert.ok(
      r.selectors.every(
        (s) => unitSuffixes.some((suffix) => s.endsWith(suffix)) && !s.includes(':hover'),
      ),
      'the hiding rule targets the non-hovered revealed units only',
    );
  }
});

test('hover reveal: one rule per revealed unit, hover-driven, covering every unit exactly once', () => {
  const rules = styleRules();
  const reveal = revealRules(rules);
  assert.equal(reveal.length, REVEALED_UNITS.length, 'exactly one reveal rule per revealed unit');
  const covered = [];
  for (const r of reveal) {
    assert.equal(r.selectors.length, 1, 'one selector per reveal rule');
    const sel = r.selectors[0];
    const row = sel.slice(0, sel.lastIndexOf(':hover')).trim();
    const child = sel.slice(sel.lastIndexOf(':hover') + ':hover'.length).trim();
    assert.ok(REVEALED_UNITS.some(([uRow, uChild]) => uRow === row && '> ' + uChild === child), `reveal rule for a known unit, got ${sel}`);
    assert.ok(sel.includes(':hover'), `reveal rule is hover-driven, got ${sel}`);
    covered.push(row + ' ' + child.replace(/^> /, ''));
    // Revealed look unchanged: no fade/transition in the reveal rule.
    assert.ok(
      !r.declarations.some((d) => d.startsWith('transition') || d.startsWith('animation')),
      'no fade or transition on reveal',
    );
  }
  assert.deepEqual(covered.sort(), REVEALED_UNITS.map(([row, child]) => row + ' ' + child).sort(), 'each revealed unit covered exactly once');
});

test('no visibility rule touches the + section document-flow buttons or the toolbar', () => {
  const rules = styleRules();
  for (const r of visibilityRules(rules)) {
    for (const sel of r.selectors) {
      assert.ok(!sel.includes('ev-add-section-btn'), `no visibility rule hides the + section buttons (got ${sel})`);
      assert.ok(!sel.includes('#toolbar') && !sel.includes('toolbar'), `no visibility rule targets the toolbar (got ${sel})`);
    }
  }
  // Belt and braces: the + section button rules themselves set no visibility.
  for (const r of rules) {
    if (r.selectors.some((s) => s.includes('ev-add-section-btn'))) {
      assert.ok(!visibilityRules([r]).length, '+ section button rules set no visibility');
    }
  }
});
