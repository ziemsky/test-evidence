import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, appSource, downloadText, addFirstSection } from './helpers.js';

// 0032: per-depth header font sizes (0030's locked decision; SPEC §4/§5.3/§7/§16).
// A section's title steps down in size with nesting depth — 1.1em (top) →
// 1.0em → 0.92em → 0.85em floor — and the depth is stamped (data-depth,
// capped at 3) by the same walk that computes the numbering, so the size can
// never disagree with the number. The stamp is chrome: stripped from the
// saved file, re-stamped at boot.
// Seams (pre-agreed in the ticket, per 0024/0031 prior art):
//   1. the live DOM through the UI (+ the moveElement seam for drags)
//   2. the stylesheet rule text (jsdom cannot evaluate rendered font sizes)
//   3. the saved file text (downloadText + the A4 idempotency property)

const stamps = (document) =>
  [...document.querySelectorAll('#evidence .ev-section')].map((s) => s.getAttribute('data-depth'));

const nums = (document) =>
  [...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent);

const bodyOf = (section) => section.querySelector(':scope > .ev-body');

/** Build through the UI (0031's tree): 1 / 1.1 / 1.1.1 / 2. */
function buildTree(document) {
  const s1 = addFirstSection(document); // 0040: build the root section
  sectionAction(s1, 'add-subsection').click(); // 1.1
  const s11 = bodyOf(s1).querySelector(':scope > .ev-section');
  sectionAction(s11, 'add-subsection').click(); // 1.1.1
  const s111 = bodyOf(s11).querySelector(':scope > .ev-section');
  document.querySelector('.ev-add-section-btn').click(); // + section → 2
  const s2 = [...document.querySelectorAll('#evidence > .ev-section')][1];
  return { s1, s11, s111, s2 };
}

// ---------------------------------------------------------------------
// The live DOM: the stamp, at boot and after every mutation path
// ---------------------------------------------------------------------

test('boot: every section carries a data-depth stamp, capped at 3, matching the numbering', () => {
  // A five-deep nest (depths 0..4) plus a second top-level section:
  // 1 / 1.1 / 1.1.1 / 1.1.1.1 / 1.1.1.1.1 / 2
  const dirty = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence">
      <section class="ev-section">
        <h2 class="ev-title"><span class="ev-text ev-title-text">A</span></h2>
        <div class="ev-body">
          <section class="ev-section">
            <h2 class="ev-title"><span class="ev-text ev-title-text">A1</span></h2>
            <div class="ev-body">
              <section class="ev-section">
                <h2 class="ev-title"><span class="ev-text ev-title-text">A11</span></h2>
                <div class="ev-body">
                  <section class="ev-section">
                    <h2 class="ev-title"><span class="ev-text ev-title-text">A111</span></h2>
                    <div class="ev-body">
                      <section class="ev-section">
                        <h2 class="ev-title"><span class="ev-text ev-title-text">A1111</span></h2>
                        <div class="ev-body"></div>
                      </section>
                    </div>
                  </section>
                </div>
              </section>
            </div>
          </section>
        </div>
      </section>
      <section class="ev-section">
        <h2 class="ev-title"><span class="ev-text ev-title-text">B</span></h2>
        <div class="ev-body"></div>
      </section>
    </main>`,
  );
  const { document } = loadApp(dirty);
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '1.1.1.1', '1.1.1.1.1', '2'], 'numbering intact');
  assert.deepEqual(
    stamps(document),
    ['0', '1', '2', '3', '3', '0'],
    'stamps follow nesting depth; a depth-5 section is stamped 3, not 4',
  );
});

test('boot: a UI-built tree (1 / 1.1 / 1.1.1 / 2) stamps 0 / 1 / 2 / 0', () => {
  const { document } = loadApp();
  buildTree(document);
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '2'], 'the tree is as built');
  assert.deepEqual(stamps(document), ['0', '1', '2', '0'], 'each section stamped by its depth');
});

test('mutation: + subsection stamps the new section at its parent depth + 1', () => {
  const { document } = loadApp();
  const s1 = addFirstSection(document); // 0040: build the root section
  sectionAction(s1, 'add-subsection').click(); // 1.1
  assert.deepEqual(stamps(document), ['0', '1'], 'the subsection is stamped 1');
  sectionAction(s1, 'add-subsection').click(); // 1.2
  assert.deepEqual(stamps(document), ['0', '1', '1'], 'sibling subsections share the stamp');
  const s12 = s1.querySelectorAll(':scope > .ev-body > .ev-section')[1];
  sectionAction(s12, 'add-subsection').click(); // 1.2.1
  assert.deepEqual(stamps(document), ['0', '1', '1', '2'], 'the grandchild is stamped 2');
});

test('mutation: + section after stamps the new sibling at the clicked section depth', () => {
  const { document } = loadApp();
  const s1 = addFirstSection(document); // 0040: build the root section
  sectionAction(s1, 'add-subsection').click(); // 1.1
  const s11 = bodyOf(s1).querySelector(':scope > .ev-section');

  sectionAction(s1, 'add-section-after').click(); // 2
  assert.deepEqual(nums(document), ['1', '1.1', '2'], 'top-level insert: a new root section');
  assert.deepEqual(stamps(document), ['0', '1', '0'], 'the new top-level section is stamped 0');

  sectionAction(s11, 'add-section-after').click(); // 1.2
  assert.deepEqual(nums(document), ['1', '1.1', '1.2', '2'], 'nested insert: a sibling inside 1');
  assert.deepEqual(stamps(document), ['0', '1', '1', '0'], 'the new nested sibling is stamped 1');
});

test('mutation: the standalone + section button stamps the new top-level section 0', () => {
  const { document } = loadApp();
  buildTree(document);
  document.querySelector('.ev-add-section-btn').click(); // + section → 3
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '2', '3'], 'a new top-level section exists');
  assert.deepEqual(stamps(document), ['0', '1', '2', '0', '0'], 'the appended section is stamped 0');
});

test('mutation: section delete leaves the remaining stamps consistent with the numbers', () => {
  const { document, window } = loadApp();
  const { s11, s111 } = buildTree(document);
  window.confirm = () => true;
  sectionAction(s111, 'delete').click(); // deletes 1.1.1
  assert.deepEqual(nums(document), ['1', '1.1', '2'], 'the deep section is gone');
  assert.deepEqual(stamps(document), ['0', '1', '0'], 'the survivors keep stamps matching their numbers');
  sectionAction(s11, 'delete').click(); // deletes 1.1
  assert.deepEqual(nums(document), ['1', '2']);
  assert.deepEqual(stamps(document), ['0', '0'], 'after deleting the middle of the tree');
});

test('mutation: drag moves re-stamp — re-nesting deepens, promotion shallows (the move seam)', () => {
  const { document, window } = loadApp();
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const { s11, s2 } = buildTree(document);
  assert.deepEqual(stamps(document), ['0', '1', '2', '0'], 'starting stamps');

  // re-nest 1.1 (with its child 1.1.1) into section 2: depths +1
  assert.equal(move(s11, bodyOf(s2), null), true, '1.1 re-nests into section 2');
  assert.deepEqual(nums(document), ['1', '2', '2.1', '2.1.1'], 'numbering recomputed');
  assert.deepEqual(stamps(document), ['0', '0', '1', '2'], 'the moved subtree is re-stamped at its new depth');

  // promote 2.1 back to top level: depths -1 for the subtree
  assert.equal(move(s11, document.getElementById('evidence'), null), true, '2.1 promotes to top level');
  assert.deepEqual(nums(document), ['1', '2', '3', '3.1'], 'numbering recomputed after promotion');
  assert.deepEqual(stamps(document), ['0', '0', '0', '1'], 'the promoted section and child are re-stamped shallower');
});

// ---------------------------------------------------------------------
// The stylesheet: four size steps keyed on the marker
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

test('styles: the four font-size steps are keyed on data-depth — 1.1 / 1.0 / 0.92 / 0.85em', () => {
  const rules = styleRules();
  const steps = [
    ['0', '1.1em'],
    ['1', '1.0em'],
    ['2', '0.92em'],
    ['3', '0.85em'],
  ];
  for (const [depth, size] of steps) {
    const rule = rules.find(
      (r) =>
        r.declarations.includes(`font-size: ${size}`) &&
        r.selectors.some((s) => s.includes(`data-depth="${depth}"`) && s.includes('ev-title')),
    );
    assert.ok(rule, `a title rule with font-size ${size} is keyed on data-depth="${depth}"`);
  }
  // Exactly the four steps: no other rule keys anything on the depth marker.
  const depthRules = rules.filter((r) => r.selectors.some((s) => s.includes('data-depth=')));
  assert.equal(depthRules.length, 4, 'exactly four rules key on data-depth (no floor duplication, no extras)');
});

test('styles: the number span and control buttons scale with the title (em-based, never fixed)', () => {
  const rules = styleRules();
  // .ev-num carries no font-size of its own: it inherits the (per-depth) title size.
  for (const r of rules) {
    if (!r.selectors.some((s) => s.includes('.ev-num'))) continue;
    assert.ok(
      !r.declarations.some((d) => d.startsWith('font-size')),
      `the number span sets no font-size of its own (got ${r.declarations.join('; ')})`,
    );
  }
  // Any font-size the control buttons get must be relative (em), so it
  // scales with the per-depth title size.
  for (const r of rules) {
    for (const d of r.declarations.filter((d) => d.startsWith('font-size'))) {
      if (!r.selectors.some((s) => s.includes('.ev-controls'))) continue;
      assert.ok(/em\s*$/.test(d), `control-button font-size is em-based (got ${d})`);
    }
  }
});

// ---------------------------------------------------------------------
// The saved file: the marker is stripped; A4 stays byte-stable
// ---------------------------------------------------------------------

test('save: the depth marker is stripped from the saved file and re-stamped at boot', async () => {
  const { document, downloads } = loadApp();
  buildTree(document);
  document.getElementById('save-btn').click();
  const text = await downloadText(downloads.find((d) => d.name));

  const saved = new JSDOM(text).window.document;
  const content = saved.getElementById('evidence').innerHTML;
  assert.equal(saved.querySelectorAll('#evidence [data-depth]').length, 0, 'no data-depth in the saved content');
  assert.ok(!content.includes('data-depth'), 'the marker text is gone from the evidence markup');
  assert.ok(!saved.getElementById('evidence').textContent.includes('data-depth'), 'nothing else in the content references it');

  // Reopening re-stamps at boot.
  const reopened = loadApp(text);
  assert.deepEqual(stamps(reopened.document), ['0', '1', '2', '0'], 'the stamps are re-stamped at boot');
});

test('A4: with the stamp in play, save → reload → save stays byte-identical on a nested tree', async () => {
  const first = loadApp();
  buildTree(first.document);
  first.document.getElementById('save-btn').click();
  const s1 = await downloadText(first.downloads.find((d) => d.name));

  const second = loadApp(s1);
  assert.deepEqual(stamps(second.document), ['0', '1', '2', '0'], 'the reopened tree is re-stamped');
  second.document.getElementById('save-btn').click();
  const s2 = await downloadText(second.downloads.find((d) => d.name));
  assert.equal(s2, s1, 'byte-identical after the first save');
});
