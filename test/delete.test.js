import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAction, loadApp, downloadText, addFirstSection } from './helpers.js';

// 0017: delete & section-delete confirmation (SPEC §10).
// Seams: the UI buttons + the live DOM, and the saved file text.
// confirm() is a browser primitive jsdom does not implement, so tests stub
// window.confirm on the window (same pattern as the download stubs in helpers.js).

/**
 * Build the SPEC's example tree: section 1 (untitled) with subsections
 * 1.1 and 1.2, where 1.2 is titled "Login". Returns both subsections.
 * 0040: the root section is built through the UI, not inherited from boot.
 */
function buildTree(document) {
  const s1 = addFirstSection(document); // 0040: bare boot — build the root section
  sectionAction(s1, 'add-subsection').click();
  sectionAction(s1, 'add-subsection').click();
  const s11 = s1.querySelectorAll(':scope > .ev-body > .ev-section')[0];
  const s12 = s1.querySelectorAll(':scope > .ev-body > .ev-section')[1];
  s12.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Login';
  return { s1, s11, s12 };
}

const sectionDeleteButton = (section) =>
  sectionAction(section, 'delete');

test('deleting a titled section asks confirm() with the locked wording, then removes the subtree', () => {
  const { window, document } = loadApp();
  const calls = [];
  window.confirm = (msg) => { calls.push(msg); return true; };
  const { s12 } = buildTree(document);

  sectionDeleteButton(s12).click();

  assert.deepEqual(calls, ['Delete section "1.2 Login" and all of its contents?'], 'locked wording: number + title');
  assert.equal(s12.isConnected, false, 'the section subtree is removed from the DOM');
});

test('deleting an untitled section uses the untitled wording', () => {
  const { window, document } = loadApp();
  const calls = [];
  window.confirm = (msg) => { calls.push(msg); return true; };

  const s1 = addFirstSection(document);
  sectionAction(s1, 'add-subsection').click();
  const s11 = s1.querySelector(':scope > .ev-body > .ev-section');
  assert.equal(s11.querySelector(':scope > .ev-title > .ev-title-text').textContent, '', 'precondition: new subsection is untitled');

  sectionDeleteButton(s11).click();

  assert.deepEqual(calls, ['Delete this untitled section and all of its contents?'], 'locked untitled wording');
  assert.equal(s11.isConnected, false, 'untitled section subtree removed on approval');
});

test('declining the confirmation leaves the section and its contents untouched', () => {
  const { window, document } = loadApp();
  window.confirm = () => false;
  const { s12 } = buildTree(document);
  sectionAction(s12, 'add-comment').click();
  const comment = s12.querySelector(':scope > .ev-body > .ev-comment');

  sectionDeleteButton(s12).click();

  assert.equal(s12.isConnected, true, 'section stays in the DOM');
  assert.equal(comment.isConnected, true, 'nested content stays');
  assert.ok(s12.querySelector(':scope > .ev-body > .ev-comment'), 'content still a child of the body');
  const nums = [...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent);
  assert.deepEqual(nums, ['1', '1.1', '1.2'], 'numbering unchanged on decline');
});

test('deleting a comment is immediate, no confirmation', () => {
  const { window, document } = loadApp();
  const calls = [];
  window.confirm = (msg) => { calls.push(msg); return false; };
  const s1 = addFirstSection(document);
  sectionAction(s1, 'add-comment').click();
  const comment = s1.querySelector(':scope > .ev-body > .ev-comment');

  sectionAction(comment, 'delete').click();

  assert.deepEqual(calls, [], 'no confirmation for leaf deletes');
  assert.equal(comment.isConnected, false, 'comment removed even though confirm would have declined');
});

test('deleting a property is immediate, no confirmation', () => {
  const { window, document } = loadApp();
  const calls = [];
  window.confirm = (msg) => { calls.push(msg); return false; };
  const s1 = addFirstSection(document);
  for (let i = 0; i < 3; i++) sectionAction(s1, 'add-property').click();
  const prop = s1.querySelector(':scope > .ev-body > .ev-property');

  sectionAction(prop, 'delete').click();

  assert.deepEqual(calls, [], 'no confirmation for leaf deletes');
  assert.equal(prop.isConnected, false, 'property removed');
  assert.equal(s1.querySelectorAll(':scope > .ev-body > .ev-property').length, 2, 'three added, one deleted');
});

test('renumber() runs after a section delete', () => {
  const { window, document } = loadApp();
  window.confirm = () => true;
  const nums = () => [...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent);
  const { s11 } = buildTree(document);
  assert.deepEqual(nums(), ['1', '1.1', '1.2'], 'precondition');

  sectionDeleteButton(s11).click();

  assert.deepEqual(nums(), ['1', '1.1'], 'former 1.2 renumbers to 1.1');
});

test('renumber() runs after a leaf delete', () => {
  const { window, document } = loadApp();
  window.confirm = () => true;
  const s1 = addFirstSection(document);
  sectionAction(s1, 'add-property').click();
  // delete a property; numbering must stay consistent (nothing else to renumber, but it runs)
  s1.querySelector(':scope > .ev-body > .ev-property').querySelector('[data-action="delete"]').click();
  const nums = () => [...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent);
  assert.deepEqual(nums(), ['1'], 'numbering intact after a leaf delete');
});

test('a delete reports completion without triggering a save', () => {
  const { window, document, downloads } = loadApp();
  window.confirm = () => true;
  const { s11, s12 } = buildTree(document);
  sectionAction(s11, 'add-property').click();

  sectionDeleteButton(s12).click();
  const prop = s11.querySelector(':scope > .ev-body > .ev-property');
  sectionAction(prop, 'delete').click();

  assert.deepEqual(downloads, [], 'neither delete caused a download');
  assert.equal(latestOperationResult(document).message, 'Delete completed');
  assert.equal(latestOperationResult(document).outcome, 'success');
});

test('an explicit save after a delete persists the removal, without the numbering', async () => {
  const first = loadApp();
  first.window.confirm = () => true;
  const { s11 } = buildTree(first.document);
  sectionDeleteButton(s11).click();
  first.document.getElementById('save-btn').click();
  const savedText = await downloadText(first.downloads.find((d) => d.name));

  const second = loadApp(savedText);
  const doc = second.document;
  const s1 = doc.querySelector('#evidence > .ev-section');
  const sections = s1.querySelectorAll(':scope > .ev-body > .ev-section');
  assert.equal(sections.length, 1, 'deleted subtree is gone from the saved file');
  assert.equal(sections[0].querySelector(':scope > .ev-title > .ev-title-text').textContent, 'Login', 'the surviving 1.2 is the Login section');
  assert.equal(sections[0].querySelector(':scope > .ev-title > .ev-num').textContent, '1.1', 'numbering recomputed on boot, not restored from the file');
});
