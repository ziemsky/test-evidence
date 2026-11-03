import test from 'node:test';
import assert from 'node:assert/strict';
import { appSource, createFileSystemEnv, dispatchContextMenu, loadApp, waitFor } from './helpers.js';

const NON_CHROMIUM_DOCUMENT = `<!doctype html>
<html><head><title>Test Evidence</title></head><body>
<main id="evidence">
  <h1 class="ev-doc-title"><span class="ev-doc-title-text">Review</span></h1>
  <section class="ev-section">
    <h2 class="ev-title"><span class="ev-title-text">Checkout</span></h2>
    <div class="ev-body">
      <div class="ev-file"><a href="assets/report.pdf">report.pdf</a></div>
      <div class="ev-shot-row">
        <div class="ev-screenshot"><img class="ev-img" src="assets/shot.png" alt=""></div>
      </div>
      <div class="ev-shot-row">
        <div class="ev-screenshot"><img class="ev-img" src="data:image/png;base64,AA==" alt=""></div>
      </div>
    </div>
  </section>
</main>
</body></html>`;

function unsupportedBrowserApp() {
  const alerts = [];
  const template = appSource();
  const templateRoot = '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>';
  const app = loadApp(template.replace(templateRoot, NON_CHROMIUM_DOCUMENT.match(/<main id="evidence">[\s\S]*?<\/main>/)[0]), {
    fileSystemAccess: false,
    beforeParse(window) {
      window.alert = (message) => alerts.push(message);
    },
  });
  return { ...app, alerts };
}

test('unsupported browser warns on start and disables save with a useful tooltip', () => {
  const { document, window, alerts, downloads } = unsupportedBrowserApp();
  const save = document.getElementById('save-btn');

  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /saving changes.+Chromium/i);
  assert.equal(save.disabled, true);
  assert.match(save.title, /Chromium/i);
  save.click();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  assert.equal(downloads.length, 0, 'a disabled Save action does not silently download a copy');
});

test('declining the folder picker in a supported browser keeps download fallback available', async () => {
  const fs = createFileSystemEnv();
  const { document, downloads } = loadApp(undefined, { fs });
  fs.env.declineNextPicker = true;
  const save = document.getElementById('save-btn');
  const addScreenshot = document.querySelector('[data-action="add-screenshot"]');

  assert.equal(save.disabled, false);
  assert.equal(addScreenshot.disabled, false);
  save.click();
  await waitFor(() => downloads.some((entry) => entry.name));

  assert.equal(fs.env.pickerCalls.length, 1);
  assert.equal(save.disabled, false, 'the supported browser may still download after declining the picker');
  assert.equal(addScreenshot.disabled, false, 'screenshot capture remains available in download fallback');
});

test('unsupported browsers disable screenshot and filesystem dependent controls with tooltips', () => {
  const { document, window } = unsupportedBrowserApp();
  const addScreenshotButtons = document.querySelectorAll('[data-action="add-screenshot"]');
  assert.ok(addScreenshotButtons.length >= 2, 'the end toolbox and section toolbox expose + screenshot');
  for (const button of addScreenshotButtons) {
    assert.equal(button.disabled, true);
    assert.match(button.title, /Adding screenshots requires File System Access/);
  }
  document.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'o', ctrlKey: true, bubbles: true,
  }));
  assert.equal(document.querySelector('.ev-screenshot-pending'), null, 'Ctrl+O cannot bypass the disabled button');

  const addFileButtons = document.querySelectorAll('[data-action="add-file"]');
  assert.ok(addFileButtons.length >= 2, 'the end toolbox and file row toolbox expose + file');
  for (const button of addFileButtons) {
    assert.equal(button.disabled, true);
    assert.match(button.title, /File attachments require File System Access/);
  }

  const fileRow = document.querySelector('.ev-file');
  const rename = fileRow.querySelector('[data-action="rename-file"]');
  const deleteFile = fileRow.querySelector('[data-action="delete"]');
  assert.equal(rename.disabled, true);
  assert.match(rename.title, /Renaming requires File System Access/);
  assert.equal(deleteFile.disabled, true);
  assert.match(deleteFile.title, /Deleting attachments requires File System Access/);

  const screenshots = document.querySelectorAll('.ev-screenshot');
  const assetCopy = screenshots[0].querySelector('[data-action="copy"]');
  const inlineCopy = screenshots[1].querySelector('[data-action="copy"]');
  assert.equal(assetCopy.disabled, true);
  assert.match(assetCopy.title, /Copying this screenshot requires File System Access/);
  assert.equal(inlineCopy.disabled, false, 'copying an inline screenshot does not need disk access');
});

test('the shared toolbox updates disabled states for the selected file and asset screenshot', () => {
  const { document, window } = unsupportedBrowserApp();
  const fileRow = document.querySelector('.ev-file');
  dispatchContextMenu(window, fileRow.querySelector('a'));

  let palette = document.querySelector('#evidence > .ev-section-palette');
  assert.equal(palette.querySelector('[data-action="delete"]').disabled, true);
  assert.match(palette.querySelector('[data-action="delete"]').title, /Deleting attachments requires File System Access/);

  const assetScreenshot = document.querySelector('.ev-screenshot');
  dispatchContextMenu(window, assetScreenshot.querySelector('img'));
  palette = document.querySelector('#evidence > .ev-section-palette');
  assert.equal(palette.querySelector('[data-action="copy"]').disabled, true);
  assert.match(palette.querySelector('[data-action="copy"]').title, /Copying this screenshot requires File System Access/);
});
