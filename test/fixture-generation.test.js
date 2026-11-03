import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { appSource, loadApp } from './helpers.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const expectedAssets = [
  'example-ers1234-shortlist-after.svg',
  'example-ers1234-shortlist-audit.svg',
  'example-ers1234-shortlist-response.json',
  'example-ers1234-shortlist.svg',
];

test('the fixture command creates a populated HTML document with real assets beside it', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'test-evidence-fixture-'));
  try {
    const run = spawnSync(process.execPath, ['scripts/create-test-document.js', output], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);

    const html = readFileSync(path.join(output, 'index.html'), 'utf8');
    const saved = new JSDOM(html).window.document;
    const assetsDir = path.join(output, 'assets');
    assert.deepEqual(readdirSync(assetsDir).sort(), expectedAssets);
    assert.equal(saved.querySelectorAll('#evidence .ev-section').length, 16);
    assert.equal(saved.querySelectorAll('#evidence .ev-screenshot').length, 3);
    assert.equal(saved.getElementById('example-btn'), null);
    assert.equal(saved.getElementById('example-menu'), null);
    for (const image of saved.querySelectorAll('#evidence img')) {
      assert.ok(image.getAttribute('src').startsWith('assets/'));
      assert.ok(existsSync(path.join(output, image.getAttribute('src'))));
    }
    for (const link of saved.querySelectorAll('#evidence .ev-file > a')) {
      assert.ok(existsSync(path.join(output, link.getAttribute('href'))));
    }
    assert.ok(readFileSync(path.join(assetsDir, 'example-ers1234-shortlist-response.json'), 'utf8').includes('"outcome": "passed"'));

    const opened = loadApp(html).document;
    assert.equal(opened.querySelectorAll('#evidence .ev-section').length, 16);
    assert.ok(opened.querySelector('#evidence .ev-screenshot .ev-controls'));
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('the shipped document boots empty and carries no sample content or Examples menu', () => {
  const source = appSource();
  const opened = loadApp(source).document;
  assert.equal(opened.querySelectorAll('#evidence .ev-section').length, 0);
  assert.equal(opened.getElementById('example-btn'), null);
  assert.equal(opened.getElementById('example-menu'), null);
  assert.equal(source.includes('ERS-1234'), false);
});

test('the fixture command refuses to overwrite the tracked index.html', () => {
  const before = appSource();
  const run = spawnSync(process.execPath, ['scripts/create-test-document.js', '.'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Choose an output directory other than the project root/);
  assert.equal(appSource(), before);
});
