import { latestOperationResult } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sectionAction,
  loadApp,
  addFirstSection,
  appSource,
  createFileSystemEnv,
  downloadText,
  assertCaretAtEnd,
} from './helpers.js';

function sectionActions(section) {
  return [...section.ownerDocument.querySelector('#evidence > .ev-section-palette').querySelectorAll(':scope > button')]
    .map((button) => button.dataset.action);
}

function copyElement(section) {
  sectionAction(section, 'copy-element').click();
}

function pasteAfter(section) {
  sectionAction(section, 'paste-after').click();
}

function nativeClipboardData() {
  const values = new Map();
  return {
    types: [],
    setData(type, value) {
      values.set(type, value);
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData(type) {
      return values.get(type) || '';
    },
  };
}

function runNativeCopy(window) {
  const clipboardData = nativeClipboardData();
  window.document.execCommand = () => {
    const event = new window.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    window.document.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return clipboardData;
}

function runNativePaste(window, clipboardData) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  window.document.dispatchEvent(event);
  return event;
}

test('sections expose copy element and paste after creates a focused sibling subtree', () => {
  const { document } = loadApp();
  const source = addFirstSection(document);
  source.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Source';
  sectionAction(source, 'add-subsection').click();
  const child = source.querySelector(':scope > .ev-body > .ev-section');
  child.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Child';

  assert.deepEqual(sectionActions(source).slice(-5), ['copy', 'copy-element', 'paste-after', 'paste-here', 'delete']);
  copyElement(source);

  assert.ok(sectionAction(source, 'paste-after'));
  assert.ok(sectionAction(source, 'paste-here'));
  pasteAfter(source);

  const copies = [...document.querySelectorAll('#evidence > .ev-section')];
  assert.equal(copies.length, 2);
  assert.equal(copies[1].querySelector(':scope > .ev-title > .ev-title-text').textContent, 'Source');
  assert.equal(copies[1].querySelector(':scope > .ev-body > .ev-section > .ev-title > .ev-title-text').textContent, 'Child');
  assert.notEqual(copies[1], source);
  assert.notEqual(copies[1].querySelector(':scope > .ev-body > .ev-section'), child);
  assert.equal(document.activeElement, copies[1].querySelector(':scope > .ev-title > .ev-title-text'));
  assertCaretAtEnd(copies[1].querySelector(':scope > .ev-title > .ev-title-text'));
  assert.match(latestOperationResult(document).message, /^Pasted section \d{2}:\d{2}:\d{2}$/);
});

test('section copy and paste consumes one armed target without async clipboard reads', async () => {
  const sourceApp = loadApp();
  const sourceClipboard = runNativeCopy(sourceApp.window);
  const source = addFirstSection(sourceApp.document);
  source.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'External section';
  sectionAction(source, 'add-comment').click();
  source.querySelector('.ev-comment-text').textContent = 'section content';
  copyElement(source);

  const destinationApp = loadApp();
  let reads = 0;
  destinationApp.window.navigator.clipboard = {
    read() { reads++; return Promise.reject(new Error('async read must not run')); },
    readText() { reads++; return Promise.reject(new Error('async read must not run')); },
  };
  const destination = addFirstSection(destinationApp.document);
  pasteAfter(destination);
  const palette = destinationApp.document.querySelector('#evidence > .ev-section-palette');
  assert.equal(palette.querySelector('[data-action="paste-after"]').getAttribute('data-clipboard-target'), 'paste-after');
  assert.match(latestOperationResult(destinationApp.document).message, /Ctrl\/Cmd\+V/);

  runNativePaste(destinationApp.window, sourceClipboard);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(destinationApp.document.querySelectorAll('#evidence > .ev-section').length, 2);
  const pasted = destinationApp.document.querySelectorAll('#evidence > .ev-section')[1];
  assert.equal(pasted.querySelector(':scope > .ev-title > .ev-title-text').textContent, 'External section');
  assert.equal(pasted.querySelector('.ev-comment-text').textContent, 'section content');
  assert.equal(palette.querySelector('[data-action="paste-after"]').hasAttribute('data-clipboard-target'), false);
  assert.equal(reads, 0);

  runNativePaste(destinationApp.window, sourceClipboard);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(destinationApp.document.querySelectorAll('#evidence > .ev-section').length, 2);
  assert.equal(reads, 0);
});

test('a local section snapshot is consumed once so the next target accepts external content', async () => {
  const sourceApp = loadApp();
  const sourceClipboard = runNativeCopy(sourceApp.window);
  const source = addFirstSection(sourceApp.document);
  source.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'External section';
  copyElement(source);

  const destinationApp = loadApp();
  const local = addFirstSection(destinationApp.document);
  local.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Local section';
  sectionAction(destinationApp.document, 'add-section').click();
  const externalTarget = [...destinationApp.document.querySelectorAll('#evidence > .ev-section')].at(-1);
  externalTarget.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'External target';
  copyElement(local);

  pasteAfter(local);
  assert.equal(destinationApp.document.querySelectorAll('#evidence > .ev-section').length, 3);
  assert.equal(destinationApp.document.querySelectorAll('[data-clipboard-source]').length, 0);

  pasteAfter(externalTarget);
  assert.equal(destinationApp.document.querySelectorAll('#evidence > .ev-section').length, 3,
    'a consumed local snapshot is not pasted a second time');
  assert.equal(sectionAction(externalTarget, 'paste-after').getAttribute('data-clipboard-target'), 'paste-after');

  runNativePaste(destinationApp.window, sourceClipboard);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(destinationApp.document.querySelectorAll('#evidence > .ev-section').length, 4);
  assert.equal(externalTarget.nextElementSibling.querySelector(':scope > .ev-title > .ev-title-text').textContent, 'External section');
});

test('a section snapshot preserves mixed order, authored data, assets, and presentation state', () => {
  const source = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>
      <section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Mixed</span></h2>
        <div class="ev-body">
          <div class="ev-comment"><span class="ev-comment-text">first\ncomment</span></div>
          <div class="ev-shot-row" data-valign="middle" data-halign="center">
            <div class="ev-screenshot" data-size="custom" data-width="480" data-standalone=""><img class="ev-img" style="width: 480px" alt="shot alt" src="assets/shared.png"><span class="ev-caption">A screenshot</span></div>
          </div>
          <div class="ev-property"><span class="ev-prop-key">Key</span><span class="ev-sep">:</span><span class="ev-prop-value">Value</span></div>
          <div class="ev-code" data-soft-wrap=""><span class="ev-code-text">code\nline</span></div>
          <div class="ev-file"><a href="assets/shared.pdf">shared.pdf</a></div>
          <section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Nested</span></h2><div class="ev-body"></div></section>
        </div>
      </section></main>`,
  );
  const { document } = loadApp(source);
  const original = document.querySelector('#evidence > .ev-section');
  copyElement(original);
  pasteAfter(original);

  const copy = document.querySelectorAll('#evidence > .ev-section')[1];
  const body = copy.querySelector(':scope > .ev-body');
  assert.deepEqual(
    [...body.children].map((child) => child.className),
    ['ev-comment', 'ev-shot-row', 'ev-property', 'ev-code', 'ev-file', 'ev-section'],
  );
  assert.equal(body.querySelector(':scope > .ev-comment > .ev-comment-text').textContent, 'first\ncomment');
  const shotRow = body.querySelector(':scope > .ev-shot-row');
  assert.equal(shotRow.dataset.valign, 'middle');
  assert.equal(shotRow.dataset.halign, 'center');
  const shot = shotRow.querySelector(':scope > .ev-screenshot');
  assert.equal(shot.dataset.size, 'custom');
  assert.equal(shot.dataset.width, '480');
  assert.equal(shot.dataset.standalone, '');
  assert.equal(shot.querySelector(':scope > img').getAttribute('src'), 'assets/shared.png');
  assert.equal(shot.querySelector(':scope > img').style.width, '480px');
  assert.equal(shot.querySelector(':scope > .ev-caption').textContent, 'A screenshot');
  assert.equal(body.querySelector(':scope > .ev-code').dataset.softWrap, '');
  assert.equal(body.querySelector(':scope > .ev-file > a').getAttribute('href'), 'assets/shared.pdf');
  assert.equal(body.querySelector(':scope > .ev-section > .ev-title > .ev-title-text').textContent, 'Nested');
  assert.equal(copy.querySelectorAll(':scope > .ev-title > .ev-controls').length, 0);
  assert.equal(document.querySelectorAll('#evidence > .ev-section-palette').length, 1);
  assert.equal(copy.querySelectorAll(':scope > .ev-title > .ev-drag-handle').length, 1);
});

test('section pastes support section, leaf-row, and nested destinations', () => {
  const { document } = loadApp();
  const source = addFirstSection(document);
  source.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Copied';
  sectionAction(source, 'add-subsection').click();
  const sourceChild = source.querySelector(':scope > .ev-body > .ev-section');
  sourceChild.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Nested source';

  sectionAction(document, 'add-section').click();
  const target = [...document.querySelectorAll('#evidence > .ev-section')].at(-1);
  target.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Target';
  sectionAction(target, 'add-comment').click();
  const leaf = target.querySelector(':scope > .ev-body > .ev-comment');

  copyElement(source);
  sectionAction(leaf, 'paste-after').click();
  const leafCopy = leaf.nextElementSibling;
  assert.equal(leafCopy.matches('.ev-section'), true);
  assert.equal(leafCopy.querySelector(':scope > .ev-title > .ev-title-text').textContent, 'Copied');
  assert.equal(target.querySelectorAll(':scope > .ev-body > .ev-section').length, 1);

  copyElement(source);
  sectionAction(target, 'paste-here').click();
  const directChildren = [...target.querySelectorAll(':scope > .ev-body > .ev-section')];
  assert.equal(directChildren.length, 2);
  assert.ok(directChildren.every((section) => section.parentElement === target.querySelector(':scope > .ev-body')));
  assert.equal(document.activeElement, directChildren[1].querySelector(':scope > .ev-title > .ev-title-text'));

  const deepTarget = directChildren[1];
  copyElement(source);
  sectionAction(deepTarget, 'paste-here').click();
  const nestedTarget = deepTarget.querySelector(':scope > .ev-body > .ev-section');
  assert.equal(nestedTarget.querySelector(':scope > .ev-title > .ev-title-text').textContent, 'Nested source');
  copyElement(source);
  sectionAction(nestedTarget, 'paste-here').click();
  const deepCopy = nestedTarget.querySelector(':scope > .ev-body > .ev-section');
  assert.equal(deepCopy.querySelector(':scope > .ev-title > .ev-title-text').textContent, 'Copied');
  assert.equal(deepCopy.dataset.depth, '3', 'visual depth caps at three');
  assert.equal(deepCopy.querySelector(':scope > .ev-title > .ev-num').textContent, '2.2.1.1');
});

test('section clipboard supports leaf placement after file and screenshot rows', () => {
  const source = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>
      <section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Source</span></h2>
        <div class="ev-body">
          <div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="assets/shared.png"></div></div>
          <div class="ev-file"><a href="assets/shared.pdf">shared.pdf</a></div>
        </div>
      </section></main>`,
  );
  const { document } = loadApp(source);
  const section = document.querySelector('#evidence > .ev-section');
  copyElement(section);

  const shotRow = section.querySelector(':scope > .ev-body > .ev-shot-row');
  sectionAction(shotRow, 'paste-after').click();
  assert.equal(shotRow.nextElementSibling.matches('.ev-section'), true);

  const file = section.querySelector(':scope > .ev-body > .ev-file');
  copyElement(section);
  sectionAction(file, 'paste-after').click();
  assert.equal(file.nextElementSibling.matches('.ev-section'), true);
});

test('copying a section does not duplicate its physical asset references', () => {
  const fs = createFileSystemEnv();
  const source = appSource().replace(
    '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>',
    `<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1>
      <section class="ev-section"><h2 class="ev-title"><span class="ev-title-text">Assets</span></h2>
        <div class="ev-body">
          <div class="ev-shot-row"><div class="ev-screenshot"><img class="ev-img" src="assets/shared.png"></div></div>
          <div class="ev-file"><a href="assets/shared.pdf">shared.pdf</a></div>
        </div>
      </section></main>`,
  );
  const { document } = loadApp(source, { fs });
  const image = new document.defaultView.Blob(['image']);
  const file = new document.defaultView.Blob(['file']);
  fs.env.assetsFiles.set('shared.png', image);
  fs.env.assetsFiles.set('shared.pdf', file);
  const section = document.querySelector('#evidence > .ev-section');
  copyElement(section);
  sectionAction(section, 'paste-after').click();

  assert.equal(fs.env.assetsFiles.size, 2);
  assert.equal(fs.env.assetsFiles.get('shared.png'), image);
  assert.equal(fs.env.assetsFiles.get('shared.pdf'), file);
  assert.deepEqual(
    [...document.querySelectorAll('.ev-file > a')].map((link) => link.getAttribute('href')),
    ['assets/shared.pdf', 'assets/shared.pdf'],
  );
});

test('section and row copies replace one another in the single app clipboard', () => {
  const { document } = loadApp();
  const section = addFirstSection(document);
  sectionAction(section, 'add-comment').click();
  const comment = section.querySelector('.ev-comment');

  copyElement(section);
  assert.ok(sectionAction(section, 'paste-after'));
  copyElement(comment);
  assert.ok(sectionAction(section, 'paste-after'));
  assert.ok(sectionAction(section, 'paste-here'));

  sectionAction(comment, 'paste-after').click();
  assert.equal(comment.nextElementSibling.matches('.ev-comment'), true);
  copyElement(section);
  assert.ok(sectionAction(section, 'paste-after'));
});

test('empty sections require a new copy after the local snapshot is consumed', () => {
  const { document, window } = loadApp();
  const source = addFirstSection(document);
  source.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Original';
  copyElement(source);

  source.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Changed';
  window.confirm = () => true;
  sectionAction(source, 'delete').click();

  sectionAction(document, 'add-section').click();
  const empty = [...document.querySelectorAll('#evidence > .ev-section')].at(-1);
  sectionAction(empty, 'paste-here').click();
  sectionAction(empty, 'paste-here').click();

  const copies = [...empty.querySelectorAll(':scope > .ev-body > .ev-section')];
  assert.equal(copies.length, 1);
  assert.equal(copies[0].querySelector(':scope > .ev-title > .ev-title-text').textContent, 'Original');
  assert.equal(sectionAction(empty, 'paste-here').getAttribute('data-clipboard-target'), 'paste-here');
  assert.match(latestOperationResult(document).message, /Ctrl\/Cmd\+V/);
});

test('section pastes do not save automatically and persist as ordinary content after reload', async () => {
  const first = loadApp();
  const source = addFirstSection(first.document);
  source.querySelector(':scope > .ev-title > .ev-title-text').textContent = 'Persisted';
  sectionAction(source, 'add-comment').click();
  source.querySelector('.ev-comment-text').textContent = 'saved comment';
  copyElement(source);
  sectionAction(source, 'paste-after').click();

  assert.equal(first.downloads.length, 0, 'copy and paste do not save automatically');
  first.document.getElementById('save-btn').click();
  const savedText = await downloadText(first.downloads.find((download) => download.name));
  const saved = new JSDOM(savedText).window.document;
  assert.equal(saved.querySelectorAll('#evidence > .ev-section').length, 2);
  assert.equal(saved.querySelectorAll('[data-chrome]').length, 0);
  assert.equal(saved.querySelectorAll('[contenteditable]').length, 0);
  assert.equal(saved.querySelectorAll('[data-action="copy-element"]').length, 0);
  assert.equal(saved.querySelectorAll('.ev-comment-text').length, 2);

  const reopened = loadApp(savedText).document;
  assert.equal(reopened.querySelectorAll('#evidence > .ev-section').length, 2);
  assert.ok(sectionAction(reopened, 'paste-after'), 'reload retains a system paste target');
  assert.equal(reopened.querySelectorAll('.ev-comment-text')[1].textContent, 'saved comment');
});
