import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction,
  loadApp,
  loadPopulatedApp,
  tick,
  downloadText,
  createFileSystemEnv,
  waitFor,
  stubImagePipeline,
  pasteImage,
  addFirstSection,
  appSource,
  screenStyles,
  stylesheetRule,
} from './helpers.js';

test('"+ screenshot" inserts the pending placeholder at the end of the section body (0021)', () => {
  const { document } = loadApp();
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-screenshot').click();
  const pending = section.querySelector('.ev-screenshot-pending');
  assert.ok(pending, 'placeholder inserted');
  assert.ok(pending.hasAttribute('data-chrome'), 'placeholder is chrome');
  assert.equal(pending.textContent, 'Press Ctrl+V to paste from clipboard', 'placeholder shows the paste guidance');
  const body = section.querySelector(':scope > .ev-body');
  assert.equal(body.lastElementChild, pending, 'placeholder at the end of the body');
});

test('pending screenshot hint matches the full-width paste guidance style', () => {
  const styles = stylesheetRule(screenStyles(), '.ev-screenshot-pending');

  assert.match(styles, /width:\s*100%/);
  assert.match(styles, /margin:\s*0\.65em 0 0\.2em/);
  assert.match(styles, /padding:\s*0\.85em 1\.4em/);
  assert.match(styles, /border:\s*1px dashed/);
  assert.match(styles, /border-radius:\s*6px/);
  assert.match(styles, /background:\s*rgba\(128, 128, 128, 0\.035\)/);
  assert.match(styles, /text-align:\s*center/);
  const pendingGutter = stylesheetRule(screenStyles(), '.ev-body > .ev-screenshot-pending');
  assert.match(pendingGutter, /padding-left:\s*1\.4em/,
    'the content-gutter override keeps the centered card padding balanced');
});

test('every screenshot exposes size presets before Copy and Delete; selecting one saves its display metadata (0048)', () => {
  const { document, window } = loadPopulatedApp();
  const example = document.querySelector('.ev-screenshot');
  assert.ok(example, 'the fixture screenshot is present');
  assert.equal(example.dataset.size, 'small', 'the fixture screenshot uses compact sizing for the demo row');

  const controls = example.querySelector(':scope > .ev-controls');
  assert.deepEqual(
    [...controls.querySelectorAll('[data-action]')].map((button) => button.dataset.action),
    ['size-small', 'size-medium', 'size-large', 'size-page-width', 'size-original', 'size-larger', 'size-smaller', 'standalone', 'open-image', 'rename-file', 'copy', 'paste-after', 'delete'],
    'sizing shares the screenshot control row and precedes its established actions',
  );

  sectionAction(controls, 'size-large').click();
  assert.equal(example.dataset.size, 'large', 'the selected preset is content metadata');
  assert.equal(example.querySelector('img').getAttribute('src'), 'assets/example-ers1234-shortlist.svg',
    'changing display size never changes the image source');
  assert.equal(window.getComputedStyle(example.querySelector('img')).height, 'auto',
    'the display rule preserves intrinsic aspect ratio');
});

test('screenshot presets lock display widths, preserve aspect ratio, and cap to the content width (0048)', () => {
  const { document } = loadApp();
  const rules = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter((rule) => rule.selectorText && /data-size="\w+"/.test(rule.selectorText));
  const preset = Object.fromEntries(rules.map((rule) => [rule.selectorText.match(/data-size="(\w+)"/)[1], rule.style]));

  assert.equal(preset.small.width, 'min(320px, 100%)');
  assert.equal(preset.medium.width, 'min(640px, 100%)');
  assert.equal(preset.large.width, 'min(960px, 100%)');
  const sizedImage = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .find((rule) => rule.selectorText === '.ev-screenshot[data-size] > .ev-img');
  assert.equal(sizedImage.style.height, 'auto');
});

test('a pre-existing saved screenshot retains its rendering until selected and receives every preset control (0048)', () => {
  const legacySource = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Legacy</span></h2><div class="ev-body"><div class="ev-screenshot"><img class="ev-img" src="assets/legacy.png"></div></div></section>',
  );
  const { document } = loadApp(legacySource);
  const screenshot = document.querySelector('.ev-screenshot');

  assert.equal(screenshot.dataset.size, undefined, 'boot does not alter legacy display metadata');
  assert.deepEqual(
    [...screenshot.querySelectorAll('[data-action]')].map((button) => button.dataset.action),
    ['size-small', 'size-medium', 'size-large', 'size-page-width', 'size-original', 'size-larger', 'size-smaller', 'standalone', 'open-image', 'rename-file', 'copy', 'paste-after', 'delete'],
    'the asset-backed legacy shot carries rename file (§27)',
  );
  sectionAction(screenshot, 'size-medium').click();
  assert.equal(screenshot.dataset.size, 'medium', 'legacy rows become sizable without changing their image source');
  assert.equal(screenshot.querySelector('img').getAttribute('src'), 'assets/legacy.png');
});

test('responsive screenshot controls use page width, natural width, and bounded 80px steps (0049)', () => {
  const legacySource = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Responsive</span></h2><div class="ev-body"><div class="ev-screenshot"><img class="ev-img" src="assets/responsive.png"></div></div></section>',
  );
  const { document, window } = loadApp(legacySource);
  const screenshot = document.querySelector('.ev-screenshot');
  const body = screenshot.parentElement;
  const image = screenshot.querySelector('img');
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 500 });
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 420 });
  const click = (action) => screenshot.querySelector(`[data-action="${action}"]`).click();

  click('size-page-width');
  assert.equal(screenshot.dataset.size, 'page-width');
  assert.equal(image.style.width, '', 'page-width remains responsive rather than storing a fixed width');

  click('size-original');
  assert.equal(screenshot.dataset.size, 'original');
  assert.equal(image.style.width, '', 'original delegates to the image natural width');

  click('size-larger');
  assert.equal(screenshot.dataset.size, 'custom');
  assert.equal(screenshot.dataset.width, '500', 'larger moves from the natural 420px width by 80px and caps at the column');
  assert.equal(sectionAction(screenshot, 'size-larger').disabled, true, 'larger is unavailable at the column bound');

  for (let i = 0; i < 5; i++) click('size-smaller');
  assert.equal(screenshot.dataset.width, '160', 'smaller never goes below 160px');
  assert.equal(sectionAction(screenshot, 'size-smaller').disabled, true, 'smaller is unavailable at the minimum bound');
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 120 });
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(sectionAction(screenshot, 'size-larger').disabled, true, 'a narrow column prevents any overflowing increase');
  assert.equal(sectionAction(screenshot, 'size-smaller').disabled, true, 'a narrow column also prevents decreasing below its available width');
  assert.equal(image.getAttribute('src'), 'assets/responsive.png', 'sizing leaves the image source untouched');
});

test('page-width stays fluid when the content column changes (0049)', () => {
  const legacySource = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Fluid</span></h2><div class="ev-body"><div class="ev-screenshot"><img class="ev-img" src="assets/fluid.png"></div></div></section>',
  );
  const { document, window } = loadApp(legacySource);
  const screenshot = document.querySelector('.ev-screenshot');
  const body = screenshot.parentElement;
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 640 });
  sectionAction(screenshot, 'size-page-width').click();
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 300 });
  window.dispatchEvent(new window.Event('resize'));

  const pageWidthRule = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .find((rule) => rule.selectorText === '.ev-screenshot[data-size="page-width"] > .ev-img');
  assert.equal(pageWidthRule.style.width, '100%', 'page-width fills whatever the column currently offers');
  assert.equal(screenshot.dataset.size, 'page-width', 'a resize does not turn the responsive choice into a fixed width');
  assert.equal(sectionAction(screenshot, 'size-larger').disabled, true, 'the page-width bound updates after resize');
});

test('a loaded legacy image refreshes its step bounds from its natural width (0049)', () => {
  const legacySource = appSource().replace(
    '<main id="evidence">',
    '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Load</span></h2><div class="ev-body"><div class="ev-screenshot"><img class="ev-img" src="assets/load.png"></div></div></section>',
  );
  const { document, window } = loadApp(legacySource);
  const screenshot = document.querySelector('.ev-screenshot');
  const image = screenshot.querySelector('img');
  Object.defineProperty(screenshot.parentElement, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 400 });

  sectionAction(screenshot, 'size-original').click();
  assert.equal(screenshot.dataset.size, 'original');
  assert.equal(image.style.width, '', 'original leaves the natural image width in control');
  const imageRule = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .find((rule) => rule.selectorText === '.ev-img');
  assert.equal(imageRule.style.maxWidth, '100%', 'the natural width cannot overflow its content column');
  image.dispatchEvent(new window.Event('load'));
  assert.equal(sectionAction(screenshot, 'size-larger').disabled, true, 'natural width capped by the column disables larger');
});

test('content-column-only resizing refreshes step bounds (0049)', () => {
  const observerPrelude = '<script>window.__screenshotObservers=[];window.ResizeObserver=class{constructor(callback){this.callback=callback;window.__screenshotObservers.push(this)}observe(target){this.target=target}};</script><script>';
  const legacySource = appSource()
    .replace('\n<script>\n', `\n${observerPrelude}\n`)
    .replace(
      '<main id="evidence">',
      '<main id="evidence"><section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Observed</span></h2><div class="ev-body"><div class="ev-screenshot" data-size="custom" data-width="500"><img class="ev-img" style="width: 500px" src="assets/observed.png"></div></div></section>',
    );
  const { document, window } = loadApp(legacySource);
  const screenshot = document.querySelector('.ev-screenshot');
  const body = screenshot.parentElement;
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 500 });
  window.__screenshotObservers.forEach((observer) => observer.callback());
  assert.equal(sectionAction(screenshot, 'size-larger').disabled, true);

  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 800 });
  window.__screenshotObservers.forEach((observer) => observer.callback());
  assert.equal(sectionAction(screenshot, 'size-larger').disabled, false, 'a wider content column re-enables larger without a window resize');
});

test('a stepped screenshot width persists through save and reload without altering its image (0049)', async () => {
  const first = loadApp();
  stubImagePipeline(first.window);
  const section = addFirstSection(first.document);
  Object.defineProperty(section.querySelector(':scope > .ev-body'), 'clientWidth', { configurable: true, value: 800 });
  sectionAction(section, 'add-screenshot').click();
  pasteImage(first.window, first.document.body);
  await waitFor(() => section.querySelector('.ev-screenshot img'));
  const screenshot = section.querySelector('.ev-screenshot');
  const source = screenshot.querySelector('img').getAttribute('src');
  sectionAction(screenshot, 'size-larger').click();

  first.document.getElementById('save-btn').click();
  const savedText = await downloadText(first.downloads.find((download) => download.name));
  const saved = new JSDOM(savedText).window.document.querySelector('.ev-screenshot');
  assert.equal(saved.dataset.size, 'custom');
  assert.equal(saved.dataset.width, '720');
  assert.equal(saved.querySelector('img').style.width, '720px');
  assert.equal(saved.querySelector('img').getAttribute('src'), source);
  assert.equal(saved.querySelector('.ev-controls'), null, 'only content metadata is serialized');

  const reopened = loadApp(savedText).document.querySelector('.ev-screenshot');
  assert.equal(reopened.dataset.width, '720');
  assert.equal(reopened.querySelector('img').getAttribute('src'), source);
});

test('a second "+ screenshot" click removes the old placeholder and moves it (exactly one)', () => {
  const { document } = loadApp();
  addFirstSection(document); // 0040: build the first section
  const tops = document.querySelectorAll('#evidence > .ev-section');
  document.querySelector('.ev-add-section-btn').click(); // 0115: + section in the add toolbox
  const sections = document.querySelectorAll('.ev-section');
  sectionAction(sections[0], 'add-screenshot').click();
  assert.equal(document.querySelectorAll('.ev-screenshot-pending').length, 1);
  sectionAction(sections[1], 'add-screenshot').click();
  assert.equal(document.querySelectorAll('.ev-screenshot-pending').length, 1, 'still exactly one');
  assert.equal(sections[0].querySelector('.ev-screenshot-pending'), null, 'old one removed');
  const body = sections[1].querySelector(':scope > .ev-body');
  assert.equal(body.lastElementChild, sections[1].querySelector('.ev-screenshot-pending'), 'moved to the new section');
});

test('image paste with a pending placeholder: re-encoded to PNG, stored as data-URL in fallback mode', async () => {
  const { document, window } = loadApp();
  const pipeline = stubImagePipeline(window);
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-screenshot').click();
  const ev = pasteImage(window, document.body);
  assert.equal(ev.defaultPrevented, true, 'image paste is intercepted');
  await waitFor(() => section.querySelector('.ev-screenshot img'));
  const img = section.querySelector('.ev-screenshot img');
  assert.ok(img, 'placeholder replaced by a real screenshot item');
  assert.equal(section.querySelector('.ev-screenshot-pending'), null, 'placeholder gone');
  assert.ok(img.getAttribute('src').startsWith('data:image/png;base64,'), 'data-URL src in fallback mode');
  assert.ok(img.classList.contains('ev-img'), 'img uses the locked .ev-img class');
  assert.deepEqual(pipeline.toBlobCalls, ['image/png'], 're-encoded to PNG via canvas.toBlob');
  assert.equal(pipeline.files.length, 1, 'the pasted File was decoded');
  // the screenshot item has copy/delete controls like other items
  const controls = section.querySelector('.ev-screenshot .ev-controls');
  assert.ok(controls.hasAttribute('data-chrome'), 'screenshot controls are chrome');
  assert.deepEqual(
    [...controls.querySelectorAll('[data-action]')].map((b) => b.dataset.action),
    ['size-small', 'size-medium', 'size-large', 'size-page-width', 'size-original', 'size-larger', 'size-smaller', 'standalone', 'open-image', 'copy', 'paste-after', 'delete'],
  );
  assert.equal(
    section.querySelector('.ev-screenshot').dataset.size,
    'medium',
    'a newly pasted screenshot starts at the medium display preset',
  );
});

test('image paste routes to the placeholder even when the paste happens inside an editable', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-screenshot').click();
  sectionAction(section, 'add-comment').click();
  const comment = document.querySelector('.ev-comment-text');
  const ev = pasteImage(window, comment, { plain: 'some text' });
  assert.equal(ev.defaultPrevented, true, 'intercepted, text not inserted');
  await waitFor(() => document.querySelector('.ev-screenshot img'), { tries: 10 });
  assert.equal(comment.textContent, '', 'no text inserted into the editable');
});

test('image paste with no pending placeholder is not intercepted', () => {
  const { document, window } = loadApp();
  stubImagePipeline(window);
  const ev = pasteImage(window, document.body);
  assert.equal(ev.defaultPrevented, false, 'default action left alone');
  assert.equal(document.querySelector('.ev-screenshot'), null, 'nothing inserted');
});

test('chosen screenshot sizing survives save and reload as content metadata without control chrome (0048)', async () => {
  const first = loadApp();
  stubImagePipeline(first.window);
  const section = addFirstSection(first.document);
  sectionAction(section, 'add-screenshot').click();
  pasteImage(first.window, first.document.body);
  await waitFor(() => section.querySelector('.ev-screenshot img'));
  const screenshot = section.querySelector('.ev-screenshot');
  const source = screenshot.querySelector('img').getAttribute('src');
  sectionAction(screenshot, 'size-small').click();

  first.document.getElementById('save-btn').click();
  const savedText = await downloadText(first.downloads.find((download) => download.name));
  const saved = new JSDOM(savedText).window.document;
  const savedScreenshot = saved.querySelector('.ev-screenshot');
  assert.equal(savedScreenshot.dataset.size, 'small', 'the selected size is persisted as clean screenshot metadata');
  assert.equal(savedScreenshot.querySelector('img').getAttribute('src'), source, 'saving never rewrites the source image');
  assert.equal(savedScreenshot.querySelector('.ev-controls'), null, 'the control row remains chrome only');

  const reopened = loadApp(savedText).document.querySelector('.ev-screenshot');
  assert.equal(reopened.dataset.size, 'small', 'reload adopts the chosen size unchanged');
  assert.equal(reopened.querySelector('img').getAttribute('src'), source, 'reload retains the original source location');
});

// Freeze the app's clock at a local time so naming is deterministic.
function freezeNow(window, iso) {
  const Real = window.Date;
  window.Date = class extends Real {
    constructor(...args) {
      super(...(args.length ? args : [iso]));
    }
  };
  window.Date.now = () => new Real(iso).getTime();
}

test('primary mode, handle granted: PNG written to assets/<name>, relative src (0021)', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click(); // pick the folder, derive the assets dir
  await tick();
  stubImagePipeline(window);
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  await waitFor(() => section.querySelector('.ev-screenshot img'));
  const src = section.querySelector('.ev-screenshot img').getAttribute('src');
  assert.match(src, /^assets\/shot-\d{8}-\d{6}(-\d+)?\.png$/, 'relative assets/ src, never absolute');
  assert.equal(fs.env.assetsFiles.get(src.slice('assets/'.length)).type, 'image/png', 'PNG blob written to disk');
});

test('name is shot-YYYYMMDD-HHMMSS.png from local time (0021)', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click();
  await tick();
  freezeNow(window, '2026-09-09T14:30:22'); // local time
  stubImagePipeline(window);
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  await waitFor(() => section.querySelector('.ev-screenshot img'));
  assert.equal(
    section.querySelector('.ev-screenshot img').getAttribute('src'),
    'assets/shot-20260909-143022.png',
  );
});

test('primary mode, no handle picked yet: paste degrades to data-URL, no picker (0021)', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  stubImagePipeline(window);
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  await waitFor(() => section.querySelector('.ev-screenshot img'));
  const src = section.querySelector('.ev-screenshot img').getAttribute('src');
  assert.ok(src.startsWith('data:image/png;base64,'), 'data-URL when no handle');
  assert.equal(fs.env.pickerCalls.length, 0, 'paste never opens the picker');
});

test('primary mode, permission denied at paste time: degrades to data-URL (0021)', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click();
  await tick();
  fs.env.permission = 'denied'; // handle exists but the gesture is refused
  stubImagePipeline(window);
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  await waitFor(() => section.querySelector('.ev-screenshot img'));
  const src = section.querySelector('.ev-screenshot img').getAttribute('src');
  assert.ok(src.startsWith('data:image/png;base64,'), 'data-URL on denied permission');
  assert.equal(fs.env.requestPermissionCalls, 0, 'denied is final — no prompt loop');
});

test('same-second collision: -1, -2, … until the name is free (assets-dir probe) (0021)', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click();
  await tick();
  freezeNow(window, '2026-09-09T14:30:22');
  stubImagePipeline(window);
  const base = 'shot-20260909-143022.png';
  fs.env.assetsFiles.set(base, new window.Blob(['x'])); // the base name is already taken on disk
  const section = addFirstSection(document); // 0040: build the section
  const srcs = [];
  for (let i = 0; i < 2; i++) {
    sectionAction(section, 'add-screenshot').click();
    pasteImage(window, document.body);
    await waitFor(() => section.querySelectorAll('.ev-screenshot img').length === i + 1);
    srcs.push(section.querySelectorAll('.ev-screenshot img')[i].getAttribute('src'));
  }
  assert.deepEqual(srcs, ['assets/shot-20260909-143022-1.png', 'assets/shot-20260909-143022-2.png'], 'counter before the extension');
});

test('decode error: placeholder kept, error shown in the save status (0021)', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window, { decodeError: 'image corrupt' });
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  await tick();
  assert.ok(section.querySelector('.ev-screenshot-pending'), 'placeholder survives the failure');
  assert.equal(latestOperationResult(document).message, 'Screenshot failed — image corrupt');
  // a retry now succeeds
  stubImagePipeline(window);
  sectionAction(section, 'add-screenshot').click(); // moves the placeholder (still one)
  pasteImage(window, document.body);
  await waitFor(() => section.querySelector('.ev-screenshot img'));
  assert.equal(section.querySelector('.ev-screenshot-pending'), null);
});

test('PNG encode failure: placeholder kept, error shown in the save status (0021)', async () => {
  const { document, window } = loadApp();
  stubImagePipeline(window, { encodeFails: true });
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  await waitFor(() => latestOperationResult(document)?.message.startsWith('Screenshot failed'));
  assert.ok(section.querySelector('.ev-screenshot-pending'), 'placeholder survives the failure');
  assert.equal(latestOperationResult(document).message, 'Screenshot failed — PNG encode failed');
});

test('write error: placeholder kept, error shown in the save status (0021)', async () => {
  const fs = createFileSystemEnv();
  const { document, window } = loadApp(undefined, { fs });
  await tick();
  document.getElementById('save-btn').click();
  await tick();
  fs.env.failNextAssetWrite = 'disk full';
  stubImagePipeline(window);
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-screenshot').click();
  pasteImage(window, document.body);
  await waitFor(() => latestOperationResult(document)?.message.startsWith('Screenshot failed'));
  assert.ok(section.querySelector('.ev-screenshot-pending'), 'placeholder survives the failure');
  assert.equal(latestOperationResult(document).message, 'Screenshot failed — disk full');
});

test('the placeholder never survives a save; a stored screenshot does (0021)', async () => {
  const { document, window, downloads } = loadApp();
  stubImagePipeline(window);
  const section = addFirstSection(document); // 0040: build the section
  sectionAction(section, 'add-screenshot').click();
  pasteImage(document.defaultView, document.body);
  await waitFor(() => section.querySelector('.ev-screenshot img'));
  sectionAction(section, 'add-screenshot').click(); // leave a pending placeholder behind
  document.getElementById('save-btn').click();
  await tick();
  const saved = await downloadText(downloads.find((d) => d.name));
  // the app's own script embeds the placeholder string, so inspect the
  // evidence content of the saved document, not the whole file
  const savedDoc = new JSDOM(saved).window.document;
  const root = savedDoc.getElementById('evidence');
  assert.equal(root.querySelector('.ev-screenshot-pending'), null, 'placeholder is chrome — not saved');
  const img = root.querySelector('.ev-screenshot img');
  assert.ok(img && img.getAttribute('src').startsWith('data:image/png;base64,'), 'the screenshot itself is saved');
});
