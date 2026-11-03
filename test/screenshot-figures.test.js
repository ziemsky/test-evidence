import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction,
  addFirstSection,
  appSource,
  downloadText,
  loadApp,
  pasteImage,
  screenStyles,
  stubImagePipeline,
  stylesheetRule,
  waitFor,
} from './helpers.js';

test('screenshot rows present intentional figures without changing their sizing lane', () => {
  const css = screenStyles().split('@media print')[0];
  const figure = stylesheetRule(css, '.ev-screenshot');
  const image = stylesheetRule(css, '.ev-screenshot > .ev-img');
  const row = stylesheetRule(css, '.ev-shot-row');
  const caption = stylesheetRule(css, '.ev-caption');

  assert.match(figure, /box-sizing:\s*border-box/);
  assert.match(figure, /min-width:\s*0/);
  assert.match(image, /box-sizing:\s*border-box/);
  assert.match(image, /border:\s*1px solid var\(--ev-divider\)/);
  assert.match(image, /border-radius:\s*6px/);
  assert.match(image, /background:\s*rgba\(128,\s*128,\s*128,\s*0\.04\)/);
  assert.match(image, /box-shadow:\s*0 2px 10px rgba\(0,\s*0,\s*0,\s*0\.18\)/);
  assert.match(row, /width:\s*min\(var\(--ev-media-measure\),/);
  assert.match(caption, /color:\s*rgba\(128,\s*128,\s*128,\s*0\.84\)/);
  assert.match(caption, /line-height:\s*1\.35/);
  assert.match(caption, /overflow-wrap:\s*anywhere/);
});

test('screenshot rows stay inside the evidence content column', () => {
  const row = stylesheetRule(screenStyles().split('@media print')[0], '.ev-shot-row');

  assert.match(row, /max-width:\s*100%/);
  assert.doesNotMatch(row, /max-width:\s*none/);
});

test('figure styling keeps narrow and wide screenshots bounded while print removes decoration', () => {
  const document = new JSDOM(appSource()).window.document;
  const rules = [...document.styleSheets[0].cssRules];
  const style = (selector) => rules.find((rule) => rule.selectorText === selector)?.style;
  const figure = style('.ev-screenshot');
  const imageFigure = style('.ev-screenshot > .ev-img');
  const item = style('.ev-shot-row > .ev-screenshot');
  const image = style('.ev-img');

  assert.equal(figure.boxSizing, 'border-box');
  assert.equal(figure.minWidth, '0px');
  assert.equal(figure.maxWidth, '100%');
  assert.equal(imageFigure.boxSizing, 'border-box');
  assert.equal(item.minWidth, '0px');
  assert.equal(item.maxWidth, '100%');
  assert.equal(image.maxWidth, '100%');
  assert.match(
    appSource(),
    /\.ev-screenshot > \.ev-img\s*\{[^}]*border:\s*none[^}]*border-radius:\s*0[^}]*box-shadow:\s*none[^}]*background:\s*transparent/,
    'print CSS explicitly resets figure decoration',
  );
});

test('pasted figure captions, alignment, sizing, and clean persistence remain intact', async () => {
  const first = loadApp();
  stubImagePipeline(first.window);
  const section = addFirstSection(first.document);
  sectionAction(section, 'add-screenshot').click();
  pasteImage(first.window, first.document.body);
  await waitFor(() => section.querySelector('.ev-screenshot'));

  const figure = section.querySelector('.ev-screenshot');
  const row = section.querySelector('.ev-shot-row');
  const caption = figure.querySelector(':scope > .ev-caption');
  const image = figure.querySelector(':scope > .ev-img');
  assert.equal(figure.dataset.size, 'medium', 'a pasted screenshot keeps the medium default');
  assert.equal(image.getAttribute('src').startsWith('data:image/png;base64,'), true);
  caption.textContent = 'Large referral screen';
  caption.dispatchEvent(new first.window.Event('input', { bubbles: true }));
  sectionAction(row, 'row-halign-right').click();
  sectionAction(figure, 'size-large').click();

  assert.equal(figure.dataset.size, 'large');
  assert.equal(row.dataset.halign, 'right');
  assert.equal(caption.textContent, 'Large referral screen');
  assert.equal(image.getAttribute('alt'), 'Large referral screen');

  first.document.getElementById('save-btn').click();
  const savedText = await downloadText(first.downloads.find((entry) => entry.name));
  const savedDocument = new JSDOM(savedText).window.document;
  const savedFigure = savedDocument.querySelector('.ev-screenshot');
  assert.equal(savedFigure.dataset.size, 'large');
  assert.equal(savedFigure.closest('.ev-shot-row').dataset.halign, 'right');
  assert.equal(savedFigure.querySelector('.ev-caption').textContent, 'Large referral screen');
  assert.equal(savedFigure.querySelector('img').getAttribute('alt'), 'Large referral screen');
  assert.equal(savedDocument.querySelector('.ev-screenshot .ev-controls'), null);
  assert.equal(savedDocument.querySelector('.ev-shot-row .ev-row-controls'), null);

  const reopened = loadApp(savedText).document;
  assert.equal(reopened.querySelector('.ev-screenshot').dataset.size, 'large');
  assert.equal(reopened.querySelector('.ev-shot-row').dataset.halign, 'right');
  assert.equal(reopened.querySelector('.ev-screenshot .ev-caption').textContent, 'Large referral screen');
});

test('legacy unsized figures remain valid content and receive the same caption treatment', () => {
  const source = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Legacy</span></h2><div class="ev-body"><div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="assets/tall.png" alt="Tall screen"><span class="ev-caption">Tall screen</span></div><div class="ev-screenshot"><img class="ev-img" src="assets/small.png" alt="Small screen"><span class="ev-caption">Small screen</span></div></div></div></section>',
  );
  const { document, window } = loadApp(source);
  const figures = [...document.querySelectorAll('.ev-screenshot')];

  assert.equal(figures.length, 2);
  assert.ok(figures.every((figure) => figure.matches('.ev-shot-row > .ev-screenshot')));
  assert.ok(figures.every((figure) => figure.querySelector(':scope > .ev-caption')));
  assert.ok(figures.every((figure) => window.getComputedStyle(figure).minWidth === '0px'));
  assert.ok(figures.every((figure) => window.getComputedStyle(figure).maxWidth === '100%'));
  assert.equal(document.querySelector('.ev-shot-row').querySelectorAll('.ev-row-controls').length, 1);
});
