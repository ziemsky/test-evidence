import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, downloadText, addFirstSection } from './helpers.js';

// 0115: the single end-of-document add toolbox — directly below the last
// top-level section, or at the top of #evidence when there are none.
// Seams: the UI buttons + the live DOM, and the saved file text (same
// pattern as the seams comments in test/delete.test.js).
// 0040: boot is bare — a loaded document has no sections, and the empty
// state is also reached the tester way: delete all top-level sections
// through the UI with a window.confirm stub (the established pattern in
// test/delete.test.js).

const topSections = (document) =>
  [...document.querySelectorAll('#evidence > .ev-section')];

const addSectionButtons = (document) =>
  [...document.querySelectorAll('.ev-add-section-btn')];

/** Click + section in the single end-of-document toolbox. */
const clickAddButton = (document) => {
  const buttons = addSectionButtons(document);
  assert.equal(buttons.length, 1, 'exactly one + section button');
  buttons[0].click();
};

/** Delete every top-level section through the UI (confirm approved). */
const deleteAllSections = (window, document) => {
  window.confirm = () => true;
  for (const section of topSections(document)) {
    sectionAction(section, 'delete').click();
  }
};

test('one persistent add toolbox replaces the standalone + section button', () => {
  const { document } = loadApp();
  const root = document.getElementById('evidence');
  const toolbox = root.querySelector(':scope > .ev-end-add-toolbox[data-add-toolbox]');

  assert.ok(toolbox, 'the add toolbox exists directly under the evidence root');
  assert.ok(toolbox.hasAttribute('data-chrome'), 'the toolbox is transient chrome');
  assert.deepEqual(
    [...toolbox.querySelectorAll(':scope > button')].map((button) => button.dataset.action),
    ['add-section', 'add-subsection', 'add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url'],
    'the toolbox contains all add actions and no context actions',
  );
  assert.deepEqual(
    [...toolbox.querySelectorAll(':scope > button .ev-action-label')].map((label) => label.textContent),
    ['+ section', '+ subsection', '+ comment', '+ code', '+ property', '+ screenshot', '+ file', '+ URL'],
    'each add action has its user-facing label',
  );
  for (const button of toolbox.querySelectorAll(':scope > button')) {
    assert.ok(button.querySelector(':scope > .ev-action-icon'), `${button.dataset.action} has an icon`);
    assert.ok(button.querySelector(':scope > .ev-action-label'), `${button.dataset.action} has a text label`);
  }
  assert.equal(toolbox.querySelectorAll('button[data-action="add-section"]').length, 1);
  assert.equal(toolbox.querySelectorAll('button[data-action="copy"], button[data-action="delete"], button[data-action^="paste-"]').length, 0);
  assert.equal(root.querySelectorAll(':scope > .ev-end-add-toolbox').length, 1, 'one toolbox is rendered');
  assert.equal(
    root.querySelector(':scope > h1.ev-doc-title').nextElementSibling,
    toolbox,
    'the toolbox follows the document title when no sections exist',
  );
});

test('exactly one add toolbox — directly below the last top-level section, never below a non-last one', () => {
  const { document } = loadApp();
  clickAddButton(document); // first top-level section
  clickAddButton(document); // second top-level section
  clickAddButton(document); // third top-level section
  const s1 = topSections(document)[0];
  sectionAction(s1, 'add-subsection').click(); // nested section

  const buttons = addSectionButtons(document);
  assert.equal(buttons.length, 1, 'exactly one + section button, not one per section');
  const tops = topSections(document);
  assert.equal(tops[0].nextElementSibling, tops[1], 'no button below a non-last section');
  assert.equal(tops[1].nextElementSibling, tops[2], 'no button below the middle section');
  assert.equal(tops[2].nextElementSibling, buttons[0].parentElement, 'the toolbox is below the last top-level section');
  const nested = s1.querySelector(':scope > .ev-body > .ev-section');
  assert.equal(nested.nextElementSibling, null, 'no button below a subsection');
});

test('the + section action is chrome with the expected label', () => {
  const { document } = loadApp();
  const btn = addSectionButtons(document)[0];
  assert.ok(btn, 'a + section button exists');
  assert.ok(btn.parentElement.hasAttribute('data-chrome'), 'the containing toolbox is chrome');
  assert.equal(btn.dataset.action, 'add-section', 'data-action="add-section"');
  assert.equal(btn.querySelector('.ev-action-label').textContent, '+ section', 'section action label');
});

test('the toolbar omits a + section button (0015 retired) and status displays', () => {
  const { document } = loadApp();
  assert.equal(document.getElementById('add-section-btn'), null, 'the toolbar #add-section-btn is gone');
  const toolbar = document.getElementById('toolbar');
  assert.ok(toolbar, 'toolbar still exists');
  assert.equal(toolbar.querySelector('.ev-add-section-btn'), null, 'no in-toolbar add-section button');
  assert.ok(toolbar.querySelector('#save-btn'));
  assert.equal(toolbar.querySelector('#mode-indicator'), null);
  assert.equal(toolbar.querySelector('#save-status'), null);
  assert.equal(addSectionButtons(document).length, 1, 'the + section action lives in the document toolbox');
});

test('a click inserts a new top-level section immediately after the button and focuses its empty title', () => {
  const { document } = loadApp();
  const s1 = addFirstSection(document);
  s1.querySelector('.ev-title-text').textContent = 'Setup';
  clickAddButton(document);
  topSections(document)[1].querySelector('.ev-title-text').textContent = 'Results';

  clickAddButton(document); // the button is below Results — the new section lands right after it

  const titles = topSections(document).map((s) => s.querySelector('.ev-title-text').textContent);
  assert.deepEqual(titles, ['Setup', 'Results', ''], 'new section immediately after the button');
  const newSection = topSections(document)[2];
  assert.equal(document.activeElement, newSection.querySelector('.ev-title-text'), 'focus on the empty title');
});

test('when the root has no sections, exactly one button sits at the top of #evidence', () => {
  const { window, document } = loadApp();
  addFirstSection(document); // then delete it through the UI to reach the empty state
  deleteAllSections(window, document);

  assert.equal(topSections(document).length, 0, 'no top-level sections');
  const buttons = addSectionButtons(document);
  assert.equal(buttons.length, 1, 'exactly one button');
  // 0039: the title row is always the first child, so "at the top of
  // #evidence" means right below it.
  const titleRow = document.querySelector('#evidence > h1.ev-doc-title');
  assert.ok(titleRow, 'the document title row is always present');
  assert.equal(titleRow.nextElementSibling, buttons[0].parentElement, 'at the top of #evidence, below the title row');
});

test('in the empty state, a click adds the first section and focuses its title', () => {
  const { window, document } = loadApp();
  addFirstSection(document);
  deleteAllSections(window, document);
  const btn = addSectionButtons(document)[0];

  btn.click();

  const tops = topSections(document);
  assert.equal(tops.length, 1, 'the first section exists');
  assert.equal(tops[0].querySelector('.ev-title-text').textContent, '', 'empty title');
  assert.equal(document.activeElement, tops[0].querySelector('.ev-title-text'), 'focus on the empty title');
  const buttons = addSectionButtons(document);
  assert.equal(buttons.length, 1, 'still exactly one button');
  assert.equal(tops[0].nextElementSibling, buttons[0].parentElement, 'the toolbox now follows the section it created');
});

test('button placement re-renders after add and delete — always one button, always below the last section', () => {
  const { window, document } = loadApp();
  clickAddButton(document);
  clickAddButton(document);
  clickAddButton(document);
  assert.equal(addSectionButtons(document).length, 1, 'one button after adds, not one per section');
  assert.equal(
    addSectionButtons(document)[0].parentElement,
    topSections(document).at(-1).nextElementSibling,
    'the toolbox follows the last top-level section',
  );

  // delete the middle section: the button must track the new last section
  window.confirm = () => true;
  sectionAction(topSections(document)[1], 'delete').click();
  assert.equal(addSectionButtons(document).length, 1, 'no orphan, no duplicate');
  assert.equal(
    addSectionButtons(document)[0].parentElement,
    topSections(document).at(-1).nextElementSibling,
    'the toolbox tracks the live top-level section list',
  );

  // delete the last section: the button moves to the new last section
  sectionAction(topSections(document).at(-1), 'delete').click();
  assert.equal(topSections(document).length, 1, 'one section left');
  assert.equal(addSectionButtons(document).length, 1, 'still exactly one button');
  assert.equal(
    addSectionButtons(document)[0].parentElement,
    topSections(document)[0].nextElementSibling,
    'the toolbox follows the remaining last section',
  );
});

test('the saved file text contains no add toolbox — chrome is stripped, never persisted', async () => {
  const { document, downloads } = loadApp();
  clickAddButton(document);
  document.getElementById('save-btn').click();
  const text = await downloadText(downloads.find((d) => d.name));
  const saved = new JSDOM(text).window.document;
  assert.equal(saved.querySelectorAll('[data-chrome]').length, 0, 'no data-chrome elements');
  assert.equal(saved.querySelectorAll('[data-add-toolbox]').length, 0, 'no add toolbox');
  assert.equal(saved.querySelectorAll('.ev-add-section-btn').length, 0, 'no + section buttons');
  assert.ok(!text.includes('data-action="add-section"'), 'no add-section action in the file text');
});

test('the add toolbox survives a save/reload round-trip: stripped from the file, re-rendered at boot', async () => {
  const first = loadApp();
  clickAddButton(first.document);
  first.document.getElementById('save-btn').click();
  const savedText = await downloadText(first.downloads.find((d) => d.name));

  const second = loadApp(savedText);
  const tops = topSections(second.document);
  assert.equal(tops.length, 1, 'the added section adopted');
  const buttons = addSectionButtons(second.document);
  assert.equal(buttons.length, 1, 'one button re-rendered at boot');
  assert.equal(
    buttons[0].parentElement,
    tops.at(-1).nextElementSibling,
    'the re-rendered toolbox follows the last adopted top-level section',
  );
});
