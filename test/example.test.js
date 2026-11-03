import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  sectionAction,
  loadApp,
  tick,
  createFileSystemEnv,
  appSource,
  downloadText,
  stubImagePipeline,
  pasteImage,
  waitFor,
  documentHandleKey,
  assertCaretAtEnd,
} from './helpers.js';

// 0042: example content (SPEC §20). Seams: the UI (toolbar dropdown,
// confirm(), the live DOM, the saved file) driven through loadApp, with
// confirm() stubbed (delete.test.js pattern) and the File System Access
// stubs (in-place-save.test.js pattern) for the primary-mode edges.

const ENTRY_LABEL = 'ERS-1234: update a shortlist';
const EXAMPLE_TITLE = 'ERS-1234 — SPC updates the shortlist for a triaged referral';
const EXAMPLE_SCREENSHOT_CAPTION = 'Referral before shortlist update';
const EXAMPLE_ASSETS = [
  'example-ers1234-shortlist.svg',
  'example-ers1234-shortlist-after.svg',
  'example-ers1234-shortlist-audit.svg',
  'example-ers1234-shortlist-response.json',
];
const LOCKED_CONFIRM =
  'Replace this document with the "ERS-1234: update a shortlist" example? The previous content will be unrecoverably lost, including its saved asset files.';

const menuButton = (document) => document.getElementById('example-btn');
const menu = (document) => document.getElementById('example-menu');
const isMenuOpen = (document) => menu(document).classList.contains('open');

// confirm() call log for approveExample; each test that inspects it resets
// the array first (tests in this file run sequentially).
const calls = [];

/** Open the menu and click the (only) entry with confirm() stubbed to `approve`. */
function approveExample(document, window, approve = true) {
  window.confirm = (msg) => { calls.push(msg); return approve; };
  menuButton(document).click();
  menu(document).querySelector('button[data-action="apply-example"]').click();
}

test('the toolbar row carries the Examples ▾ button and its dropdown (chrome)', () => {
  const { document } = loadApp();
  const btn = menuButton(document);
  assert.ok(btn, 'the Examples button is present in the live DOM');
  assert.equal(btn.textContent, 'Examples ▾');
  assert.equal(btn.getAttribute('data-action'), 'toggle-example-menu');
  assert.ok(btn.closest('#toolbar'), 'the button sits in the toolbar row');
  assert.ok(menu(document), 'the dropdown list is present');
  assert.ok(menu(document).hasAttribute('data-chrome'), 'the dropdown is chrome');
});

test('clicking the button toggles the menu; first release lists exactly one entry; re-click closes', () => {
  const { document } = loadApp();
  assert.equal(isMenuOpen(document), false, 'closed at boot');
  menuButton(document).click();
  assert.equal(isMenuOpen(document), true, 'click opens');
  const entries = [...menu(document).querySelectorAll('button')];
  assert.equal(entries.length, 1, 'first release: exactly one entry');
  assert.equal(entries[0].textContent, ENTRY_LABEL);
  menuButton(document).click();
  assert.equal(isMenuOpen(document), false, 're-click of the button closes');
});

test('the menu closes on Esc', () => {
  const { document, window } = loadApp();
  menuButton(document).click();
  assert.equal(isMenuOpen(document), true, 'precondition: open');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(isMenuOpen(document), false, 'Esc closes');
});

test('the menu closes on a click outside', () => {
  const { document } = loadApp();
  menuButton(document).click();
  assert.equal(isMenuOpen(document), true, 'precondition: open');
  document.body.click();
  assert.equal(isMenuOpen(document), false, 'click outside closes');
});

test('declining the confirmation: the document is unchanged, the dropdown closes', () => {
  const { document, window, downloads } = loadApp();
  // a populated document to prove the decline touches nothing
  document.querySelector('button[data-action="add-section"]').click();
  const section = document.querySelector('#evidence > .ev-section');
  sectionAction(section, 'add-property').click();
  section.querySelector(':scope > .ev-body > .ev-property > .ev-prop-value').textContent = 'kept value';

  calls.length = 0;
  approveExample(document, window, false);

  assert.deepEqual(calls, [LOCKED_CONFIRM], 'the locked wording, templated on the label');
  assert.equal(isMenuOpen(document), false, 'the dropdown is closed after the confirmation resolves');
  assert.equal(document.querySelector('#evidence h1.ev-doc-title > .ev-doc-title-text').textContent, '', 'title unchanged');
  assert.equal(document.querySelectorAll('#evidence > .ev-section').length, 1, 'sections unchanged');
  assert.equal(section.querySelector(':scope > .ev-body > .ev-property > .ev-prop-value').textContent, 'kept value', 'content unchanged');
  assert.equal(document.querySelectorAll('#evidence .ev-screenshot').length, 0, 'no example content added');
  assert.deepEqual(downloads, [], 'no save triggered');
});

function topLevelSections(document) {
  return [...document.querySelectorAll('#evidence > .ev-section')];
}

test('the applied example reads as a representative shortlist-update test', async () => {
  const { document, window } = loadApp();
  approveExample(document, window);

  const title = document.querySelector('#evidence h1.ev-doc-title > .ev-doc-title-text');
  assert.equal(title.textContent, 'ERS-1234 — SPC updates the shortlist for a triaged referral');

  const sections = topLevelSections(document);
  assert.deepEqual(sections.map((section) =>
    section.querySelector(':scope > .ev-title > .ev-title-text').textContent),
  ['Test objective', 'Test data', 'Preconditions', 'Test steps', 'Expected result', 'Evidence']);

  const testData = sections[1];
  assert.deepEqual([...testData.querySelectorAll(':scope > .ev-body > .ev-section')].map((section) =>
    section.querySelector(':scope > .ev-title > .ev-title-text').textContent),
  ['Referral', 'Patient', 'SPC', 'Triage service', 'Referral notes', 'Update request', 'Linked references']);
  assert.deepEqual(propsOf(testData.querySelector(':scope > .ev-body > .ev-section')), [
    ['Id', 'REF-1234'],
    ['State', 'Triaged - Provider to action'],
    ['Owning service', 'Triage service'],
    ['Initial shortlist', 'Respiratory'],
  ]);
  // The adjacency demos: a two-paragraph comment precedes AND follows the
  // property group, code sits between prose and properties, and properties
  // run straight into a file row and a url row.
  const subSections = [...testData.querySelectorAll(':scope > .ev-body > .ev-section')];
  const bodyKinds = (section) =>
    [...section.querySelectorAll(':scope > .ev-body > *')].filter((el) => !el.hasAttribute('data-chrome')).map((el) => el.className);
  assert.deepEqual(bodyKinds(subSections[4]),
    ['ev-comment', 'ev-property', 'ev-property', 'ev-property', 'ev-property', 'ev-comment'],
    'Referral notes: comments flank the property group');
  const notesComments = [...subSections[4].querySelectorAll(':scope > .ev-body > .ev-comment > .ev-comment-text')].map((el) => el.textContent);
  assert.ok(notesComments[0].includes('\n\n'), 'the preceding note is two paragraphs');
  assert.ok(notesComments[1].includes('\n\n'), 'the following note is two paragraphs');
  assert.deepEqual(bodyKinds(subSections[5]),
    ['ev-comment', 'ev-code', 'ev-property', 'ev-property', 'ev-property'],
    'Update request: prose, then the payload, then a definition list');
  assert.deepEqual(bodyKinds(subSections[6]),
    ['ev-property', 'ev-property', 'ev-file', 'ev-url'],
    'Linked references: properties run into the file row and the url row');

  const steps = sections[3];
  assert.deepEqual([...steps.querySelectorAll(':scope > .ev-body > .ev-section')].map((section) =>
    section.querySelector(':scope > .ev-title > .ev-title-text').textContent),
  ['Open referral', 'Update shortlist', 'Save update']);

  const evidence = sections[5];
  const row = evidence.querySelector(':scope > .ev-body > .ev-shot-row');
  assert.equal(row.querySelectorAll(':scope > .ev-screenshot').length, 3, 'before, after, and audit screenshots share one row');
  assert.equal(row.querySelectorAll(':scope > .ev-screenshot')[0].querySelector('.ev-caption').textContent,
    'Referral before shortlist update');
  assert.equal(row.querySelectorAll(':scope > .ev-screenshot')[1].querySelector('.ev-caption').textContent,
    'Referral after adding Cardiology to the shortlist');
  assert.ok(row.querySelectorAll(':scope > .ev-screenshot')[2].hasAttribute('data-standalone'),
    'the audit screenshot demonstrates standalone layout');

  const file = evidence.querySelector(':scope > .ev-body > .ev-file > a');
  assert.equal(file.textContent, 'example-ers1234-shortlist-response.json');
  assert.equal(file.getAttribute('href'), 'assets/example-ers1234-shortlist-response.json');
  assert.deepEqual([...file.parentElement.querySelectorAll(':scope > .ev-controls button')].map((button) => button.dataset.action),
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'rename-file', 'copy', 'paste-after', 'delete'], 'the attachment has the standard file controls');
});

test('a screenshot pasted after applying the example shares its row and alignment palette', async () => {
  const { document, window } = loadApp();
  approveExample(document, window);
  stubImagePipeline(window);
  const section = topLevelSections(document).at(-1);
  const exampleShot = section.querySelector('.ev-screenshot');
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, section.querySelector('.ev-screenshot-pending'));
  await waitFor(() => section.querySelectorAll('.ev-screenshot img').length === 4);

  const row = exampleShot.closest('.ev-shot-row');
  assert.ok(row, 'the example screenshot belongs to a screenshot row');
  assert.equal(section.querySelectorAll('.ev-shot-row').length, 1, 'both images share one row');
  assert.equal(row.querySelectorAll(':scope > .ev-screenshot').length, 4);
  assert.equal(section.querySelectorAll('.ev-row-controls').length, 1, 'one shared alignment palette');
  assert.ok(sectionAction(row, 'row-halign-center').hasAttribute('data-active'),
    'center is the default row alignment');
  sectionAction(row, 'row-halign-left').click();
  assert.equal(row.getAttribute('data-halign'), 'left', 'the palette can choose left explicitly');
  sectionAction(row, 'row-halign-center').click();
  assert.equal(row.hasAttribute('data-halign'), false, 'the center default is omitted');
});

test('the embedded example screenshot responds visibly to row horizontal alignment', async () => {
  const { document, window } = loadApp();
  approveExample(document, window);
  stubImagePipeline(window);

  const row = document.querySelector('#evidence .ev-shot-row');
  const image = row.querySelector(':scope > .ev-screenshot > .ev-img');
  const click = (action) => row.querySelector(`[data-action="${action}"]`).click();

  assert.equal(row.hasAttribute('data-halign'), false, 'the example uses the omitted default alignment');
  assert.equal(window.getComputedStyle(image).marginLeft, 'auto', 'the example is centered by default');
  assert.equal(window.getComputedStyle(image).marginRight, 'auto', 'the example is centered by default');

  click('row-halign-center');
  assert.equal(window.getComputedStyle(image).marginLeft, 'auto', 'center gives the image an auto left margin');
  assert.equal(window.getComputedStyle(image).marginRight, 'auto', 'center gives the image an auto right margin');

  click('row-halign-right');
  assert.equal(window.getComputedStyle(image).marginLeft, 'auto', 'right gives the image an auto left margin');

  click('row-halign-left');
  assert.notEqual(window.getComputedStyle(image).marginLeft, 'auto', 'left clears the centered image margin');
  assert.notEqual(window.getComputedStyle(image).marginRight, 'auto', 'left clears the centered image margin');

  const section = topLevelSections(document).at(-1);
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, section.querySelector('.ev-screenshot-pending'));
  await waitFor(() => section.querySelectorAll('.ev-screenshot img').length === 4);
  click('row-halign-center');
  assert.equal(window.getComputedStyle(image).marginLeft, 'auto',
    'the example image remains centered after another screenshot joins its row');
});

test('the example evidence row uses compact demo shots while pasted screenshots keep normal sizing', async () => {
  const { document, window } = loadApp();
  approveExample(document, window);
  const exampleShot = document.querySelector('#evidence .ev-screenshot');

  stubImagePipeline(window);
  const section = topLevelSections(document).at(-1);
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, section.querySelector('.ev-screenshot-pending'));
  await waitFor(() => section.querySelectorAll('.ev-screenshot img').length === 4);
  const pastedShot = section.querySelectorAll('.ev-screenshot')[3];

  assert.equal(exampleShot.dataset.size, 'small', 'the example uses compact sizing for the multi-shot demo row');
  assert.equal(pastedShot.dataset.size, 'medium', 'a pasted screenshot keeps the normal screenshot size');
  assert.equal(exampleShot.querySelector(':scope > .ev-caption').previousElementSibling.matches('img.ev-img'), true,
    'the caption remains directly beneath the example image');
});

test('ordinary unsized screenshot rows are centered by default and can be left-aligned explicitly', () => {
  const source = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">T</span></h2><div class="ev-body"><div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"></div></div></div></section>',
  );
  const { document, window } = loadApp(source);
  const row = document.querySelector('#evidence .ev-shot-row');
  assert.equal(window.getComputedStyle(row.querySelector('.ev-img')).marginLeft, 'auto',
    'ordinary unsized screenshots are centered by default');
  sectionAction(row, 'row-halign-left').click();
  assert.notEqual(window.getComputedStyle(row.querySelector('.ev-img')).marginLeft, 'auto',
    'ordinary unsized screenshots remain left-aligned when explicitly selected');
});
function bodyItems(section) {
  return [...section.querySelectorAll(':scope > .ev-body > *')].filter((el) => !el.hasAttribute('data-chrome'));
}
function propsOf(section) {
  return [...section.querySelectorAll(':scope > .ev-body > .ev-property')].map((p) => [
    p.querySelector(':scope > .ev-prop-key').textContent,
    p.querySelector(':scope > .ev-prop-value').textContent,
  ]);
}

test('apply on an empty document: the confirm wording still appears (no empty special case)', () => {
  const { document, window } = loadApp();
  calls.length = 0;
  approveExample(document, window);
  assert.deepEqual(calls, [LOCKED_CONFIRM], 'confirmed even on an empty document');
  assert.ok(topLevelSections(document).length, 'the example was applied');
});

test('apply (empty document): the exact example DOM', () => {
  const { document, window, downloads } = loadApp();
  calls.length = 0;
  approveExample(document, window);

  // title
  const title = document.querySelector('#evidence h1.ev-doc-title > .ev-doc-title-text');
  assert.equal(title.textContent, EXAMPLE_TITLE);

  // the six top-level sections
  const sections = topLevelSections(document);
  assert.deepEqual(sections.map((s) => s.querySelector(':scope > .ev-title > .ev-title-text').textContent),
    ['Test objective', 'Test data', 'Preconditions', 'Test steps', 'Expected result', 'Evidence']);

  // 1 Test objective: one comment
  assert.deepEqual(bodyItems(sections[0]).map((el) => el.className), ['ev-comment']);
  assert.equal(sections[0].querySelector('.ev-comment-text').textContent,
    "Verify that an SPC can add Cardiology to the referral shortlist when the referral is in the 'Triaged - Provider to action' state and owned by the Triage service.");

  // 2 Test data: seven subsections with representative properties plus the
  // element-adjacency demos
  const subs = [...sections[1].querySelectorAll(':scope > .ev-body > .ev-section')];
  assert.deepEqual(subs.map((s) => s.querySelector(':scope > .ev-title > .ev-title-text').textContent),
    ['Referral', 'Patient', 'SPC', 'Triage service', 'Referral notes', 'Update request', 'Linked references']);
  assert.deepEqual(propsOf(subs[0]),
    [['Id', 'REF-1234'], ['State', 'Triaged - Provider to action'], ['Owning service', 'Triage service'], ['Initial shortlist', 'Respiratory']]);
  assert.deepEqual(propsOf(subs[1]),
    [['Id', 'PAT-1234'], ['Name', 'Alex Morgan'], ['Role', 'Patient associated with the referral'], ['Organisation', 'R68']]);
  assert.deepEqual(propsOf(subs[2]),
    [['Id', 'SPC-321564'], ['Name', 'Casey Morgan'], ['Role', 'SPC performing the shortlist update'], ['Organisation', 'R69']]);
  assert.deepEqual(propsOf(subs[3]),
    [['Name', 'Service A - Triage'], ['Provider', "Hell's Pass Hospital"], ['Organisation', 'R68']]);
  assert.deepEqual([...subs[4].querySelectorAll(':scope > .ev-body > *')].filter((el) => !el.hasAttribute('data-chrome')).map((el) => el.className),
    ['ev-comment', 'ev-property', 'ev-property', 'ev-property', 'ev-property', 'ev-comment'],
    'Referral notes: a two-paragraph comment precedes and follows the group');
  assert.deepEqual(propsOf(subs[4]),
    [['Note type', 'Triage annotation'], ['Recorded by', 'N. Okafor (triage nurse)'],
     ['Recorded at', '14 Mar, 09:41'], ['Review status', 'Unreviewed']]);
  assert.deepEqual([...subs[5].querySelectorAll(':scope > .ev-body > *')].filter((el) => !el.hasAttribute('data-chrome')).map((el) => el.className),
    ['ev-comment', 'ev-code', 'ev-property', 'ev-property', 'ev-property'],
    'Update request: comment, code payload, properties');
  assert.equal(subs[5].querySelector('.ev-code-text').textContent,
    '{\n  "referralId": "REF-1234",\n  "shortlist": ["Respiratory", "Cardiology"],\n  "submittedBy": "SPC-321564",\n  "idempotencyKey": "upd-9f2c"\n}\n');
  assert.deepEqual([...subs[6].querySelectorAll(':scope > .ev-body > *')].filter((el) => !el.hasAttribute('data-chrome')).map((el) => el.className),
    ['ev-property', 'ev-property', 'ev-file', 'ev-url'],
    'Linked references: properties, file, url');
  assert.deepEqual(propsOf(subs[6]),
    [['Response file', 'example-ers1234-shortlist-response.json'], ['Record system', 'Referral manager (example.org)']]);
  assert.equal(subs[6].querySelector('.ev-file > a').getAttribute('href'),
    'assets/example-ers1234-shortlist-response.json', 'the response file is the shared example asset');
  assert.equal(subs[6].querySelector('.ev-url > a').textContent, 'Audit trail for REF-1234');

  // 3 Preconditions and 4 Test steps are authored prose with nested steps.
  assert.deepEqual(bodyItems(sections[2]).map((el) => el.className), ['ev-comment']);
  assert.deepEqual([...sections[3].querySelectorAll(':scope > .ev-body > .ev-section')].map((s) =>
    s.querySelector(':scope > .ev-title > .ev-title-text').textContent),
    ['Open referral', 'Update shortlist', 'Save update']);

  // 5 Expected result: readable assertion plus a structured response.
  assert.deepEqual(bodyItems(sections[4]).map((el) => el.className), ['ev-comment', 'ev-code']);
  assert.equal(sections[4].querySelector('.ev-code-text').textContent,
    '{\n  "referralId": "REF-1234",\n  "action": "update-shortlist",\n  "added": ["Cardiology"],\n  "outcome": "passed"\n}\n');

  // 6 Evidence: lead-in comment, the shared response attachment, two url
  // rows, the three-shot row, and a closing comment after the images.
  assert.deepEqual(bodyItems(sections[5]).map((el) => el.className),
    ['ev-comment', 'ev-file', 'ev-url', 'ev-url', 'ev-shot-row', 'ev-comment']);
  const screenshots = [...sections[5].querySelectorAll(':scope > .ev-body > .ev-shot-row > .ev-screenshot')];
  assert.equal(screenshots.length, 3);
  screenshots.forEach((shot) => {
    assert.ok(shot.querySelector(':scope > img.ev-img').getAttribute('src').startsWith('data:image/svg+xml'),
      'fallback: each SVG is stored as a data-URL');
  });
  assert.equal(screenshots[0].querySelector('.ev-caption').textContent, EXAMPLE_SCREENSHOT_CAPTION);
  assert.equal(screenshots[0].querySelector('img').getAttribute('alt'), EXAMPLE_SCREENSHOT_CAPTION);
  assert.equal(screenshots[1].querySelector('.ev-caption').textContent,
    'Referral after adding Cardiology to the shortlist');
  assert.equal(screenshots[2].querySelector('.ev-caption').textContent,
    'Audit confirmation after shortlist update');
  assert.ok(screenshots[2].hasAttribute('data-standalone'));
  assert.equal(sections[5].querySelector('.ev-file > a').getAttribute('href'),
    'assets/example-ers1234-shortlist-response.json');

  // numbering
  assert.deepEqual([...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent),
    ['1', '2', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '3', '4', '4.1', '4.2', '4.3', '5', '6']);

  // focus lands in the title field; the tab title syncs
  assert.equal(document.activeElement, title, 'focus is in the document title field');
  assertCaretAtEnd(title);
  assert.equal(document.title, EXAMPLE_TITLE, 'the tab mirrors the example title');

  // no save is triggered, no status message (fallback: nothing failed)
  assert.deepEqual(downloads, [], 'no save triggered');
  assert.equal(latestOperationResult(document).message, 'Example applied');
  assert.equal(latestOperationResult(document).outcome, 'success');
});

test('apply on a populated document: the old content and any pending placeholder are replaced', () => {
  const { document, window } = loadApp();
  document.querySelector('button[data-action="add-section"]').click();
  const section = document.querySelector('#evidence > .ev-section');
  sectionAction(section, 'add-property').click();
  section.querySelector(':scope > .ev-body > .ev-property > .ev-prop-value').textContent = 'old value';
  sectionAction(section, 'add-screenshot').click(); // a pending placeholder
  assert.ok(document.querySelector('#evidence .ev-screenshot-pending'), 'precondition: a pending placeholder exists');

  calls.length = 0;
  approveExample(document, window);

  assert.equal(topLevelSections(document).length, 6, 'the old section is gone; the six example sections remain');
  assert.equal(document.querySelector('#evidence .ev-screenshot-pending'), null, 'the pending placeholder is removed');
  assert.ok(!document.querySelector('#evidence').textContent.includes('old value'), 'the old content is gone');
  assert.equal(document.querySelectorAll('#evidence .ev-screenshot').length, 3, 'the example evidence row contains three screenshots');
});

test('apply, primary + granted: the SVG is written, the src is relative, and old shot files are deleted', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click(); // pick the folder + grant, so the session has a handle
  await tick();

  // a pre-existing shot referenced by the document
  fs.env.assetsFiles.set('shot-20260912-100000.png', null);
  document.querySelector('button[data-action="add-section"]').click();
  const newSection = document.querySelector('#evidence > .ev-section');
  const shotDiv = document.createElement('div');
  shotDiv.className = 'ev-screenshot';
  const shotImg = document.createElement('img');
  shotImg.className = 'ev-img';
  shotImg.setAttribute('src', 'assets/shot-20260912-100000.png');
  shotDiv.appendChild(shotImg);
  newSection.querySelector(':scope > .ev-body').appendChild(shotDiv);

  calls.length = 0;
  approveExample(document, window);
  await tick(); // the primary path awaits ensurePermission + the writes

  assert.ok(fs.env.assetsFiles.has('example-ers1234-shortlist.svg'), 'the example SVG asset is written');
  const svgText = fs.env.assetsFiles.get('example-ers1234-shortlist.svg');
  assert.ok(svgText.includes('example-shot-svg'), 'the SVG is the inlined definition');
  assert.ok(svgText.includes('MOCK SCREENSHOT OF A WEB APPLICATION'), 'the SVG carries the mock text');
  EXAMPLE_ASSETS.forEach((asset) => assert.ok(fs.env.assetsFiles.has(asset), `the example asset ${asset} is written`));
  const exImg = document.querySelector('#evidence .ev-screenshot > img.ev-img');
  assert.equal(exImg.getAttribute('src'), 'assets/example-ers1234-shortlist.svg', 'the src is the relative asset path');
  assert.ok(fs.env.removedAssets.includes('shot-20260912-100000.png'), 'the previously referenced shot file is removed from disk');
  assert.ok(!fs.env.assetsFiles.has('shot-20260912-100000.png'), 'the old shot file is gone from the assets map');
  assert.equal(latestOperationResult(document).message, 'Example applied');
  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.equal(fs.env.pickerCalls.length, 1, 'apply triggers no folder picker — only the Save gesture did');
});

test('apply twice in primary + granted: the same asset name is overwritten (no folder growth)', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click();
  await tick();

  calls.length = 0;
  approveExample(document, window);
  await tick();
  EXAMPLE_ASSETS.forEach((asset) => assert.ok(fs.env.assetsFiles.has(asset), `first apply wrote ${asset}`));
  const firstWrites = new Map(EXAMPLE_ASSETS.map((asset) => [asset, fs.env.assetsFiles.get(asset)]));

  calls.length = 0;
  approveExample(document, window);
  await tick();

  assert.deepEqual([...fs.env.assetsFiles.keys()], EXAMPLE_ASSETS, 'no folder growth across applies');
  EXAMPLE_ASSETS.forEach((asset) => {
    assert.equal(fs.env.assetsFiles.get(asset), firstWrites.get(asset), `${asset} is overwritten byte-identically`);
  });
});

test('apply, primary with no handle yet: the SVG stores inline, no picker, nothing deleted', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  assert.equal(document.getElementById('mode-indicator'), null);

  // an old document referencing a screenshot and a file attachment
  document.querySelector('button[data-action="add-section"]').click();
  const body = document.querySelector('#evidence > .ev-section').querySelector(':scope > .ev-body');
  body.insertAdjacentHTML('beforeend', fileRowHtml('assets/field%20notes.txt', 'field notes.txt'));
  const shotDiv = document.createElement('div');
  shotDiv.className = 'ev-screenshot';
  const shotImg = document.createElement('img');
  shotImg.className = 'ev-img';
  shotImg.setAttribute('src', 'assets/shot-20260912-100000.png');
  shotDiv.appendChild(shotImg);
  body.appendChild(shotDiv);
  fs.env.assetsFiles.set('field notes.txt', new window.Blob(['notes']));
  fs.env.assetsFiles.set('shot-20260912-100000.png', null);

  calls.length = 0;
  approveExample(document, window);
  await tick();

  const img = document.querySelector('#evidence .ev-screenshot > img.ev-img');
  assert.ok(img.getAttribute('src').startsWith('data:image/svg+xml'), 'the SVG stores as an inline data-URL');
  assert.equal(fs.env.pickerCalls.length, 0, 'apply triggers no folder picker');
  assert.equal(fs.env.requestPermissionCalls, 0, 'no permission prompt');
  assert.deepEqual(fs.env.removedAssets, [], 'nothing is deleted');
  assert.equal(latestOperationResult(document).message, 'Example applied');
  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.equal(topLevelSections(document).length, 6, 'the content replacement still happened');
  assert.equal(document.querySelectorAll('#evidence .ev-file').length, 2, 'the example attachment rows are present (Evidence and Linked references');
  assert.equal(document.querySelectorAll('#evidence .ev-screenshot').length, 3, 'the example screenshots remain');
  assert.ok(fs.env.assetsFiles.has('field notes.txt'), 'no handle: the attachment asset stays on disk');
  assert.ok(fs.env.assetsFiles.has('shot-20260912-100000.png'), 'no handle: the screenshot asset stays on disk');
});

test('apply re-seeds the used names: the stale name is gone, the example name is registered', async () => {
  const fs = createFileSystemEnv();
  // Boot from a document that already references the old shot, so the boot
  // seed (§4.5) puts its name into the used-names set.
  const dirty = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text">Old title</span></h1>
      <section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">Old</span></h2>
      <div class="ev-body"><div class="ev-screenshot"><img class="ev-img" src="assets/shot-20260912-100000.png" alt=""></div></div></section>
    </main>`,
  );
  const { document, window } = loadApp(dirty, { fs });
  await tick();
  document.getElementById('save-btn').click(); // pick the folder + grant
  await tick();

  const usedNames = window.__evidence.usedNames;
  assert.ok(usedNames.has('shot-20260912-100000.png'), 'precondition: the boot seed picked up the old name');

  calls.length = 0;
  approveExample(document, window);
  await tick();

  assert.ok(usedNames.has('example-ers1234-shortlist.svg'), 'the canonical example name is registered');
  assert.ok(usedNames.has('example-ers1234-shortlist-after.svg'), 'the after-state example name is registered');
  assert.ok(usedNames.has('example-ers1234-shortlist-audit.svg'), 'the audit example name is registered');
  assert.ok(!usedNames.has('shot-20260912-100000.png'), 'the stale name is released');
  assert.deepEqual([...usedNames].sort(), [
    'example-ers1234-shortlist-after.svg',
    'example-ers1234-shortlist-audit.svg',
    'example-ers1234-shortlist.svg',
  ], 'only the example screenshot names remain');
});

function stubClipboardWindow(window) {
  const textCalls = [];
  const imageCalls = [];
  window.navigator.clipboard = {
    writeText: (text) => { textCalls.push(text); return Promise.resolve(); },
    write: (items) => { imageCalls.push(items); return Promise.resolve(); },
  };
  return { textCalls, imageCalls };
}

test('copy on the example\'s SVG screenshot is a no-op with the locked status', async () => {
  const { document, window } = loadApp();
  const { textCalls, imageCalls } = stubClipboardWindow(window);
  calls.length = 0;
  approveExample(document, window); // fallback: the SVG is a data-URL

  const shot = document.querySelector('#evidence .ev-screenshot');
  sectionAction(shot, 'copy').click();
  await Promise.resolve();

  assert.deepEqual(imageCalls, [], 'no clipboard image write');
  assert.deepEqual(textCalls, [], 'no text write either');
  assert.equal(latestOperationResult(document).message, 'Copy unavailable — example screenshot');
  assert.equal(latestOperationResult(document).outcome, 'information');
});

test('copy on the example\'s text fields works as usual (value only, comment text)', async () => {
  const { document, window } = loadApp();
  const { textCalls } = stubClipboardWindow(window);
  calls.length = 0;
  approveExample(document, window);
  const sections = topLevelSections(document);

  // a property copies the value only — never the key
  const patient = sections[1].querySelectorAll(':scope > .ev-body > .ev-section')[1];
  const prop = patient.querySelectorAll(':scope > .ev-body > .ev-property')[1];
  sectionAction(prop, 'copy').click();
  await Promise.resolve();

  // the multi-line comment copies its text exactly
  const objective = sections[0].querySelector('.ev-comment');
  sectionAction(objective, 'copy').click();
  await Promise.resolve();

  assert.ok(textCalls.includes('Alex Morgan'), 'the property value copied, not the key');
  assert.ok(!textCalls.includes('Name'), 'the key never copied');
  assert.ok(textCalls.includes(
    "Verify that an SPC can add Cardiology to the referral shortlist when the referral is in the 'Triaged - Provider to action' state and owned by the Triage service."),
    'the objective comment copied verbatim');
});

test('the saved file carries the hidden SVG definition and clean example content (no chrome, no contenteditable)', async () => {
  const { document, window, downloads } = loadApp();
  calls.length = 0;
  approveExample(document, window);
  document.getElementById('save-btn').click();
  const text = await downloadText(downloads.find((d) => d.name));

  assert.ok(text.includes('example-shot-svg'), 'the hidden <svg> definition survives as code');
  assert.ok(text.includes('MOCK SCREENSHOT OF A WEB APPLICATION'), 'the SVG mock content is in the file');
  assert.ok(text.includes(EXAMPLE_TITLE), 'the example title is in the file');
  const saved = new JSDOM(text).window.document;
  assert.equal(saved.querySelectorAll('[data-chrome]').length, 0, 'no data-chrome in the saved file');
  assert.equal(saved.querySelectorAll('[contenteditable]').length, 0, 'no contenteditable in the saved file');
  assert.equal(saved.querySelector('.ev-img').style.marginLeft, '', 'screen alignment does not serialize as inline styling');
  const svg = saved.getElementById('example-shot-svg');
  assert.ok(svg, 'the SVG definition is an element of the saved file');
  assert.ok(!svg.hasAttribute('data-chrome'), 'the SVG definition is not chrome');
  assert.ok(saved.getElementById('example-shortlist-after-svg'), 'the after-state SVG definition is an element of the saved file');
  assert.ok(saved.getElementById('example-shortlist-audit-svg'), 'the audit SVG definition is an element of the saved file');
  assert.equal(saved.querySelectorAll('#evidence .ev-screenshot').length, 3, 'the example content includes the complete screenshot row');
  const screenshots = [...saved.querySelectorAll('#evidence .ev-screenshot')];
  screenshots.forEach((screenshot) => {
    assert.equal(screenshot.querySelector('img').getAttribute('src').indexOf('data:image/svg+xml'), 0, 'fallback: the inline data-URL travels with the file');
  });
  const screenshot = screenshots[0];
  assert.equal(screenshot.querySelector('.ev-caption').textContent, EXAMPLE_SCREENSHOT_CAPTION, 'the caption is saved as clean content');
  assert.equal(screenshot.querySelector('img').getAttribute('alt'), EXAMPLE_SCREENSHOT_CAPTION, 'the saved alt mirrors the caption');
  assert.equal(saved.querySelector('.ev-file > a').getAttribute('href'), 'assets/example-ers1234-shortlist-response.json', 'the attachment link is saved as clean content');
});

test('A4 after an apply: save → reload → save is byte-identical (fallback and primary)', async () => {
  // fallback
  const first = loadApp();
  calls.length = 0;
  approveExample(first.document, first.window);
  first.document.getElementById('save-btn').click();
  const f1 = await downloadText(first.downloads.find((d) => d.name));
  const second = loadApp(f1);
  second.document.getElementById('save-btn').click();
  const f2 = await downloadText(second.downloads.find((d) => d.name));
  assert.equal(f2, f1, 'fallback: byte-identical after an apply');
  assert.equal(second.document.querySelector('.ev-caption').textContent, EXAMPLE_SCREENSHOT_CAPTION, 'fallback reload retains the caption');
  assert.equal(second.document.querySelector('.ev-screenshot img').getAttribute('alt'), EXAMPLE_SCREENSHOT_CAPTION, 'fallback reload retains the synchronized alt');

  // primary + granted
  const fs = createFileSystemEnv();
  const p1app = loadApp(undefined, { fs });
  await tick();
  p1app.document.getElementById('save-btn').click();
  await tick();
  calls.length = 0;
  approveExample(p1app.document, p1app.window);
  await tick();
  p1app.document.getElementById('save-btn').click();
  await tick();
  const p1 = fs.env.files.get('index.html');
  assert.ok(p1.includes('src="assets/example-ers1234-shortlist.svg"'), 'primary: the relative asset src is saved');
  assert.ok(p1.includes('example-shot-svg'), 'primary: the SVG definition is saved');
  const p2app = loadApp(p1, { fs });
  await tick();
  p2app.document.getElementById('save-btn').click();
  await tick();
  assert.equal(fs.env.files.get('index.html'), p1, 'primary: byte-identical after an apply');
  assert.equal(p2app.document.querySelector('.ev-caption').textContent, EXAMPLE_SCREENSHOT_CAPTION, 'primary reload retains the caption');
  assert.equal(p2app.document.querySelector('.ev-screenshot img').getAttribute('alt'), EXAMPLE_SCREENSHOT_CAPTION, 'primary reload retains the synchronized alt');
});

test('apply, primary with permission declined: content replaced, inline asset, old files stay, a status message', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click(); // granted handle + an old shot file on disk
  await tick();
  fs.env.assetsFiles.set('shot-20260912-100000.png', null);

  fs.env.permission = 'denied'; // the apply gesture cannot obtain 'granted'
  calls.length = 0;
  approveExample(document, window);
  await tick();

  const img = document.querySelector('#evidence .ev-screenshot > img.ev-img');
  assert.ok(img.getAttribute('src').startsWith('data:image/svg+xml'), 'the SVG stores inline');
  assert.equal(topLevelSections(document).length, 6, 'the content replacement proceeded — it never fails on FS');
  assert.deepEqual(fs.env.removedAssets, [], 'zero removeEntry calls');
  assert.ok(fs.env.assetsFiles.has('shot-20260912-100000.png'), 'the undeletable old file stays on disk');
  assert.equal(latestOperationResult(document).message, 'Example file work failed — permission not granted', 'a status message reports the failed file work');
  assert.equal(latestOperationResult(document).outcome, 'warning');
  assert.equal(document.getElementById('operation-status'), null,
    'warning completions remain contextual and logged without adding a bottom bar');
});

// ---------------------------------------------------------------------
// 0062: attachment cleanup — file rows are document-owned assets
// alongside screenshots: the confirmation names all asset files, and a
// confirmed replacement cleans up referenced attachment assets without
// making the example dependent on perfect filesystem cleanup.
// ---------------------------------------------------------------------

/** One file row whose link text and href match the given name/path. */
const fileRowHtml = (href, label) =>
  `<div class="ev-file"><a href="${href}" target="_blank" rel="noopener">${label}</a></div>`;

/**
 * Remember the picked folder in the env's IndexedDB BEFORE loadApp so
 * boot's initMode restores the handle and the default 'granted' permission
 * makes disk work available (the 0059/0061 restore pattern) — no save
 * gesture needed.
 */
function rememberFolder(fs) {
  fs.env.idbStores.add('handles');
  fs.env.idbHandles.set(documentHandleKey(), fs.env.pickedDir);
}

/** A hand-built screenshot div referencing the given raw asset src. */
function shotHtml(src) {
  return `<div class="ev-screenshot"><img class="ev-img" src="${src}" alt=""></div>`;
}

test('declining in primary mode leaves attachment rows, their assets, and the disk untouched', async () => {
  const fs = createFileSystemEnv();
  rememberFolder(fs);
  const { window, document } = loadApp(undefined, { fs });
  await tick(); // initMode restores the remembered handle

  document.querySelector('button[data-action="add-section"]').click();
  const body = document.querySelector('#evidence > .ev-section').querySelector(':scope > .ev-body');
  body.insertAdjacentHTML('beforeend',
    fileRowHtml('assets/field%20notes.txt', 'field notes.txt') + shotHtml('assets/shot-20260912-100000.png'));
  const notes = new window.Blob(['notes']);
  fs.env.assetsFiles.set('field notes.txt', notes);
  fs.env.assetsFiles.set('shot-20260912-100000.png', null);

  calls.length = 0;
  approveExample(document, window, false);
  await tick(); // the confirmation resolved: nothing else happens

  assert.deepEqual(calls, [LOCKED_CONFIRM], 'the new locked wording names the saved asset files');
  assert.equal(document.querySelectorAll('#evidence .ev-file').length, 1, 'the attachment row is untouched');
  assert.equal(document.querySelectorAll('#evidence .ev-screenshot img').length, 1, 'the old screenshot is untouched');
  assert.equal(fs.env.assetsFiles.get('field notes.txt'), notes, 'the attachment asset is untouched');
  assert.ok(fs.env.assetsFiles.has('shot-20260912-100000.png'), 'the screenshot asset is untouched');
  assert.deepEqual(fs.env.removedAssets, [], 'nothing is deleted');
  assert.equal(fs.env.pickerCalls.length, 0, 'no unexpected folder picker');
  assert.equal(fs.env.files.size, 0, 'no automatic save');
  assert.equal(latestOperationResult(document).message, 'Apply example cancelled');
  assert.equal(latestOperationResult(document).outcome, 'information');
});

test('confirmed replacement in primary mode deletes attachment assets alongside screenshot assets', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click(); // pick the folder + grant
  await tick();

  document.querySelector('button[data-action="add-section"]').click();
  const body = document.querySelector('#evidence > .ev-section').querySelector(':scope > .ev-body');
  body.insertAdjacentHTML('beforeend',
    fileRowHtml('assets/field%20notes.txt', 'field notes.txt') + shotHtml('assets/shot-20260912-100000.png'));
  fs.env.assetsFiles.set('field notes.txt', new window.Blob(['notes']));
  fs.env.assetsFiles.set('shot-20260912-100000.png', null);
  const savedBefore = fs.env.files.get('index.html');

  calls.length = 0;
  approveExample(document, window);
  await tick();

  assert.ok(fs.env.assetsFiles.has('example-ers1234-shortlist.svg'), 'the example asset is still written');
  const exImg = document.querySelector('#evidence .ev-screenshot > img.ev-img');
  assert.equal(exImg.getAttribute('src'), 'assets/example-ers1234-shortlist.svg', 'the src is the relative asset path');
  assert.ok(fs.env.removedAssets.includes('field notes.txt'), 'the attachment asset is removed by its decoded disk name');
  assert.ok(!fs.env.removedAssets.includes('field%20notes.txt'), 'never the encoded URL');
  assert.ok(fs.env.removedAssets.includes('shot-20260912-100000.png'), 'the screenshot asset is removed');
  assert.equal(document.querySelectorAll('#evidence .ev-file').length, 2, 'the example attachment rows remain after replacement (Evidence and Linked references');
  assert.equal(document.querySelectorAll('#evidence .ev-screenshot').length, 3, 'the example screenshots remain');
  assert.equal(latestOperationResult(document).message, 'Example applied');
  assert.equal(latestOperationResult(document).outcome, 'success');
  assert.equal(fs.env.pickerCalls.length, 1, 'apply triggers no folder picker — only the Save gesture did');
  assert.equal(fs.env.files.get('index.html'), savedBefore, 'no automatic HTML save — the saved file is untouched by the apply');
});

test('duplicate references to one asset deduplicate to a single deletion', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click();
  await tick();

  document.querySelector('button[data-action="add-section"]').click();
  const body = document.querySelector('#evidence > .ev-section').querySelector(':scope > .ev-body');
  body.insertAdjacentHTML('beforeend',
    fileRowHtml('assets/shared.dat', 'shared.dat') +
    fileRowHtml('assets/shared.dat', 'shared.dat') +
    '<div class="ev-shot-row">' + shotHtml('assets/shared.dat') + '</div>');
  fs.env.assetsFiles.set('shared.dat', new window.Blob(['shared']));

  calls.length = 0;
  approveExample(document, window);
  await tick();

  assert.deepEqual(fs.env.removedAssets, ['shared.dat'], 'three references (two file rows, one cross-type screenshot) → one deletion');
  assert.equal(document.querySelectorAll('#evidence .ev-file').length, 2, 'the example attachment rows remain after replacement (Evidence and Linked references');
  assert.ok(fs.env.assetsFiles.has('example-ers1234-shortlist.svg'), 'the example apply succeeded');
  assert.equal(latestOperationResult(document).message, 'Example applied');
  assert.equal(latestOperationResult(document).outcome, 'success');
});

test('missing old assets are ignored — no failure, no status message', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click();
  await tick();

  document.querySelector('button[data-action="add-section"]').click();
  const body = document.querySelector('#evidence > .ev-section').querySelector(':scope > .ev-body');
  body.insertAdjacentHTML('beforeend',
    fileRowHtml('assets/gone.txt', 'gone.txt') + shotHtml('assets/shot-gone.png'));
  // Neither referenced asset exists on disk.

  calls.length = 0;
  approveExample(document, window);
  await tick();

  assert.ok(fs.env.assetsFiles.has('example-ers1234-shortlist.svg'), 'the example apply still succeeded');
  assert.equal(document.querySelectorAll('#evidence .ev-file').length, 2, 'the example attachment rows remain after replacement (Evidence and Linked references');
  assert.deepEqual(fs.env.removedAssets, [], 'there was nothing to remove');
  assert.equal(latestOperationResult(document).message, 'Example applied');
  assert.equal(latestOperationResult(document).outcome, 'success');
});

test('a per-asset deletion failure does not undo the replacement and reports could not delete <filename>', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click();
  await tick();

  document.querySelector('button[data-action="add-section"]').click();
  const body = document.querySelector('#evidence > .ev-section').querySelector(':scope > .ev-body');
  body.insertAdjacentHTML('beforeend',
    fileRowHtml('assets/locked.dat', 'locked.dat') + shotHtml('assets/shot-20260912-100000.png'));
  const shot = new window.Blob(['shot']);
  fs.env.assetsFiles.set('locked.dat', new window.Blob(['locked']));
  fs.env.assetsFiles.set('shot-20260912-100000.png', shot);
  fs.env.failNextRemoveEntry = 'read-only file system'; // the first deletion (the screenshot) fails

  calls.length = 0;
  approveExample(document, window);
  await tick();

  assert.ok(fs.env.assetsFiles.has('example-ers1234-shortlist.svg'), 'the example asset is written');
  assert.equal(document.querySelectorAll('#evidence > .ev-section').length, 6, 'the replacement proceeded');
  assert.equal(document.querySelectorAll('#evidence .ev-file').length, 2, 'the example attachment rows remain regardless of the cleanup failure');
  assert.ok(fs.env.assetsFiles.get('shot-20260912-100000.png') === shot, 'the undeletable asset stays on disk');
  assert.deepEqual(fs.env.removedAssets, ['locked.dat'], 'cleanup continues past the failure — the attachment asset is still deleted');
  assert.equal(latestOperationResult(document).message,
    'Example file work failed — could not delete shot-20260912-100000.png',
    'the existing status area reports the failed asset');
});

test('a malformed percent-sequence in a file-row href never blocks the apply', async () => {
  // A hand-written href whose % is not a valid encoding would make
  // decodeURIComponent throw; the apply must not die on it.
  const { document, window } = loadApp();
  document.querySelector('button[data-action="add-section"]').click();
  const body = document.querySelector('#evidence > .ev-section').querySelector(':scope > .ev-body');
  body.insertAdjacentHTML('beforeend', fileRowHtml('assets/100%.weird', '100%.weird'));
  assert.throws(() => window.decodeURIComponent('100%.weird'), 'precondition: the decode would throw');

  calls.length = 0;
  approveExample(document, window);
  await tick();

  assert.equal(topLevelSections(document).length, 6, 'the content replacement happened');
  assert.equal(document.querySelectorAll('#evidence .ev-file').length, 2, 'the example attachment rows remain after replacement (Evidence and Linked references');
  assert.equal(latestOperationResult(document).message, 'Example applied');
  assert.equal(latestOperationResult(document).outcome, 'success');
});
