import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createTestDocument } from '../scripts/create-test-document.js';

// 0105 follow-up: the file row carries a "• " list marker as the row's first
// inline box (.ev-file::before, outside the underlined link per 0075/0076).
// That marker can never sit before an IN-FLOW handle, so the file handle is
// pinned out of flow in the gutter like the code and url handles — and must
// still land flush with the row's left edge, exactly like every other leaf
// row's handle. jsdom cannot evaluate layout; run under headless Chromium
// via CDP (`npm run test:chromium:file-handle`).

const fixtureDir = createTestDocument(mkdtempSync(join(tmpdir(), 'test-evidence-fixture-')));
const appPath = join(fixtureDir, 'index.html');

function chromiumEndpoint(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chromium did not expose DevTools')), 10_000);
    child.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== null) reject(new Error(`Chromium exited before DevTools started (${code})`));
    });
  });
}

function cdpClient(endpoint) {
  const socket = new WebSocket(endpoint);
  const pending = new Map();
  let nextId = 0;
  const ready = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  return {
    async send(method, params = {}) {
      await ready;
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function pageEndpoint(browserEndpoint) {
  const browserUrl = new URL(browserEndpoint);
  const response = await fetch(`http://${browserUrl.host}/json/list`);
  if (!response.ok) throw new Error(`Chromium target listing failed (${response.status})`);
  const targets = await response.json();
  const page = targets.find((target) => target.type === 'page');
  if (!page || !page.webSocketDebuggerUrl) throw new Error('Chromium did not expose a page target');
  return page.webSocketDebuggerUrl;
}

const evaluate = (client, fn) => client.send('Runtime.evaluate', {
  expression: `(${fn.toString()})()`,
  returnByValue: true,
  awaitPromise: true,
}).then((result) => {
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'Browser evaluation failed',
    );
  }
  return result.result.value;
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const child = spawn('chromium', [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--remote-debugging-port=0',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'test-evidence-file-handle-'))}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

try {
  const browserEndpoint = await chromiumEndpoint(child);
  const client = cdpClient(await pageEndpoint(browserEndpoint));
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: `file://${appPath}` });
  await wait(300);

  const rows = await evaluate(client, async () => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const files = [...document.querySelectorAll('#evidence .ev-file')];
      if (files.length && files.every((row) => row.querySelector(':scope > .ev-drag-handle'))) break;
      if (Date.now() > deadline) throw new Error('file rows did not appear');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    return [...document.querySelectorAll(
      '#evidence .ev-title, #evidence .ev-comment, #evidence .ev-code, ' +
      '#evidence .ev-property, #evidence .ev-file, #evidence .ev-url, #evidence .ev-shot-row',
    )].map((row) => {
      const handle = row.querySelector(':scope > .ev-drag-handle');
      if (!handle) return null;
      const rowBox = row.getBoundingClientRect();
      const handleBox = handle.getBoundingClientRect();
      return {
        kind: row.tagName.toLowerCase() + '.' + row.classList[0],
        leftOffset: Math.round((handleBox.left - rowBox.left) * 100) / 100,
        topOffset: Math.round((handleBox.top - rowBox.top) * 100) / 100,
      };
    }).filter(Boolean);
  });

  const fileRows = rows.filter((row) => row.kind === 'div.ev-file');
  assert.ok(fileRows.length, 'the fixture contains at least one file row');
  for (const row of rows) {
    assert.equal(
      row.leftOffset, 0,
      `${row.kind} drag handle is flush with the row's left edge, got ${row.leftOffset}px`,
    );
  }
  for (const row of fileRows) {
    assert.equal(
      row.topOffset, 0,
      `file row drag handle is flush with the row's top edge, got ${row.topOffset}px`,
    );
  }

  client.close();
  console.log(`ok — ${rows.length} leaf row handles flush with their rows; ` +
    `file row handle at (0, ${fileRows[0].topOffset})`);
} finally {
  child.kill();
  rmSync(fixtureDir, { recursive: true, force: true });
}
