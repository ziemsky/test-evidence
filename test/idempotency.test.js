import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, downloadText, appSource, addFirstSection } from './helpers.js';

/** Mirror of the app's save serialization (SPEC §5.3), for asserting on saved files. */
function serialize(document) {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('[data-chrome]').forEach((el) => el.remove());
  clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
  return '<!DOCTYPE html>\n' + clone.outerHTML;
}

/** Re-run the app script inside an already-booted window (simulates a second boot). */
function reBoot(window) {
  const source = window.document
    .querySelector('body > script')
    .textContent;
  window.eval(source);
}

test('boot strips stray data-chrome elements inside the evidence root', () => {
  const dirty = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence">
      <section class="ev-section">
        <h2 class="ev-title">
          <span class="ev-num" data-chrome>1</span>
          <span class="ev-text ev-title-text">Kept</span>
          <span class="ev-controls" data-chrome><button data-action="copy">copy</button></span>
        </h2>
        <div class="ev-body">
          <div class="ev-stray" data-chrome>should vanish</div>
        </div>
      </section>
    </main>`,
  );
  const { document } = loadApp(dirty);
  assert.ok(!document.querySelector('.ev-stray'), 'stray data-chrome element removed');
  assert.equal(document.querySelector('.ev-title-text').textContent, 'Kept', 'clean content kept');
  // whatever chrome boot re-renders is stripped again on save:
  const saved = new JSDOM(serialize(document)).window.document;
  assert.equal(saved.querySelectorAll('[data-chrome]').length, 0);
});

test('boot removes stray contenteditable attributes inside the evidence root', () => {
  const dirty = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence">
      <section class="ev-section">
        <h2 class="ev-title"><span class="ev-text ev-title-text" contenteditable="true">T</span></h2>
        <div class="ev-body"><p contenteditable="true">stray editable</p></div>
      </section>
    </main>`,
  );
  const { document } = loadApp(dirty);
  // boot strips all contenteditable, then re-renders chrome (which re-adds it to editables only)
  assert.equal(document.querySelectorAll('#evidence p[contenteditable]').length, 0);
  // 0039: the document title row's span is editable too — it and the section
  // title are the only .ev-text editables in this fixture.
  assert.equal(
    document.querySelectorAll('#evidence .ev-text[contenteditable="true"]').length,
    2,
    'only the document title and section title are editable again',
  );
});

test('boot adopts existing content as-is: item order and text are never rewritten', () => {
  const dirty = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence">
      <section class="ev-section">
        <h2 class="ev-title"><span class="ev-text ev-title-text">My Section</span></h2>
        <div class="ev-body">
          <div class="ev-property">
            <span class="ev-text ev-prop-key">ZKey</span>
            <span class="ev-sep">:</span>
            <span class="ev-text ev-prop-value">  spaced  value  </span>
          </div>
          <div class="ev-comment"><span class="ev-text ev-comment-text">note one</span></div>
          <div class="ev-property">
            <span class="ev-text ev-prop-key">AKey</span>
            <span class="ev-sep">:</span>
            <span class="ev-text ev-prop-value">v2</span>
          </div>
        </div>
      </section>
    </main>`,
  );
  const { document, downloads } = loadApp(dirty);
  const body = document.querySelector('#evidence > .ev-section > .ev-body');
  const tags = [...body.children].map((el) => el.className);
  assert.deepEqual(
    tags,
    ['ev-property', 'ev-comment', 'ev-property'],
    'insertion order preserved (property, comment, property)',
  );
  assert.equal(body.querySelector('.ev-prop-value').textContent, '  spaced  value  ', 'text not normalized');
  document.getElementById('save-btn').click();
});

test('numbering is chrome: absent from the saved content', async () => {
  const { document, downloads } = loadApp();
  document.getElementById('save-btn').click();
  const text = await downloadText(downloads.find((d) => d.name));
  // (the CSS may mention the class; the *content* must not contain numbering)
  const saved = new JSDOM(text).window.document;
  assert.equal(saved.querySelectorAll('.ev-num').length, 0, 'no numbering spans in saved content');
  assert.ok(!saved.getElementById('evidence').textContent.match(/\b\d+(\.\d+)*\s/), 'no number prefixes in text');
});

test('numbering: nested sections are numbered by position (1, 1.1, 1.2, 1.2.1)', () => {
  const dirty = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence">
      <section class="ev-section">
        <h2 class="ev-title"><span class="ev-text ev-title-text">A</span></h2>
        <div class="ev-body">
          <section class="ev-section">
            <h2 class="ev-title"><span class="ev-text ev-title-text">A1</span></h2>
            <div class="ev-body"></div>
          </section>
          <section class="ev-section">
            <h2 class="ev-title"><span class="ev-text ev-title-text">A2</span></h2>
            <div class="ev-body">
              <section class="ev-section">
                <h2 class="ev-title"><span class="ev-text ev-title-text">A21</span></h2>
                <div class="ev-body"></div>
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
  const nums = [...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent);
  assert.deepEqual(nums, ['1', '1.1', '1.2', '1.2.1', '2']);
});

test('re-running the app script does not duplicate chrome or handlers', async () => {
  const { document, window, downloads } = loadApp();
  addFirstSection(document); // 0040: bare boot — build the section this test needs
  reBoot(window);
  assert.equal(document.querySelectorAll('#toolbar').length, 1, 'still one toolbar');
  assert.equal(document.querySelectorAll('#evidence .ev-section').length, 1, 'no section duplicated');
  assert.equal(document.querySelectorAll('#evidence > .ev-section .ev-title-text').length, 1);
  document.getElementById('save-btn').click();
  const saves = downloads.filter((d) => d.name);
  assert.equal(saves.length, 1, 'one save per click — handlers bound exactly once');
});

test('A4: save → reload → save is byte-identical (bare, untouched)', async () => {
  const first = loadApp();
  first.document.getElementById('save-btn').click();
  const s1 = await downloadText(first.downloads.find((d) => d.name));

  const second = loadApp(s1);
  second.document.getElementById('save-btn').click();
  const s2 = await downloadText(second.downloads.find((d) => d.name));

  assert.equal(s2, s1, 'byte-identical after first save');
});

test('A4: save → reload → save is byte-identical after editing values', async () => {
  const first = loadApp();
  const section = addFirstSection(first.document);
  for (let i = 0; i < 3; i++) sectionAction(section, 'add-property').click();
  const values = first.document.querySelectorAll('.ev-prop-value');
  values[0].textContent = 'Firefox 139.0.1';
  values[1].textContent = 'line one\nline two'; // multi-line: pre-wrap round-trip
  values[2].textContent = 'a < b & c "d"'; // entity round-trip
  first.document.getElementById('save-btn').click();
  const s1 = await downloadText(first.downloads.find((d) => d.name));

  const second = loadApp(s1);
  const adopted = second.document.querySelectorAll('.ev-prop-value');
  assert.equal(adopted[0].textContent, 'Firefox 139.0.1');
  assert.equal(adopted[1].textContent, 'line one\nline two');
  assert.equal(adopted[2].textContent, 'a < b & c "d"');
  second.document.getElementById('save-btn').click();
  const s2 = await downloadText(second.downloads.find((d) => d.name));

  assert.equal(s2, s1, 'byte-identical after first save (edited content)');
});

test('empty-root boot rule (0040): a saved file with no sections re-opens bare and focused — the skeleton never re-renders', async () => {
  const first = loadApp();
  addFirstSection(first.document);
  addFirstSection(first.document);
  first.window.confirm = () => true;
  // delete every section through the UI, then save
  for (const section of [...first.document.querySelectorAll('#evidence > .ev-section')]) {
    sectionAction(section, 'delete').click();
  }
  first.document.getElementById('save-btn').click();
  const text = await downloadText(first.downloads.find((d) => d.name));

  const second = loadApp(text);
  assert.equal(second.document.querySelectorAll('#evidence > .ev-section').length, 0, 'no skeleton rendered');
  assert.equal(
    second.document.activeElement,
    second.document.querySelector('#evidence h1.ev-doc-title > .ev-doc-title-text'),
    'the title field is focused on the bare re-open',
  );
});
