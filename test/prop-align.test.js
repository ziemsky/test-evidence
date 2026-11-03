import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, appSource, downloadText, addFirstSection } from './helpers.js';

// 0036: property key alignment (SPEC §18).
//
// Test seam (locked in the ticket): window.__evidence.measureKeyWidth —
// the single injectable measurement function where pixels enter the logic.
// Everything downstream (group max, clamp, stamping, recompute scheduling,
// save-stripping) is plain DOM logic exercised here for real. The fake is
// px-per-character: only determinism matters. jsdom has no layout, so the
// .ev-body content width is stubbed through clientWidth; the row's 2em
// drag-handle gutter resolves to 32px at jsdom's 16px root font.

function stubMeasurer(window, pxPerChar = 10) {
  window.__evidence.measureKeyWidth = (keyEl) =>
    (keyEl.textContent || '').length * pxPerChar;
}

function stubBodyWidth(window, width = 500) {
  Object.defineProperty(window.Element.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.classList && this.classList.contains('ev-body') ? width : 0;
    },
  });
}

const rowsIn = (body) => [...body.querySelectorAll(':scope > .ev-property')];
const stampOf = (row) => row.getAttribute('data-key-w');

function propertyHtml(keyText, valueText = 'v') {
  return (
    `<div class="ev-property">` +
    `<span class="ev-text ev-prop-key">${keyText}</span>` +
    `<span class="ev-sep">:</span>` +
    `<span class="ev-text ev-prop-value">${valueText}</span>` +
    `</div>`
  );
}

function mainWith(html) {
  return appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence">${html}</main>`,
  );
}

// ---------------------------------------------------------------------
// 1. Group max
// ---------------------------------------------------------------------

test('group max: every row of the .ev-body is stamped with the clamped max; a subsection is its own group', () => {
  const dirty = mainWith(
    `<section class="ev-section">
      <h2 class="ev-title"><span class="ev-text ev-title-text">S1</span></h2>
      <div class="ev-body">
        ${propertyHtml('ab')}
        <div class="ev-comment"><span class="ev-text ev-comment-text">note</span></div>
        ${propertyHtml('')}
        ${propertyHtml('abcde')}
        <section class="ev-section">
          <h2 class="ev-title"><span class="ev-text ev-title-text">S1.1</span></h2>
          <div class="ev-body">${propertyHtml('abcdefgh')}</div>
        </section>
      </div>
    </section>`,
  );
  const { document, window } = loadApp(dirty);
  stubMeasurer(window);
  stubBodyWidth(window, 500);
  window.__evidence.alignProps();

  const body = document.querySelector('#evidence > .ev-section > .ev-body');
  const rows = rowsIn(body);
  assert.equal(rows.length, 3, 'the three direct property rows');
  // Group max = 5 chars * 10px = 50. The empty key counts 0; the comment row
  // between the first and last properties neither participates nor breaks
  // the group.
  for (const row of rows) {
    assert.equal(stampOf(row), '50', 'row stamped with the group max');
    assert.equal(row.style.getPropertyValue('--key-w'), '50px', 'inline --key-w mirror');
  }
  const subBody = body.querySelector(':scope > .ev-section > .ev-body');
  const subRow = subBody.querySelector(':scope > .ev-property');
  assert.equal(stampOf(subRow), '80', 'subsection properties form their own group (8 chars)');
});

test('empty keys take zero width and never widen a column', () => {
  const dirty = mainWith(
    `<section class="ev-section">
      <h2 class="ev-title"><span class="ev-text ev-title-text">S</span></h2>
      <div class="ev-body">
        ${propertyHtml('')}
        ${propertyHtml('ab')}
      </div>
    </section>`,
  );
  const { document, window } = loadApp(dirty);
  stubMeasurer(window);
  stubBodyWidth(window, 500);
  window.__evidence.alignProps();
  const rows = rowsIn(document.querySelector('#evidence > .ev-section > .ev-body'));
  assert.deepEqual(rows.map(stampOf), ['20', '20'], 'the empty key does not widen the column');

  // An all-empty body: the group max is 0, not the CSS "Key" placeholder.
  const empty = mainWith(
    `<section class="ev-section">
      <h2 class="ev-title"><span class="ev-text ev-title-text">E</span></h2>
      <div class="ev-body">${propertyHtml('')}</div>
    </section>`,
  );
  const { document: d2, window: w2 } = loadApp(empty);
  stubMeasurer(w2);
  stubBodyWidth(w2, 500);
  w2.__evidence.alignProps();
  assert.equal(stampOf(rowsIn(d2.querySelector('#evidence > .ev-section > .ev-body'))[0]), '0');
});

// ---------------------------------------------------------------------
// 2. The clamp
// ---------------------------------------------------------------------

test('the clamp: a key wider than the row caps the group at body width minus gutter', () => {
  const dirty = mainWith(
    `<section class="ev-section">
      <h2 class="ev-title"><span class="ev-text ev-title-text">S</span></h2>
      <div class="ev-body">
        ${propertyHtml('x'.repeat(60))}
        ${propertyHtml('ab')}
      </div>
    </section>`,
  );
  const { document, window } = loadApp(dirty);
  stubMeasurer(window); // 60 chars -> 600px, 2 chars -> 20px
  stubBodyWidth(window, 500);
  window.__evidence.alignProps();

  const contentStart = parseFloat(
    document.getElementById('evidence').style.getPropertyValue('--ev-content-start'),
  );
  const cap = Math.round(500 - contentStart);
  const rows = rowsIn(document.querySelector('#evidence > .ev-section > .ev-body'));
  assert.equal(stampOf(rows[0]), String(cap), 'over-long key is capped, not its measured 600px');
  assert.equal(stampOf(rows[1]), String(cap), 'the other keys still pad to the clamped column');
});

// ---------------------------------------------------------------------
// 3. Recompute hooks
// ---------------------------------------------------------------------

test('recompute hooks: key input, add, delete, and drop each re-run the pass; a value input does not', () => {
  const { document, window } = loadApp(); // 0040: build the section and its keys
  const section = addFirstSection(document);
  for (let i = 0; i < 3; i++) sectionAction(section, 'add-property').click();
  const keys = [...document.querySelectorAll('#evidence > .ev-section > .ev-body > .ev-property > .ev-prop-key')];
  keys[0].textContent = 'BrowserXY'; // 9 chars
  keys[1].textContent = 'OSXXXXXXX'; // 9 chars
  keys[2].textContent = 'TestCaseX'; // 9 chars
  stubMeasurer(window);
  stubBodyWidth(window, 500);
  window.__evidence.alignProps();
  const body = document.querySelector('#evidence > .ev-section > .ev-body');
  const rows = rowsIn(body);
  assert.deepEqual(rows.map(stampOf), ['90', '90', '90'], 'baseline: every key is 9 chars');

  // Key input: live re-align per keystroke
  const key0 = rows[0].querySelector(':scope > .ev-prop-key');
  key0.textContent = 'BrowserXY'; // 9 chars -> 90… make it wider:
  key0.textContent = 'BrowserXYZ'; // 10 chars -> 100
  key0.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(rows.map(stampOf), ['100', '100', '100'], 'key input re-aligns the group');

  // Value input: the value sits right of the colon and never moves it
  const value0 = rows[0].querySelector(':scope > .ev-prop-value');
  value0.textContent = 'a very long value';
  value0.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(rows.map(stampOf), ['100', '100', '100'], 'value input does not re-align');

  // Delete the widest key: the column narrows
  rows[0].querySelector('[data-action="delete"]').click();
  const afterDelete = rowsIn(body);
  assert.equal(afterDelete.length, 2, 'widest row deleted');
  assert.deepEqual(afterDelete.map(stampOf), ['90', '90'], 'delete re-aligns to the next widest');

  // Add a property: the new row joins and is stamped to the group max
  sectionAction(section, 'add-property').click();
  const afterAdd = rowsIn(body);
  assert.equal(afterAdd.length, 3, 'row added');
  assert.equal(stampOf(afterAdd[2]), '90', 'add re-runs the pass; the new empty row is stamped');
});

test('drag-and-drop move re-aligns both affected bodies', () => {
  const dirty = mainWith(
    `<section class="ev-section">
      <h2 class="ev-title"><span class="ev-text ev-title-text">S1</span></h2>
      <div class="ev-body">
        ${propertyHtml('abc')}
        ${propertyHtml('de')}
      </div>
    </section>
    <section class="ev-section">
      <h2 class="ev-title"><span class="ev-text ev-title-text">S2</span></h2>
      <div class="ev-body">${propertyHtml('fghij')}</div>
    </section>`,
  );
  const { document, window } = loadApp(dirty);
  stubMeasurer(window);
  stubBodyWidth(window, 500);
  window.__evidence.alignProps();

  const bodies = [...document.querySelectorAll('#evidence > .ev-section > .ev-body')];
  assert.deepEqual(rowsIn(bodies[0]).map(stampOf), ['30', '30']);
  assert.deepEqual(rowsIn(bodies[1]).map(stampOf), ['50']);

  // Drop S1's widest property into S2's body (the 0025/0026 move seam)
  window.__evidence.moveElement(rowsIn(bodies[0])[0], bodies[1], null);
  assert.deepEqual(rowsIn(bodies[0]).map(stampOf), ['20'], 'source body re-aligned (widest left)');
  assert.deepEqual(rowsIn(bodies[1]).map(stampOf), ['50', '50'], 'target body re-aligned with the mover');
});

// ---------------------------------------------------------------------
// 4. Serialization & boot
// ---------------------------------------------------------------------

test('save strips the stamp (attribute and inline property); A4 holds', async () => {
  const { document, window, downloads } = loadApp();
  const section = addFirstSection(document); // 0040: build the property row
  sectionAction(section, 'add-property').click();
  stubMeasurer(window);
  stubBodyWidth(window, 500);
  window.__evidence.alignProps();
  const live = document.querySelector('#evidence > .ev-section > .ev-body > .ev-property');
  assert.ok(live.hasAttribute('data-key-w'), 'the live DOM carries the stamp');
  assert.ok(live.style.getPropertyValue('--key-w'), 'the live DOM carries the inline mirror');

  document.getElementById('save-btn').click();
  const s1 = await downloadText(downloads.find((d) => d.name));
  const saved = new JSDOM(s1).window.document;
  assert.equal(saved.querySelectorAll('[data-key-w]').length, 0, 'no data-key-w attribute in the saved file');
  assert.equal(
    saved.querySelectorAll('[data-key-clamped]').length, 0,
    'no data-key-clamped marker in the saved file (0038)',
  );
  assert.ok(
    ![...saved.querySelectorAll('[style]')].some((el) => (el.getAttribute('style') || '').includes('--key-w')),
    'no --key-w custom property in the saved file',
  );

  // A4: save -> reload -> save is byte-identical
  const second = loadApp(s1);
  second.document.getElementById('save-btn').click();
  const s2 = await downloadText(second.downloads.find((d) => d.name));
  assert.equal(s2, s1, 'byte-identical after first save');
});

test('boot strips a stale stamp defensively and recomputes', () => {
  const dirty = mainWith(
    `<section class="ev-section">
      <h2 class="ev-title"><span class="ev-text ev-title-text">S</span></h2>
      <div class="ev-body">
        <div class="ev-property" data-key-w="999" data-key-clamped style="--key-w: 999px">
          <span class="ev-text ev-prop-key">Browser</span>
          <span class="ev-sep">:</span>
          <span class="ev-text ev-prop-value"></span>
        </div>
        <div class="ev-property" data-key-w="999" data-key-clamped style="--key-w: 999px">
          <span class="ev-text ev-prop-key">OS</span>
          <span class="ev-sep">:</span>
          <span class="ev-text ev-prop-value"></span>
        </div>
      </div>
    </section>`,
  );
  const { document, window } = loadApp(dirty);
  // The boot recompute runs before any stub exists (jsdom: zero widths, so it
  // stamps the clamped marker); stub now and re-run to check the recompute
  // itself — with real widths the stale marker is gone.
  stubMeasurer(window);
  stubBodyWidth(window, 500);
  window.__evidence.alignProps();
  const rows = [...document.querySelectorAll('#evidence .ev-property')];
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.notEqual(row.getAttribute('data-key-w'), '999', 'the stale stamp was replaced by the boot recompute');
    assert.equal(
      row.style.getPropertyValue('--key-w'),
      row.getAttribute('data-key-w') + 'px',
      'the inline mirror follows the recomputed value',
    );
    assert.equal(row.hasAttribute('data-key-clamped'), false, 'the stale marker was stripped (0038)');
  }
});

// ---------------------------------------------------------------------
// 0038: the clamped-column marker (SPEC §18 amended)
// ---------------------------------------------------------------------

const markerOf = (row) => row.hasAttribute('data-key-clamped');

test('0038: the marker is stamped on every row of a clamped group and absent otherwise', () => {
  const dirty = mainWith(
    `<section class="ev-section">
      <h2 class="ev-title"><span class="ev-text ev-title-text">S</span></h2>
      <div class="ev-body">
        ${propertyHtml('x'.repeat(60))}
        ${propertyHtml('ab')}
      </div>
    </section>`,
  );
  const { document, window } = loadApp(dirty);
  stubMeasurer(window); // 60 chars -> 600px > cap 486
  stubBodyWidth(window, 500);
  window.__evidence.alignProps();
  const rows = rowsIn(document.querySelector('#evidence > .ev-section > .ev-body'));
  assert.ok(rows.every(markerOf), 'clamped group: every row carries data-key-clamped');

  // Below the cap: the natural key column leaves a positive rest of line, no marker
  const short = mainWith(
    `<section class="ev-section">
      <h2 class="ev-title"><span class="ev-text ev-title-text">S</span></h2>
      <div class="ev-body">
        ${propertyHtml('ab')}
        ${propertyHtml('c')}
      </div>
    </section>`,
  );
  const { document: d2, window: w2 } = loadApp(short);
  stubMeasurer(w2);
  stubBodyWidth(w2, 500);
  w2.__evidence.alignProps();
  const rows2 = rowsIn(d2.querySelector('#evidence > .ev-section > .ev-body'));
  assert.ok(rows2.every((r) => !markerOf(r)), 'unclamped group: no marker');
});

test('0038: deleting the over-long key clears the marker on the recompute', () => {
  const dirty = mainWith(
    `<section class="ev-section">
      <h2 class="ev-title"><span class="ev-text ev-title-text">S</span></h2>
      <div class="ev-body">
        ${propertyHtml('x'.repeat(60))}
        ${propertyHtml('abcd')}
      </div>
    </section>`,
  );
  const { document, window } = loadApp(dirty);
  stubMeasurer(window);
  stubBodyWidth(window, 500);
  window.__evidence.alignProps();
  const body = document.querySelector('#evidence > .ev-section > .ev-body');
  const rows = rowsIn(body);
  assert.ok(rows.every(markerOf), 'clamped before the delete');

  rows[0].querySelector('[data-action="delete"]').click();
  const after = rowsIn(body);
  assert.equal(after.length, 1);
  assert.ok(after.every((r) => !markerOf(r)), 'recompute cleared the marker');
  assert.equal(stampOf(after[0]), '40', 'and re-stamped to the new group max');
});

// ---------------------------------------------------------------------
// Styles (rule-text seam — jsdom cannot evaluate the rendered column)
// ---------------------------------------------------------------------

/** Parse the embedded <style> block into [{ selectors, declarations }] (0024/0032 rule-text seam). */
function styleRules() {
  const match = /<style>([\s\S]*?)<\/style>/.exec(appSource());
  assert.ok(match, 'an embedded <style> block exists');
  const rules = [];
  // strip comments first: they may contain commas/braces that would
  // confuse the naive split below
  for (const chunk of match[1].replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const brace = chunk.indexOf('{');
    if (brace === -1) continue;
    const selectors = chunk.slice(0, brace).split(',').map((s) => s.trim()).filter(Boolean);
    const declarations = chunk
      .slice(brace + 1)
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean);
    if (selectors.length) rules.push({ selectors, declarations });
  }
  return rules;
}

test('styles: the key is inline-block with min-width: var(--key-w, 0px)', () => {
  const rules = styleRules();
  const rule = rules.find(
    (r) => r.selectors.includes('.ev-property > .ev-prop-key') &&
      r.declarations.some((d) => d.startsWith('min-width')),
  );
  assert.ok(rule, 'a .ev-property > .ev-prop-key rule with a min-width exists');
  const has = (decl) => rule.declarations.some((d) => d.replace(/\s+/g, ' ') === decl);
  assert.ok(has('display: inline-block'), 'the key becomes inline-block');
  assert.ok(has('min-width: var(--key-w, 0px)'), 'min-width mirrors the stamped --key-w');
});

// ---------------------------------------------------------------------
// 0037: property value continuation indent and key right-align (SPEC §18
// amended). Pure CSS — the rule-text seam asserts the declarations that
// produce the behavior, since jsdom cannot render a wrapping flex row.
// ---------------------------------------------------------------------

test('styles: the property row is a wrapping flex row with vertically centered items', () => {
  const rules = styleRules();
  const rule = rules.find(
    (r) => r.selectors.includes('.ev-property') &&
      r.declarations.some((d) => d.replace(/\s+/g, ' ') === 'display: flex') &&
      r.declarations.some((d) => d.replace(/\s+/g, ' ') === 'flex-wrap: wrap'),
  );
  assert.ok(rule, 'an .ev-property rule with display: flex and flex-wrap: wrap exists');
  assert.ok(
    rule.declarations.some((d) => d.replace(/\s+/g, ' ') === 'align-items: center'),
    'the row contents share the row center so vertical padding is balanced',
  );
});

test('styles: single-line labels center, multiline labels start at the first value line', () => {
  const rules = styleRules();
  const centered = rules.find(
    (r) => r.selectors.includes('.ev-property > .ev-prop-key') &&
      r.selectors.includes('.ev-property > .ev-sep') &&
      r.declarations.some((d) => d.replace(/\s+/g, ' ') === 'align-self: center'),
  );
  assert.ok(centered, 'the key and separator center with a single-line value');
  const multiline = rules.find(
    (r) => r.selectors.includes('.ev-property[data-value-multiline] > .ev-prop-key') &&
      r.selectors.includes('.ev-property[data-value-multiline] > .ev-sep') &&
      r.declarations.some((d) => d.replace(/\s+/g, ' ') === 'align-self: flex-start'),
  );
  assert.ok(multiline, 'multiline labels start beside the first value line');
});

test('styles: the value is a self-boxing flex item (flex: 0 1 auto; min-width: 0)', () => {
  const rules = styleRules();
  const rule = rules.find(
    (r) => r.selectors.some((s) => s.includes('.ev-prop-value')) &&
      r.declarations.some((d) => d.startsWith('flex')),
  );
  assert.ok(rule, 'a .ev-prop-value rule with a flex declaration exists');
  const has = (decl) => rule.declarations.some((d) => d.replace(/\s+/g, ' ') === decl);
  assert.ok(has('flex: 0 1 auto'), 'the value does not grow but may shrink below its content');
  assert.ok(has('min-width: 0'), 'min-width: 0 lets the value box be the value column');
});

// 0038: the value's hypothetical size is capped so a long value can never
// break the flex line (flex line-breaking is on pre-shrink hypothetical
// sizes); the clamped marker drops separator + value to the second line
// with a non-zero box; the separator has a definite 1em outer contribution
// so the cap is exact.

test('styles: the value is capped to the rest of the first line (0038)', () => {
  const rules = styleRules();
  const rule = rules.find(
    (r) => r.selectors.includes('.ev-property > .ev-prop-value') &&
      r.declarations.some((d) => d.startsWith('max-width')),
  );
  assert.ok(rule, 'the 0037 .ev-property > .ev-prop-value rule carries a max-width');
  assert.ok(
    rule.declarations.some((d) => d.replace(/\s+/g, ' ') === 'max-width: calc(100% - var(--key-w, 0px) - 1em)'),
    'the hypothetical size is capped to the rest of the first line',
  );
});

test('styles: the clamped marker drops the value below with a non-zero box (0038)', () => {
  const rules = styleRules();
  const rule = rules.find((r) => r.selectors.includes('.ev-property[data-key-clamped] > .ev-prop-value'));
  assert.ok(rule, 'a .ev-property[data-key-clamped] > .ev-prop-value rule exists');
  const has = (decl) => rule.declarations.some((d) => d.replace(/\s+/g, ' ') === decl);
  assert.ok(has('max-width: calc(100% - 1em)'), 'capped to the rest of the second line (after the dropped separator)');
  assert.ok(has('min-width: 1em'), 'a positive floor lifts it off the sliver of the first line');
});

test('styles: the separator has a definite 1em outer contribution (0038)', () => {
  const rules = styleRules();
  const rule = rules.find(
    (r) => r.selectors.includes('.ev-sep') &&
      r.declarations.some((d) => d.replace(/\s+/g, ' ') === 'margin: 0 0.3em'),
  );
  assert.ok(rule, 'the .ev-sep rule exists');
  assert.ok(
    rule.declarations.some((d) => d.replace(/\s+/g, ' ') === 'width: 0.4em'),
    '0.3em + 0.4em + 0.3em = 1em exactly, so the value cap is exact',
  );
});

test('styles: the key right-aligns in its padded box', () => {
  const rules = styleRules();
  const rule = rules.find(
    (r) => r.selectors.includes('.ev-property > .ev-prop-key') &&
      r.declarations.some((d) => d.startsWith('min-width')),
  );
  assert.ok(rule, 'the 0036 .ev-property > .ev-prop-key rule still exists');
  assert.ok(
    rule.declarations.some((d) => d.replace(/\s+/g, ' ') === 'text-align: right'),
    'the key text right-aligns so its right edge meets the colon',
  );
});
