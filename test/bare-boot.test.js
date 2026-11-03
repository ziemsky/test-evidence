import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAction, loadApp, downloadText, appSource, addFirstSection } from './helpers.js';

// 0040 (SPEC §2, §4.7, §19; §13 removed): bare boot & focused title.
// Every empty document — the fresh template, or a saved session whose
// sections were all deleted — boots in its "vanilla" state: the document
// title row alone, with the keyboard already in the title field. No
// starter skeleton, no persisted signal distinguishing template from
// session. Seams (same prior art as the sibling suites): the live DOM
// after loadApp(), the app source, and the saved file text (A4).

const TEMPLATE_MAIN =
  '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>';

const titleSpan = (document) =>
  document.querySelector('#evidence h1.ev-doc-title > .ev-doc-title-text');

test('bare boot: an empty evidence root renders no section — the title row is the root\'s only child', () => {
  const { document } = loadApp();
  assert.equal(document.querySelectorAll('#evidence > .ev-section').length, 0, 'no section rendered at boot');
  const root = document.getElementById('evidence');
  const h1 = root.querySelector(':scope > h1.ev-doc-title');
  assert.ok(h1, 'the title row exists');
  // The standalone "+ section" button is chrome (SPEC §11); it is the only
  // non-content child beside the title row.
  const contentChildren = [...root.children].filter((el) => !el.hasAttribute('data-chrome'));
  assert.deepEqual(contentChildren, [h1], 'the title row is the root\'s only content child');
  assert.equal(root.firstElementChild, h1);
});

test('bare boot: the title field is focused and editable — the wash is the first frame', () => {
  const { document } = loadApp();
  const span = titleSpan(document);
  assert.equal(span.getAttribute('contenteditable'), 'true', 'the span is stamped editable');
  assert.equal(document.activeElement, span, 'the title\'s .ev-text span is document.activeElement');
});

test('focus on populated load: a document with pre-existing sections still ends boot with the title focused', () => {
  const populated = appSource().replace(
    TEMPLATE_MAIN,
    `<main id="evidence">
      <h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text">Saved Session</span></h1>
      <section class="ev-section">
        <h2 class="ev-title"><span class="ev-text ev-title-text">Setup</span></h2>
        <div class="ev-body"></div>
      </section>
    </main>`,
  );
  const { document } = loadApp(populated);
  assert.equal(document.querySelectorAll('#evidence > .ev-section').length, 1, 'the section is adopted');
  assert.equal(document.activeElement, titleSpan(document), 'the title field gets focus on every load');
});

test('stray non-section content but no sections: still bare — nothing renders a section', () => {
  const dirty = appSource().replace(
    TEMPLATE_MAIN,
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>stray comment text</main>',
  );
  const { document } = loadApp(dirty);
  assert.equal(document.querySelectorAll('#evidence > .ev-section').length, 0, 'no section rendered');
  assert.equal(document.activeElement, titleSpan(document), 'the title field is focused');
});

test('the skeleton is gone: Environment / Browser / OS / Test case appear in neither the app source nor the runtime', () => {
  const source = appSource();
  for (const word of ['Environment', 'Browser', 'OS', 'Test case', 'renderSkeleton']) {
    assert.ok(!source.includes(word), `no "${word}" in the app source`);
  }
  const { document } = loadApp();
  for (const word of ['Environment', 'Browser', 'OS', 'Test case']) {
    assert.ok(!document.getElementById('evidence').textContent.includes(word), `no "${word}" in the rendered root`);
  }
});

test('bare round trip: a saved bare document re-opens bare and focused; save → reload → save is byte-identical (A4)', async () => {
  const first = loadApp();
  first.document.getElementById('save-btn').click();
  const s1 = await downloadText(first.downloads.find((d) => d.name));

  const second = loadApp(s1);
  assert.equal(second.document.querySelectorAll('#evidence > .ev-section').length, 0, 'still bare on reopen');
  assert.equal(second.document.activeElement, titleSpan(second.document), 'still focused on reopen');
  second.document.getElementById('save-btn').click();
  const s2 = await downloadText(second.downloads.find((d) => d.name));
  assert.equal(s2, s1, 'save → reload → save is byte-identical (A4) with the document bare');
});

test('delete all sections, save, re-open: bare and focused — the skeleton never re-renders', async () => {
  const { window, document, downloads } = loadApp();
  addFirstSection(document);
  addFirstSection(document); // two sections to delete
  window.confirm = () => true;
  for (const section of [...document.querySelectorAll('#evidence > .ev-section')]) {
    sectionAction(section, 'delete').click();
  }
  assert.equal(document.querySelectorAll('#evidence > .ev-section').length, 0, 'the live document is bare');
  document.getElementById('save-btn').click();
  const savedText = await downloadText(downloads.find((d) => d.name));

  const second = loadApp(savedText);
  assert.equal(second.document.querySelectorAll('#evidence > .ev-section').length, 0, 're-opens bare');
  assert.equal(second.document.activeElement, titleSpan(second.document), 're-opens focused');
});
