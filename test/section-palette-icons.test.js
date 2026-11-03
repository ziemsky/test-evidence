import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  sectionAction,
  addFirstSection,
  appSource,
  downloadText,
  loadApp,
  sectionPalette,
  screenStyles,
  stylesheetRule,
} from './helpers.js';

const SECTION_ACTIONS = [
  ['add-subsection', '+ subsection'],
  ['add-comment', '+ comment'],
  ['add-code', '+ code'],
  ['add-property', '+ property'],
  ['add-screenshot', '+ screenshot'],
  ['add-file', '+ file'],
  ['add-url', '+ url'],
  ['add-section-after', '+ section after'],
  ['copy', 'copy'],
  ['copy-element', 'copy element'],
  ['paste-after', 'paste after'],
  ['paste-here', 'paste here'],
  ['delete', 'delete'],
];

test('section palette actions keep their labels and render decorative current-color icons', () => {
  const { document } = loadApp();
  const palette = sectionPalette(addFirstSection(document));
  const buttons = [...palette.querySelectorAll(':scope > button')];

  assert.deepEqual(
    buttons.map((button) => [button.dataset.action, button.textContent]),
    SECTION_ACTIONS,
    'the visible labels and semantic action order remain unchanged',
  );
  assert.ok(buttons.every((button) => button.querySelector(':scope > svg.ev-action-icon')));
  assert.ok(buttons.every((button) => {
    const icon = button.querySelector(':scope > svg.ev-action-icon');
    return icon && icon.getAttribute('aria-hidden') === 'true' &&
      icon.getAttribute('focusable') === 'false' &&
      icon.getAttribute('stroke') === 'currentColor' &&
      icon.querySelector(':scope > path[d]');
  }), 'icons are inline, decorative, outlined, and inherit the button color');
  assert.ok(buttons.every((button) =>
    button.querySelector(':scope > .ev-action-label')?.textContent === button.textContent.trim()
      .replace(/^/, ''),
  ), 'the accessible text label remains a distinct visible span');
});

test('system paste targets receive the same icons while leaf palettes stay text-only', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  const conditional = sectionPalette(section);
  for (const action of ['paste-after', 'paste-here']) {
    const button = conditional.querySelector(`[data-action="${action}"]`);
    assert.ok(button, `${action} is present after copying a section`);
    assert.ok(button.querySelector(':scope > svg.ev-action-icon'), `${action} has an icon`);
  }

  sectionAction(section, 'add-comment').click();
  const leafPalette = section.querySelector(':scope > .ev-body > .ev-comment > .ev-controls');
  assert.ok(leafPalette, 'the comment has its existing leaf palette');
  assert.equal(leafPalette.querySelector('svg'), null, 'leaf palettes remain text-only');
  assert.ok([...leafPalette.querySelectorAll('button')].every((button) => button.children.length === 0));

  assert.ok(sectionAction(conditional, 'paste-here'), 'sections always expose a system paste target');
});

test('section palette styling left-aligns wrapped labels, enlarges separated targets, and casts a shadow', () => {
  const css = screenStyles();
  const palette = stylesheetRule(css, '#evidence > .ev-section-palette');
  const buttons = stylesheetRule(css, '#evidence > .ev-section-palette button');
  const icon = stylesheetRule(css, '#evidence > .ev-section-palette .ev-action-icon');

  assert.match(palette, /box-shadow:\s*0\s+2px\s+8px\s+rgba\(0,\s*0,\s*0,\s*0\.16\)/);
  assert.match(palette, /row-gap:\s*4px/);
  assert.match(buttons, /text-align:\s*left/);
  assert.match(buttons, /font-size:\s*0\.85em/);
  assert.match(buttons, /padding:\s*4px\s+8px/);
  assert.match(buttons, /box-sizing:\s*border-box/);
  assert.match(buttons, /overflow-wrap:\s*anywhere/);
  assert.match(icon, /color:\s*inherit/);
  assert.match(icon, /flex:\s*0\s+0\s+1\.1em/);
});

test('palette icons are transient chrome and do not enter saved authored HTML', async () => {
  const { document, downloads } = loadApp();
  addFirstSection(document);
  document.getElementById('save-btn').click();
  const saved = downloads.find((entry) => entry.name);
  assert.ok(saved, 'save produced a download');
  const text = await downloadText(saved);
  const savedDocument = new JSDOM(text).window.document;
  assert.equal(savedDocument.querySelector('.ev-action-icon'), null);
  assert.equal(savedDocument.querySelector('.ev-controls'), null);
});
