import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { appSource, loadApp } from './helpers.js';

function createMediaQuery(initiallyDark = false) {
  const listeners = new Set();
  return {
    media: '(prefers-color-scheme: dark)',
    matches: initiallyDark,
    addEventListener(type, listener) { if (type === 'change') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'change') listeners.delete(listener); },
    setDark(matches) {
      this.matches = matches;
      for (const listener of listeners) listener({ matches, media: this.media });
    },
  };
}

function loadThemeApp({ dark = false, storage, storageAvailable = true } = {}) {
  const media = createMediaQuery(dark);
  const storageArea = storage || new Map();
  const loaded = loadApp(appSource(), {
    url: 'https://evidence.test/session.html',
    beforeParse(window) {
      window.matchMedia = () => media;
      if (storageAvailable) {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          value: {
            getItem(key) { return storageArea.has(key) ? storageArea.get(key) : null; },
            setItem(key, value) { storageArea.set(key, String(value)); },
            removeItem(key) { storageArea.delete(key); },
          },
        });
      } else {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          get() { throw new window.DOMException('Storage is unavailable', 'SecurityError'); },
        });
      }
    },
  });
  return { ...loaded, media, storage: storageArea };
}

function appearance(document) {
  return document.documentElement.getAttribute('data-theme') || 'system';
}

function printStyles() {
  const source = appSource();
  const start = source.indexOf('@media print');
  assert.notEqual(start, -1, 'the app defines print-specific rules');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(open + 1, i).replace(/\/\*[\s\S]*?\*\//g, ' ');
  }
  assert.fail('the print media rule is closed');
}

test('a fresh visit follows the device appearance and updates when the device changes', () => {
  const light = loadThemeApp();
  assert.equal(appearance(light.document), 'light');
  assert.equal(light.document.getElementById('theme-toggle').getAttribute('aria-label'), 'Switch to dark appearance');

  const dark = loadThemeApp({ dark: true });
  assert.equal(appearance(dark.document), 'dark');
  assert.equal(dark.document.getElementById('theme-toggle').getAttribute('aria-label'), 'Switch to light appearance');

  light.media.setDark(true);
  assert.equal(appearance(light.document), 'dark');
  assert.equal(light.document.getElementById('theme-toggle').getAttribute('aria-label'), 'Switch to light appearance');
});

test('the toolbar toggle changes appearance, shows the target, and remembers the choice', () => {
  const storage = new Map();
  const { document, media } = loadThemeApp({ dark: true, storage });
  const print = document.getElementById('print-btn');
  const toggle = document.getElementById('theme-toggle');

  assert.ok(toggle);
  assert.equal(print.nextElementSibling, toggle);
  assert.equal(toggle.nextElementSibling, null);
  assert.equal(toggle.getAttribute('aria-label'), 'Switch to light appearance');
  toggle.click();
  assert.equal(appearance(document), 'light');
  assert.equal(toggle.getAttribute('aria-label'), 'Switch to dark appearance');
  assert.equal(storage.get('test-evidence-theme'), 'light');

  media.setDark(false);
  media.setDark(true);
  assert.equal(appearance(document), 'light', 'a manual choice ignores later device changes');

  const reopened = loadThemeApp({ dark: true, storage });
  assert.equal(appearance(reopened.document), 'light', 'the origin preference is restored on a later visit');
});

test('a manual choice still works without storage and lasts only for the current page', () => {
  const first = loadThemeApp({ storageAvailable: false });
  const toggle = first.document.getElementById('theme-toggle');
  toggle.click();
  assert.equal(appearance(first.document), 'dark');
  first.media.setDark(false);
  assert.equal(appearance(first.document), 'dark', 'the current page keeps its manual selection');

  const nextLoad = loadThemeApp({ storageAvailable: false });
  assert.equal(appearance(nextLoad.document), 'light');
  assert.equal(nextLoad.document.getElementById('theme-toggle').getAttribute('aria-label'), 'Switch to dark appearance');
});

test('the saved evidence file contains no selected theme or toolbar preference', () => {
  const { document, window, storage } = loadThemeApp();
  document.getElementById('theme-toggle').click();
  const saved = window.__evidence.serialize();
  const savedDocument = new JSDOM(saved).window.document;

  assert.equal(savedDocument.documentElement.hasAttribute('data-theme'), false);
  assert.equal(savedDocument.getElementById('theme-toggle'), null);
  assert.doesNotMatch(saved, /<html[^>]*data-theme=/i, 'the current selection is not serialized as document state');
  assert.equal(storage.get('test-evidence-theme'), 'dark', 'the preference remains in browser storage');
});

test('print media forces the native light palette regardless of the screen theme', () => {
  const css = printStyles();
  assert.match(css, /:root\s*\{[^}]*color-scheme:\s*light\s*!important/i);
  assert.match(css, /html,\s*body\s*\{[^}]*background:\s*white;[^}]*color:\s*black;/i);
});
