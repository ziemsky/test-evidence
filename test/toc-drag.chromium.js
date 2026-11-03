import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 0112 (SPEC §21): a dependency-free Chromium check for the TOC entry drag
// nesting zones — the pointer seam jsdom cannot reach (real layout,
// elementFromPoint, the drop line, the row wash, smooth-scroll navigation).
// Run with `npm run test:chromium:toc-drag`.
//
// Blocks:
//   A  the BEFORE zone (the left stack's top half): line above the row at its
//      own indent, the mapped drop, and the post-drag click suppression
//   B  a clean ≤4px click still navigates (smooth scroll)
//   Z0 the zone geometry: the right 33% is one inside band at any height, the
//      left 67% splits 50/50 at the row's mid-line
//   Z1 the INSIDE band (the row's right 33%) on a childless second-level entry:
//      wash + +1em-indented line, drop → last child
//   Z2 the AFTER zone (the left stack's bottom half): line below the row, drop → sibling-after
//   Z3 the tree ends: above the first row = top-level 1; below the last row
//      = after the last top-level section
//   C  panel auto-scroll at the tree scrollport edges; Esc cancels
//   D  the cycle rule in every zone: no line, no wash, release cancels
//   F  a release outside the tree cancels (the line and wash disappear first)
//   E  a save carries no TOC markup and no drag state

const appPath = fileURLToPath(new URL('../index.html', import.meta.url));

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
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'test-evidence-toc-drag-'))}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const userDataDir = child.spawnargs.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);

try {
  const browserEndpoint = await chromiumEndpoint(child);
  const client = cdpClient(await pageEndpoint(browserEndpoint));
  try {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 500,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send('Page.navigate', { url: `file://${appPath}` });
    await wait(300);

    // Shared in-page helpers. Each block's evaluate is a fresh function, so
    // the helpers live on window once; the fixture is deep enough (25
    // sections) to fill the tree's scrollport, and the two real moves stamp
    // the chrome (renumber + TOC).
    await evaluate(client, () => {
      window.__td = {
        wait: (ms) => new Promise((r) => setTimeout(r, ms)),
        pointer: (type, target, x, y, pointerId) => target.dispatchEvent(new PointerEvent(type, {
          pointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
          clientX: x, clientY: y, bubbles: true, cancelable: true,
        })),
        center: (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }),
        entryByNum: (prefix) => [...document.querySelectorAll('#toc-tree [data-action="toc-goto"]')]
          .find((e) => e.textContent.trim().startsWith(prefix)),
        sectionTitles: () => [...document.querySelectorAll('#evidence .ev-section')]
          .map((s) => s.querySelector(':scope > .ev-title > .ev-title-text').textContent),
        buildFixture: async () => {
          const evidence = document.getElementById('evidence');
          const sec = (t) => '<section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">' + t + '</span></h2><div class="ev-body"></div></section>';
          const a2 = '<section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">A2</span></h2><div class="ev-body">' + sec('A21') + '</div></section>';
          const a = '<section class="ev-section"><h2 class="ev-title"><span class="ev-text ev-title-text">A</span></h2><div class="ev-body">' + sec('A1') + a2 + sec('A3') + '</div></section>';
          let inner = '<h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text">CDP doc</span></h1>' + a;
          for (let i = 1; i <= 20; i++) inner += sec('B' + i);
          evidence.innerHTML = inner;
          window.__evidence.moveElement(evidence.querySelector(':scope > .ev-section'), evidence, null);
          const lastNow = [...evidence.querySelectorAll(':scope > .ev-section')].pop();
          window.__evidence.moveElement(lastNow, evidence, evidence.querySelector(':scope > .ev-section'));
          await window.__td.wait(50);
        },
      };
      return true;
    });

    // Block A — the BEFORE zone: dim, line above the row at the row's own
    // indent (no wash), the mapped drop, and the post-drag click
    // suppression.
    const drag = await evaluate(client, async () => {
      const { wait, pointer, center, entryByNum, sectionTitles } = window.__td;
      await window.__td.buildFixture();

      const entryCount = document.querySelectorAll('#toc-tree [data-action="toc-goto"]').length;
      const entryA2 = entryByNum('1.2 ');
      const entryA1 = entryByNum('1.1 ');
      const start = center(entryA2.getBoundingClientRect());

      pointer('pointerdown', entryA2, start.x, start.y, 11);
      pointer('pointermove', document, start.x + 2, start.y + 2, 11);
      const underThreshold = !entryA2.classList.contains('ev-dragging') &&
        !document.body.classList.contains('ev-dragging-active');
      pointer('pointermove', document, start.x + 20, start.y + 20, 11);
      const entryDimmed = entryA2.classList.contains('ev-dragging');
      const documentDimmed = document.getElementById('evidence').querySelectorAll('.ev-section.ev-dragging').length;

      // the BEFORE zone of 1.1 (A1): the line above the row, at the row's own indent
      const r1 = entryA1.getBoundingClientRect();
      pointer('pointermove', document, r1.left + 20, r1.top + 2, 11);
      const line = document.querySelector('.ev-drop-line');
      const lineInTree = !!line && line.closest('#toc-tree') === document.getElementById('toc-tree');
      const lineInDocument = !!line && line.closest('#evidence') !== null;
      const lineAtRowTop = !!line &&
        Math.abs(line.getBoundingClientRect().top - r1.top) < 4 &&
        parseFloat(getComputedStyle(line).marginLeft) === 0;
      const noWashInTopZone = document.querySelectorAll('#toc-tree .toc-drop-wash').length === 0;

      pointer('pointerup', document, r1.left + 20, r1.top + 2, 11);
      const order = sectionTitles();
      const nums = [...document.querySelectorAll('.ev-num')].map((n) => n.textContent);
      const tocTexts = [...document.querySelectorAll('#toc-tree [data-action="toc-goto"]')]
        .map((e) => e.textContent.trim());
      const lineGoneAfterDrop = document.querySelector('.ev-drop-line') === null;

      // the release click of the completed drag must not navigate
      window.scrollTo(0, 0);
      await wait(30);
      const deepEntry = entryByNum('10 ');
      deepEntry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(80);
      const clickSuppressed = window.scrollY === 0;
      const entryNotDimmedAtRest = document.querySelector('#toc-tree .ev-dragging') === null;

      return {
        entryCount, underThreshold, entryDimmed, documentDimmed,
        lineInTree, lineInDocument, lineAtRowTop, noWashInTopZone,
        order: order.slice(0, 6), nums: nums.slice(0, 6), tocTexts: tocTexts.slice(0, 6),
        lineGoneAfterDrop, clickSuppressed, entryNotDimmedAtRest,
      };
    });
    assert.equal(drag.entryCount, 25, 'one entry per section at any depth');
    assert.equal(drag.underThreshold, true, 'a ≤4px press never starts the drag');
    assert.equal(drag.entryDimmed, true, 'the entry dims');
    assert.equal(drag.documentDimmed, 0, 'the document section never dims');
    assert.equal(drag.lineInTree, true, 'the drop line renders in the tree');
    assert.equal(drag.lineInDocument, false, '…and never in the document');
    assert.equal(drag.lineAtRowTop, true, '…above the row at the row\'s own indent (no child indent)');
    assert.equal(drag.noWashInTopZone, true, 'no wash in the before zone');
    assert.deepEqual(drag.order, ['A', 'A2', 'A21', 'A1', 'A3', 'B1'], 'A2 re-nested before A1');
    assert.deepEqual(drag.nums, ['1', '1.1', '1.1.1', '1.2', '1.3', '2'], 'numbers recomputed');
    assert.deepEqual(drag.tocTexts, ['1 A', '1.1 A2', '1.1.1 A21', '1.2 A1', '1.3 A3', '2 B1'], 'TOC re-rendered live');
    assert.equal(drag.lineGoneAfterDrop, true, 'the line is removed by the drop');
    assert.equal(drag.clickSuppressed, true, 'the drag release does not navigate');
    assert.equal(drag.entryNotDimmedAtRest, true, 'no dim remains at rest');

    // Block B — a clean ≤4px click still navigates (smooth scroll), and the
    // post-drag suppression did not linger.
    const navigate = await evaluate(client, async () => {
      const { wait, pointer, center, entryByNum } = window.__td;
      await window.__td.buildFixture();

      window.scrollTo(0, 0);
      await wait(50);
      const entryB9 = entryByNum('10 ');
      const b9 = [...document.querySelectorAll('#evidence .ev-section')]
        .find((s) => s.querySelector(':scope > .ev-title > .ev-title-text').textContent === 'B9');
      const belowFoldBefore = b9.getBoundingClientRect().top > window.innerHeight;
      const s = center(entryB9.getBoundingClientRect());
      pointer('pointerdown', entryB9, s.x, s.y, 12);
      pointer('pointerup', entryB9, s.x, s.y, 12);
      entryB9.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(700); // the smooth scroll settles
      const rect = b9.getBoundingClientRect();
      return {
        belowFoldBefore,
        scrolled: window.scrollY > 0,
        visible: rect.top >= -1 && rect.top < window.innerHeight,
        noDragArmed: document.querySelector('.ev-dragging') === null,
      };
    });
    assert.equal(navigate.belowFoldBefore, true, 'the target section starts below the fold');
    assert.equal(navigate.scrolled, true, 'the click scrolls the page');
    assert.equal(navigate.visible, true, '…to the section (smooth scroll)');
    assert.equal(navigate.noDragArmed, true, 'a ≤4px click arms no drag');

    // Block Z1 — the INSIDE band on a CHILDLESS second-level entry shows the
    // wash + the +1em-indented line; the drop makes the dragged section the
    // target's last child.
    const middleZone = await evaluate(client, async () => {
      const { wait, pointer, center, entryByNum, sectionTitles } = window.__td;
      await window.__td.buildFixture();

      // drag 1.3 (A3) onto the INSIDE band (the row's right 33%) of 1.1
      // (A1 — childless)
      const entryA3 = entryByNum('1.3 ');
      const entryA1 = entryByNum('1.1 ');
      const start = center(entryA3.getBoundingClientRect());
      pointer('pointerdown', entryA3, start.x, start.y, 21);
      pointer('pointermove', document, start.x + 15, start.y + 15, 21); // cross the 4px threshold
      const r1 = entryA1.getBoundingClientRect();
      const midY = r1.top + r1.height / 2;
      const insideX = r1.right - 20; // the right-hand band → inside
      pointer('pointermove', document, insideX, midY, 21);

      const line = document.querySelector('.ev-drop-line');
      const washed = [...document.querySelectorAll('#toc-tree .toc-drop-wash')];
      const washOnA1 = washed.length === 1 && washed[0] === entryA1;
      const washIsChrome = washOnA1 && entryA1.hasAttribute('data-chrome');
      // the wash is the row's ::after band — it carries the focus treatment
      // (the quiet surface + the blue inset edge) and starts at the same 67%
      // boundary the zone math uses
      const washBand = washOnA1 ? getComputedStyle(entryA1, '::after') : null;
      const washLook = !!washBand &&
        washBand.boxShadow.includes('rgba(0, 120, 215') &&
        washBand.backgroundColor.includes('rgba(128, 128, 128');
      const washBandIsInsideZone = !!washBand &&
        Math.abs(parseFloat(washBand.left) - 0.67 * r1.width) < 1 &&
        washBand.right === '0px' && washBand.top === '0px' && washBand.bottom === '0px';
      const lineInTree = !!line && line.closest('#toc-tree') === document.getElementById('toc-tree');
      const lineJustBelowRow = !!line &&
        Math.abs(line.getBoundingClientRect().top - r1.bottom) < 4;
      // the line's indent is the CHILD level: A1 sits at 1em of the entry
      // font, so +1em = 2em of it (the line mirrors the row's used font)
      const lineAtChildIndent = !!line &&
        Math.abs(parseFloat(getComputedStyle(line).marginLeft) -
          2 * parseFloat(getComputedStyle(entryA1).fontSize)) < 0.5;

      pointer('pointerup', document, insideX, midY, 21);
      const order = sectionTitles();
      const nums = [...document.querySelectorAll('.ev-num')].map((n) => n.textContent);
      const tocTexts = [...document.querySelectorAll('#toc-tree [data-action="toc-goto"]')]
        .map((e) => e.textContent.trim());
      const chromeGone = document.querySelector('.ev-drop-line') === null &&
        document.querySelectorAll('#toc-tree .toc-drop-wash').length === 0;
      return {
        washOnA1, washIsChrome, washLook, washBandIsInsideZone, lineInTree, lineJustBelowRow, lineAtChildIndent,
        order: order.slice(0, 6), nums: nums.slice(0, 6), tocTexts: tocTexts.slice(0, 6),
        chromeGone,
      };
    });
    assert.equal(middleZone.washOnA1, true, 'the childless second-level row is washed (exactly one row)');
    assert.equal(middleZone.washIsChrome, true, 'the wash carries data-chrome');
    assert.equal(middleZone.washLook, true, 'the wash is the focus treatment (blue inset edge)');
    assert.equal(middleZone.washBandIsInsideZone, true, '…and it paints exactly the row\'s right 33% (the inside zone)');
    assert.equal(middleZone.lineInTree, true, 'the line renders in the tree');
    assert.equal(middleZone.lineJustBelowRow, true, '…just below the washed row');
    assert.equal(middleZone.lineAtChildIndent, true, '…indented +1em (the child level)');
    assert.deepEqual(middleZone.order, ['A', 'A1', 'A3', 'A2', 'A21', 'B1'], 'A3 (subtree) is A1\'s last child');
    assert.deepEqual(middleZone.nums, ['1', '1.1', '1.1.1', '1.2', '1.2.1', '2'], 'numbers recomputed');
    assert.deepEqual(middleZone.tocTexts, ['1 A', '1.1 A1', '1.1.1 A3', '1.2 A2', '1.2.1 A21', '2 B1'], 'TOC re-rendered live');
    assert.equal(middleZone.chromeGone, true, 'line and wash are removed by the drop');

    // Block Z2 — the AFTER zone shows the line below the row at the row's
    // own indent (no wash) and moves the section after the row in its own
    // parent.
    const bottomZone = await evaluate(client, async () => {
      const { pointer, center, entryByNum, sectionTitles } = window.__td;
      await window.__td.buildFixture();

      // drag 21 B20 (top level, childless) onto the BOTTOM of 3 B2
      const entryB20 = entryByNum('21 ');
      const entryB2 = entryByNum('3 ');
      const start = center(entryB20.getBoundingClientRect());
      pointer('pointerdown', entryB20, start.x, start.y, 22);
      pointer('pointermove', document, start.x + 15, start.y - 15, 22); // cross the threshold (up the list)
      const r2 = entryB2.getBoundingClientRect();
      const botY = r2.bottom - 2;
      pointer('pointermove', document, r2.left + 20, botY, 22);

      const line = document.querySelector('.ev-drop-line');
      const lineJustBelowRow = !!line &&
        Math.abs(line.getBoundingClientRect().top - r2.bottom) < 4;
      const lineAtRowIndent = !!line && parseFloat(getComputedStyle(line).marginLeft) === 0;
      const noWashInBottomZone = document.querySelectorAll('#toc-tree .toc-drop-wash').length === 0;

      pointer('pointerup', document, r2.left + 20, botY, 22);
      const order = sectionTitles();
      return {
        lineJustBelowRow, lineAtRowIndent, noWashInBottomZone,
        order: order.slice(0, 8),
      };
    });
    assert.equal(bottomZone.lineJustBelowRow, true, 'the line sits directly below the row');
    assert.equal(bottomZone.lineAtRowIndent, true, '…at the row\'s own indent (top level: 0)');
    assert.equal(bottomZone.noWashInBottomZone, true, 'no wash in the after zone');
    // document order: A's subtree (A1, A2, A21, A3) stands before B1
    assert.deepEqual(bottomZone.order, ['A', 'A1', 'A2', 'A21', 'A3', 'B1', 'B2', 'B20'], 'B20 moved after B2 (sibling-after)');

    // Block Z0 — the zone GEOMETRY: the row's right 33% is ONE inside band
    // spanning its whole height, and the left 67% splits 50/50 at the row's
    // mid-line (above = before, below = after). Hover only; Esc cancels.
    const geometry = await evaluate(client, async () => {
      const { wait, pointer, center, entryByNum } = window.__td;
      await window.__td.buildFixture();

      const entryB20 = entryByNum('21 ');
      const entryB2 = entryByNum('3 ');
      const start = center(entryB20.getBoundingClientRect());
      pointer('pointerdown', entryB20, start.x, start.y, 25);
      pointer('pointermove', document, start.x + 15, start.y - 15, 25);

      const r2 = entryB2.getBoundingClientRect();
      const bandX = r2.right - 20;                    // the right 33% band
      const stackX = r2.left + 20;                    // the left 67% stack
      const midY = r2.top + r2.height / 2;
      const line = () => document.querySelector('#toc-tree .ev-drop-line');
      const washed = () => document.querySelectorAll('#toc-tree .toc-drop-wash').length;
      const below = () => { const l = line(); return !!l && Math.abs(l.getBoundingClientRect().top - r2.bottom) < 4; };
      const above = () => { const l = line(); return !!l && Math.abs(l.getBoundingClientRect().top - r2.top) < 4; };
      // a top-level row sits at 0em, so the child level is +1em of its font
      const childIndent = () => { const l = line(); return !!l &&
        Math.abs(parseFloat(getComputedStyle(l).marginLeft) - parseFloat(getComputedStyle(entryB2).fontSize)) < 0.5; };
      const rowIndent = () => { const l = line(); return !!l && parseFloat(getComputedStyle(l).marginLeft) === 0; };

      // 1. the inside band at the row's very TOP edge — still "as a subsection"
      pointer('pointermove', document, bandX, r2.top + 2, 25);
      const insideAtRowTop = washed() === 1 && below() && childIndent();
      // 2. the inside band at the row's BOTTOM edge
      pointer('pointermove', document, bandX, r2.bottom - 2, 25);
      const insideAtRowBottom = washed() === 1 && below() && childIndent();
      // 3. just past the 67% boundary: inside
      pointer('pointermove', document, r2.left + 0.67 * r2.width + 0.5, midY, 25);
      const insideAtBoundary = washed() === 1 && below() && childIndent();
      // 3b. the band is wider than 0113's 25%: x = 70% of the row (left of the
      //     old 75% boundary) is inside now
      pointer('pointermove', document, r2.left + 0.70 * r2.width, midY, 25);
      const insideWhereOldStackWas = washed() === 1 && below() && childIndent();
      // 4. just left of that boundary, ON the mid-line: the after zone
      pointer('pointermove', document, r2.left + 0.67 * r2.width - 2, midY, 25);
      const afterOnMidLine = washed() === 0 && below() && rowIndent();
      // 5. just above the mid-line in the left stack: the before zone
      pointer('pointermove', document, stackX, midY - 2, 25);
      const beforeJustAboveMid = washed() === 0 && above() && rowIndent();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(20);
      return {
        insideAtRowTop, insideAtRowBottom, insideAtBoundary, insideWhereOldStackWas, afterOnMidLine, beforeJustAboveMid,
        clean: document.querySelector('.ev-drop-line') === null &&
          document.querySelectorAll('#toc-tree .toc-drop-wash').length === 0,
      };
    });
    assert.equal(geometry.insideAtRowTop, true, 'the inside band spans the row\'s whole height (its top edge included)');
    assert.equal(geometry.insideAtRowBottom, true, '…and its bottom edge is the same zone');
    assert.equal(geometry.insideAtBoundary, true, '…just past the 67% boundary is inside');
    assert.equal(geometry.insideWhereOldStackWas, true, '…and so is x = 70% — the band is 33% wide, not 25%');
    assert.equal(geometry.afterOnMidLine, true, 'just left of the boundary, on the mid-line, is the after zone');
    assert.equal(geometry.beforeJustAboveMid, true, 'just above the mid-line in the left stack is the before zone');
    assert.equal(geometry.clean, true, 'Esc leaves no line and no wash');

    // Block Z3 — the tree ends: above the first row is top-level position 1;
    // in the tree below the last row is after the last top-level section.
    const treeEnds = await evaluate(client, async () => {
      const { wait, pointer, center, entryByNum, sectionTitles } = window.__td;
      await window.__td.buildFixture();

      // 1. B20 → the before zone of the first row (1 A): top-level position 1
      const entryB20 = entryByNum('21 ');
      let start = center(entryB20.getBoundingClientRect());
      pointer('pointerdown', entryB20, start.x, start.y, 23);
      pointer('pointermove', document, start.x + 15, start.y - 15, 23);
      const first = entryByNum('1 ');
      const fr = first.getBoundingClientRect();
      pointer('pointermove', document, fr.left + 20, fr.top + 2, 23);
      const topLineAboveFirst = (() => {
        const line = document.querySelector('.ev-drop-line');
        return !!line && line.previousElementSibling === null &&
          Math.abs(line.getBoundingClientRect().top - fr.top) < 4;
      })();
      pointer('pointerup', document, fr.left + 20, fr.top + 2, 23);
      const orderTop = sectionTitles();

      // 2. A (now 2) → the band in the tree below the LAST row: after the
      //    last top-level section. The panel is the scrollport — scroll the
      //    last row into view first (a real drag gets there by auto-scroll).
      const entryA = entryByNum('2 ');
      document.getElementById('toc-panel').scrollTop = 1e9;
      await wait(30);
      start = center(entryA.getBoundingClientRect());
      pointer('pointerdown', entryA, start.x, start.y, 24);
      pointer('pointermove', document, start.x + 15, start.y + 15, 24);
      const entries = [...document.querySelectorAll('#toc-tree [data-action="toc-goto"]')];
      const lastEntry = entries[entries.length - 1];
      const lr = lastEntry.getBoundingClientRect();
      pointer('pointermove', document, lr.left + 20, lr.bottom + 4, 24); // the tree's own bottom padding
      const bottomLineBelowLast = (() => {
        const line = document.querySelector('.ev-drop-line');
        const tree = document.getElementById('toc-tree');
        return !!line && line.closest('#toc-tree') === tree &&
          line.previousElementSibling === lastEntry &&
          Math.abs(line.getBoundingClientRect().top - lr.bottom) < 4;
      })();
      pointer('pointerup', document, lr.left + 20, lr.bottom + 4, 24);
      const orderBottom = sectionTitles();
      const noWashAtEnds = document.querySelectorAll('#toc-tree .toc-drop-wash').length === 0;

      return {
        topLineAboveFirst, bottomLineBelowLast, noWashAtEnds,
        topStart: orderTop.slice(0, 3),
        bottomHead: orderBottom.slice(0, 3),
        bottomTail: orderBottom.slice(-7),
      };
    });
    assert.equal(treeEnds.topLineAboveFirst, true, 'the top end shows the line above the first row');
    assert.deepEqual(treeEnds.topStart, ['B20', 'A', 'A1'], 'B20 is top-level position 1');
    assert.equal(treeEnds.bottomLineBelowLast, true, 'the bottom end shows the line below the last row');
    assert.deepEqual(treeEnds.bottomHead, ['B20', 'B1', 'B2'], 'the head is unchanged');
    assert.deepEqual(treeEnds.bottomTail, ['B18', 'B19', 'A', 'A1', 'A2', 'A21', 'A3'], 'A (whole subtree) is the last top-level section');
    assert.equal(treeEnds.noWashAtEnds, true, 'no wash at the tree ends');

    // Block C — near the tree scrollport edges the PANEL scrolls (~12px per
    // tick); the page scroll is untouched. Esc cancels the drag cleanly.
    const autoScroll = await evaluate(client, async () => {
      const { wait, pointer, center } = window.__td;
      const panel = document.getElementById('toc-panel');
      const entries = [...document.querySelectorAll('#toc-tree [data-action="toc-goto"]')];

      const scrollable = panel.scrollHeight > panel.clientHeight;
      panel.scrollTop = 0;
      await wait(30);
      const start = center(entries[entries.length - 1].getBoundingClientRect());
      pointer('pointerdown', entries[entries.length - 1], start.x, start.y, 13);
      pointer('pointermove', document, start.x + 10, start.y + 10, 13);
      const rect = panel.getBoundingClientRect();
      const before = panel.scrollTop;
      const pageBefore = window.scrollY;
      // auto-scroll is event-driven: each move inside the 40px edge band is one
      // 12px step — a real drag generates these continuously
      for (let i = 0; i < 4; i++) {
        pointer('pointermove', document, rect.left + rect.width / 2 + i, rect.bottom - 10, 13);
        await wait(20);
      }
      const afterBottomEdge = panel.scrollTop;
      for (let i = 0; i < 4; i++) {
        pointer('pointermove', document, rect.left + rect.width / 2 + i, rect.top + 10, 13);
        await wait(20);
      }
      const afterTopEdge = panel.scrollTop;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const canceledClean = !document.querySelector('.ev-drop-line') &&
        !document.body.classList.contains('ev-dragging-active') &&
        !document.querySelector('.ev-dragging') &&
        document.querySelectorAll('#toc-tree .toc-drop-wash').length === 0;
      return {
        scrollable,
        bottomEdgeDelta: afterBottomEdge - before,
        topEdgeDelta: afterBottomEdge - afterTopEdge,
        pageUntouched: window.scrollY === pageBefore,
        canceledClean,
      };
    });
    assert.equal(autoScroll.scrollable, true, 'the tree scrollport overflows');
    assert.ok(autoScroll.bottomEdgeDelta >= 12, `bottom edge scrolled the panel (${autoScroll.bottomEdgeDelta}px)`);
    assert.ok(autoScroll.topEdgeDelta >= 12, `top edge scrolled it back (${autoScroll.topEdgeDelta}px)`);
    assert.equal(autoScroll.pageUntouched, true, 'the page scroll is untouched');
    assert.equal(autoScroll.canceledClean, true, 'Esc cancels the drag cleanly');

    // Block D — the cycle rule in every zone: over the dragged subtree the
    // line and the wash never appear; releasing there cancels (nothing moved).
    const cycleCancel = await evaluate(client, async () => {
      const { wait, pointer, center, entryByNum, sectionTitles } = window.__td;
      await window.__td.buildFixture();
      document.getElementById('toc-panel').scrollTop = 0;
      await wait(30);

      const entryA = entryByNum('1 ');
      const entryB1 = entryByNum('2 ');
      const entryA1 = entryByNum('1.1 ');
      const entryA21 = entryByNum('1.2.1 ');
      const entryA3 = entryByNum('1.3 ');
      const start = center(entryA.getBoundingClientRect());
      pointer('pointerdown', entryA, start.x, start.y, 14);
      pointer('pointermove', document, start.x + 15, start.y + 15, 14);

      const move = (r, x, y) => pointer('pointermove', document, x, y, 14);
      const stackX = (r) => r.left + 10;   // the left 67%: the before/after stack
      const bandX = (r) => r.right - 20;   // the right 33%: the inside band
      const lineShownAt = () => !!document.querySelector('#toc-tree .ev-drop-line');
      const washShown = () => document.querySelectorAll('#toc-tree .toc-drop-wash').length > 0;
      const rA1 = entryA1.getBoundingClientRect();
      const rA21 = entryA21.getBoundingClientRect();
      const rA3 = entryA3.getBoundingClientRect();
      const rOwn = entryA.getBoundingClientRect();
      const rB1 = entryB1.getBoundingClientRect();

      move(rB1, stackX(rB1), rB1.top + 2); // before zone of B1 — outside A's subtree
      const lineShown = lineShownAt() && !washShown();
      move(rA1, bandX(rA1), rA1.top + rA1.height / 2); // inside band of 1.1
      const midA1 = !lineShownAt() && !washShown();
      move(rA21, stackX(rA21), rA21.top + 2); // before zone of 1.2.1
      const topA21 = !lineShownAt() && !washShown();
      move(rA3, stackX(rA3), rA3.bottom - 2); // after zone of 1.3 (A's own append slot)
      const bottomA3 = !lineShownAt() && !washShown();
      move(rOwn, bandX(rOwn), rOwn.top + 2); // inside band of A itself (its top edge)
      const midOwn = !lineShownAt() && !washShown();

      const orderBefore = sectionTitles();
      pointer('pointerup', document, bandX(rA1), rA1.top + rA1.height / 2, 14);
      const orderAfter = sectionTitles();
      return { lineShown, midA1, topA21, bottomA3, midOwn, unchanged: JSON.stringify(orderBefore) === JSON.stringify(orderAfter) };
    });
    assert.equal(cycleCancel.lineShown, true, 'a valid zone still shows the line (no wash in the before zone)');
    assert.equal(cycleCancel.midA1, true, 'no line and no wash over 1.1\'s inside band');
    assert.equal(cycleCancel.topA21, true, 'no line and no wash over 1.2.1\'s before zone');
    assert.equal(cycleCancel.bottomA3, true, 'no line and no wash over 1.3\'s after zone (A\'s own append slot)');
    assert.equal(cycleCancel.midOwn, true, 'no line and no wash over the dragged row\'s inside band');
    assert.equal(cycleCancel.unchanged, true, 'the release there cancels — nothing moved');

    // Block F — a release outside the tree cancels: leaving the tree first
    // removes the line and the wash.
    const outsideCancel = await evaluate(client, async () => {
      const { wait, pointer, center, entryByNum, sectionTitles } = window.__td;
      await window.__td.buildFixture();

      const entryA = entryByNum('1 ');
      const entryB1 = entryByNum('2 ');
      const start = center(entryA.getBoundingClientRect());
      pointer('pointerdown', entryA, start.x, start.y, 31);
      pointer('pointermove', document, start.x + 15, start.y + 15, 31);
      const r1 = entryB1.getBoundingClientRect();
      const midY = r1.top + r1.height / 2;
      pointer('pointermove', document, r1.right - 20, midY, 31); // inside band of B1 — wash + line
      const shownOutside = (() => {
        const line = document.querySelector('.ev-drop-line');
        return !!line && document.querySelectorAll('#toc-tree .toc-drop-wash').length === 1;
      })();
      const orderBefore = sectionTitles();
      // the document area to the right of the pinned panel
      pointer('pointermove', document, 700, 250, 31);
      const chromeGone = !document.querySelector('.ev-drop-line') &&
        document.querySelectorAll('#toc-tree .toc-drop-wash').length === 0;
      pointer('pointerup', document, 700, 250, 31);
      const after = {
        orderChanged: JSON.stringify(sectionTitles()) !== JSON.stringify(orderBefore),
        active: document.body.classList.contains('ev-dragging-active'),
        dimmed: document.querySelector('.ev-dragging') !== null,
      };
      await wait(20);
      return { shownOutside, chromeGone, ...after };
    });
    assert.equal(outsideCancel.shownOutside, true, 'the inside band shows wash + line inside the tree');
    assert.equal(outsideCancel.chromeGone, true, 'leaving the tree removes the line and the wash');
    assert.equal(outsideCancel.orderChanged, false, 'the outside release cancels — nothing moved');
    assert.equal(outsideCancel.active, false, 'the drag state is cleared');
    assert.equal(outsideCancel.dimmed, false, '…including the dim');

    // Block E — a save after all that carries no TOC markup and no drag
    // state (the fixture is F's: the canceled release left it untouched).
    const serialization = await evaluate(client, () => {
      const saved = window.__evidence.serialize();
      const doc = new DOMParser().parseFromString(saved, 'text/html');
      return {
        noPanel: !doc.getElementById('toc-panel'),
        noGoto: doc.querySelector('[data-action="toc-goto"]') === null,
        noLine: doc.querySelector('.ev-drop-line') === null,
        noWash: doc.querySelector('.toc-drop-wash') === null,
        noDim: doc.querySelector('.ev-dragging') === null,
        noCollapse: !doc.body.classList.contains('toc-collapsed'),
        noChrome: doc.querySelectorAll('[data-chrome]').length === 0,
        order: [...doc.querySelectorAll('#evidence .ev-section')]
          .map((s) => s.querySelector(':scope > .ev-title > .ev-title-text').textContent).slice(0, 6),
      };
    });
    assert.deepEqual(serialization, {
      noPanel: true, noGoto: true, noLine: true, noWash: true, noDim: true,
      noCollapse: true, noChrome: true,
      order: ['A', 'A1', 'A2', 'A21', 'A3', 'B1'],
    });

    console.log('Chromium TOC entry-drag zone check passed');
  } finally {
    client.close();
  }
} finally {
  child.kill();
  rmSync(userDataDir, { recursive: true, force: true });
}
