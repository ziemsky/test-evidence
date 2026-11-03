import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, appSource, loadApp, downloadText, stubImagePipeline, pasteImage, waitFor, addFirstSection } from './helpers.js';

// 0034: focus-wash row highlight (SPEC §17). Focusing any editable (section
// title, comment text, property key/value) replaces the per-fragment inline
// outline with a quiet full-width neutral-gray band on the field's row.
// Seams (pre-agreed in the ticket, per 0024/0033 prior art):
//   1. the stylesheet rule text — jsdom cannot evaluate :focus-within
//      styles, so the wash's look and its keying are asserted on the rules
//   2. the live DOM through focus events — jsdom evaluates :focus-within
//      matches while focus is held; it cannot observe the clear, so
//      "clears when focus leaves" is a rule-text assertion
//   3. the saved file text — nothing focus-related is persisted

// The washable rows: section titles, authored evidence rows with editable
// fields (including URL rows), document titles, and screenshots with captions.
const WASH_ROWS = ['h2.ev-title', '.ev-doc-title', '.ev-comment', '.ev-code', '.ev-file', '.ev-url', '.ev-property', '.ev-screenshot'];
const WASH_COLOR = 'var(--ev-focus-surface)';

/** Parse the embedded <style> block into [{ selectors, declarations }] (0024's rule-text seam). */
function styleRules() {
  const source = appSource();
  const match = /<style>([\s\S]*?)<\/style>/.exec(source);
  assert.ok(match, 'an embedded <style> block exists');
  const css = withoutPrintMedia(match[1]).replace(/\/\*[\s\S]*?\*\//g, ' '); // drop comments
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({
      selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
      declarations: m[2].split(';').map((d) => d.trim()).filter(Boolean),
    });
  }
  return rules;
}

function withoutPrintMedia(css) {
  const start = css.indexOf('@media print');
  if (start === -1) return css;
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') depth--;
    if (depth === 0) return css.slice(0, start) + css.slice(i + 1);
  }
  assert.fail('the print media rule is closed');
}

const focusWithinRules = (rules) =>
  rules.filter((r) => r.selectors.some((s) => s.endsWith(':focus-within')));

test('the wash: one shared rule covers every washable row, keyed on :focus-within', () => {
  const rules = styleRules();
  const wash = focusWithinRules(rules);
  assert.equal(wash.length, 1, 'one shared :focus-within wash rule exists');

  const covered = [];
  for (const r of wash) {
    // The locked look: the single neutral-gray value, the ~2px vertical
    // padding (accepted layout shift), and no fade/transition (instant).
    assert.ok(
      r.declarations.some((d) => d.startsWith('background') && d.includes(WASH_COLOR)),
      `the wash uses the locked neutral-gray value, got ${r.declarations.join('; ')}`,
    );
    assert.ok(
      r.declarations.some((d) => d.startsWith('padding') && /2px/.test(d)),
      `the washed state adds ~2px vertical padding, got ${r.declarations.join('; ')}`,
    );
    assert.ok(
      !r.declarations.some((d) => d.startsWith('transition') || d.startsWith('animation')),
      'no fade or transition on the wash',
    );
    for (const sel of r.selectors) {
      const row = sel.slice(0, sel.lastIndexOf(':focus-within')).trim();
      assert.ok(WASH_ROWS.includes(row), `wash rule for a washable row, got ${sel}`);
      assert.ok(sel.endsWith(':focus-within'), `wash rule is focus-within-driven, got ${sel}`);
      covered.push(row);
    }
  }
  assert.deepEqual(covered, WASH_ROWS, 'each washable row covered exactly once');
});

test('only editable-bearing row types wash', () => {
  const rules = styleRules();
  for (const r of focusWithinRules(rules)) {
    for (const sel of r.selectors) {
      const row = sel.slice(0, sel.lastIndexOf(':focus-within')).trim();
      assert.ok(WASH_ROWS.includes(row), `wash keying covers only editable-bearing rows (got ${sel})`);
    }
  }
});

test('one neutral-gray value for every wash row (light and dark mode alike)', () => {
  const rules = styleRules();
  const backgrounds = focusWithinRules(rules).map((r) =>
    r.declarations.find((d) => d.startsWith('background')),
  );
  for (const bg of backgrounds) {
    assert.equal(bg, `background: ${WASH_COLOR}`, 'every wash row uses the single locked value');
  }
});

// ---------------------------------------------------------------------
// The live DOM through focus events (jsdom evaluates :focus-within while
// focus is held; it cannot observe the clear, so the clear is a
// rule-text assertion above)
// ---------------------------------------------------------------------

test('any focus within a property row washes that row — key, value, or its own buttons', () => {
  const { document } = loadApp(); // 0040: build the section and two property rows
  const section = addFirstSection(document);
  sectionAction(section, 'add-property').click();
  sectionAction(section, 'add-property').click();
  const rows = [...document.querySelectorAll('.ev-property')];
  const [row, other] = rows;

  row.querySelector('.ev-prop-value').focus();
  assert.ok(row.matches(':focus-within'), 'the property row is focus-within when its value is focused');
  assert.ok(!other.matches(':focus-within'), 'a sibling row that never held focus is not');

  row.querySelector('.ev-prop-key').focus();
  assert.ok(row.matches(':focus-within'), 'focusing the key washes the same row (no key-vs-value distinction)');

  // any-focus, not text-only: the row's own control buttons keep the wash on
  row.querySelector('button[data-action="delete"]').focus();
  assert.ok(row.matches(':focus-within'), 'the row is focus-within while its delete button is focused');
});

test('any focus within a comment row washes the whole row, multi-line included', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const row = document.querySelector('.ev-comment');
  assert.ok(row, 'the section control row added a comment row');
  const text = row.querySelector('.ev-comment-text');
  text.textContent = 'step one failed\nstep two also failed\nsee log';
  text.focus();
  assert.ok(row.matches(':focus-within'), 'the comment row is focus-within (one wash across the whole row, not per line)');

  // and through the row's buttons (the delete-confirmation moment keeps it on)
  row.querySelector('button[data-action="delete"]').focus();
  assert.ok(row.matches(':focus-within'), 'the comment row stays focus-within while its delete button is focused');
});

test('any focus within a screenshot row washes the image and caption row', async () => {
  const { document, window } = loadApp();
  const section = addFirstSection(document);
  stubImagePipeline(window);
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  await waitFor(() => section.querySelector('.ev-screenshot'));
  const row = section.querySelector('.ev-screenshot');

  row.querySelector('.ev-caption').focus();
  assert.ok(row.matches(':focus-within'), 'caption focus washes its screenshot row');
  row.querySelector('button[data-action="copy"]').focus();
  assert.ok(row.matches(':focus-within'), 'the screenshot copy control keeps the row washed');
});

test('the section-title wash stays on the title row — never the body or a nested row', () => {
  const { document } = loadApp();
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-property').click();
  const title = section.querySelector(':scope > h2.ev-title');
  const body = section.querySelector(':scope > .ev-body');
  const propRow = body.querySelector('.ev-property');

  title.querySelector('.ev-title-text').focus();
  assert.ok(title.matches(':focus-within'), 'the title row is focus-within when its title is focused');
  assert.ok(!body.matches(':focus-within'), 'the section body is not lit — a section never washes as a whole');
  assert.ok(!propRow.matches(':focus-within'), 'a row inside the body is not lit by the title focus');

  // The shared palette is outside the title row, so focusing its action does
  // not wash the authored title row itself.
  sectionAction(section, 'copy').focus();
  assert.ok(!title.matches(':focus-within'), 'the external palette does not wash the title row');
});

test('outline suppression: the focused editables draw no outline of any kind', () => {
  const rules = styleRules();
  // The suppression itself: outline: none on the focused editables (this
  // also suppresses the UA default ring, without which the per-fragment
  // outline returns via the browser's own ring).
  assert.ok(
    rules.some(
      (r) => r.selectors.includes('.ev-text:focus') && r.declarations.includes('outline: none'),
    ),
    'a rule sets outline: none on the focused editables',
  );
  // And no rule anywhere draws an outline on a focused element — the old
  // per-fragment outline is gone, not just overridden.
  for (const r of rules) {
    if (r.selectors.some((s) => s.includes(':focus'))) {
      for (const d of r.declarations) {
        if (d.startsWith('outline')) {
          assert.equal(d, 'outline: none', `no drawn outline on focused elements, got ${d}`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------
// The saved file text: nothing focus-related is persisted
// ---------------------------------------------------------------------

test('a save after focusing/editing is byte-identical to a save without — no focus state is persisted', async () => {
  const touched = loadApp();
  // 0040: both documents build the same content (section, property, comment)
  const tSection = addFirstSection(touched.document);
  sectionAction(tSection, 'add-property').click();
  const d = touched.document;
  d.querySelector('.ev-prop-value').focus();
  d.querySelector('.ev-title-text').focus();
  sectionAction(tSection, 'add-comment').click();
  d.querySelector('.ev-comment-text').focus(); // focus held on a row at save time
  d.getElementById('save-btn').click();
  const s1 = await downloadText(touched.downloads.find((x) => x.name));

  const pristine = loadApp();
  const pSection = addFirstSection(pristine.document);
  sectionAction(pSection, 'add-property').click();
  sectionAction(pSection, 'add-comment').click(); // same content, never focused
  pristine.document.getElementById('save-btn').click();
  const s2 = await downloadText(pristine.downloads.find((x) => x.name));

  assert.equal(s1, s2, 'focus leaves no trace in the saved file');
  const saved = new JSDOM(s1).window.document;
  assert.equal(saved.querySelectorAll('[contenteditable]').length, 0, 'no contenteditable attributes survive the save');
});
