import test from 'node:test';
import assert from 'node:assert/strict';
import { appSource } from './helpers.js';

// 0105: every drag handle sits flush with the TOP of its alignment target.
// Row handles (title, comment, code, file, URL, property, image row) stay in
// the shared left gutter (drag-gutter.test.js locks that seam) and pin to the
// row's top edge; each individual image keeps its own handle at the image's
// top-left corner. Seam: the embedded stylesheet's rule text (jsdom cannot
// evaluate layout), same prior art as 0024/0033/0034.

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

/** All declarations across every rule targeting exactly `selector`. */
function declarationsFor(selector) {
  return styleRules()
    .filter((r) => r.selectors.includes(selector))
    .flatMap((r) => r.declarations);
}

// Rows whose handle is taken out of flow (position: absolute) in the gutter.
// File rows join code/url here: the row's "• " list marker is its first
// inline box (and must stay outside the underlined link), so an in-flow
// handle would land right of it.
const ABSOLUTE_ROW_HANDLES = [
  'h2.ev-title > .ev-drag-handle',
  '.ev-code > .ev-drag-handle',
  '.ev-file > .ev-drag-handle',
  '.ev-url > .ev-drag-handle',
  '.ev-shot-row > .ev-drag-handle',
];

test('out-of-flow row handles pin to the row top with no vertical centering', () => {
  for (const selector of ABSOLUTE_ROW_HANDLES) {
    const declarations = declarationsFor(selector);
    assert.ok(declarations.length, `a rule targets ${selector}`);
    assert.ok(
      declarations.includes('position: absolute'),
      `${selector} stays out of flow in the gutter`,
    );
    assert.ok(
      declarations.includes('top: 0'),
      `${selector} is flush with the row's top edge, got ${declarations.join('; ')}`,
    );
    assert.ok(
      !declarations.some((d) => /^top: (?!0$)/.test(d)),
      `${selector} carries no other top offset, got ${declarations.join('; ')}`,
    );
    assert.ok(
      !declarations.some((d) => d.startsWith('transform')),
      `${selector} must not re-center the handle, got ${declarations.join('; ')}`,
    );
  }
});

test('the in-flow row handle (comment) aligns to the top of the first line', () => {
  // The shared handle rule is the seam the in-flow row inherits: the handle
  // must ride the line box's top edge instead of sitting on its middle.
  const handleRule = styleRules().find((r) =>
    r.selectors.includes('.ev-drag-handle') && r.selectors.length === 1,
  );
  assert.ok(handleRule, 'the shared single-selector .ev-drag-handle rule exists');
  assert.ok(
    handleRule.declarations.includes('vertical-align: top'),
    `the in-flow handle aligns to the line top, got ${handleRule.declarations.join('; ')}`,
  );
  // The gutter pull-back still applies, so top alignment does not leave the handle
  // sitting in the content column.
  for (const row of ['.ev-comment']) {
    const ml = declarationsFor(`${row} > .ev-drag-handle`).find((d) =>
      d.startsWith('margin-left'),
    );
    assert.equal(
      ml,
      'margin-left: calc(-1 * var(--ev-content-start))',
      `${row} keeps its handle in the shared left gutter`,
    );
  }
});

test('the property handle pins to the flex line top instead of the baseline', () => {
  const declarations = declarationsFor('.ev-property > .ev-drag-handle');
  assert.ok(declarations.length, 'a rule targets .ev-property > .ev-drag-handle');
  assert.ok(
    declarations.includes('align-self: flex-start'),
    `the property handle rides the row top, got ${declarations.join('; ')}`,
  );
  assert.ok(
    !declarations.some((d) => d.startsWith('align-self') && d !== 'align-self: flex-start'),
    `no other cross-axis alignment remains, got ${declarations.join('; ')}`,
  );
  assert.ok(
    !declarations.some((d) => d.startsWith('margin-top')),
    `no vertical drop offsets the top edge, got ${declarations.join('; ')}`,
  );
});

test('the standalone handle is not offset relative to the item box', () => {
  // A standalone shot in a row is a grid container: its absolutely-positioned
  // handle uses the shared grid area (already flush with the image corner) as
  // its containing block, so an item-relative offset would land the handle
  // shifted right by the centered column's inset. The standalone branch must
  // write the constant grid-area inset instead.
  const source = appSource();
  assert.match(
    source,
    /screenshot\.hasAttribute\('data-standalone'\)[\s\S]*?handle\.style\.left = '2px';\s*handle\.style\.top = '2px';/,
    'standalone shots write the constant 2px grid-area inset for their handle',
  );
});

test('each image keeps its own handle at the image top-left corner', () => {
  const declarations = declarationsFor('.ev-screenshot > .ev-drag-handle');
  assert.ok(
    declarations.includes('position: absolute'),
    'the image handle stays an overlay on the rendered image',
  );
  assert.ok(
    declarations.includes('top: 2px'),
    `the CSS fallback pins the handle to the image top corner, got ${declarations.join('; ')}`,
  );
  assert.ok(
    declarations.includes('left: calc(var(--ev-content-start) + 2px)'),
    `the CSS fallback pins the handle to the image left corner, got ${declarations.join('; ')}`,
  );
  // The live offset is still refreshed from the image box (top-left + 2px inset).
  const source = appSource();
  assert.match(
    source,
    /imageRect\.top - itemRect\.top \+ 2/,
    'the live handle offset is measured from the image top edge',
  );
  assert.match(
    source,
    /imageRect\.left - itemRect\.left \+ 2/,
    'the live handle offset is measured from the image left edge',
  );
});
