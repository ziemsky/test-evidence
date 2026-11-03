import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction, loadApp, downloadText, addFirstSection } from './helpers.js';

// 0016: section auto-numbering (SPEC §7).
// Seams: the UI buttons + the live DOM, and the saved file text.
// Expected values are the SPEC's worked example: 1, 1.1, 1.2, 1.2.1.

const nums = (document) =>
  [...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent);

// 0029: the single standalone + section button (SPEC §11). 0040: bare
// boot — it sits below the title row until the first section exists.
const clickAddSection = (document) =>
  document.querySelector('button[data-action="add-section"]').click();

test('position numbering matches the SPEC example: 1, 1.1, 1.2, 1.2.1, 2, built through the UI', () => {
  const { document } = loadApp();
  assert.deepEqual(nums(document), [], 'bare boot: no sections, no numbers');

  clickAddSection(document);
  assert.deepEqual(nums(document), ['1'], 'the first section is 1');

  const s1 = document.querySelector('#evidence > .ev-section');
  sectionAction(s1, 'add-subsection').click();
  assert.deepEqual(nums(document), ['1', '1.1'], 'first subsection is 1.1');
  sectionAction(s1, 'add-subsection').click();
  assert.deepEqual(nums(document), ['1', '1.1', '1.2'], 'second subsection is 1.2');

  const s12 = s1.querySelectorAll(':scope > .ev-body > .ev-section')[1];
  sectionAction(s12, 'add-subsection').click();
  assert.deepEqual(
    nums(document),
    ['1', '1.1', '1.2', '1.2.1'],
    'grandchild is parent prefix + index; whole tree in document order',
  );

  clickAddSection(document);
  assert.deepEqual(
    nums(document),
    ['1', '1.1', '1.2', '1.2.1', '2'],
    '+ section appends a new root number',
  );
});

test('renumber() runs after every add, for any item type', () => {
  const { document } = loadApp();
  clickAddSection(document); // + section (the first — 0040 bare boot)
  const s1 = document.querySelector('#evidence > .ev-section');
  assert.deepEqual(nums(document), ['1']);

  clickAddSection(document); // + section
  assert.deepEqual(nums(document), ['1', '2']);
  sectionAction(s1, 'add-subsection').click(); // + subsection
  assert.deepEqual(nums(document), ['1', '1.1', '2']);
  sectionAction(s1, 'add-comment').click(); // + comment
  assert.deepEqual(nums(document), ['1', '1.1', '2'], 'comment add leaves the numbering consistent');
  sectionAction(s1, 'add-property').click(); // + property
  assert.deepEqual(nums(document), ['1', '1.1', '2'], 'property add leaves the numbering consistent');
});

test('the number is chrome: a title that looks like a number is untouched, in the DOM and in the saved file', async () => {
  const { document, downloads } = loadApp();
  const s1 = addFirstSection(document); // 0040: build the section
  s1.querySelector('.ev-title-text').textContent = '1.2 Login';
  sectionAction(s1, 'add-subsection').click();

  assert.equal(nums(document)[0], '1', 'computed number stays position-based, not title-derived');
  assert.equal(s1.querySelector('.ev-title-text').textContent, '1.2 Login', 'title data is exactly the user text');

  document.getElementById('save-btn').click();
  const text = await downloadText(downloads.find((d) => d.name));
  const saved = new JSDOM(text).window.document;
  assert.equal(saved.querySelectorAll('.ev-num').length, 0, 'no numbering spans in the saved file');
  assert.equal(
    saved.querySelector('.ev-title-text').textContent,
    '1.2 Login',
    'saved title carries no numbering prefix',
  );
});
