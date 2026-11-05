import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, createFileSystemEnv, downloadText, addFirstSection, sectionAction, sectionPalette, screenStyles, stylesheetRule, assertCaretAtEnd } from './helpers.js';

// 0115: the persistent add toolbox replaces the standalone + section button.
// 0040: bare boot has no sections, so the toolbox sits below the title row
// until the first section is added, then content adds target the trailing
// subsection when present, or the last top-level section otherwise.
const clickAddSection = (document) =>
  document.querySelector('button[data-action="add-section"]').click();

const endAddAction = (document, action) => {
  const button = document.querySelector('#evidence > [data-add-toolbox] > button[data-action="' + action + '"]');
  assert.ok(button, `the persistent add toolbox exposes ${action}`);
  button.click();
};

const endAddButton = (document, action) =>
  document.querySelector('#evidence > [data-add-toolbox] > button[data-action="' + action + '"]');

test('global add tooltips explain each action in an empty document', () => {
  const { document } = loadApp(undefined, { fs: createFileSystemEnv() });
  assert.match(endAddButton(document, 'add-section').title, /first top-level section/);
  assert.match(endAddButton(document, 'add-subsection').title, /first top-level section.*subsection inside it/);
  for (const [action, behavior] of [
    ['add-comment', 'comment'], ['add-code', 'code snippet'],
    ['add-property', 'key\/value property'], ['add-screenshot', 'paste a screenshot'],
    ['add-file', 'file to attach'], ['add-url', 'URL'],
  ]) {
    assert.match(endAddButton(document, action).title, new RegExp(behavior + '.*new first top-level section'));
  }
});

test('global add tooltips identify the actual section targeted by each action', () => {
  const { document, window } = loadApp(undefined, { fs: createFileSystemEnv() });
  endAddAction(document, 'add-section');
  const section = document.querySelector('#evidence > .ev-section');
  section.querySelector('.ev-title-text').textContent = 'Results';
  sectionAction(section, 'add-subsection').click();
  const nested = section.querySelector(':scope > .ev-body > .ev-section');
  nested.querySelector('.ev-title-text').textContent = 'Retry';

  for (const action of ['add-section', 'add-subsection', 'add-comment', 'add-code',
    'add-property', 'add-screenshot', 'add-file', 'add-url']) {
    endAddButton(document, action).dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  }
  assert.match(endAddButton(document, 'add-section').title, /after section 1 “Results”/);
  assert.match(endAddButton(document, 'add-subsection').title, /end of section 1 “Results”/);
  for (const action of ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url']) {
    assert.match(endAddButton(document, action).title, /end of section 1\.1 “Retry”/);
  }

  sectionAction(section, 'add-comment').click();
  endAddButton(document, 'add-code').dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
  assert.match(endAddButton(document, 'add-code').title, /end of section 1 “Results”/);
});

test('global screenshot tooltip names the last screenshot row even when a comment follows it', () => {
  const { document, window } = loadApp(undefined, { fs: createFileSystemEnv() });
  endAddAction(document, 'add-section');
  const section = document.querySelector('#evidence > .ev-section');
  section.querySelector('.ev-title-text').textContent = 'Results';
  const body = section.querySelector(':scope > .ev-body');
  const row = document.createElement('div');
  row.className = 'ev-shot-row';
  const shot = document.createElement('div');
  shot.className = 'ev-screenshot';
  row.appendChild(shot);
  body.appendChild(row);
  sectionAction(section, 'add-comment').click();

  const screenshotButton = endAddButton(document, 'add-screenshot');
  screenshotButton.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  assert.match(screenshotButton.title, /after the final screenshot in the last screenshot row of section 1 “Results”/);
  screenshotButton.click();
  assert.ok(row.querySelector(':scope > .ev-screenshot-pending'), 'the action uses the row named by the tooltip');
});

test('persistent add actions append to the latest subsection when it ends the document', () => {
  const { document } = loadApp();
  const first = addFirstSection(document);
  sectionAction(first, 'add-comment').click();
  sectionAction(first, 'add-subsection').click();
  const firstBody = first.querySelector(':scope > .ev-body');
  const nested = firstBody.querySelector(':scope > .ev-section');
  const nestedBody = nested.querySelector(':scope > .ev-body');

  endAddAction(document, 'add-comment');
  endAddAction(document, 'add-code');
  endAddAction(document, 'add-property');
  endAddAction(document, 'add-url');
  endAddAction(document, 'add-screenshot');

  assert.deepEqual(
    [...firstBody.children].map((child) => child.className),
    ['ev-comment', 'ev-section'],
    'the top-level section keeps its existing children',
  );
  assert.deepEqual(
    [...nestedBody.children].map((child) => child.className),
    ['ev-comment', 'ev-code', 'ev-property', 'ev-url', 'ev-screenshot-pending'],
    'new content appends in click order to the latest subsection',
  );
});

test('global + subsection appends to the last top-level section after a trailing subsection', () => {
  const { document } = loadApp();
  const first = addFirstSection(document);
  sectionAction(first, 'add-subsection').click();
  const firstBody = first.querySelector(':scope > .ev-body');
  const nested = firstBody.querySelector(':scope > .ev-section');

  endAddAction(document, 'add-subsection');

  assert.deepEqual(
    [...firstBody.children].map((child) => child.className),
    ['ev-section', 'ev-section'],
    'the new subsection is the last child of the top-level section',
  );
  assert.equal(nested.querySelector(':scope > .ev-body').children.length, 0, 'the trailing subsection is not selected as its parent');
  assert.equal(firstBody.lastElementChild.parentElement, firstBody, 'the new subsection is a top-level section child');
});

test('persistent add actions fall back to the last top-level section after a later leaf row', () => {
  const { document } = loadApp();
  const first = addFirstSection(document);
  sectionAction(first, 'add-subsection').click();
  sectionAction(first, 'add-comment').click();

  endAddAction(document, 'add-code');

  const firstBody = first.querySelector(':scope > .ev-body');
  const nested = firstBody.querySelector(':scope > .ev-section');
  assert.equal(nested.querySelector(':scope > .ev-body').children.length, 0, 'the nested section is not selected');
  assert.deepEqual(
    [...firstBody.children].map((child) => child.className),
    ['ev-section', 'ev-comment', 'ev-code'],
    'the new row follows the later leaf in the last top-level section',
  );
});

test('the global + section action always adds a new top-level section', () => {
  const { document } = loadApp();
  const first = addFirstSection(document);
  sectionAction(first, 'add-subsection').click();

  endAddAction(document, 'add-section');

  assert.equal(document.querySelectorAll('#evidence > .ev-section').length, 2, 'a new top-level section was added');
  assert.equal(first.querySelectorAll(':scope > .ev-body > .ev-section').length, 1, 'the existing subsection remains nested');
});

test('an empty document creates a section before adding content or a subsection', () => {
  const commentDoc = loadApp().document;
  endAddAction(commentDoc, 'add-comment');
  const [commentSection] = [...commentDoc.querySelectorAll('#evidence > .ev-section')];
  assert.ok(commentSection, 'a top-level section is created');
  assert.equal(commentSection.querySelectorAll(':scope > .ev-body > .ev-comment').length, 1);

  const subsectionDoc = loadApp().document;
  endAddAction(subsectionDoc, 'add-subsection');
  const [parent] = [...subsectionDoc.querySelectorAll('#evidence > .ev-section')];
  assert.ok(parent, 'a top-level parent section is created');
  assert.equal(parent.querySelectorAll(':scope > .ev-body > .ev-section').length, 1, 'the requested subsection is nested in it');

  const screenshotDoc = loadApp().document;
  endAddAction(screenshotDoc, 'add-screenshot');
  const [screenshotSection] = [...screenshotDoc.querySelectorAll('#evidence > .ev-section')];
  assert.ok(screenshotSection, 'screenshot add creates a top-level section first');
  assert.equal(screenshotSection.querySelectorAll(':scope > .ev-body > .ev-screenshot-pending').length, 1);
});

test('persistent add toolbox uses the full document width and wraps its controls', () => {
  const css = screenStyles();
  const toolbox = stylesheetRule(css, '#evidence > .ev-end-add-toolbox');
  assert.match(toolbox, /width:\s*100%/);
  assert.match(toolbox, /display:\s*flex/);
  assert.match(toolbox, /flex-wrap:\s*wrap/);
  assert.match(toolbox, /padding:/, 'the large toolbox has a padded hit area');
});

test('+ section adds a new top-level section with an empty title', () => {
  const { document } = loadApp();
  clickAddSection(document);
  const sections = document.querySelectorAll('#evidence > .ev-section');
  assert.equal(sections.length, 1, 'the first top-level section was added');
  assert.equal(sections[0].querySelector('.ev-title-text').textContent, '', 'new title is empty');
});

test('+ section focuses the new section\'s title', () => {
  const { document } = loadApp();
  clickAddSection(document);
  const newTitle = document.querySelectorAll('#evidence > .ev-section')[0].querySelector('.ev-title-text');
  assert.equal(document.activeElement, newTitle, 'focus moved to the new title');
  assertCaretAtEnd(newTitle);
});

test('the new section matches the locked §3 shape', () => {
  const { document } = loadApp();
  clickAddSection(document);
  const section = document.querySelectorAll('#evidence > .ev-section')[0];

  const h2 = section.querySelector(':scope > h2.ev-title');
  assert.ok(h2, 'header is an h2.ev-title');
  const children = [...h2.children];
  assert.deepEqual(
    children.map((el) => el.className),
    ['ev-drag-handle', 'ev-num', 'ev-text ev-title-text'],
    'exactly: drag handle, numbering span, and title span; actions live in the shared palette',
  );
  assert.ok(children[0].hasAttribute('data-chrome'), 'drag handle is chrome');
  assert.ok(children[1].hasAttribute('data-chrome'), 'numbering span is chrome');
  assert.equal(children[2].getAttribute('contenteditable'), 'true', 'title is editable');
  const palette = sectionPalette(section);
  assert.equal(palette.parentElement, document.getElementById('evidence'), 'palette is external chrome');
  assert.deepEqual(
    [...palette.querySelectorAll('button')].map((b) => b.dataset.action),
    ['add-subsection', 'add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url', 'add-section-after', 'copy', 'copy-element', 'paste-after', 'paste-here', 'delete'],
    'section control row actions in spec order (+ code immediately follows + comment)',
  );
  const body = section.querySelector(':scope > .ev-body');
  assert.ok(body, 'section has an .ev-body');
  assert.equal(body.children.length, 0, 'new section body is empty');
});

test('+ subsection nests a section inside the clicked section\'s body', () => {
  const { document } = loadApp();
  const first = addFirstSection(document);
  sectionAction(first, 'add-subsection').click();
  assert.equal(document.querySelectorAll('#evidence > .ev-section').length, 1, 'still one top-level section');
  const nested = first.querySelector(':scope > .ev-body > .ev-section');
  assert.ok(nested, 'a section was nested in the body');
  assert.equal(nested.querySelector('.ev-title-text').textContent, '', 'new title is empty');
});

test('subsections nest to any depth, each appended to its own body', () => {
  const { document } = loadApp();
  const level1 = addFirstSection(document);
  sectionAction(level1, 'add-subsection').click();
  const level2 = level1.querySelector(':scope > .ev-body > .ev-section');
  assert.ok(level2, 'depth 2 exists');
  sectionAction(level2, 'add-subsection').click();
  const level3 = level2.querySelector(':scope > .ev-body > .ev-section');
  assert.ok(level3, 'depth 3 exists');
  assert.ok(level3.querySelector(':scope > .ev-title'), 'deepest section has the full locked shape');
  assert.equal(level3.querySelector('.ev-title-text').textContent, '', 'deepest title is empty and focused');
  assert.equal(document.activeElement, level3.querySelector('.ev-title-text'), 'focus follows the newest section');
  assertCaretAtEnd(level3.querySelector('.ev-title-text'));
});

test('+ subsection appends after existing items in the body', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  const body = section.querySelector(':scope > .ev-body');
  // the body starts empty (0040: no boot content); the subsection lands in it
  sectionAction(section, 'add-subsection').click();
  const tags = [...body.children].map((el) => el.className);
  assert.deepEqual(tags, ['ev-section']);
});

test('+ comment adds a comment matching the locked §3 shape', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const comment = section.querySelector(':scope > .ev-body > .ev-comment');
  assert.ok(comment, 'a comment was added to the body');
  const children = [...comment.children];
  assert.deepEqual(
    children.map((el) => el.className),
    ['ev-drag-handle', 'ev-text ev-comment-text', 'ev-controls', 'ev-copy-overlay'],
    'exactly: drag handle, editable text span, control row, and copy overlay',
  );
  assert.ok(children[0].hasAttribute('data-chrome'), 'drag handle is chrome');
  assert.equal(children[1].getAttribute('contenteditable'), 'true', 'comment text is editable');
  assert.equal(children[1].textContent, '', 'new comment text is empty');
  assert.ok(children[2].hasAttribute('data-chrome'), 'control row is chrome');
  assert.ok(children[3].hasAttribute('data-chrome'), 'copy overlay is chrome');
  assert.deepEqual(
    [...children[2].querySelectorAll('button')].map((b) => b.dataset.action),
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'copy', 'copy-element', 'paste-after', 'delete'],
    'comment control row actions',
  );
});

test('add actions focus the new text field and leave the typing caret ready', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);

  for (const [action, selector] of [
    ['add-comment', '.ev-comment-text'],
    ['add-code', '.ev-code-text'],
    ['add-property', '.ev-prop-key'],
  ]) {
    sectionAction(section, action).click();
    const row = section.querySelector(':scope > .ev-body > .' + ({
      'add-comment': 'ev-comment', 'add-code': 'ev-code', 'add-property': 'ev-property',
    })[action] + ':last-child');
    const field = row.querySelector(selector);
    assert.equal(document.activeElement, field, action + ' focuses its new text field');
    assertCaretAtEnd(field);
  }
});

test('+ property adds a key/value property matching the locked §3 shape', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-property').click();
  const props = section.querySelectorAll(':scope > .ev-body > .ev-property');
  assert.equal(props.length, 1, 'the property was added to the (empty) body');
  const prop = props[props.length - 1];
  const children = [...prop.children];
  assert.deepEqual(
    children.map((el) => el.className),
    ['ev-drag-handle', 'ev-text ev-prop-key', 'ev-sep', 'ev-text ev-prop-value', 'ev-controls', 'ev-copy-overlay'],
    'exactly: drag handle, key span, separator, value span, control row, and copy overlay',
  );
  assert.ok(children[0].hasAttribute('data-chrome'), 'drag handle is chrome');
  assert.equal(children[1].getAttribute('contenteditable'), 'true', 'key is editable');
  assert.equal(children[2].textContent, ':', 'separator is a colon');
  assert.equal(children[3].getAttribute('contenteditable'), 'true', 'value is editable');
  assert.equal(children[3].textContent, '', 'new value is empty');
  assert.ok(children[4].hasAttribute('data-chrome'), 'control row is chrome');
  assert.ok(children[5].hasAttribute('data-chrome'), 'copy overlay is chrome');
  assert.deepEqual(
    [...children[4].querySelectorAll('button')].map((b) => b.dataset.action),
    // 0107 (SPEC §29): the legacy row chrome mirrors the shared toolbox —
    // the six in-section content adds lead, above the existing tools.
    ['add-comment', 'add-code', 'add-property', 'add-screenshot', 'add-file', 'add-url',
      'copy', 'copy-element', 'paste-after', 'delete'],
    'property control row actions',
  );
});

test('items keep insertion order across mixed types', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  const body = section.querySelector(':scope > .ev-body');
  sectionAction(section, 'add-comment').click();
  sectionAction(section, 'add-property').click();
  sectionAction(section, 'add-subsection').click();
  const tags = [...body.children].map((el) => el.className);
  assert.deepEqual(tags, [
    'ev-comment', 'ev-property', 'ev-section', // inserted in click order
  ]);
});

test('numbering recomputes after every add (any item type)', () => {
  const { document } = loadApp();
  const nums = () => [...document.querySelectorAll('#evidence .ev-num')].map((n) => n.textContent);
  assert.deepEqual(nums(), [], 'bare boot: no sections, no numbers');
  clickAddSection(document);
  assert.deepEqual(nums(), ['1'], 'the first section is 1');
  clickAddSection(document);
  assert.deepEqual(nums(), ['1', '2'], 'top-level add renumbers');
  sectionAction(document.querySelector('#evidence > .ev-section'), 'add-comment').click();
  assert.deepEqual(nums(), ['1', '2'], 'comment add keeps numbering');
  sectionAction(document.querySelector('#evidence > .ev-section'), 'add-subsection').click();
  assert.deepEqual(nums(), ['1', '1.1', '2'], 'nested add renumbers by position');
});

test('content added in-session survives save/reload unchanged, in order', async () => {
  const first = loadApp();
  const section = addFirstSection(first.document);
  sectionAction(section, 'add-comment').click();
  sectionAction(section, 'add-property').click();
  const comment = section.querySelector(':scope > .ev-body > .ev-comment');
  comment.querySelector('.ev-comment-text').textContent = 'passed on retry';
  const newProp = [...section.querySelectorAll(':scope > .ev-body > .ev-property')].pop();
  newProp.querySelector('.ev-prop-key').textContent = 'Flaky?';
  newProp.querySelector('.ev-prop-value').textContent = 'yes';
  sectionAction(section, 'add-subsection').click();
  first.document.getElementById('save-btn').click();
  const savedText = await downloadText(first.downloads.find((d) => d.name));

  const second = loadApp(savedText);
  const adopted = second.document.querySelector('#evidence > .ev-section');
  const body = adopted.querySelector(':scope > .ev-body');
  const tags = [...body.children].map((el) => el.className);
  assert.deepEqual(tags, [
    'ev-comment', 'ev-property', 'ev-section',
  ], 'insertion order preserved across reload');
  assert.equal(adopted.querySelector('.ev-comment-text').textContent, 'passed on retry');
  const props = [...body.querySelectorAll(':scope > .ev-property')];
  assert.equal(props[0].querySelector('.ev-prop-key').textContent, 'Flaky?');
  assert.equal(props[0].querySelector('.ev-prop-value').textContent, 'yes');
  assert.equal(adopted.querySelectorAll('.ev-section').length, 1, 'nested section adopted too');

  // the adopted document is still fully growable:
  sectionAction(adopted, 'add-comment').click();
  assert.equal(body.querySelectorAll(':scope > .ev-comment').length, 2);
});

test('+ section appends after existing top-level sections', () => {
  const { document } = loadApp();
  clickAddSection(document);
  clickAddSection(document);
  clickAddSection(document);
  const titles = [...document.querySelectorAll('#evidence > .ev-section .ev-title-text')].map(
    (el) => el.textContent,
  );
  assert.deepEqual(titles, ['', '', '']);
});
