import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, downloadText, appSource, addFirstSection, assertCaretAtEnd } from './helpers.js';

// 0028/0086: "+ section after" is carried by the shared section palette
// (SPEC §3, §11 — the row button inserts a sibling at the same depth,
// immediately after the clicked section).
// Seams: the UI buttons + the live DOM, and the saved file text (the same
// pattern as the seams comments in test/add-section-buttons.test.js and
// test/delete.test.js).

const allSections = (document) => [...document.querySelectorAll('#evidence .ev-section')];
const topSections = (document) => [...document.querySelectorAll('#evidence > .ev-section')];
const afterButtons = (document) =>
  [...document.querySelectorAll('button[data-action="add-section-after"]')];
const nums = (document) => [...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent);

function assertCaretInsideEmptyTextNode(document, field) {
  const selection = document.defaultView.getSelection();
  assert.equal(selection.anchorNode.nodeType, 3, 'the caret is inside a text insertion point');
  assert.equal(selection.anchorNode.parentNode, field, 'the insertion point belongs to the focused title');
  assert.equal(selection.anchorNode.textContent, '', 'the insertion point is empty');
  assert.equal(selection.anchorOffset, 0, 'the caret is at the start of the empty insertion point');
}

/** Click the given section's own `+ section after` button (its title row's control row). */
const clickAfter = (section) =>
  sectionAction(section, 'add-section-after').click();

test('every section control row carries + section after, after + url and before copy/delete — top-level and nested, any depth', () => {
  const { document } = loadApp();
  const s1 = addFirstSection(document);
  sectionAction(s1, 'add-subsection').click();
  const s11 = s1.querySelector(':scope > .ev-body > .ev-section');
  sectionAction(s11, 'add-subsection').click(); // depth 3

  const lockedOrder = [
    'add-subsection', 'add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file',
    'add-url', 'add-section-after', 'copy', 'copy-element', 'paste-after', 'paste-here', 'delete',
  ];
  for (const section of allSections(document)) {
    const actions = [...document.querySelector('#evidence > .ev-section-palette').querySelectorAll(':scope > button')]
      .map((b) => b.dataset.action);
    assert.deepEqual(actions, lockedOrder, 'control row actions in the locked §3 order');
    const after = sectionAction(section, 'add-section-after');
    assert.equal(after.textContent, '+ section after', 'locked label');
  }
});

test('the button is chrome and inherits the existing section-palette hover treatment — no button-specific CSS', () => {
  const { document } = loadApp();
  addFirstSection(document);
  const after = afterButtons(document)[0];
  assert.ok(after, 'a + section after button exists');
  const controls = after.parentElement;
  assert.equal(controls.className, 'ev-controls ev-section-palette', 'the button lives in the shared palette');
  assert.ok(controls.hasAttribute('data-chrome'), 'the control span is chrome');
  assert.equal(controls.parentElement.id, 'evidence', 'the shared palette is outside section content');

  // The palette treatment comes from the shared rail rule and no rule may key
  // on the new button itself (0028 inherits as-is).
  const css = /<style>([\s\S]*?)<\/style>/.exec(appSource())[1];
  assert.ok(!css.includes('add-section-after'), 'no CSS rule mentions the new button');
  assert.match(css, /#evidence > \.ev-section-palette\s*\{[\s\S]*opacity:\s*0;/, 'the shared palette is hidden at rest');
  assert.match(css, /#evidence > \.ev-section-palette\[data-palette-visible\]/, 'the shared palette has an active state');
});

test('a top-level click inserts a new top-level section immediately after the clicked one, renumbers, and focuses its empty title', () => {
  const { document, window } = loadApp();
  const s1 = addFirstSection(document);
  s1.querySelector('.ev-title-text').textContent = 'Setup';
  clickAfter(s1); // 2
  topSections(document)[1].querySelector('.ev-title-text').textContent = 'Results';

  clickAfter(s1); // the new section must land between Setup and Results

  const titles = topSections(document).map((s) => s.querySelector('.ev-title-text').textContent);
  assert.deepEqual(titles, ['Setup', '', 'Results'], 'positional sibling insert at top level');
  assert.deepEqual(nums(document), ['1', '2', '3'], 'renumbered');
  const newSection = topSections(document)[1];
  assert.equal(newSection.querySelector('.ev-title-text').textContent, '', 'empty title');
  assert.equal(document.activeElement, newSection.querySelector('.ev-title-text'), 'focus on the new empty title');
  assertCaretAtEnd(newSection.querySelector('.ev-title-text'));
  assertCaretInsideEmptyTextNode(document, newSection.querySelector('.ev-title-text'));
  assert.notEqual(window.getComputedStyle(newSection.querySelector('.ev-title-text')).caretColor, 'auto',
    'the focused title uses a visible system highlight caret');
});

test('a click on a sub-section makes a new sibling immediately after it, inside the same parent, renumbered', () => {
  const { document, window } = loadApp();
  const s1 = addFirstSection(document);
  sectionAction(s1, 'add-subsection').click(); // 1.1
  sectionAction(s1, 'add-subsection').click(); // 1.2
  const s11 = s1.querySelectorAll(':scope > .ev-body > .ev-section')[0];
  const s12 = s1.querySelectorAll(':scope > .ev-body > .ev-section')[1];
  s12.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Login';

  clickAfter(s11);

  const sibs = s1.querySelectorAll(':scope > .ev-body > .ev-section');
  assert.equal(sibs.length, 3, 'the new section is in the same parent body');
  assert.equal(sibs[1], s11.nextElementSibling, 'immediately after the clicked section');
  assert.equal(sibs[2], s12, 'the Login section follows the new one');
  assert.deepEqual(nums(document), ['1', '1.1', '1.2', '1.3'], 'renumbered within the parent');
  assert.equal(topSections(document).length, 1, 'no top-level section was created');
  const newTitle = sibs[1].querySelector(':scope > .ev-title > .ev-title-text');
  assert.equal(newTitle.textContent, '', 'empty title');
  assert.equal(document.activeElement, newTitle, 'focus on the new empty title');
  assertCaretInsideEmptyTextNode(document, newTitle);
  assert.notEqual(window.getComputedStyle(newTitle).caretColor, 'auto',
    'the focused sub-section title uses a visible system highlight caret');
});

test('focused section title caret is blue in bright mode and orange in dark mode', () => {
  const { document, window } = loadApp();
  const title = addFirstSection(document).querySelector('.ev-title-text');

  document.documentElement.setAttribute('data-theme', 'light');
  assert.equal(window.getComputedStyle(document.documentElement)
    .getPropertyValue('--ev-title-caret-color').trim(), '#0078d7');
  assert.equal(window.getComputedStyle(title).caretColor, 'var(--ev-title-caret-color)');

  document.documentElement.setAttribute('data-theme', 'dark');
  assert.equal(window.getComputedStyle(document.documentElement)
    .getPropertyValue('--ev-title-caret-color').trim(), '#ff9800');
});

test('an empty focused section title keeps a text caret after its last character is deleted', () => {
  const { document, window } = loadApp();
  const title = addFirstSection(document).querySelector('.ev-title-text');
  title.textContent = 'X';
  title.focus();
  title.textContent = '';
  title.dispatchEvent(new window.InputEvent('input', {
    bubbles: true,
    inputType: 'deleteContentBackward',
  }));

  assert.equal(document.activeElement, title);
  assertCaretInsideEmptyTextNode(document, title);
});

test('the insertion works at any depth — a depth-3 click makes a depth-3 sibling', () => {
  const { document } = loadApp();
  const s1 = addFirstSection(document);
  sectionAction(s1, 'add-subsection').click(); // 1.1
  const s11 = s1.querySelector(':scope > .ev-body > .ev-section');
  sectionAction(s11, 'add-subsection').click(); // 1.1.1
  const s111 = s11.querySelector(':scope > .ev-body > .ev-section');

  clickAfter(s111);

  const sibs = s11.querySelectorAll(':scope > .ev-body > .ev-section');
  assert.equal(sibs.length, 2, 'depth-3 body now has two sections');
  assert.equal(sibs[1].parentElement, s11.querySelector(':scope > .ev-body'), 'the new sibling sits in the same depth-3 body');
  assert.deepEqual(nums(document), ['1', '1.1', '1.1.1', '1.1.2'], 'renumbered at depth 3');
  assert.equal(document.activeElement, sibs[1].querySelector(':scope > .ev-title > .ev-title-text'), 'focus follows the new section');
});

test('the chrome re-render after add and delete leaves the rows correct — no orphaned or missing row buttons', () => {
  const { window, document } = loadApp();
  const s1 = addFirstSection(document);
  clickAfter(s1);
  clickAfter(topSections(document)[1]);
  assert.equal(afterButtons(document).length, 1, 'the shared palette carries one + section after action');

  // delete the middle section through the UI: its row button must not survive
  window.confirm = () => true;
  sectionAction(topSections(document)[1], 'delete').click();

  assert.equal(afterButtons(document).length, 1, 'the shared palette remains singular after the delete');
});

test('the add toolbox stays single and below the last top-level section after a row add (0115)', () => {
  const { document } = loadApp();
  const s1 = addFirstSection(document);
  clickAfter(s1);
  const buttons = [...document.querySelectorAll('.ev-add-section-btn')];
  assert.equal(buttons.length, 1, 'exactly one + section action');
  assert.equal(
    buttons[0].parentElement,
    topSections(document).at(-1).nextElementSibling,
    'the toolbox follows the last top-level section',
  );
});

test('the saved file text contains no + section after buttons — chrome is stripped, never persisted, and the new section itself persists', async () => {
  const { document, downloads } = loadApp();
  const s1 = addFirstSection(document);
  clickAfter(s1);
  document.getElementById('save-btn').click();
  const text = await downloadText(downloads.find((d) => d.name));
  const saved = new JSDOM(text).window.document;
  assert.equal(saved.querySelectorAll('[data-chrome]').length, 0, 'no data-chrome elements');
  assert.ok(!text.includes('data-action="add-section-after"'), 'no add-section-after action in the file text');
  assert.equal(saved.querySelectorAll('#evidence > .ev-section').length, 2, 'the inserted section IS persisted');

  const second = loadApp(text);
  assert.equal(topSections(second.document).length, 2, 'both sections adopted on reload');
  assert.equal(afterButtons(second.document).length, 1, 'the shared palette re-rendered at boot');
});
