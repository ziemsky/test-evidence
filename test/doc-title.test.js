import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, appSource, loadApp, downloadText, addFirstSection } from './helpers.js';

// 0039 (SPEC §19): the document title row. Content, not chrome — exactly
// one <h1 class="ev-doc-title">, always the first child of #evidence,
// always serialized (even empty); a single-line editable (0035 class); the
// §17 wash; a one-way field → tab sync that is never persisted
// (serialization resets <head><title> to "Test Evidence").
// Seams (same prior art as the sibling suites): the live DOM through
// dispatched events, the stylesheet rule text, and the saved file text.

// The template main (0039): the title row is in the file, empty, with no
// contenteditable (boot stamps it, as for every editable, §4).
const TEMPLATE_MAIN =
  '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>';

/** The app source with the evidence root replaced by `inner`. */
function appWith(inner) {
  const source = appSource();
  assert.ok(source.includes(TEMPLATE_MAIN), 'the template main is the expected seam');
  return source.replace(TEMPLATE_MAIN, `<main id="evidence">${inner}</main>`);
}

const SECTION = `
  <section class="ev-section">
    <h2 class="ev-title"><span class="ev-text ev-title-text">S</span></h2>
    <div class="ev-body"></div>
  </section>`;

/** Re-run the app script inside an already-booted window (simulates a second boot). */
function reBoot(window) {
  window.eval(window.document.querySelector('body > script').textContent);
}

/** Parse the embedded <style> block into [{ selectors, declarations }]. */
function styleRules() {
  const match = /<style>([\s\S]*?)<\/style>/.exec(appSource());
  assert.ok(match, 'an embedded <style> block exists');
  const css = match[1].replace(/\/\*[\s\S]*?\*\//g, ' ');
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({
      selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
      declarations: m[2].split(';').map((d) => d.trim()).filter(Boolean),
    });
  }
  return rules;
}

// ---------------------------------------------------------------------
// 1. Boot ensure: missing → created, misplaced → moved, idempotent
// ---------------------------------------------------------------------

test('boot: the template (empty title row in the file) keeps exactly one row, first child, span stamped editable', () => {
  const { document } = loadApp();
  const root = document.getElementById('evidence');
  const h1s = [...root.querySelectorAll('h1.ev-doc-title')];
  assert.equal(h1s.length, 1, 'exactly one document title row');
  assert.equal(root.firstElementChild, h1s[0], 'the row is the first child of #evidence');
  const span = h1s[0].querySelector(':scope > .ev-doc-title-text');
  assert.ok(span, 'the row holds the .ev-doc-title-text span');
  assert.equal(span.getAttribute('contenteditable'), 'true', 'boot stamps the span editable');
  assert.ok(!h1s[0].hasAttribute('data-chrome'), 'the row is content, not chrome');
});

test('boot ensure: a pre-0039 file (no <h1> at all) gets the row created as first child', () => {
  const { document } = loadApp(appWith(SECTION));
  const root = document.getElementById('evidence');
  const h1 = root.querySelector('h1.ev-doc-title');
  assert.ok(h1, 'the row is created');
  assert.equal(root.firstElementChild, h1, 'it is the first child, before the section');
  assert.equal(h1.querySelector('.ev-doc-title-text').getAttribute('contenteditable'), 'true');
  assert.equal(root.querySelectorAll('.ev-section').length, 1, 'the section is adopted, not dropped');
});

test('boot ensure: a <h1> present elsewhere is moved to the first child, not duplicated', () => {
  const { document } = loadApp(
    appWith(`${SECTION}
    <h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text">Misplaced</span></h1>`),
  );
  const root = document.getElementById('evidence');
  const h1s = [...root.querySelectorAll('h1.ev-doc-title')];
  assert.equal(h1s.length, 1, 'still exactly one row');
  assert.equal(root.firstElementChild, h1s[0], 'moved to the front');
  assert.equal(h1s[0].querySelector('.ev-doc-title-text').textContent, 'Misplaced', 'its text survives the move');
});

test('boot ensure is idempotent: a second boot is a no-op (one row, first child, text intact)', () => {
  const { window, document } = loadApp();
  document.querySelector('#evidence .ev-doc-title-text').textContent = 'My Session';
  reBoot(window);
  const root = document.getElementById('evidence');
  const h1s = [...root.querySelectorAll('h1.ev-doc-title')];
  assert.equal(h1s.length, 1, 'no duplicate row');
  assert.equal(root.firstElementChild, h1s[0], 'still the first child');
  assert.equal(h1s[0].querySelector('.ev-doc-title-text').textContent, 'My Session', 'text not rewritten');
  assert.equal(h1s[0].querySelector('.ev-doc-title-text').getAttribute('contenteditable'), 'true');
});

// ---------------------------------------------------------------------
// 2. Tab sync: field → tab only, at boot and on every input
// ---------------------------------------------------------------------

test('tab sync at boot: a pre-filled title mirrors into document.title', () => {
  const { document } = loadApp(
    appWith(`<h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text">Pre-filled Title</span></h1>${SECTION}`),
  );
  assert.equal(document.title, 'Pre-filled Title');
});

test('tab sync at boot: an empty field leaves the tab as "Test Evidence"', () => {
  const { document } = loadApp();
  assert.equal(document.title, 'Test Evidence');
});

test('tab sync on input: editing the field updates the tab; clearing it returns to "Test Evidence"', () => {
  const { document, window } = loadApp();
  const field = document.querySelector('#evidence .ev-doc-title-text');
  field.textContent = 'Live title';
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.title, 'Live title', 'the tab mirrors the field live');
  field.textContent = '';
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.title, 'Test Evidence', 'empty field → "Test Evidence"');
});

// ---------------------------------------------------------------------
// 4. Serialization: always present (filled and empty), no contenteditable,
//    <head><title> always "Test Evidence"; A4 round-trip with a filled title
// ---------------------------------------------------------------------

async function saveText(app) {
  app.document.getElementById('save-btn').click();
  return downloadText(app.downloads.find((d) => d.name));
}

test('serialization: the saved file always carries the <h1> as first child of <main>, filled and empty, with no contenteditable', async () => {
  const filled = loadApp();
  filled.document.querySelector('#evidence .ev-doc-title-text').textContent = 'My Session';
  const t1 = await saveText(filled);

  const empty = loadApp();
  const t2 = await saveText(empty);

  for (const [text, label] of [[t1, 'filled'], [t2, 'empty']]) {
    const saved = new JSDOM(text).window.document;
    const main = saved.getElementById('evidence');
    const h1 = main.firstElementChild;
    assert.equal(h1.tagName, 'H1', `${label}: the <h1> is the first child of <main>`);
    assert.ok(h1.classList.contains('ev-doc-title'), `${label}: it is the .ev-doc-title row`);
    assert.equal(saved.querySelectorAll('h1.ev-doc-title').length, 1, `${label}: exactly one`);
    const span = h1.querySelector('.ev-doc-title-text');
    assert.ok(span, `${label}: the .ev-doc-title-text span is serialized`);
    assert.ok(!h1.hasAttribute('data-chrome'), `${label}: content, not chrome`);
    assert.equal(saved.querySelector('h1.ev-doc-title[contenteditable]'), null, `${label}: no contenteditable on the row`);
    assert.equal(saved.querySelectorAll('[contenteditable]').length, 0, `${label}: no contenteditable anywhere`);
  }
  assert.ok(t1.includes('>My Session<'), 'filled case: the title text is in the saved file');
  assert.ok(!t2.includes('My Session'), 'empty case: no title text');
});

test('serialization: the <head> title is "Test Evidence" regardless of the field content, and the synced title appears exactly once', async () => {
  const filled = loadApp();
  const field = filled.document.querySelector('#evidence .ev-doc-title-text');
  field.textContent = 'Synced Title';
  field.dispatchEvent(new filled.window.Event('input', { bubbles: true }));
  assert.equal(filled.document.title, 'Synced Title', 'the live tab is synced first');
  const text = await saveText(filled);
  const saved = new JSDOM(text).window.document;
  assert.equal(saved.title, 'Test Evidence', 'the <head> title is reset on save');
  assert.equal(text.match(/Synced Title/g).length, 1, 'the title text appears exactly once — in the evidence root');
});

test('A4: save → reload → save is byte-identical with a filled title', async () => {
  const first = loadApp();
  first.document.querySelector('#evidence .ev-doc-title-text').textContent = 'My Session';
  const s1 = await saveText(first);

  const second = loadApp(s1);
  assert.equal(second.document.querySelector('#evidence .ev-doc-title-text').textContent, 'My Session', 'adopted on reopen');
  const s2 = await saveText(second);
  assert.equal(s2, s1, 'byte-identical after the round-trip (tab sync leaves no trace)');
});

test('A4: save → reload → save is byte-identical with an empty title', async () => {
  const first = loadApp();
  const s1 = await saveText(first);

  const second = loadApp(s1);
  const s2 = await saveText(second);
  assert.equal(s2, s1, 'byte-identical with the placeholder state');
});

// ---------------------------------------------------------------------
// The row stays out of numbering, drag & drop, and rails
// ---------------------------------------------------------------------

test('the row has no number, no drag handle, no control row, no data-depth, and no rails', () => {
  const { document } = loadApp();
  const h1 = document.querySelector('#evidence > h1.ev-doc-title');
  assert.equal(h1.querySelector('.ev-num'), null, 'no number');
  assert.equal(h1.querySelector('.ev-drag-handle'), null, 'no drag handle');
  assert.equal(h1.querySelector('.ev-controls'), null, 'no control row');
  assert.equal(h1.hasAttribute('data-depth'), false, 'no depth stamp');
  assert.equal(h1.hasAttribute('data-rail'), false, 'never a rail mark');
});

test('the row never participates in numbering: sections number from 1 around it', () => {
  const { document } = loadApp(); // 0040: bare boot — the sections are built, not inherited
  sectionAction(document, 'add-section').click();
  sectionAction(document, 'add-section').click();
  sectionAction(document, 'add-section').click();
  const nums = [...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent);
  assert.deepEqual(nums, ['1', '2', '3'], 'the title row takes no number slot');
  const root = document.getElementById('evidence');
  assert.equal(root.firstElementChild, root.querySelector('h1.ev-doc-title'), 'still the first child after adds');
});

// ---------------------------------------------------------------------
// 5. Style declarations: the locked look, the wash, the placeholder
// ---------------------------------------------------------------------

test('styles: the .ev-doc-title rule carries the locked centered 1.6em/600 look with the 0.6em bottom margin', () => {
  const rule = styleRules().find((r) => r.selectors.includes('.ev-doc-title') && !r.selectors[0].includes(':'));
  assert.ok(rule, 'a plain .ev-doc-title rule exists');
  for (const d of ['text-align: center', 'font-size: 1.6em', 'font-weight: 600', 'margin-bottom: 0.6em']) {
    assert.ok(rule.declarations.includes(d), `.ev-doc-title carries "${d}", got ${rule.declarations.join('; ')}`);
  }
});

test('styles: the wash rule covers .ev-doc-title with the shared neutral-gray value', () => {
  const rule = styleRules().find(
    (r) => r.selectors.includes('.ev-doc-title:focus-within'),
  );
  assert.ok(rule, 'a .ev-doc-title:focus-within wash rule exists');
  assert.ok(
    rule.declarations.some((d) => d === 'background: var(--ev-focus-surface)'),
    `the wash uses the locked value, got ${rule.declarations.join('; ')}`,
  );
  assert.ok(
    rule.declarations.some((d) => d.startsWith('padding') && /2px/.test(d)),
    `the washed state adds the ~2px band, got ${rule.declarations.join('; ')}`,
  );
});

test('styles: the empty placeholder is "Untitled", the same word as the section-title hint', () => {
  const rules = styleRules();
  const doc = rules.find((r) => r.selectors.includes('.ev-doc-title-text:empty::before'));
  const section = rules.find((r) => r.selectors.includes('.ev-title-text:empty::before'));
  assert.ok(doc, 'a .ev-doc-title-text:empty::before rule exists');
  assert.ok(doc.declarations.some((d) => d.includes('"Untitled"')), `placeholder is "Untitled", got ${doc.declarations.join('; ')}`);
  assert.ok(section, 'the section-title hint rule still exists');
  assert.equal(
    doc.declarations.find((d) => d.startsWith('content')),
    section.declarations.find((d) => d.startsWith('content')),
    'the two "Untitled" hints are deliberately identical',
  );
});

test('live DOM: focusing the title row washes only that row, with no outline', () => {
  const { document } = loadApp();
  addFirstSection(document); // 0040: bare boot — build the section the assertion needs
  const h1 = document.querySelector('#evidence > h1.ev-doc-title');
  const field = h1.querySelector('.ev-doc-title-text');
  field.focus();
  assert.ok(h1.matches(':focus-within'), 'the title row is focus-within when its field is focused');
  const section = document.querySelector('#evidence > .ev-section');
  assert.ok(!section.querySelector(':scope > h2.ev-title').matches(':focus-within'), 'the section row is not lit by the title focus');
  const rules = styleRules();
  assert.ok(
    rules.some((r) => r.selectors.includes('.ev-text:focus') && r.declarations.includes('outline: none')),
    'the shared outline suppression covers the title row (no outline of any kind)',
  );
});
