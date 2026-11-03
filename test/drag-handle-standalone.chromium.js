import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createTestDocument } from '../scripts/create-test-document.js';

// 0105 follow-up: in the populated fixture the third screenshot is authored
// standalone. A standalone shot in a row is a CSS GRID container whose
// image and drag handle share one grid area, so the handle's top/left inset
// resolves against the GRID AREA, not the item's padding box. The handle
// must still sit 2px inside the image's rendered top-left corner. This is a
// real-layout check: jsdom cannot evaluate grid geometry.
// Run with `npm run test:chromium:handles`; the jsdom suite stays portable.

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
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'test-evidence-handles-'))}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

try {
  const browserEndpoint = await chromiumEndpoint(child);
  const client = cdpClient(await pageEndpoint(browserEndpoint));
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 500,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: `file://${appPath}` });
  await wait(300);

  const handles = await evaluate(client, async () => {
    // Wait until all three fixture images have rendered.
    const deadline = Date.now() + 10_000;
    for (;;) {
      const shots = [...document.querySelectorAll('#evidence .ev-screenshot')];
      if (shots.length >= 3 && shots.every((s) => {
        const image = s.querySelector('img');
        return image && image.complete && image.naturalWidth > 0;
      })) break;
      if (Date.now() > deadline) throw new Error('fixture screenshots did not render');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Let load handlers and a paint settle.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    return [...document.querySelectorAll('#evidence .ev-screenshot')].map((shot, index) => {
      const image = shot.querySelector(':scope > img.ev-img').getBoundingClientRect();
      const handle = shot.querySelector(':scope > .ev-drag-handle').getBoundingClientRect();
      return {
        index: index + 1,
        standalone: shot.hasAttribute('data-standalone'),
        leftOffset: handle.left - image.left,
        topOffset: handle.top - image.top,
      };
    });
  });

  assert.equal(handles.length, 3, 'the fixture has three screenshots');
  assert.equal(handles[2].standalone, true, 'the third fixture screenshot is standalone');
  for (const shot of handles) {
    assert.ok(
      Math.abs(shot.leftOffset - 2) < 1 && Math.abs(shot.topOffset - 2) < 1,
      `screenshot ${shot.index} (standalone=${shot.standalone}) handle is 2px inside the image top-left corner, got (${shot.leftOffset}, ${shot.topOffset})`,
    );
  }

  client.close();
  console.log('ok — fixture drag handles align to the image top-left corner');
} finally {
  child.kill();
  rmSync(fixtureDir, { recursive: true, force: true });
}
