import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction,
  loadApp,
  appSource,
  downloadText,
  stubImagePipeline,
  pasteImage,
  waitFor,
  addFirstSection,
} from './helpers.js';

// 0051 (SPEC §23): screenshot rows. Seams, per repo convention:
//   1. UI-driven DOM (clicks, paste) through loadApp()
//   2. the core move seam — window.__evidence.moveElement(row, target, before)
//   3. the embedded source (CSS text, chrome factories) for what jsdom
//      cannot evaluate (:hover, flex layout)

/** Paste one screenshot into the section's pending placeholder; return the new shot. */
async function pasteShot(section, window) {
  const before = section.querySelectorAll('.ev-screenshot img').length;
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, section.querySelector('.ev-screenshot-pending'));
  await waitFor(() => section.querySelectorAll('.ev-screenshot img').length === before + 1);
  return section.querySelectorAll('.ev-screenshot')[before];
}

const bodyOf = (section) => section.querySelector(':scope > .ev-body');
const rowsOf = (section) => [...bodyOf(section).querySelectorAll(':scope > .ev-shot-row')];
const shotsOf = (container) =>
  [...container.querySelectorAll(':scope > .ev-screenshot')];

// ---------------------------------------------------------------------
// Row creation: the paste flow (SPEC §23 mutation 1, §6)
// ---------------------------------------------------------------------

test('a first paste in a section wraps the shot in a new .ev-shot-row (plain row)', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  await pasteShot(section, window);
  const body = bodyOf(section);
  const row = body.querySelector(':scope > .ev-shot-row');
  assert.ok(row, 'a shot row exists');
  assert.equal(body.lastElementChild, row, 'the row is at the end of the body');
  assert.equal(shotsOf(row).length, 1, 'the pasted shot is the row\'s only member');
  assert.ok(!row.hasAttribute('data-chrome'), 'the wrapper is content, not chrome');
  assert.ok(!row.hasAttribute('data-valign'), 'no alignment attributes at the defaults');
  assert.ok(!row.hasAttribute('data-halign'), 'no alignment attributes at the defaults');
});

test('a second "+ screenshot" puts the placeholder at the end of the section\'s last row; the paste joins it', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  await pasteShot(section, window);
  const first = section.querySelector('.ev-screenshot');
  sectionAction(section, 'add-screenshot').click();
  const pending = section.querySelector('.ev-screenshot-pending');
  assert.ok(pending, 'the placeholder exists');
  assert.equal(pending.parentElement, rowsOf(section)[0], 'the placeholder is inside the last row');
  assert.equal(rowsOf(section)[0].lastElementChild, pending, 'at the row\'s end');
  await pasteShot(section, window);
  assert.equal(section.querySelectorAll('.ev-screenshot').length, 2);
  assert.equal(rowsOf(section).length, 1, 'both shots share one row');
  const row = rowsOf(section)[0];
  assert.equal(shotsOf(row)[0], first, 'the first shot kept its place');
});

test('legacy flat shots are never grouped: a paste after them creates its own plain row', async () => {
  const legacy = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Legacy</span></h2><div class="ev-body"><div class="ev-screenshot"><img class="ev-img" src="assets/legacy.png"></div></div></section>',
  );
  const { document, window } = loadApp(legacy);
  stubImagePipeline(window);
  const section = document.querySelector('#evidence > .ev-section');
  const legacyShot = section.querySelector('.ev-screenshot');
  assert.equal(section.querySelector('.ev-shot-row'), null, 'boot trusts wrappers: no re-derivation from flat siblings');
  sectionAction(section, 'add-screenshot').click();
  const pending = section.querySelector('.ev-screenshot-pending');
  assert.equal(pending.parentElement, bodyOf(section), 'the section has no rows: the placeholder sits at the end of the body');
  pasteImage(window, pending);
  await waitFor(() => section.querySelectorAll('.ev-screenshot').length === 2);
  assert.equal(legacyShot.parentElement, bodyOf(section), 'the flat shot stayed flat');
  const row = rowsOf(section)[0];
  assert.ok(row, 'the new shot got its own plain row');
  assert.equal(shotsOf(row).length, 1);
  assert.ok(row.contains(legacyShot) === false, 'the legacy shot did not join it');
});

test('boot never re-derives rows from flat siblings — two adjacent flat shots stay flat', () => {
  const flat = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">T</span></h2><div class="ev-body"><div class="ev-screenshot"><img class="ev-img" src="assets/a.png"></div><div class="ev-screenshot"><img class="ev-img" src="assets/b.png"></div></div></section>',
  );
  const { document } = loadApp(flat);
  const body = document.querySelector('#evidence .ev-body');
  assert.equal(document.querySelectorAll('.ev-shot-row').length, 0, 'no wrapper is created at boot');
  assert.equal(body.querySelectorAll(':scope > .ev-screenshot').length, 2, 'both shots stay direct body children');
});

test('add buttons append after the last row and never split it', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  await pasteShot(section, window);
  await pasteShot(section, window);
  assert.equal(rowsOf(section).length, 1, 'precondition: one two-shot row');
  const row = rowsOf(section)[0];

  // + comment: lands after the row, the row is untouched
  sectionAction(section, 'add-comment').click();
  const body = bodyOf(section);
  assert.equal(body.lastElementChild, section.querySelector('.ev-comment'), 'the comment is after the last row');
  assert.equal(rowsOf(section).length, 1, '+ comment did not split the row');
  assert.equal(shotsOf(rowsOf(section)[0]).length, 2, 'both shots still in the row');
  assert.ok(rowsOf(section)[0].contains(row), 'the same wrapper element survived');

  // + screenshot: the placeholder joins the (new) last row, at its end
  sectionAction(section, 'add-screenshot').click();
  const pending = section.querySelector('.ev-screenshot-pending');
  assert.equal(pending.parentElement, bodyOf(section).querySelector(':scope > .ev-shot-row'), 'the placeholder is inside the last row');
});

// ---------------------------------------------------------------------
// The row control strip & alignment state (SPEC §23 visual & controls)
// ---------------------------------------------------------------------

const ROW_CONTROL_ACTIONS = [
  'row-valign-top', 'row-valign-middle', 'row-valign-bottom',
  'row-halign-left', 'row-halign-center', 'row-halign-right',
];

async function twoShotRow(document, window) {
  const section = addFirstSection(document);
  await pasteShot(section, window);
  await pasteShot(section, window);
  return rowsOf(section)[0];
}

test('every row renders a chrome drag handle before its .ev-row-controls strip', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const row = await twoShotRow(document, window);
  const handle = row.firstElementChild;
  assert.ok(handle && handle.matches('.ev-drag-handle[data-chrome]'), 'the row handle is the wrapper\'s first child');
  const strip = row.children[1];
  assert.ok(strip && strip.matches('.ev-row-controls'), 'the strip follows the row handle');
  assert.ok(strip.hasAttribute('data-chrome'), 'the strip is chrome');
  assert.deepEqual(
    [...strip.querySelectorAll('[data-action]')].map((b) => b.dataset.action),
    ROW_CONTROL_ACTIONS,
    'top mid bot · left center right',
  );
  const active = (action) => strip.querySelector(`[data-action="${action}"]`).hasAttribute('data-active');
  assert.equal(active('row-valign-top'), true, 'top is active at the default');
  assert.equal(active('row-halign-center'), true, 'center is active at the default');
  assert.equal(active('row-halign-left'), false);
  assert.equal(active('row-valign-middle'), false);
});

test('strip toggles are stateful: clicks set the wrapper attributes, re-highlight, and omit the defaults', async () => {
  const { document, window, downloads } = loadApp();
  stubImagePipeline(window);
  const row = await twoShotRow(document, window);
  const strip = () => row.querySelector(':scope > .ev-row-controls');
  const active = (action) => strip().querySelector(`[data-action="${action}"]`).hasAttribute('data-active');

  sectionAction(row, 'row-valign-middle').click();
  assert.equal(row.getAttribute('data-valign'), 'middle', 'mid sets data-valign="middle"');
  assert.equal(active('row-valign-middle'), true, 'the active highlight moved');
  assert.equal(active('row-valign-top'), false);

  sectionAction(row, 'row-halign-right').click();
  assert.equal(row.getAttribute('data-halign'), 'right');
  assert.equal(active('row-halign-right'), true);

  sectionAction(row, 'row-valign-top').click();
  assert.equal(row.hasAttribute('data-valign'), false, 'the top default is omitted, not set');
  assert.equal(active('row-valign-top'), true, '…but the highlight returns');

  sectionAction(row, 'row-halign-center').click();
  assert.equal(row.hasAttribute('data-halign'), false, 'the center default is omitted, not set');
  assert.equal(active('row-halign-center'), true, '…but the center highlight returns');

  sectionAction(row, 'row-halign-left').click();
  assert.equal(row.getAttribute('data-halign'), 'left', 'left is stored as a non-default choice');

  assert.equal(downloads.length, 0, 'no save is triggered by the strip');
});

test('boot rebuilds the strip and trusts saved wrapper alignment', async () => {
  const savedSource = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">T</span></h2><div class="ev-body"><div class="ev-shot-row" data-valign="middle" data-halign="center"><div class="ev-screenshot" data-standalone=""><img class="ev-img" src="assets/a.png"></div><div class="ev-screenshot"><img class="ev-img" src="assets/b.png"></div></div></div></section>',
  );
  const { document } = loadApp(savedSource);
  const row = document.querySelector('#evidence .ev-shot-row');
  assert.equal(row.getAttribute('data-valign'), 'middle', 'saved data-valign adopted as-is');
  assert.equal(row.getAttribute('data-halign'), 'center', 'saved data-halign adopted as-is');
  const handle = row.firstElementChild;
  assert.ok(handle && handle.matches('.ev-drag-handle[data-chrome]'), 'the row handle was rebuilt as the first child');
  const strip = row.children[1];
  assert.ok(strip && strip.matches('.ev-row-controls[data-chrome]'), 'the chrome strip was rebuilt after the row handle');
  assert.equal(sectionAction(strip, 'row-valign-middle').hasAttribute('data-active'), true, 'active state follows the saved attributes');
  assert.equal(sectionAction(strip, 'row-halign-center').hasAttribute('data-active'), true);
  assert.equal(document.querySelector('#evidence .ev-screenshot[data-standalone]').querySelector('img').getAttribute('src'), 'assets/a.png', 'the data-standalone marker is adopted as-is');
});

test('the strip is stripped on save; the wrapper and its alignment serialize as clean content', async () => {
  const first = loadApp();
  stubImagePipeline(first.window);
  const row = await twoShotRow(first.document, first.window);
  sectionAction(row, 'row-valign-bottom').click();

  first.document.getElementById('save-btn').click();
  const savedText = await downloadText(first.downloads.find((d) => d.name));
  const saved = new JSDOM(savedText).window.document;
  const savedRow = saved.querySelector('#evidence .ev-shot-row');
  assert.ok(savedRow, 'the wrapper is content and serializes');
  assert.equal(savedRow.getAttribute('data-valign'), 'bottom');
  assert.equal(savedRow.hasAttribute('data-halign'), false, 'the center default remains omitted');
  assert.equal(savedRow.querySelector('.ev-row-controls'), null, 'the strip is chrome — stripped on save');
  assert.equal(saved.querySelectorAll('#evidence [data-chrome]').length, 0, 'no chrome of any kind in the saved content');
});

test('CSS: rows are flex-wrap with the alignment mapping, an at-rest-invisible hover wash, and a visibility-based strip reveal', () => {
  const source = appSource();
  const rule = (selector) => {
    const m = new RegExp(selector.replace(/[.+\[\]:#-]/g, (c) => `\\${c}`) + '\\s*\\{([^}]*)\\}').exec(source);
    return m ? m[1] : null;
  };
  const rowCss = rule('.ev-shot-row');
  assert.ok(rowCss, 'a .ev-shot-row rule exists');
  assert.ok(/display:\s*flex/.test(rowCss), 'the row is display: flex');
  assert.ok(/flex-wrap:\s*wrap/.test(rowCss), '…and wraps');
  assert.ok(/align-items:\s*flex-start/.test(rowCss), 'the top default is align-items: flex-start');
  assert.ok(/justify-content:\s*center/.test(rowCss), 'the center default is justify-content: center');
  assert.ok(/margin-block:\s*1\.25em/.test(rowCss), 'screenshots have space from surrounding content');
  assert.ok(/row-gap:\s*1em/.test(rowCss), 'wrapped images have vertical space');
  assert.ok(/column-gap:\s*32px/.test(rowCss), 'neighboring images have horizontal space');
  assert.match(source, /\.ev-shot-row\[data-valign="middle"\]\s*\{[^}]*align-items:\s*center/);
  assert.match(source, /\.ev-shot-row\[data-valign="bottom"\]\s*\{[^}]*align-items:\s*flex-end/);
  assert.match(source, /\.ev-shot-row\[data-halign="center"\]\s*\{[^}]*justify-content:\s*center/);
  assert.match(source, /\.ev-shot-row\[data-halign="right"\]\s*\{[^}]*justify-content:\s*flex-end/);
  assert.match(source, /\.ev-shot-row\s*>\s*\.ev-screenshot\s*>\s*\.ev-img\s*\{[^}]*margin:\s*0 auto/,
    'images are centered inside full-line items by default');
  assert.match(source, /\.ev-shot-row\[data-halign="left"\]\s*>\s*\.ev-screenshot\s*>\s*\.ev-img\s*\{[^}]*margin:\s*0/,
    'explicit left alignment restores the flat image position');
  // the row is invisible at rest: no border/background; its left padding is
  // the shared authored-content column, not a visual wash or row-specific gap
  assert.ok(!/(?:^|[;\s])(border|background)\s*:/.test(rowCss), 'the at-rest row has no border or background');
  assert.match(rowCss, /padding-left:\s*var\(--ev-content-start\)/,
    'the row reserves the shared authored-content column');
  // hover reveals the subtle wash
  assert.match(source, /\.ev-shot-row:hover:not\(:focus-within\)\s*\{[^}]*background:\s*var\(--ev-hover-surface\)/);
  // the strip: right-aligned above the first image, revealed by the row hover — visibility, never display
  const stripCss = rule('.ev-shot-row > .ev-row-controls');
  assert.ok(stripCss, 'a .ev-shot-row > .ev-row-controls rule exists');
  assert.ok(/justify-content:\s*flex-end/.test(stripCss), 'the strip is right-aligned');
  assert.match(source, /\.ev-shot-row > \.ev-row-controls\s*\{[^}]*visibility:\s*hidden/,
    'the strip is hidden at rest, via visibility (in its own rule, so no hiding rule carries display)');
  assert.match(source, /\.ev-shot-row:hover\s*>\s*\.ev-row-controls\s*\{[^}]*visibility:\s*visible/);
  assert.ok(!/display:\s*none/.test(stripCss), 'never display — the strip keeps reserving its line (0024)');
});

// ---------------------------------------------------------------------
// Standalone (per-image) — SPEC §23
// ---------------------------------------------------------------------

test('CSS: row item widths follow image presets, with full-line natural sizes and standalone override', () => {
  const document = new JSDOM(appSource()).window.document;
  const rules = [...document.styleSheets[0].cssRules];
  const style = (selector) => rules.find((rule) => rule.selectorText === selector)?.style;
  const item = style('.ev-shot-row > .ev-screenshot');
  assert.equal(item.width, '100%', 'unsized, original and page-width items claim the full line');
  assert.equal(item.flex, '0 0 auto', 'items wrap at their declared width without growing or shrinking');
  assert.equal(item.getPropertyValue('min-width'), '0px', 'content cannot impose a minimum width');
  assert.equal(item.getPropertyValue('max-width'), '100%', 'natural images cannot blow out the column');
  for (const [size, width] of [['small', '320px'], ['medium', '640px'], ['large', '960px']]) {
    assert.equal(style(`.ev-shot-row > .ev-screenshot[data-size="${size}"]`).width, width, size);
  }
  const standalone = style('.ev-shot-row > .ev-screenshot[data-standalone]');
  assert.equal(standalone.width, '100%', 'standalone overrides preset widths');
  assert.equal(standalone.flex, '0 0 100%', 'standalone breaks before and after the image');
  const defaultImage = style('.ev-shot-row > .ev-screenshot > .ev-img');
  assert.equal(defaultImage?.marginLeft, 'auto', 'standalone images are centered by default');
  assert.equal(defaultImage?.marginRight, 'auto', 'standalone images are centered by default');
  const leftImage = style('.ev-shot-row[data-halign="left"] > .ev-screenshot > .ev-img');
  assert.equal(leftImage?.marginLeft, '0px', 'explicit left alignment overrides the centered default');
  assert.equal(leftImage?.marginRight, '0px', 'explicit left alignment overrides the centered default');
});

test('CSS: standalone metadata shares the rendered image-sized column and follows row horizontal alignment', () => {
  const document = new JSDOM(appSource()).window.document;
  const rules = [...document.styleSheets[0].cssRules];
  const style = (selector) => rules.find((rule) => rule.selectorText === selector)?.style;
  const standalone = style('.ev-shot-row > .ev-screenshot[data-standalone]');
  const caption = style('.ev-shot-row > .ev-screenshot[data-standalone] > .ev-caption');
  const filename = style('.ev-shot-row > .ev-screenshot[data-standalone] > .ev-filename');
  const left = style('.ev-shot-row[data-halign="left"] > .ev-screenshot[data-standalone]');
  const right = style('.ev-shot-row[data-halign="right"] > .ev-screenshot[data-standalone]');

  assert.equal(standalone.display, 'grid', 'standalone content is laid out in one column');
  assert.equal(standalone.gridTemplateColumns, 'min(var(--ev-standalone-image-width, 100%), 100%)', 'the column follows the rendered image width and stays bounded');
  assert.equal(standalone.justifyContent, 'center', 'the image-sized column is centered by default');
  assert.equal(caption.width, '100%', 'caption fills the image-sized column');
  assert.equal(caption.paddingLeft, '0px', 'caption text is flush with the image');
  assert.equal(caption.paddingRight, '0px', 'caption does not add an image-edge indent');
  assert.equal(filename.width, '100%', 'filename fills the image-sized column');
  assert.equal(left.justifyContent, 'start', 'left row alignment moves the metadata with the image');
  assert.equal(right.justifyContent, 'end', 'right row alignment moves the metadata with the image');
});

test('standalone captures the rendered image width for its metadata column', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  await pasteShot(section, window);
  const screenshot = section.querySelector('.ev-screenshot');
  const image = screenshot.querySelector(':scope > .ev-img');
  image.getBoundingClientRect = () => ({ width: 320 });

  sectionAction(screenshot, 'standalone').click();
  assert.equal(
    screenshot.style.getPropertyValue('--ev-standalone-image-width'),
    '320px',
    'the standalone metadata column uses the image\'s rendered width',
  );
  sectionAction(screenshot, 'standalone').click();
  assert.equal(screenshot.style.getPropertyValue('--ev-standalone-image-width'), '', 'off clears the live layout width');
});

test('standalone remeasures its metadata column after the viewport changes', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  await pasteShot(section, window);
  const screenshot = section.querySelector('.ev-screenshot');
  const image = screenshot.querySelector(':scope > .ev-img');
  image.getBoundingClientRect = () => ({
    width: screenshot.style.getPropertyValue('--ev-standalone-image-width') ? 640 : 468,
  });
  sectionAction(screenshot, 'standalone').click();
  assert.equal(screenshot.style.getPropertyValue('--ev-standalone-image-width'), '468px');

  image.getBoundingClientRect = () => ({
    width: screenshot.style.getPropertyValue('--ev-standalone-image-width') ? 640 : 320,
  });
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(screenshot.style.getPropertyValue('--ev-standalone-image-width'), '320px', 'resize discards the stale width before measuring');
});

test('CSS: custom row widths come from the image, while palette and caption wrap without an intrinsic floor', () => {
  const document = new JSDOM(appSource()).window.document;
  const rules = [...document.styleSheets[0].cssRules];
  const style = (selector) => rules.find((rule) => rule.selectorText === selector)?.style;
  assert.equal(style('.ev-shot-row > .ev-screenshot[data-size="custom"]')?.width, 'max-content',
    'the existing inline pixel width on a custom image sizes its item');
  const controls = style('.ev-shot-row > .ev-screenshot > .ev-controls');
  assert.equal(style('.ev-screenshot:hover > .ev-controls')?.display, 'flex', 'the visible palette fills the item as a block');
  assert.equal(controls.getPropertyValue('flex-wrap'), 'wrap', 'buttons wrap within the item');
  assert.equal(controls.getPropertyValue('margin-left'), '0px', 'palette margins do not overflow the item');
  assert.equal(controls.contain, 'inline-size', 'chrome contributes no intrinsic width to a custom item');
  const caption = style('.ev-shot-row > .ev-screenshot > .ev-caption');
  assert.equal(caption?.contain, 'inline-size', 'caption text contributes no intrinsic width');
  assert.equal(caption.getPropertyValue('overflow-wrap'), 'anywhere', 'even an unbroken caption fits');
  assert.equal(style('.ev-controls').display, 'inline-flex', 'flat palettes retain their existing layout');
  assert.equal(style('.ev-controls').getPropertyValue('flex-wrap'), '', 'flat palettes are unchanged');
});

test('each screenshot control row carries the stateful standalone toggle after the size controls and before Copy/Delete', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  await pasteShot(section, window);
  const shot = section.querySelector('.ev-screenshot');
  const actions = [...shot.querySelectorAll(':scope > .ev-controls [data-action]')].map((b) => b.dataset.action);
  assert.deepEqual(actions, [
    'size-small', 'size-medium', 'size-large', 'size-page-width', 'size-original', 'size-larger', 'size-smaller',
    'standalone', 'open-image', 'copy', 'paste-after', 'delete',
  ], 'standalone sits between the size controls and Copy/Delete');
  assert.equal(sectionAction(shot, 'standalone').hasAttribute('data-active'), false, 'dim (inactive) when off');
});

test('standalone is a pure boolean on the shot: on marks it, off restores, the highlight follows', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  const first = await pasteShot(section, window);
  await pasteShot(section, window);
  const toggle = () => sectionAction(first, 'standalone');

  toggle().click();
  assert.ok(first.hasAttribute('data-standalone'), 'on sets the data-standalone marker on the shot');
  assert.equal(toggle().hasAttribute('data-active'), true, 'highlighted when on');
  assert.equal(section.querySelectorAll('.ev-screenshot[data-standalone]').length, 1, 'the marker is never stamped on the row or other shots');

  toggle().click();
  assert.equal(first.hasAttribute('data-standalone'), false, 'off removes it — no state bookkeeping');
  assert.equal(toggle().hasAttribute('data-active'), false);
});

test('a saved data-standalone marker is adopted at boot and serialized verbatim', async () => {
  const savedSource = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">T</span></h2><div class="ev-body"><div class="ev-shot-row"><div class="ev-screenshot" data-standalone="" data-size="small"><img class="ev-img" src="assets/a.png"></div></div></div></section>',
  );
  const { document, downloads } = loadApp(savedSource);
  const shot = document.querySelector('#evidence .ev-screenshot');
  assert.equal(sectionAction(shot, 'standalone').hasAttribute('data-active'), true, 'boot lights the toggle from the saved marker');

  document.getElementById('save-btn').click();
  const savedText = await downloadText(downloads.find((d) => d.name));
  const saved = new JSDOM(savedText).window.document;
  assert.ok(saved.querySelector('#evidence .ev-screenshot[data-standalone]'), 'the marker serializes as clean content');
  assert.equal(saved.querySelector('#evidence .ev-screenshot').getAttribute('data-standalone'), '');
});

test('CSS: standalone takes the full line (flex basis 100%), the image keeps its size, and the row halign positions it', () => {
  const source = appSource();
  const rule = /\.ev-screenshot\[data-standalone\]\s*\{([^}]*)\}/.exec(source);
  assert.ok(rule, 'a .ev-screenshot[data-standalone] rule exists');
  assert.match(rule[1], /flex:\s*0 0 100%/);
  // the lone image is positioned by the row\'s halign inside its full-width box
  assert.match(source, /\.ev-shot-row\s*>\s*\.ev-screenshot\s*>\s*\.ev-img\s*\{[^}]*margin:\s*0 auto/);
  assert.match(source, /\.ev-shot-row\[data-halign="right"\]\s*>\s*\.ev-screenshot\s*>\s*\.ev-img\s*\{[^}]*margin-left:\s*auto/);
});

// ---------------------------------------------------------------------
// Mutation mechanics — SPEC §23 (the move seam, window.__evidence.moveElement)
// ---------------------------------------------------------------------

test('a drop between a row\'s images splits the target row around the dropped row; the first half keeps its alignment', async () => {
  const { document, window, downloads } = loadApp();
  stubImagePipeline(window);
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const s = addFirstSection(document);
  for (let i = 0; i < 3; i++) await pasteShot(s, window);
  const row = rowsOf(s)[0];
  const shots = shotsOf(row);
  sectionAction(row, 'row-valign-middle').click();
  const comment = () => s.querySelector('.ev-comment');
  sectionAction(s, 'add-comment').click();

  assert.equal(move(comment(), row, shots[1]), true, 'a drop at the gap before the second image');
  const body = bodyOf(s);
  const rows = rowsOf(s);
  assert.equal(rows.length, 2, 'the row split into two');
  assert.equal(shotsOf(rows[0]).length, 1, 'the first half holds the image before the gap');
  assert.equal(shotsOf(rows[0])[0], shots[0]);
  assert.equal(rows[0].getAttribute('data-valign'), 'middle', 'the first half keeps the target\'s alignment');
  assert.equal(shotsOf(rows[1]).length, 2, 'the second half holds the rest');
  assert.equal(shotsOf(rows[1])[0], shots[1]);
  assert.equal(rows[1].hasAttribute('data-valign'), false, 'the second half is a fresh (default) row');
  assert.equal(body.children[1], comment(), 'the dropped row sits between the two halves');
  assert.equal(downloads.length, 0, 'the split never triggers a save');
});

// 0054: a completed screenshot move leaves the image in exactly one row.
// Reordering within a row retains the container; a move into another row
// joins it; an isolated section-body drop creates a single-image row; the
// source row keeps its remaining shots together and is discarded only when
// empty. (0051's older rules — extract as a bare body child, split the
// source — are replaced.)

test('reordering a shot within its row retains the container, its alignment, and one shared layout palette; in-place drops are no-ops', async () => {
  const { document, window, downloads } = loadApp();
  stubImagePipeline(window);
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const s = addFirstSection(document);
  for (let i = 0; i < 3; i++) await pasteShot(s, window);
  const row = rowsOf(s)[0];
  const shots = shotsOf(row);
  sectionAction(row, 'row-valign-middle').click();
  sectionAction(row, 'row-halign-right').click();
  const beforeHtml = bodyOf(s).innerHTML;

  assert.equal(move(shots[1], row, shots[1]), true, 'in-place: valid no-op');
  assert.equal(move(shots[1], row, shots[2]), true, 'in-place (next sibling): valid no-op');
  assert.equal(bodyOf(s).innerHTML, beforeHtml, '…and the DOM is exactly unchanged');

  assert.equal(move(shots[1], row, shots[0]), true, 'drop the second shot before the first');
  const body = bodyOf(s);
  assert.equal(rowsOf(s).length, 1, 'one row: the reorder did not extract the shot');
  assert.equal(rowsOf(s)[0], row, '…into the same wrapper');
  assert.deepEqual(shotsOf(rowsOf(s)[0]), [shots[1], shots[0], shots[2]], 'the requested order, inside the row');
  assert.equal(rowsOf(s)[0].getAttribute('data-valign'), 'middle', 'the row keeps its alignment settings');
  assert.equal(rowsOf(s)[0].getAttribute('data-halign'), 'right');
  assert.equal(rowsOf(s)[0].querySelectorAll('.ev-row-controls').length, 1, 'one shared layout palette');
  assert.equal(
    rowsOf(s)[0].querySelector('[data-action="row-valign-middle"]').hasAttribute('data-active'),
    true,
    '…and it still reflects the row\'s state',
  );
  assert.equal(body.querySelector(':scope > .ev-screenshot'), null, 'no bare body child');

  assert.equal(move(shots[0], row, null), true, 'then the first shot to the row\'s end');
  assert.deepEqual(shotsOf(rowsOf(s)[0]), [shots[1], shots[2], shots[0]]);
  assert.equal(downloads.length, 0, 'a move never triggers a save');
});

test('moving a shot into an existing row inserts it in the requested order and uses the destination\'s alignment and shared controls', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const s1 = addFirstSection(document);
  document.querySelector('button[data-action="add-section"]').click(); // second top-level section
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  await pasteShot(s1, window);
  await pasteShot(s1, window);
  const row1 = rowsOf(s1)[0];
  const shots1 = shotsOf(row1);
  await pasteShot(s2, window);
  await pasteShot(s2, window);
  const row2 = rowsOf(s2)[0];
  const shots2 = shotsOf(row2);
  sectionAction(row2, 'row-valign-bottom').click();

  assert.equal(move(shots1[0], row2, shots2[1]), true, 'transfer the first shot into the second row, before its last image');
  assert.equal(rowsOf(s2)[0], row2, 'the destination wrapper survived — the shot joined it, no split');
  assert.deepEqual(shotsOf(rowsOf(s2)[0]), [shots2[0], shots1[0], shots2[1]], 'inserted in the requested order');
  assert.equal(rowsOf(s2)[0].getAttribute('data-valign'), 'bottom', 'the destination row\'s alignment stands');
  assert.equal(rowsOf(s2)[0].querySelectorAll('.ev-row-controls').length, 1, 'one shared palette for the joined row');
  assert.equal(rowsOf(s2)[0].querySelector('[data-action="row-valign-bottom"]').hasAttribute('data-active'), true);
  assert.equal(rowsOf(s1).length, 1, 'the source keeps a row for the remainder');
  assert.equal(rowsOf(s1)[0], row1, '…the same wrapper');
  assert.deepEqual(shotsOf(rowsOf(s1)[0]), [shots1[1]], 'the single-image row is retained');
  assert.equal(bodyOf(s2).querySelector(':scope > .ev-screenshot'), null, 'no bare body child in the destination');

  assert.equal(move(shots1[1], row2, null), true, 'then the last source shot to the destination row\'s end');
  assert.deepEqual(shotsOf(rowsOf(s2)[0]), [shots2[0], shots1[0], shots2[1], shots1[1]]);
  assert.equal(rowsOf(s1).length, 0, 'the now-empty source row is discarded');
});

test('a drop at a section-body gap right after a row joins it at the end — including one\'s own shot; right before a row it joins at the start', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const s = addFirstSection(document);
  document.querySelector('button[data-action="add-section"]').click(); // second top-level section
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  await pasteShot(s, window);
  await pasteShot(s, window);
  const row = rowsOf(s)[0];
  const shots = shotsOf(row);
  sectionAction(s, 'add-comment').click();
  const comment = bodyOf(s).querySelector(':scope > .ev-comment');

  await pasteShot(s2, window);
  const outsider = shotsOf(rowsOf(s2)[0])[0];
  assert.equal(move(outsider, bodyOf(s), comment), true, 'drop the other section\'s shot at the gap before the comment (right after the row)');
  assert.equal(rowsOf(s).length, 1, 'the shot joined the row — no new row at the body level');
  assert.equal(rowsOf(s)[0], row);
  assert.deepEqual(shotsOf(rowsOf(s)[0]), [shots[0], shots[1], outsider], '…at the row\'s end');
  assert.equal(rowsOf(s2).length, 0, 'the emptied source row is discarded');

  assert.equal(move(shots[0], bodyOf(s), comment), true, 'then one\'s own first shot to the gap right after the row (before the comment)');
  assert.deepEqual(shotsOf(rowsOf(s)[0]), [shots[1], outsider, shots[0]], '…it reorders within the row, still one row');

  // a gap right before a row: the shot joins at the start
  document.querySelector('button[data-action="add-section"]').click(); // third top-level section
  const s3 = document.querySelectorAll('#evidence > .ev-section')[2];
  sectionAction(s3, 'add-comment').click();
  const c3 = bodyOf(s3).querySelector(':scope > .ev-comment');
  await pasteShot(s3, window);
  const row3 = rowsOf(s3)[0];
  await pasteShot(s2, window); // the emptied second section gets a fresh single-image row
  const d = shotsOf(rowsOf(s2)[0])[0];
  assert.equal(move(d, bodyOf(s3), row3), true, 'drop at the gap right before the row');
  assert.equal(rowsOf(s3).length, 1, 'joined, not a new row');
  assert.deepEqual(shotsOf(rowsOf(s3)[0]), [d, shotsOf(row3)[0]], 'at the row\'s start');
  assert.ok(c3.nextSibling === rowsOf(s3)[0], 'the row still follows the comment');
});

test('an isolated section-body drop creates a single-image row with the top/center defaults and working layout controls', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const s = addFirstSection(document);
  document.querySelector('button[data-action="add-section"]').click();
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  sectionAction(s, 'add-comment').click();
  sectionAction(s, 'add-property').click();
  const comment = bodyOf(s).querySelector(':scope > .ev-comment');
  const property = bodyOf(s).querySelector(':scope > .ev-property');

  await pasteShot(s2, window);
  const shot = shotsOf(rowsOf(s2)[0])[0];
  assert.equal(move(shot, bodyOf(s), property), true, 'drop between the comment and the property — adjacent to no row');
  const body = bodyOf(s);
  assert.equal(body.children.length, 3, 'the body gains exactly one wrapper');
  assert.equal(body.children[1].parentElement, body);
  const row = body.children[1];
  assert.ok(row.matches('.ev-shot-row'), 'the gap holds a new shot row');
  assert.equal(shotsOf(row).length, 1, 'one image');
  assert.equal(shotsOf(row)[0], shot, 'the moved node itself');
  assert.ok(!row.hasAttribute('data-valign') && !row.hasAttribute('data-halign'), 'the top/center defaults, omitted');
  const strip = row.querySelector(':scope > .ev-row-controls');
  assert.ok(strip && strip.hasAttribute('data-chrome'), 'the layout controls are present (chrome, rebuilt)');
  sectionAction(strip, 'row-halign-left').click();
  assert.equal(row.getAttribute('data-halign'), 'left', '…and they work');
  sectionAction(row, 'row-halign-center').click();
  assert.equal(row.hasAttribute('data-halign'), false, 'center restores the omitted default');
  assert.equal(rowsOf(s2).length, 0, 'the emptied source row is discarded');
  assert.equal(comment.nextElementSibling, row, 'ordered: comment, row, property');
});

test('a cross-section move preserves the shot\'s identity, asset reference, caption, sizing, and standalone state; every shot belongs to exactly one row', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const s1 = addFirstSection(document);
  document.querySelector('button[data-action="add-section"]').click();
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  await pasteShot(s1, window);
  await pasteShot(s1, window);
  const shots = shotsOf(rowsOf(s1)[0]);
  const movedNode = shots[0];
  const src = movedNode.querySelector('img').getAttribute('src');
  movedNode.querySelector(':scope > .ev-caption').textContent = 'kept caption';
  sectionAction(movedNode, 'size-small').click();
  sectionAction(movedNode, 'standalone').click();

  assert.equal(move(movedNode, bodyOf(s2), null), true, 'move the first shot across sections');
  const inDest = s2.querySelector('.ev-screenshot');
  assert.equal(inDest, movedNode, 'the exact same node landed');
  assert.equal(inDest.querySelector('img').getAttribute('src'), src, 'asset reference preserved');
  assert.equal(inDest.querySelector(':scope > .ev-caption').textContent, 'kept caption', 'caption preserved');
  assert.equal(inDest.dataset.size, 'small', 'sizing preserved');
  assert.ok(inDest.hasAttribute('data-standalone'), 'standalone state preserved');

  const everyShotInOneRow = (sec) => {
    const body = bodyOf(sec);
    assert.equal(body.querySelector(':scope > .ev-screenshot'), null, `no bare shots in ${sec ? 'section' : 'root'}`);
    body.querySelectorAll('.ev-screenshot').forEach((shot) => {
      assert.ok(shot.parentElement.matches('.ev-shot-row'), 'every shot is inside a row');
    });
  };
  everyShotInOneRow(s1);
  everyShotInOneRow(s2);
  assert.equal(document.querySelectorAll('#evidence .ev-screenshot').length, 2, 'no shot lost or duplicated');
  assert.equal(document.querySelectorAll('#evidence .ev-shot-row').length, 2, 'one row per section');
});

test('invalid drops are no-ops: the content and the row\'s settings are untouched, and no save is triggered', async () => {
  const { document, window, downloads } = loadApp();
  stubImagePipeline(window);
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const s = addFirstSection(document);
  document.querySelector('button[data-action="add-section"]').click();
  const s2 = document.querySelectorAll('#evidence > .ev-section')[1];
  await pasteShot(s, window);
  await pasteShot(s, window);
  const row = rowsOf(s)[0];
  const shots = shotsOf(row);
  sectionAction(row, 'row-valign-middle').click();
  await pasteShot(s2, window);
  const otherShot = shotsOf(rowsOf(s2)[0])[0];
  const beforeHtml = document.getElementById('evidence').innerHTML;

  assert.equal(move(shots[0], s, null), false, 'a section element is not a valid leaf target');
  assert.equal(move(shots[0], bodyOf(s), otherShot), false, 'a beforeEl outside the target is rejected');
  assert.equal(move(shots[0], row, null), true, 'sanity: a valid in-row drop still works (to the end)');
  assert.equal(move(shots[0], row, shots[1]), true, '…and back to the front');
  assert.equal(document.getElementById('evidence').innerHTML, beforeHtml, 'the invalid drops changed nothing; the valid pair round-tripped the DOM');
  assert.equal(rowsOf(s)[0].getAttribute('data-valign'), 'middle', 'the row\'s settings are untouched');
  assert.equal(rowsOf(s)[0], row, 'the same wrapper, unsplit');
  assert.equal(downloads.length, 0, 'no save');
});

test('a drop at a row\'s end gap lands after the row — the row stays intact', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const s = addFirstSection(document);
  for (let i = 0; i < 2; i++) await pasteShot(s, window);
  const row = rowsOf(s)[0];
  sectionAction(s, 'add-comment').click();
  const comment = s.querySelector('.ev-comment');
  assert.equal(move(comment, row, null), true, 'drop the comment at the row\'s end gap');
  const body = bodyOf(s);
  assert.equal(rowsOf(s).length, 1, 'no split');
  assert.equal(shotsOf(rowsOf(s)[0]).length, 2, 'the row is intact');
  assert.equal(body.lastElementChild, comment, 'the comment sits after the row');
});

test('a section dropped into a row\'s gap splits the row around it', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const move = (row, target, before) => window.__evidence.moveElement(row, target, before);
  const s = addFirstSection(document);
  for (let i = 0; i < 2; i++) await pasteShot(s, window);
  const row = rowsOf(s)[0];
  const shots = shotsOf(row);
  sectionAction(s, 'add-subsection').click();
  const sub = s.querySelector(':scope > .ev-body > .ev-section');

  assert.equal(move(sub, row, shots[1]), true, 'drop the subsection between the row\'s images');
  const body = bodyOf(s);
  const rows = rowsOf(s);
  assert.equal(rows.length, 2, 'the row split');
  assert.equal(shotsOf(rows[0])[0], shots[0]);
  assert.equal(body.children[1], sub, 'the section sits between the halves');
  assert.equal(shotsOf(rows[1])[0], shots[1]);
});

test('CSS: a drop line inside a row is a full-line flex item', () => {
  assert.match(appSource(), /\.ev-shot-row > \.ev-drop-line\s*\{[^}]*flex:\s*1 0 100%/);
});

// ---------------------------------------------------------------------
// Delete & serialization — SPEC §23
// ---------------------------------------------------------------------

test('deleting the last shot of a row discards the row and its alignment state', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const s = addFirstSection(document);
  for (let i = 0; i < 2; i++) await pasteShot(s, window);
  const row = rowsOf(s)[0];
  const shots = shotsOf(row);
  sectionAction(row, 'row-valign-bottom').click();
  shots[0].querySelector('[data-action="delete"]').click();
  assert.equal(rowsOf(s).length, 1, 'one row remains with the surviving shot');
  assert.equal(shotsOf(rowsOf(s)[0])[0], shots[1]);
  shots[1].querySelector('[data-action="delete"]').click();
  assert.equal(bodyOf(s).querySelector('.ev-shot-row'), null, 'the empty row is discarded');
  assert.equal(bodyOf(s).querySelector('.ev-screenshot'), null, 'the last shot is gone');
});

test('A4: save → reload → save is byte-identical with rows populated, aligned, and standalone-marked', async () => {
  const first = loadApp();
  stubImagePipeline(first.window);
  const s = addFirstSection(first.document);
  for (let i = 0; i < 3; i++) await pasteShot(s, first.window);
  const row = rowsOf(s)[0];
  sectionAction(row, 'row-valign-middle').click();
  sectionAction(row, 'row-halign-right').click();
  shotsOf(row)[1].querySelector('[data-action="standalone"]').click();
  shotsOf(row)[0].querySelector('[data-action="size-small"]').click();

  first.document.getElementById('save-btn').click();
  const saved1 = await downloadText(first.downloads.find((d) => d.name));
  const savedDoc = new JSDOM(saved1).window.document;
  const savedRow = savedDoc.querySelector('#evidence .ev-shot-row');
  assert.equal(savedRow.getAttribute('data-valign'), 'middle');
  assert.equal(savedRow.getAttribute('data-halign'), 'right');
  assert.ok(savedRow.querySelector('.ev-screenshot[data-standalone]'), 'standalone marker is clean content');
  assert.equal(savedRow.querySelector('.ev-row-controls'), null, 'the strip does not serialize');

  const second = loadApp(saved1);
  const reopenedRow = second.document.querySelector('#evidence .ev-shot-row');
  assert.equal(reopenedRow.getAttribute('data-valign'), 'middle', 'boot trusts the saved wrapper');
  assert.ok(reopenedRow.querySelector('.ev-row-controls'), 'the strip is rebuilt at boot');
  assert.equal(
    sectionAction(reopenedRow, 'row-valign-middle').hasAttribute('data-active'),
    true,
    'the rebuilt strip\'s active state follows the saved alignment',
  );
  assert.equal(
    reopenedRow.querySelector('.ev-screenshot[data-standalone] [data-action="standalone"]').hasAttribute('data-active'),
    true,
    'the standalone toggle is lit from the saved marker',
  );
  second.document.getElementById('save-btn').click();
  const saved2 = await downloadText(second.downloads.find((d) => d.name));
  assert.equal(saved2, saved1, 'byte-identical with rows populated, aligned, and standalone-marked');
});

test('A4: save → reload → save is byte-identical after a transfer and a reorder — rows, order, alignment, caption, sizing, and standalone state survive; the strips are rebuilt, transient chrome is not saved', async () => {
  const first = loadApp();
  stubImagePipeline(first.window);
  const move = (row, target, before) => first.window.__evidence.moveElement(row, target, before);
  const s1 = addFirstSection(first.document);
  first.document.querySelector('button[data-action="add-section"]').click();
  const s2 = first.document.querySelectorAll('#evidence > .ev-section')[1];
  await pasteShot(s1, first.window);
  await pasteShot(s1, first.window);
  const shots = shotsOf(rowsOf(s1)[0]);
  const caption = shots[0].querySelector(':scope > .ev-caption');
  caption.textContent = 'moved caption';
  caption.dispatchEvent(new first.window.Event('input', { bubbles: true }));
  shots[1].querySelector('[data-action="size-small"]').click();

  assert.equal(move(shots[0], bodyOf(s2), null), true, 'transfer the first shot across sections');
  const row2 = rowsOf(s2)[0];
  sectionAction(row2, 'row-valign-middle').click();
  shots[0].querySelector('[data-action="standalone"]').click();

  first.document.getElementById('save-btn').click();
  const saved1 = await downloadText(first.downloads.find((d) => d.name));
  const savedDoc = new JSDOM(saved1).window.document;
  const savedSections = [...savedDoc.querySelectorAll('#evidence > .ev-section')];
  const savedRow1 = savedSections[0].querySelector('.ev-shot-row');
  const savedRow2 = savedSections[1].querySelector('.ev-shot-row');
  assert.equal(savedSections[0].querySelectorAll('.ev-shot-row').length, 1, 'the source keeps its single-image row');
  assert.equal(savedRow2.getAttribute('data-valign'), 'middle', 'the destination row\'s alignment is content');
  assert.equal(savedRow2.querySelector('.ev-screenshot .ev-caption').textContent, 'moved caption');
  assert.equal(savedRow2.querySelector('.ev-screenshot img').getAttribute('alt'), 'moved caption', 'the synced alt travels too');
  assert.ok(savedRow2.querySelector('.ev-screenshot[data-standalone]'), 'standalone state is clean content');
  assert.equal(savedRow1.querySelector('.ev-screenshot').dataset.size, 'small', 'sizing state is content');
  assert.equal(savedDoc.querySelectorAll('#evidence [data-chrome]').length, 0, 'no strips or other chrome in the saved file');

  const second = loadApp(saved1);
  const reopened = [...second.document.querySelectorAll('#evidence > .ev-section')];
  const reopenedRow2 = reopened[1].querySelector('.ev-shot-row');
  assert.equal(reopenedRow2.getAttribute('data-valign'), 'middle', 'boot trusts the saved wrapper');
  assert.ok(reopenedRow2.querySelector('.ev-row-controls'), 'the shared layout palette is rebuilt at boot');
  assert.equal(
    sectionAction(reopenedRow2, 'row-valign-middle').hasAttribute('data-active'),
    true,
    '…and its active state follows the saved alignment',
  );
  second.document.getElementById('save-btn').click();
  const saved2 = await downloadText(second.downloads.find((d) => d.name));
  assert.equal(saved2, saved1, 'byte-identical after a transfer and a reorder');
});

test('a row\'s shots keep the 0048/0049 sizing model verbatim — the sizing code path has no row special case', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document);
  await pasteShot(section, window);
  await pasteShot(section, window);
  const body = bodyOf(section);
  const row = rowsOf(section)[0];
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: 800 });
  const shot = shotsOf(row)[0]; // pasted shots start at medium (640)
  sectionAction(shot, 'size-larger').click();
  assert.equal(shot.dataset.size, 'custom', 'the 0049 stepped model applies inside the row');
  assert.equal(shot.dataset.width, '720', 'a 640px medium shot steps to 720px, verbatim');
  shotsOf(row)[1].querySelector('[data-action="size-small"]').click();
  assert.equal(shotsOf(row)[1].dataset.size, 'small', 'presets apply verbatim inside the row');
});
