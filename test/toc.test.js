import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, appSource, downloadText, addFirstSection } from './helpers.js';

// 0044 (SPEC §21): the table of contents / navigation panel. Chrome,
// never persisted — a fixed, full-height, left-edge column that shifts
// the document right (body left padding), boots expanded, re-renders its
// tree in the chrome-refresh pass, and smooth-scrolls sections into view
// on entry click.
// Seams (pre-agreed in the ticket, same prior art as the sibling suites):
//   1. the live DOM through the UI (+ the moveElement seam for drags)
//   2. the stylesheet rule text (jsdom cannot evaluate rendered layout)
//   3. the saved file text (downloadText + the A4 idempotency property)

const TEMPLATE_MAIN =
  '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>';

/** The app source with the evidence root replaced by `inner`. */
function appWith(inner) {
  const source = appSource();
  assert.ok(source.includes(TEMPLATE_MAIN), 'the template main is the expected seam');
  return source.replace(TEMPLATE_MAIN, `<main id="evidence">${inner}</main>`);
}

const SECTION = (title) =>
  `<section class="ev-section">
    <h2 class="ev-title"><span class="ev-text ev-title-text">${title}</span></h2>
    <div class="ev-body"></div>
  </section>`;

/** A two-top-level tree with a nested subsection: 1 / 1.1 / 2. */
function nestedMain() {
  return appWith(
    SECTION('A')
      .replace(
        '<div class="ev-body"></div>',
        `<div class="ev-body">${SECTION('A1')}</div>`,
      ) +
      SECTION('B'),
  );
}

const tocEntries = (document) => [...document.querySelectorAll('#toc-tree [data-action="toc-goto"]')];
const entryTexts = (document) => tocEntries(document).map((b) => b.textContent);

/** Edit a section title through the input event the app listens for. */
function editTitle(document, titleEl, text) {
  titleEl.textContent = text;
  titleEl.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
}

// ---------------------------------------------------------------------
// 1. Boot: the panel, its header, and the tree
// ---------------------------------------------------------------------

test('boot: the panel is a <nav data-chrome> and the first child of <body>', () => {
  const { document } = loadApp(nestedMain());
  const panel = document.getElementById('toc-panel');
  assert.ok(panel, 'the panel exists');
  assert.equal(panel.tagName, 'NAV');
  assert.ok(panel.hasAttribute('data-chrome'), 'the panel is chrome');
  assert.equal(document.body.firstElementChild, panel, 'the panel is the first child of <body>');
  assert.equal(panel.nextElementSibling.id, 'toolbar', 'the panel precedes the toolbar');
});

test('boot: the pinned header carries the "Content" caption and the ☰ toggle with aria state', () => {
  const { document } = loadApp(nestedMain());
  const header = document.querySelector('#toc-panel > .toc-header');
  assert.ok(header, 'the header row exists');
  const caption = document.querySelector('#toc-panel .toc-caption');
  assert.equal(caption.textContent, 'Content');
  assert.equal(header.firstElementChild, caption, 'caption on the left');
  const toggle = document.getElementById('toc-toggle');
  assert.equal(toggle.parentElement, header, 'toggle in the header');
  assert.equal(header.lastElementChild, toggle, 'toggle on the right');
  assert.equal(toggle.getAttribute('data-action'), 'toggle-toc');
  assert.equal(toggle.textContent, '☰');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'boots expanded');
  assert.equal(toggle.getAttribute('aria-controls'), 'toc-tree');
  assert.ok(!document.body.classList.contains('toc-collapsed'), 'expanded: no collapsed marker');
});

test('boot: the tree lists exactly the document sections, in document order, with current numbers', () => {
  const { document } = loadApp(nestedMain());
  assert.deepEqual(entryTexts(document), ['1 A', '1.1 A1', '2 B'], 'every section, any depth, document order');
  assert.ok(!entryTexts(document).some((t) => t.includes('Test Evidence')), 'the document title is not listed');
  // one entry per section, all real buttons
  const entries = tocEntries(document);
  assert.equal(entries.length, document.querySelectorAll('#evidence .ev-section').length);
  for (const entry of entries) assert.equal(entry.tagName, 'BUTTON');
});

test('boot: a stray toc-collapsed marker in the file is stripped — every boot is expanded', () => {
  const dirty = appWith(SECTION('A')).replace('<body>', '<body class="toc-collapsed">');
  const { document } = loadApp(dirty);
  assert.ok(!document.body.classList.contains('toc-collapsed'), 'marker stripped at boot');
  assert.equal(
    document.getElementById('toc-toggle').getAttribute('aria-expanded'),
    'true',
    'boots expanded',
  );
});

// ---------------------------------------------------------------------
// 2. The panel & shift layout (stylesheet rule text — jsdom cannot
//    evaluate rendered layout; same seam as the sibling suites)
// ---------------------------------------------------------------------

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

function ruleFor(rules, selector) {
  const rule = rules.find((r) => r.selectors.includes(selector));
  assert.ok(rule, `a ${selector} rule exists`);
  return rule;
}

test('CSS: the panel is fixed at the left edge, full height, own scroll, opaque, bordered', () => {
  const rule = ruleFor(styleRules(), '#toc-panel');
  const d = rule.declarations;
  assert.ok(d.includes('position: fixed'), 'fixed');
  assert.ok(d.includes('left: 0'), 'the viewport left edge');
  assert.ok(d.includes('top: 0') && d.includes('bottom: 0'), 'full viewport height');
  assert.ok(d.includes('width: 240px'), '240px expanded');
  assert.ok(d.includes('overflow-y: auto'), 'own internal vertical scroll');
  const bg = d.find((x) => x.startsWith('background'));
  assert.ok(bg && !bg.includes('transparent'), 'an opaque background');
  assert.ok(d.some((x) => x.startsWith('border-right')), 'a quiet right border');
  const resize = ruleFor(styleRules(), '#toc-panel .toc-resize-handle');
  assert.ok(resize.declarations.includes('position: fixed'), 'the resize edge stays visible while the tree scrolls');
  assert.ok(resize.declarations.includes('left: calc(var(--ev-toc-width) - 6px)'), 'the handle follows the live panel width');
});

test('resize edge: dragging and keyboard resize the TOC without changing its collapse state', () => {
  const { document, window } = loadApp(nestedMain());
  const handle = document.getElementById('toc-resize-handle');
  assert.ok(handle, 'the right edge has a resize handle');
  assert.equal(handle.getAttribute('role'), 'separator');
  assert.equal(handle.getAttribute('aria-orientation'), 'vertical');
  assert.equal(handle.getAttribute('aria-valuenow'), '240');

  handle.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 240 }));
  window.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 300 }));
  window.dispatchEvent(new window.MouseEvent('pointerup'));
  assert.equal(handle.getAttribute('aria-valuenow'), '300');
  assert.equal(document.body.style.getPropertyValue('--ev-toc-expanded-width'), '300px');
  assert.ok(!document.body.classList.contains('panel-resizing'), 'the drag marker clears on pointerup');

  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(handle.getAttribute('aria-valuenow'), '290', 'the right edge moves left');
  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(handle.getAttribute('aria-valuenow'), handle.getAttribute('aria-valuemin'));
  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(handle.getAttribute('aria-valuenow'), handle.getAttribute('aria-valuemax'));
  assert.ok(!document.body.classList.contains('toc-collapsed'), 'resizing leaves the TOC expanded');

  const widthBeforeCollapse = handle.getAttribute('aria-valuenow');
  document.getElementById('toc-toggle').click();
  handle.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 480 }));
  window.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 400 }));
  window.dispatchEvent(new window.MouseEvent('pointerup'));
  assert.equal(handle.getAttribute('aria-valuenow'), widthBeforeCollapse, 'the collapsed panel is not resized');
  document.getElementById('toc-toggle').click();

  const saved = new window.DOMParser().parseFromString(window.__evidence.serialize(), 'text/html');
  assert.equal(saved.body.getAttribute('style'), null, 'the session width is not serialized');
});

test('CSS: the tree content block is inset from the panel edges (entries do not touch the edge)', () => {
  const tree = ruleFor(styleRules(), '#toc-tree');
  assert.ok(tree.declarations.includes('padding: 0 8px 8px'), '8px side padding on the whole block');
  const entry = ruleFor(styleRules(), '#toc-tree button');
  assert.ok(entry.declarations.includes('padding: 2px 8px'), 'plus the entry padding inside the block');
});

test('CSS: the sticky toolbar is opaque — scrolled content is covered, not seen through', () => {
  const rule = ruleFor(styleRules(), '#toolbar');
  const bg = rule.declarations.find((x) => x.startsWith('background'));
  assert.ok(bg, 'a background declaration');
  assert.ok(!bg.includes('transparent') && bg !== 'background: inherit', 'opaque (not transparent, not inherit)');
});

test('CSS: the body shifts for the TOC and Help panels', () => {
  const rules = styleRules();
  const body = ruleFor(rules, 'body');
  assert.ok(
    body.declarations.includes('padding: 0 20px 80px 240px'),
    'the body carries 240px left padding (expanded)',
  );
  assert.ok(
    body.declarations.some((x) => x.startsWith('transition:') && x.includes('padding-left 120ms ease')),
    'TOC body padding transition ~120ms ease',
  );
  assert.ok(
    body.declarations.some((x) => x.startsWith('transition:') && x.includes('padding-right 160ms ease')),
    'Help body padding transition ~160ms ease',
  );
  const collapsed = ruleFor(rules, 'body.toc-collapsed');
  assert.ok(collapsed.declarations.includes('padding-left: 48px'), '48px left padding (collapsed)');
  const panelCollapsed = ruleFor(rules, 'body.toc-collapsed #toc-panel');
  assert.ok(panelCollapsed.declarations.includes('width: 48px'), 'panel width 48px collapsed');
  const panel = ruleFor(rules, '#toc-panel');
  assert.ok(panel.declarations.includes('transition: width 120ms ease'), 'panel width transition ~120ms ease');
});

test('CSS: collapsed shows only the corner ☰ button (caption and tree hidden)', () => {
  const rules = styleRules();
  const rule = ruleFor(rules, 'body.toc-collapsed #toc-tree');
  assert.ok(rule.declarations.includes('display: none'), 'tree hidden when collapsed');
  const caption = rules.find((r) => r.selectors.includes('body.toc-collapsed .toc-caption'));
  assert.ok(caption && caption.declarations.includes('display: none'), 'caption hidden when collapsed');
});

// ---------------------------------------------------------------------
// 3. Toggle: flip the state; a re-render never resets it
// ---------------------------------------------------------------------

test('toggle: collapse flips the marker and aria-expanded; expand restores', () => {
  const { document } = loadApp(nestedMain());
  document.getElementById('toc-toggle').click();
  assert.ok(document.body.classList.contains('toc-collapsed'), 'collapsed marker set');
  assert.equal(
    document.getElementById('toc-toggle').getAttribute('aria-expanded'),
    'false',
    'aria-expanded follows',
  );
  // the collapsed CSS pair now applies: 48px panel + 48px body padding (§21)
  const rules = styleRules();
  assert.ok(ruleFor(rules, 'body.toc-collapsed').declarations.includes('padding-left: 48px'));
  assert.ok(ruleFor(rules, 'body.toc-collapsed #toc-panel').declarations.includes('width: 48px'));

  document.getElementById('toc-toggle').click();
  assert.ok(!document.body.classList.contains('toc-collapsed'), 'expanded again');
  assert.equal(
    document.getElementById('toc-toggle').getAttribute('aria-expanded'),
    'true',
    'aria-expanded follows back',
  );
});

test('toggle: a chrome re-render (a title edit) leaves the state untouched, in both states', () => {
  const { document } = loadApp(nestedMain());
  const title = document.querySelector('#evidence .ev-title-text');
  document.getElementById('toc-toggle').click(); // collapse
  editTitle(document, title, 'Renamed');
  assert.ok(document.body.classList.contains('toc-collapsed'), 'collapse survives the re-render');
  assert.equal(
    document.getElementById('toc-toggle').getAttribute('aria-expanded'),
    'false',
    'aria-expanded survives the re-render',
  );
  assert.deepEqual(entryTexts(document), ['1 Renamed', '1.1 A1', '2 B'], 'the tree itself is fresh');

  document.getElementById('toc-toggle').click(); // expand
  editTitle(document, title, 'Renamed again');
  assert.ok(!document.body.classList.contains('toc-collapsed'), 'expansion survives the re-render');
  assert.equal(document.getElementById('toc-toggle').getAttribute('aria-expanded'), 'true');
});

// ---------------------------------------------------------------------
// 4. Tree content edges
// ---------------------------------------------------------------------

test('tree edge: an empty document shows the muted "No sections yet" hint, no entries', () => {
  const { document } = loadApp();
  assert.equal(tocEntries(document).length, 0, 'no entries');
  const hint = document.querySelector('#toc-tree .toc-hint');
  assert.ok(hint, 'the hint exists');
  assert.equal(hint.textContent, 'No sections yet');
  const { document: d2 } = loadApp();
  addFirstSection(d2); // the hint makes room for the first entry
  assert.equal(d2.querySelector('#toc-tree .toc-hint'), null, 'the hint is gone');
  assert.deepEqual(entryTexts(d2), ['1 Untitled'], 'the new empty section is listed (number + placeholder)');
});

test('tree edge: an empty section title renders a muted "Untitled" entry (number still shown in the tooltip)', () => {
  const { document } = loadApp(nestedMain());
  const a1 = [...document.querySelectorAll('#evidence .ev-title > .ev-title-text')][1]; // A1
  editTitle(document, a1, '');
  const entries = tocEntries(document);
  assert.equal(entries[1].textContent, '1.1 Untitled', 'the number stands, the placeholder replaces the title');
  const untitled = entries[1].querySelector('.toc-untitled');
  assert.equal(untitled.textContent, 'Untitled', 'the muted "Untitled"');
  assert.equal(entries[1].title, '1.1 Untitled', 'the tooltip carries the full entry text');
  // the muted class is quiet, like the document's own placeholder
  const rules = styleRules();
  const rule = ruleFor(rules, '#toc-tree .toc-untitled');
  assert.ok(rule.declarations.some((d) => d.startsWith('color')), 'a muted color');
});

test('tree edge: the document title (h1) is never listed, whatever it says', () => {
  const { document } = loadApp(nestedMain());
  const docTitle = document.querySelector('#evidence .ev-doc-title-text');
  docTitle.textContent = 'My session';
  docTitle.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  assert.ok(
    !entryTexts(document).some((t) => t.includes('My session')),
    'the document title is not an entry',
  );
});

test('tree edge: deep nesting indents per depth — padding-left (depth − 1) × 1em', () => {
  // 1 / 1.1 / 1.1.1 / 1.1.1.1 (depths 1..4) via the UI
  const { document } = loadApp();
  const s1 = addFirstSection(document);
  const clickSub = (section) => {
    sectionAction(section, 'add-subsection').click();
    return section.querySelector(':scope > .ev-body > .ev-section');
  };
  const s11 = clickSub(s1);
  const s111 = clickSub(s11);
  const s1111 = clickSub(s111);
  const pads = [s1, s11, s111, s1111].map(
    (s) => tocEntries(document)[[s1, s11, s111, s1111].indexOf(s)].style.paddingLeft,
  );
  assert.deepEqual(pads, ['0em', '1em', '2em', '3em'], 'one em per depth below the top');
});

test('tree edge: entries truncate on one line (CSS) while the title attribute carries the full text', () => {
  const long = 'A'.repeat(120);
  const { document } = loadApp(appWith(SECTION(long)));
  const entry = tocEntries(document)[0];
  assert.equal(entry.title, '1 ' + long, 'native tooltip has the full "number title" text');
  const rules = styleRules();
  const rule = ruleFor(rules, '#toc-tree button');
  assert.ok(rule.declarations.includes('white-space: nowrap'), 'single line');
  assert.ok(rule.declarations.includes('overflow: hidden'), 'clipped');
  assert.ok(rule.declarations.includes('text-overflow: ellipsis'), 'ellipsis-truncated');
});

// ---------------------------------------------------------------------
// 5. Live sync: the tree re-renders on every renumber
// ---------------------------------------------------------------------

test('sync: a title edit updates the entry text (the number is untouched)', () => {
  const { document } = loadApp(nestedMain());
  const a = document.querySelector('#evidence .ev-title > .ev-title-text');
  editTitle(document, a, 'Renamed');
  assert.deepEqual(entryTexts(document), ['1 Renamed', '1.1 A1', '2 B']);
});

test('sync: adding a subsection inserts a new numbered entry in document order', () => {
  const { document } = loadApp(nestedMain());
  const b = [...document.querySelectorAll('#evidence > .ev-section')][1]; // B
  sectionAction(b, 'add-subsection').click();
  assert.deepEqual(entryTexts(document), ['1 A', '1.1 A1', '2 B', '2.1 Untitled']);
});

test('sync: deleting a section removes its entry and its children, numbers refresh', () => {
  const { document, window } = loadApp(nestedMain());
  window.confirm = () => true;
  const a = [...document.querySelectorAll('#evidence > .ev-section')][0]; // A (has A1)
  sectionAction(a, 'delete').click();
  assert.deepEqual(entryTexts(document), ['1 B'], 'A and A1 are gone; B is renumbered 2 → 1');
});

test('sync: a drag reorder (the moveElement seam) renumbers the tree to the new order', () => {
  const { document, window } = loadApp(nestedMain());
  const root = document.getElementById('evidence');
  const [a, b] = [...root.querySelectorAll(':scope > .ev-section')];
  const ok = window.__evidence.moveElement(b, root, a); // B before A
  assert.ok(ok, 'the move lands');
  assert.deepEqual(entryTexts(document), ['1 B', '2 A', '2.1 A1'], 'entries and numbers match the new order');
});

// ---------------------------------------------------------------------
// 6. Entry click → scroll
// ---------------------------------------------------------------------

test('click: the matching section is scrolled into view, smoothly, by its own element', () => {
  const { document, window } = loadApp(nestedMain());
  const calls = [];
  window.HTMLElement.prototype.scrollIntoView = function (opts) {
    calls.push({ el: this, opts });
  };
  const sections = [...document.querySelectorAll('#evidence .ev-section')];
  tocEntries(document)[1].click(); // 1.1 A1
  assert.equal(calls.length, 1, 'exactly one scroll');
  assert.equal(calls[0].el, sections[1], 'the resolved element is the clicked entry\'s section');
  assert.equal(calls[0].opts.behavior, 'smooth');
  // the CSS offset lands the title below the sticky toolbar
  const rule = ruleFor(styleRules(), '.ev-section');
  assert.ok(rule.declarations.some((d) => d.startsWith('scroll-margin-top')), 'a scroll-margin-top rule exists');
});

test('click: scroll only — no focus change, no save, panel state unchanged', () => {
  const { document, downloads } = loadApp(nestedMain());
  const before = document.activeElement; // the title field, focused at boot
  tocEntries(document)[2].click(); // 2 B
  assert.equal(document.activeElement, before, 'the click focuses nothing — scroll only');
  assert.equal(downloads.length, 0, 'no save triggered');
  assert.ok(!document.body.classList.contains('toc-collapsed'), 'panel state unchanged');
  assert.equal(document.getElementById('toc-toggle').getAttribute('aria-expanded'), 'true');
});

// ---------------------------------------------------------------------
// 7. Serialization: no TOC markup, no TOC state, A4 from both states
// ---------------------------------------------------------------------

async function saveText(r) {
  r.document.getElementById('save-btn').click();
  return downloadText(r.downloads.find((d) => d.name));
}

test('save: the file has no #toc-panel, no TOC body-state marker, no data-chrome', async () => {
  const r = loadApp(nestedMain());
  const text = await saveText(r);
  const saved = new JSDOM(text).window.document;
  assert.equal(saved.getElementById('toc-panel'), null, 'no panel in the saved file');
  // (the app's <script> source still mentions the ids — assert the markup, not substrings)
  assert.equal(
    saved.body.querySelector('[data-action="toggle-toc"], [data-action="toc-goto"], .toc-header, #toc-tree'),
    null,
    'no TOC markup of any kind',
  );
  assert.ok(!saved.body.classList.contains('toc-collapsed'), 'no TOC body-state marker');
  assert.equal(saved.body.getAttribute('class'), null, 'and no empty class attribute residue');
  assert.equal(saved.querySelectorAll('[data-chrome]').length, 0, 'no data-chrome leakage');
  // the content survives the round trip
  assert.deepEqual(
    [...saved.querySelectorAll('#evidence .ev-title-text')].map((t) => t.textContent),
    ['A', 'A1', 'B'],
  );
});

test('A4: save → reload → save is byte-identical with the panel expanded', async () => {
  const first = loadApp(nestedMain());
  const s1 = await saveText(first);
  const second = loadApp(s1);
  assert.equal(
    second.document.getElementById('toc-toggle').getAttribute('aria-expanded'),
    'true',
    're-open boots expanded',
  );
  const s2 = await saveText(second);
  assert.equal(s2, s1, 'byte-identical (expanded)');
});

test('A4: save → reload → save is byte-identical with the panel collapsed, and identical to the expanded save', async () => {
  const first = loadApp(nestedMain());
  const sExpanded = await saveText(first);

  const c1 = loadApp(nestedMain());
  c1.document.getElementById('toc-toggle').click(); // collapse
  const s1 = await saveText(c1);
  assert.ok(!new JSDOM(s1).window.document.body.classList.contains('toc-collapsed'), 'the collapsed marker is stripped');
  assert.equal(s1, sExpanded, 'the saved file is the same in both states — no TOC state anywhere');

  const c2 = loadApp(s1);
  c2.document.getElementById('toc-toggle').click(); // collapse again after re-open
  const s2 = await saveText(c2);
  assert.equal(s2, s1, 'byte-identical (collapsed)');
});
