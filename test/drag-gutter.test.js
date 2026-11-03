import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAction, appSource } from './helpers.js';

// Drag-handle gutter and shared-content-column rules. The drag handle is an
// inline-block first child of its row, so it indents only the row's FIRST
// line; wrapped lines stick out to the left unless the row reserves its full
// content start. The alignment layout reserves that start on every evidence
// row and pulls the handle back into the left gutter.
// Seam (same rule-text seam as 0024/0033/0034 prior art — jsdom cannot
// evaluate layout): the embedded stylesheet's rule text.

/** Parse the embedded <style> block into [{ selectors, declarations }]. */
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

/** The rows whose first child is a drag handle (SPEC §3). */
const HANDLE_ROWS = ['h2.ev-title', '.ev-comment', '.ev-property', '.ev-file'];

/**
 * The shared content line is deliberately a CSS variable: its live pixel
 * value expands with the document-wide number column and gap. The handle's
 * own geometry is checked separately by the dedicated title/non-title
 * margin rules below.
 */
test('every drag-handle row reserves a full-line gutter via padding-left', () => {
  const rules = styleRules();
  const gutterDeclarations = rules
    .flatMap((r) => r.selectors.map((s) => [s, r.declarations]))
    .filter(([s, d]) => d.some((x) => x.startsWith('padding-left')));

  for (const row of HANDLE_ROWS) {
    const match = gutterDeclarations.find(
      ([s, d]) => s === row && d.includes('padding-left: var(--ev-content-start)'),
    );
    assert.ok(
      match,
      `${row} reserves the shared content start, ` +
        `got ${JSON.stringify(gutterDeclarations.filter(([s]) => s === row))}`,
    );
  }
});

test('the gutter reservation is unconditional — not hover- or focus-gated', () => {
  const rules = styleRules();
  for (const r of rules) {
    if (!r.declarations.some((d) => d.startsWith('padding-left'))) continue;
    for (const sel of r.selectors) {
      if (!r.declarations.includes('padding-left: var(--ev-content-start)')) continue;
      assert.ok(
        !sel.includes(':hover') && !sel.includes(':focus'),
        `the gutter must be layout-stable (0024's zero-reflow reveal), got gated rule ${sel}`,
      );
    }
  }
});

test('each row pulls its handle back into the gutter with a negative margin-left', () => {
  const rules = styleRules();
  for (const row of HANDLE_ROWS) {
    const selector = `${row} > .ev-drag-handle`;
    const r = rules.find((x) => x.selectors.includes(selector));
    assert.ok(r, `a rule targets ${selector}`);
    const ml = r.declarations.find((d) => d.startsWith('margin-left'));
    assert.ok(ml, `${selector} sets margin-left, got ${r.declarations.join('; ')}`);
    assert.ok(
      ml === 'margin-left: calc(-1 * var(--ev-content-start))',
      `the handle's margin-left is the negative of the shared content start, got ${ml}`,
    );
  }
});

test('drag handles reserve a generous hit target with a smaller visible grip', () => {
  const rules = styleRules();
  const handleRule = rules.find((r) => r.selectors.includes('.ev-drag-handle'));
  assert.ok(handleRule, 'a shared drag-handle rule exists');
  assert.ok(handleRule.declarations.includes('width: 2em'), 'the handle reserves a roughly 32px-wide hit target');
  assert.ok(handleRule.declarations.includes('height: 1.75em'), 'the handle reserves a tall vertical hit target');
  assert.ok(handleRule.declarations.includes('position: relative'), 'the visible grip can be centered inside the hit target');

  const gripRule = rules.find((r) => r.selectors.includes('.ev-drag-handle::before'));
  assert.ok(gripRule, 'the handle has a separate visible grip');
  assert.ok(gripRule.declarations.includes('width: 1.1em'), 'the visible grip remains smaller than the hit target');
  assert.ok(gripRule.declarations.includes('height: 1.25em'), 'the visible grip is tall enough to discover');

  const evidenceRule = rules.find((r) => r.selectors.includes('#evidence'));
  assert.ok(evidenceRule, 'the evidence root rule exists');
  assert.ok(evidenceRule.declarations.includes('--ev-gutter-width: 2em'), 'rows reserve the wider interaction gutter');
});

test('section-title handle is taken out of inline flow so it cannot overlap the section number', () => {
  const rules = styleRules();
  const titleRules = rules.filter((r) => r.selectors.includes('h2.ev-title'));
  assert.ok(titleRules.some((r) => r.declarations.includes('position: relative')), 'the section title establishes a positioning context');

  const handleRules = rules.filter((r) => r.selectors.includes('h2.ev-title > .ev-drag-handle'));
  const declarations = handleRules.flatMap((r) => r.declarations);
  for (const declaration of [
    'position: absolute',
    'left: 0',
    'top: 0', // 0105: flush with the title row's top edge
    'margin: 0',
  ]) {
    assert.ok(declarations.includes(declaration), `the title handle uses a non-overlapping gutter placement: ${declaration}`);
  }
  assert.ok(
    !declarations.some((d) => d.startsWith('transform')),
    'the title handle is not vertically re-centered (0105)',
  );
});

test('the focus wash does not collapse the gutter — its padding is vertical longhands', () => {
  const rules = styleRules();
  // A `padding` shorthand on the :focus-within wash (specificity 0,2,0) would
  // override the row's padding-left gutter (0,1,0) the moment the row is
  // focused, shifting the text left. The wash must therefore set only the
  // vertical longhands.
  for (const r of rules) {
    if (!r.selectors.some((s) => s.includes(':focus-within'))) continue;
    for (const d of r.declarations) {
      if (d.startsWith('padding')) {
        assert.match(
          d,
          /^padding-(top|bottom)/,
          `the wash pads vertically only, so the row's left gutter survives focus, got ${d}`,
        );
      }
    }
  }
});
