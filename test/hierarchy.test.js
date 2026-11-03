import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAction, loadApp, appSource, addFirstSection } from './helpers.js';

// 0031: drop the nested-section indentation (0030's locked decision;
// SPEC §7/§11). Nested sections sit flush at the same left edge as
// top-level sections — the hierarchy no longer reads from horizontal
// offset (per-depth header sizes and the hover ancestor rails are
// 0032/0033 and out of scope here).
// Seams (pre-agreed in 0030's spec): the stylesheet text (rule-text seam,
// 0024's hover-reveal prior art — jsdom cannot evaluate rendered layout
// offsets) and the live DOM through loadApp() (computed style).

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

/**
 * A selector indents nested sections if it selects a .ev-section that has
 * section/body context in front of it, e.g. ".ev-section .ev-body >
 * .ev-section" or ".ev-section .ev-section". A bare ".ev-section" or a
 * top-level anchor like "#evidence > .ev-section" does not.
 */
const indentsNestedSection = (sel) => {
  const last = sel.lastIndexOf('.ev-section');
  if (last === -1) return false;
  return /(^|[\s>+~])[^>+~]*\.ev-section|\.ev-body/.test(sel.slice(0, last));
};

test('no stylesheet rule indents nested sections — no margin-left/padding-left on a nested-section selector', () => {
  const offenders = [];
  for (const rule of styleRules()) {
    const indents = rule.declarations.some(
      (d) => d.startsWith('margin-left') || d.startsWith('padding-left'),
    );
    if (!indents) continue;
    for (const sel of rule.selectors) {
      if (indentsNestedSection(sel)) offenders.push(`${sel} { ${rule.declarations.join('; ')} }`);
    }
  }
  assert.deepEqual(offenders, [], `no rule indents nested sections, found: ${offenders.join('  ')}`);
});

// Build through the UI (the drag suite's tree shape): 1 / 1.1 / 1.1.1 / 2.
const bodyOf = (section) => section.querySelector(':scope > .ev-body');
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

test('live DOM: top-level and nested sections at any depth share the same left offset', (t) => {
  const { document, window } = loadApp();
  const { s1, s11, s111, s2 } = buildTree(document);
  const depths = [
    ['top-level 1', s1],
    ['depth-1 1.1', s11],
    ['depth-2 1.1.1', s111],
    ['top-level 2', s2],
  ];
  for (const [label, section] of depths) {
    const ml = window.getComputedStyle(section).marginLeft;
    assert.equal(ml, '0px', `${label} sits flush (margin-left 0), got ${ml}`);
  }
});
