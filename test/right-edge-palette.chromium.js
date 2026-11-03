import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 0078/0082: a dependency-free Chromium smoke check for the real CSS/event seam.
// Run with `npm run test:chromium`; the regular jsdom suite remains portable.

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
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'test-evidence-chromium-'))}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const userDataDir = child.spawnargs.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);

try {
  const browserEndpoint = await chromiumEndpoint(child);
  const client = cdpClient(await pageEndpoint(browserEndpoint));
  try {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send('Page.navigate', { url: `file://${appPath}` });
    await wait(300);
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 500,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const roomy = await evaluate(client, async () => {
      const add = document.querySelector('[data-action="add-section"]');
      add.click();
      const outer = document.querySelector('#evidence > .ev-section');
      const title = outer.querySelector(':scope > .ev-title');
      const palette = document.querySelector('#evidence > .ev-section-palette');
      const open = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, clientX: 640, clientY: 180,
      });
      title.dispatchEvent(open);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const firstRect = palette.getBoundingClientRect();

      palette.querySelector('[data-action="add-comment"]').click();
      const row = outer.querySelector(':scope > .ev-body > .ev-comment');
      const rowControlsRect = row.querySelector(':scope > .ev-controls').getBoundingClientRect();
      const actionClosed = !outer.hasAttribute('data-palette-active') &&
        !palette.hasAttribute('data-palette-visible');

      title.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, clientX: 640, clientY: 180,
      }));
      document.querySelector('#toolbar').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const outsideClosed = !outer.hasAttribute('data-palette-active') &&
        !palette.hasAttribute('data-palette-visible');

      document.querySelector('.ev-add-section-btn').click();
      const second = [...document.querySelectorAll('#evidence > .ev-section')][1];
      const secondTitle = second.querySelector(':scope > .ev-title');
      secondTitle.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 250,
      }));
      await new Promise((resolve) => setTimeout(resolve, 700));
      const secondRect = palette.getBoundingClientRect();

      return {
        viewportWidth: window.innerWidth,
        firstCentered: Math.abs((firstRect.left + firstRect.width / 2) - 640) < 1 &&
          Math.abs((firstRect.top + firstRect.height / 2) - 180) < 1,
        actionClosed,
        outsideClosed,
        secondCentered: Math.abs((secondRect.left + secondRect.width / 2) - 100) < 1 &&
          Math.abs((secondRect.top + secondRect.height / 2) - 250) < 1,
        samePalette: palette === document.querySelector('#evidence > .ev-section-palette'),
        rowControlsInsidePane: rowControlsRect.right <= document.getElementById('evidence').getBoundingClientRect().right + 1,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });
    assert.deepEqual(roomy, {
      viewportWidth: 1280,
      firstCentered: true,
      actionClosed: true,
      outsideClosed: true,
      secondCentered: true,
      samePalette: true,
      rowControlsInsidePane: true,
      noHorizontalOverflow: true,
    });

    const screenshotToolboxes = await evaluate(client, async () => {
      const section = document.querySelector('#evidence > .ev-section');
      const body = section.querySelector(':scope > .ev-body');
      const row = document.createElement('div');
      row.className = 'ev-shot-row';
      const rowHandle = document.createElement('span');
      rowHandle.className = 'ev-drag-handle';
      rowHandle.setAttribute('data-chrome', '');
      const rowControls = document.createElement('div');
      rowControls.className = 'ev-row-controls';
      rowControls.setAttribute('data-chrome', '');
      const rowButton = document.createElement('button');
      rowButton.dataset.action = 'row-valign-middle';
      rowControls.appendChild(rowButton);
      const screenshot = document.createElement('div');
      screenshot.className = 'ev-screenshot';
      screenshot.dataset.size = 'medium';
      const image = document.createElement('img');
      image.className = 'ev-img';
      image.src = 'data:image/png;base64,iVBORw0KGgo=';
      const caption = document.createElement('span');
      caption.className = 'ev-caption';
      caption.textContent = 'Browser screenshot';
      const legacyControls = document.createElement('span');
      legacyControls.className = 'ev-controls';
      legacyControls.setAttribute('data-chrome', '');
      screenshot.append(image, caption, legacyControls);
      row.append(rowHandle, rowControls, screenshot);
      body.appendChild(row);

      const palette = document.querySelector('#evidence > .ev-section-palette');
      const settle = () => new Promise((resolve) => setTimeout(resolve, 700));
      const menu = (target, x = 640, y = 180) => {
        target.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y,
        }));
      };
      menu(image);
      await settle();
      const screenshotOpen = palette.querySelector(':scope > .ev-section-palette-header').textContent === 'Screenshot' &&
        palette.querySelector('[data-action="size-medium"]').hasAttribute('data-active') &&
        palette.querySelector('[data-action="rename-file"]') === null;
      const screenshotPosition = palette.getBoundingClientRect();
      const screenshotControlsHidden = getComputedStyle(legacyControls).display === 'none';

      menu(row, 100, 250);
      await settle();
      const rowOpen = palette.querySelector(':scope > .ev-section-palette-header').textContent === 'Screenshot row' &&
        palette.querySelectorAll(':scope > button[data-action^="row-"]').length === 6;
      palette.querySelector('[data-action="row-valign-middle"]').click();
      const rowState = row.dataset.valign === 'middle';
      menu(image);
      await settle();
      image.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const ownerClickKeepsOpen = screenshot.hasAttribute('data-palette-active') &&
        palette.hasAttribute('data-palette-visible');
      menu(row.querySelector(':scope > .ev-row-controls button'), 40, 40);
      await settle();
      const rowControlsOwns = palette.querySelector(':scope > .ev-section-palette-header').textContent === 'Screenshot row' &&
        row.hasAttribute('data-palette-active') && !screenshot.hasAttribute('data-palette-active');
      menu(image);
      await settle();
      const beforeHandle = palette.style.cssText;
      menu(rowHandle, 40, 40);
      const handleIgnored = palette.style.cssText === beforeHandle &&
        screenshot.hasAttribute('data-palette-active') && !row.hasAttribute('data-palette-active');
      menu(image);
      await settle();
      const beforeOverlayControl = palette.style.cssText;
      menu(palette.querySelector(':scope > button'), 40, 40);
      const overlayControlIgnored = palette.style.cssText === beforeOverlayControl &&
        screenshot.hasAttribute('data-palette-active') && !row.hasAttribute('data-palette-active');
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      const escapeClosed = !screenshot.hasAttribute('data-palette-active') &&
        !palette.hasAttribute('data-palette-visible');
      return {
        screenshotOpen,
        screenshotCentered: Math.abs((screenshotPosition.left + screenshotPosition.width / 2) - 640) < 1,
        screenshotControlsHidden,
        rowOpen,
        rowState,
        ownerClickKeepsOpen,
        rowControlsOwns,
        handleIgnored,
        overlayControlIgnored,
        escapeClosed,
      };
    });
    assert.deepEqual(screenshotToolboxes, {
      screenshotOpen: true,
      screenshotCentered: true,
      screenshotControlsHidden: true,
      rowOpen: true,
      rowState: true,
      ownerClickKeepsOpen: true,
      rowControlsOwns: true,
      handleIgnored: true,
      overlayControlIgnored: true,
      escapeClosed: true,
    });

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const result = await evaluate(client, async () => {
      window.dispatchEvent(new Event('resize'));
      const outer = document.querySelector('#evidence > .ev-section');
      const second = document.querySelectorAll('#evidence > .ev-section')[1];
      const palette = document.querySelector('#evidence > .ev-section-palette');
      const outerTitle = outer.querySelector(':scope > .ev-title');
      let activeOwner = document.querySelector('[data-palette-active]');
      if (!activeOwner) {
        outerTitle.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 30,
        }));
        await new Promise((resolve) => setTimeout(resolve, 700));
        activeOwner = document.querySelector('[data-palette-active]');
      }
      const settledRect = palette.getBoundingClientRect();
      let closingFades = false;
      if (activeOwner) {
        activeOwner.dispatchEvent(new MouseEvent('mouseout', {
          bubbles: true, relatedTarget: document.querySelector('#toolbar'),
        }));
        await new Promise((resolve) => setTimeout(resolve, 220));
        const closingRect = palette.getBoundingClientRect();
        const closingOpacity = Number.parseFloat(getComputedStyle(palette).opacity);
        closingFades = palette.getAttribute('data-palette-phase') === 'closing' &&
          closingOpacity > 0 && closingOpacity < 1 &&
          closingRect.width === settledRect.width && closingRect.height === settledRect.height;
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      const atRest = {
        opacity: getComputedStyle(palette).opacity,
        visibility: getComputedStyle(palette).visibility,
        pointerEvents: getComputedStyle(palette).pointerEvents,
      };
      const hiddenButton = palette.querySelector('[data-action="copy"]');
      hiddenButton.focus();
      const hiddenControlNotFocusable = document.activeElement !== hiddenButton;

      outerTitle.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      const hoverStaysHidden = !outer.hasAttribute('data-palette-active');
      const openAtEdge = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, clientX: 4, clientY: 4,
      });
      outerTitle.dispatchEvent(openAtEdge);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const edgeRect = palette.getBoundingClientRect();
      const keyboardMenu = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20,
      });
      outerTitle.dispatchEvent(keyboardMenu);
      const keyboardIgnored = outer.hasAttribute('data-palette-active');
      const mouseVisible = outer.hasAttribute('data-palette-active') &&
        palette.hasAttribute('data-palette-visible') && getComputedStyle(palette).opacity === '1';
      outerTitle.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: palette }));
      palette.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: outerTitle }));
      const travelVisible = outer.hasAttribute('data-palette-active');
      palette.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.querySelector('#toolbar') }));
      await new Promise((resolve) => setTimeout(resolve, 350));
      const leftHidden = !outer.hasAttribute('data-palette-active');

      outerTitle.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      outerTitle.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 30,
      }));
      await new Promise((resolve) => setTimeout(resolve, 700));
      palette.querySelector('[data-action="add-subsection"]').click();
      const inner = outer.querySelector(':scope > .ev-body > .ev-section');
      const innerTitle = inner.querySelector(':scope > .ev-title');
      innerTitle.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, clientX: 200, clientY: 70,
      }));
      await new Promise((resolve) => setTimeout(resolve, 700));
      const nestedOwned = inner.hasAttribute('data-palette-active') && !outer.hasAttribute('data-palette-active');

      innerTitle.dispatchEvent(new MouseEvent('mouseout', {
        bubbles: true, relatedTarget: document.querySelector('#toolbar'),
      }));
      await new Promise((resolve) => setTimeout(resolve, 350));
      innerTitle.focus();
      const focusDoesNotOpen = !inner.hasAttribute('data-palette-active');
      const toolbarMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
      document.querySelector('#toolbar').dispatchEvent(toolbarMenu);

      const narrowPalette = document.querySelector('#evidence > .ev-section-palette');
      const paletteRect = narrowPalette.getBoundingClientRect();
      const evidenceRect = document.getElementById('evidence').getBoundingClientRect();
      const narrowLayout = {
        viewportWidth: window.innerWidth,
        actionCount: narrowPalette.querySelectorAll('button').length,
        iconCount: narrowPalette.querySelectorAll(':scope > button > svg.ev-action-icon').length,
        iconsDecorative: [...narrowPalette.querySelectorAll(':scope > button > svg.ev-action-icon')]
          .every((icon) => icon.getAttribute('aria-hidden') === 'true' &&
            icon.getAttribute('focusable') === 'false' &&
            icon.getAttribute('stroke') === 'currentColor'),
        labelsVisible: [...narrowPalette.querySelectorAll(':scope > button > .ev-action-label')]
          .every((label) => label.textContent && label.textContent === label.parentElement.textContent),
        labelAlignment: getComputedStyle(narrowPalette.querySelector('button')).textAlign,
        rowPadding: getComputedStyle(narrowPalette.querySelector('button')).paddingTop,
        shadowed: getComputedStyle(narrowPalette).boxShadow !== 'none',
        rightEdgeClamped: paletteRect.right <= window.innerWidth - 8,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        scrollable: narrowPalette.scrollHeight > narrowPalette.clientHeight,
        overflowY: getComputedStyle(narrowPalette).overflowY,
        maxHeight: getComputedStyle(narrowPalette).maxHeight,
      };

      const saved = window.__evidence.serialize();
      const savedDocument = new DOMParser().parseFromString(saved, 'text/html');
      return {
        atRest,
        closingFades,
        hoverStaysHidden,
        mouseVisible,
        edgeClamped: edgeRect.left >= 0 && edgeRect.top >= 0 &&
          edgeRect.right <= window.innerWidth - 8 && edgeRect.bottom <= window.innerHeight - 8,
        keyboardIgnored,
        travelVisible,
        leftHidden,
        nestedOwned,
        focusDoesNotOpen,
        toolbarMenuNotSuppressed: !toolbarMenu.defaultPrevented,
        hiddenControlNotFocusable,
        narrowLayout,
        savedHasMarker: !!savedDocument.querySelector('[data-palette-active]'),
        savedHasControls: !!savedDocument.querySelector('.ev-controls'),
      };
    });

    assert.deepEqual(result, {
      atRest: { opacity: '0', visibility: 'hidden', pointerEvents: 'none' },
      closingFades: true,
      hoverStaysHidden: true,
      mouseVisible: true,
      edgeClamped: true,
      keyboardIgnored: true,
      travelVisible: true,
      leftHidden: true,
      nestedOwned: true,
      focusDoesNotOpen: true,
      toolbarMenuNotSuppressed: true,
      hiddenControlNotFocusable: true,
        narrowLayout: {
          viewportWidth: 320,
          actionCount: 12,
          iconCount: 12,
          iconsDecorative: true,
          labelsVisible: true,
          labelAlignment: 'left',
          rowPadding: '4px',
          shadowed: true,
          rightEdgeClamped: true,
        noHorizontalOverflow: true,
        scrollable: false,
        overflowY: 'auto',
        maxHeight: '84px',
      },
      savedHasMarker: false,
      savedHasControls: false,
    });
    console.log('Chromium right-edge palette check passed');
  } finally {
    client.close();
  }
} finally {
  child.kill();
  rmSync(userDataDir, { recursive: true, force: true });
}
