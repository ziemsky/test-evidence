import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appPath = fileURLToPath(new URL('../index.html', import.meta.url));
const userDataDir = mkdtempSync(join(tmpdir(), 'test-evidence-status-chromium-'));
const child = spawn('chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${userDataDir}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

function chromiumEndpoint() {
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

async function main() {
  const endpoint = new URL(await chromiumEndpoint());
  const targets = await (await fetch(`http://${endpoint.host}/json/list`)).json();
  const target = targets.find((entry) => entry.type === 'page');
  assert.ok(target?.webSocketDebuggerUrl, 'Chromium exposes a page target');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const pending = new Map();
  let nextId = 0;
  socket.onmessage = (event) => {
    const response = JSON.parse(event.data);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error) request.reject(new Error(response.error.message));
    else request.resolve(response.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (fn) => {
    const result = await send('Runtime.evaluate', {
      expression: `(${fn.toString()})()`, returnByValue: true, awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  };

  try {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 600, deviceScaleFactor: 1, mobile: false,
    });
    await send('Page.navigate', { url: `file://${appPath}` });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const result = await evaluate(() => {
      const logs = [];
      const originalLog = window.console.log;
      window.console.log = (...parts) => logs.push(parts.join(' '));
      const absentBeforeOperation = document.getElementById('operation-status') === null &&
        document.getElementById('mode-indicator') === null && document.getElementById('save-status') === null;
      const saveLabel = document.getElementById('save-btn').textContent;
      document.getElementById('save-btn').click();
      const absentAfterOperation = document.getElementById('operation-status') === null &&
        document.getElementById('mode-indicator') === null && document.getElementById('save-status') === null;
      window.console.log = originalLog;
      return {
        absentBeforeOperation,
        absentAfterOperation,
        logs,
        saveLabel,
      };
    });
    assert.equal(result.absentBeforeOperation, true);
    assert.equal(result.absentAfterOperation, true);
    assert.equal(result.logs.length, 2);
    assert.match(result.logs[0], /^Operation started: Save$/);
    assert.match(result.logs[1], /^Operation finished: Save — success — Downloaded /);
    assert.equal(result.saveLabel, 'Save');
    console.log('Chromium bottom status removal check passed');
  } finally {
    socket.close();
  }
}

try {
  await main();
} finally {
  child.kill();
  rmSync(userDataDir, { recursive: true, force: true });
}
