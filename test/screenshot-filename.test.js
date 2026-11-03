import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, appSource, loadApp, addFirstSection } from './helpers.js';

/** Build a saved-file document with one screenshot referencing the given src. */
function withScreenshotSrc(src) {
  return appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence">
      <h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>
      <section class="ev-section">
        <h2 class="ev-title"><span class="ev-text ev-title-text">Shots</span></h2>
        <div class="ev-body">
          <div class="ev-screenshot">
            <img class="ev-img" src="${src}" alt="">
            <span class="ev-text ev-caption">A caption</span>
          </div>
        </div>
      </section>
    </main>`,
  );
}

/** Parse the embedded <style> block into rules (same helper as hover-reveal). */
function styleRules() {
  const source = appSource();
  const match = /<style>([\s\S]*?)<\/style>/.exec(source);
  assert.ok(match, 'an embedded <style> block exists');
  const css = match[1].replace(/\/\*[\s\S]*?\*\//g, ' ');
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const declarations = m[2].split(';').map((d) => d.trim()).filter(Boolean);
    rules.push({ selectors, declarations, body: m[2] });
  }
  return rules;
}

// ---------------------------------------------------------------------------
// DOM structure: label present, correct text, correct position
// ---------------------------------------------------------------------------

test('screenshot with assets/ src gets a filename label with decoded basename (0063/§26)', () => {
  const { document } = loadApp(withScreenshotSrc('assets/shot-20260909-143022.png'));
  const screenshot = document.querySelector('.ev-screenshot');
  const label = screenshot.querySelector(':scope > .ev-filename');
  assert.ok(label, 'label element exists');
  assert.equal(label.tagName, 'SPAN', 'label is a span');
  assert.ok(label.hasAttribute('data-chrome'), 'label is chrome');
  assert.equal(label.textContent, 'shot-20260909-143022.png', 'text is the decoded basename with extension');
});

test('label is between img and caption in DOM order (0063/§26)', () => {
  const { document } = loadApp(withScreenshotSrc('assets/shot-20260909-143022.png'));
  const screenshot = document.querySelector('.ev-screenshot');
  const children = [...screenshot.children].map((el) => el.className || el.tagName.toLowerCase());
  const imgIdx = children.indexOf('ev-img');
  const labelIdx = children.indexOf('ev-filename');
  const captionIdx = children.findIndex((c) => c.includes('ev-caption'));
  assert.ok(imgIdx < labelIdx, 'label after img');
  assert.ok(labelIdx < captionIdx, 'label before caption');
});

test('URL-encoded asset name is decoded in the label (0063/§26)', () => {
  const { document } = loadApp(withScreenshotSrc('assets/my%20screenshot.png'));
  const label = document.querySelector('.ev-screenshot > .ev-filename');
  assert.equal(label.textContent, 'my screenshot.png', 'decoded basename shown');
});

test('example SVG filename labels correctly (0063/§26)', () => {
  const { document } = loadApp(withScreenshotSrc('assets/example-ers1234-shortlist.svg'));
  const label = document.querySelector('.ev-screenshot > .ev-filename');
  assert.equal(label.textContent, 'example-ers1234-shortlist.svg', 'SVG extension preserved');
});

test('screenshot with data-URL src gets no filename label (0063/§26)', () => {
  const { document } = loadApp(withScreenshotSrc('data:image/png;base64,iVBORw0KGgo='));
  const screenshot = document.querySelector('.ev-screenshot');
  assert.equal(screenshot.querySelector(':scope > .ev-filename'), null, 'no label for data-URL');
});

test('pending placeholder has no filename label (0063/§26)', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-screenshot').click();
  const pending = document.querySelector('.ev-screenshot-pending');
  assert.ok(pending, 'placeholder exists');
  assert.equal(pending.querySelector('.ev-filename'), null, 'no label in placeholder');
});

test('screenshot inside a shot-row also gets a filename label (0063/§26)', () => {
  const html = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence">
      <h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>
      <section class="ev-section">
        <h2 class="ev-title"><span class="ev-text ev-title-text">Shots</span></h2>
        <div class="ev-body">
          <div class="ev-shot-row">
            <div class="ev-screenshot">
              <img class="ev-img" src="assets/shot-a.png" alt="">
              <span class="ev-text ev-caption">A</span>
            </div>
            <div class="ev-screenshot">
              <img class="ev-img" src="data:image/png;base64,x" alt="">
              <span class="ev-text ev-caption">B</span>
            </div>
          </div>
        </div>
      </section>
    </main>`,
  );
  const { document } = loadApp(html);
  const shots = document.querySelectorAll('.ev-shot-row > .ev-screenshot');
  assert.equal(shots[0].querySelector(':scope > .ev-filename')?.textContent, 'shot-a.png', 'asset shot has label');
  assert.equal(shots[1].querySelector(':scope > .ev-filename'), null, 'data-URL shot has no label');
});

// ---------------------------------------------------------------------------
// CSS: display none at rest, visible on hover
// ---------------------------------------------------------------------------

test('CSS: .ev-filename is display:none at rest (0063/§26)', () => {
  const rules = styleRules();
  const decls = rules.filter((r) => r.selectors.includes('.ev-screenshot > .ev-filename'))
    .flatMap((r) => r.declarations);
  assert.ok(decls.includes('display: none'), 'hidden at rest');
});

test('CSS: .ev-filename is visible on .ev-screenshot:hover (0063/§26)', () => {
  const rules = styleRules();
  const decls = rules.filter((r) => r.selectors.includes('.ev-screenshot:hover > .ev-filename'))
    .flatMap((r) => r.declarations);
  assert.ok(decls.includes('display: block'), 'shown on hover as block (own line)');
});

test('CSS: no transition on .ev-filename reveal (0063/§26)', () => {
  const rules = styleRules();
  for (const r of rules) {
    if (r.selectors.some((s) => s.includes('ev-filename'))) {
      assert.ok(
        !r.declarations.some((d) => d.startsWith('transition') || d.startsWith('animation')),
        'no transition or animation on the filename label',
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Serialization: no .ev-filename in saved file
// ---------------------------------------------------------------------------

test('saved file contains no .ev-filename element (0063/§26, A4)', () => {
  const { document } = loadApp(withScreenshotSrc('assets/shot-20260909-143022.png'));
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('[data-chrome]').forEach((el) => el.remove());
  clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
  const saved = new JSDOM(clone.outerHTML).window.document;
  assert.equal(saved.querySelectorAll('.ev-filename').length, 0, 'chrome label stripped from saved file');
});

// ---------------------------------------------------------------------------
// Idempotency: save → reload → save byte-identical
// ---------------------------------------------------------------------------

test('save → reload → save is byte-identical with filename labels present on screen (0063/§26, A4)', () => {
  const source = withScreenshotSrc('assets/shot-20260909-143022.png');
  // First boot + save
  const first = loadApp(source);
  const serialize = (doc) => {
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-chrome]').forEach((el) => el.remove());
    clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('[data-depth]').forEach((el) => el.removeAttribute('data-depth'));
    clone.querySelectorAll('[data-rail]').forEach((el) => el.removeAttribute('data-rail'));
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  };
  const save1 = serialize(first.document);
  // Second boot from the saved file
  const second = loadApp(save1);
  const save2 = serialize(second.document);
  assert.equal(save1, save2, 'second save is byte-identical to first');
});
