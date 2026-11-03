import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAction, appSource, loadApp } from './helpers.js';

test('screenshot drag handles are positioned inside their rendered image', () => {
  const source = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Images</span></h2><div class="ev-body"><div class="ev-screenshot"><img class="ev-img" src="assets/image.png"></div></div></section>',
  );
  const { document, window } = loadApp(source);
  const screenshot = document.querySelector('.ev-screenshot');
  const image = screenshot.querySelector(':scope > .ev-img');
  const handle = screenshot.querySelector(':scope > .ev-drag-handle');

  screenshot.getBoundingClientRect = () => ({ left: 100, top: 200, width: 500, height: 300 });
  image.getBoundingClientRect = () => ({ left: 140, top: 212, width: 460, height: 260 });
  image.dispatchEvent(new window.Event('load'));

  assert.equal(handle.style.left, '42px', 'the handle is inset from the image left edge');
  assert.equal(handle.style.top, '14px', 'the handle is inset from the image top edge');
});

test('image-only handle positioning does not change other evidence handles', () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(appSource())[1]
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const screenshotRule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find((match) => match[1].split(',').map((part) => part.trim())
      .includes('.ev-screenshot > .ev-drag-handle') && /position:\s*absolute/.test(match[2]));
  assert.ok(screenshotRule, 'a screenshot-specific handle rule exists');
  assert.match(screenshotRule[2], /position:\s*absolute/);
  assert.match(screenshotRule[2], /margin-left:\s*0/);
  assert.match(screenshotRule[2], /margin-right:\s*0/);

  const genericRule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find((match) => match[1].split(',').map((part) => part.trim())
      .includes('.ev-drag-handle'));
  assert.ok(genericRule, 'the shared handle rule still exists');
  assert.doesNotMatch(genericRule[2], /position:\s*absolute/);
});
