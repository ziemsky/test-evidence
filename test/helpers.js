import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_PATH = path.join(here, '..', 'index.html');

export function appSource() {
  return readFileSync(APP_PATH, 'utf8');
}

export function screenStyles() {
  const match = /<style>([\s\S]*?)<\/style>/.exec(appSource());
  assert.ok(match, 'the app has an embedded stylesheet');
  return match[1].replace(/\/\*[\s\S]*?\*\//g, ' ');
}

export function stylesheetRule(css, selector) {
  const matches = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((candidate) =>
    candidate[1].split(',').map((part) => part.trim()).includes(selector),
  );
  assert.ok(matches.length, `stylesheet rule exists for ${selector}`);
  return matches.map((match) => match[2]).join(' ').replace(/\s+/g, ' ');
}

export function assertCaretAtEnd(field) {
  if (typeof field.selectionStart === 'number') {
    assert.equal(field.selectionStart, field.value.length);
    assert.equal(field.selectionEnd, field.value.length);
    return;
  }
  const selection = field.ownerDocument.defaultView.getSelection();
  assert.ok(selection && selection.isCollapsed, 'the typing caret is collapsed');
  let end = field;
  while (end.lastChild) end = end.lastChild;
  const expectedOffset = end.nodeType === 3 ? end.textContent.length : end.childNodes.length;
  const atTextEnd = selection.anchorNode === end && selection.anchorOffset === expectedOffset;
  const atFieldEnd = selection.anchorNode === field && selection.anchorOffset === field.childNodes.length;
  assert.ok(atTextEnd || atFieldEnd, 'the caret follows existing text at the end of the focused field');
}

/** Flush microtasks plus one macrotask; the app's boot/save chains resolve within these. */
export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export const DEFAULT_APP_URL = 'file:///sessions/my-test/index.html';

export function documentHandleKey(url = DEFAULT_APP_URL) {
  return `evidence-root:${url.split('#')[0]}`;
}

export function latestOperationResult(subject) {
  const document = subject.nodeType === 9 ? subject : subject.document;
  const finished = document.defaultView.__operationLogs
    .filter((line) => line.startsWith('Operation finished: ')).at(-1);
  if (!finished) return null;
  const [, name, outcome, ...message] = finished.match(/^Operation finished: (.*?) — (.*?) — ([\s\S]*)$/) || [];
  return { name, outcome, message: message.join(' — '), log: finished };
}

/**
 * In-memory File System Access + IndexedDB environment for the app's primary
 * (in-place) save mode. One env can be shared across multiple loadApp calls to
 * simulate closing and reopening the file in the same browser profile: the
 * picked folder, the on-disk files, and the IndexedDB handle persist, while
 * permission state and picker behavior are controllable per test.
 */
export function createFileSystemEnv({ folderName = 'my-tests' } = {}) {
  const env = {
    folderName,
    files: new Map(), // top-level file name -> text written via createWritable
    assetsFiles: new Map(), // assets/ file name -> last write (Blob) via createWritable
    createdDirs: new Set(), // directory names created via getDirectoryHandle
    idbHandles: new Map(), // key -> stored handle (survives "tab" close)
    idbStores: new Set(),
    pickedDir: null,
    declineNextPicker: false,
    permission: 'granted', // what queryPermission reports
    requestPermissionOutcome: 'granted',
    failNextWrite: null, // if set, the next createWritable throws Error(message)
    failNextAssetWrite: null, // if set, the next assets/ createWritable throws Error(message)
    failNextAssetClose: null, // if set, the next assets/ writable close throws Error(message)
    pickerCalls: [], // options passed to each showDirectoryPicker call
    sourcePickerCalls: [], // options passed to each showOpenFilePicker call
    sourceFile: null,
    declineNextSourcePicker: false,
    removedAssets: [], // assets/ file names removed via removeEntry
    failNextRemoveEntry: null, // if set, the next removeEntry throws Error(message)
    queryPermissionCalls: 0,
    requestPermissionCalls: 0,
    next: (fn) => Promise.resolve().then(fn),
  };

  const makeDirHandle = (name) => ({
    name,
    kind: 'directory',
    async queryPermission() {
      env.queryPermissionCalls++;
      return env.permission;
    },
    async requestPermission() {
      env.requestPermissionCalls++;
      env.permission = env.requestPermissionOutcome;
      return env.permission;
    },
    async getFileHandle(name, opts) {
      if (opts && opts.create && !env.files.has(name)) env.files.set(name, '');
      return {
        name,
        kind: 'file',
        async createWritable() {
          if (env.failNextWrite) {
            const message = env.failNextWrite;
            env.failNextWrite = null;
            throw new Error(message);
          }
          let written = '';
          return {
            async write(chunk) {
              written += chunk;
              env.files.set(name, written);
            },
            async close() {
              env.files.set(name, written);
            },
          };
        },
      };
    },
    async getDirectoryHandle(name, opts) {
      if (opts && opts.create) env.createdDirs.add(name);
      if (name !== 'assets') return { name, kind: 'directory' };
      // The assets dir supports the probe semantics the app relies on
      // (SPEC §6.4): getFileHandle without create rejects NotFoundError.
      // removeEntry mirrors the real DirectoryHandle.removeEntry(name);
      // values() mirrors the real async enumeration of handles; entries()
      // mirrors the real async enumeration of [name, handle] pairs (SPEC
      // §27 collision check).
      return {
        name,
        kind: 'directory',
        async *values() {
          for (const assetName of env.assetsFiles.keys()) yield { name: assetName, kind: 'file' };
        },
        async *entries() {
          for (const assetName of env.assetsFiles.keys()) yield [assetName, { name: assetName, kind: 'file' }];
        },
        [Symbol.asyncIterator]() {
          return this.values();
        },
        async removeEntry(fname) {
          if (env.failNextRemoveEntry) {
            const message = env.failNextRemoveEntry;
            env.failNextRemoveEntry = null;
            throw new Error(message);
          }
          if (!env.assetsFiles.has(fname)) {
            const err = new Error('Failed to execute removeEntry: No entry found for key');
            err.name = 'NotFoundError';
            throw err;
          }
          env.assetsFiles.delete(fname);
          env.removedAssets.push(fname);
        },
        async getFileHandle(fname, fopts) {
          if (fopts && fopts.create && !env.assetsFiles.has(fname)) env.assetsFiles.set(fname, null);
          if (!env.assetsFiles.has(fname)) {
            const err = new Error('Failed to execute getFileHandle: No entry found for key');
            err.name = 'NotFoundError';
            throw err;
          }
          return {
            name: fname,
            kind: 'file',
            async getFile() {
              return env.assetsFiles.get(fname);
            },
            async createWritable() {
              if (env.failNextAssetWrite) {
                const message = env.failNextAssetWrite;
                env.failNextAssetWrite = null;
                throw new Error(message);
              }
              let written = null;
              return {
                async write(chunk) {
                  written = chunk;
                },
                async close() {
                  if (env.failNextAssetClose) {
                    const message = env.failNextAssetClose;
                    env.failNextAssetClose = null;
                    throw new Error(message);
                  }
                  env.assetsFiles.set(fname, written);
                },
              };
            },
          };
        },
      };
    },
  });

  env.pickedDir = makeDirHandle(folderName);

  return {
    env,
    makeDirHandle,
    install(window) {
      window.showDirectoryPicker = (opts) => {
        env.pickerCalls.push(opts);
        if (env.declineNextPicker) {
          env.declineNextPicker = false;
          const err = new Error('The user canceled the picker');
          err.name = 'AbortError';
          return Promise.reject(err);
        }
        return Promise.resolve(env.pickedDir);
      };
      window.showOpenFilePicker = (opts) => {
        env.sourcePickerCalls.push(opts);
        if (env.declineNextSourcePicker) {
          env.declineNextSourcePicker = false;
          const err = new Error('The user canceled the picker');
          err.name = 'AbortError';
          return Promise.reject(err);
        }
        return Promise.resolve(env.sourceFile ? [{
          kind: 'file',
          name: env.sourceFile.name,
          getFile: () => Promise.resolve(env.sourceFile),
        }] : []);
      };
      window.indexedDB = {
        open() {
          const req = {};
          env.next(() => {
            req.result = {
              createObjectStore(name) {
                env.idbStores.add(name);
                return {};
              },
              transaction() {
                return {
                  objectStore() {
                    return {
                      get(key) {
                        const r = {};
                        env.next(() => {
                          r.result = env.idbHandles.get(key);
                          r.onsuccess();
                        });
                        return r;
                      },
                      put(value, key) {
                        const r = {};
                        env.next(() => {
                          env.idbHandles.set(key, value);
                          r.onsuccess();
                        });
                        return r;
                      },
                    };
                  },
                };
              },
              close() {},
            };
            if (!env.idbStores.has('handles')) req.onupgradeneeded();
            req.onsuccess();
          });
          return req;
        },
      };
    },
  };
}

/**
 * Load the app into a browser-like DOM and run its embedded script.
 * jsdom has no real file downloads, so the test harness stubs the two
 * browser features jsdom does not implement: URL.createObjectURL and
 * anchor click navigation. Every "download" the app performs is captured
 * in result.downloads as { name, href, blob }.
 * Pass `fs` (a createFileSystemEnv() result) to install the mocked File
 * System Access + IndexedDB APIs and exercise primary (in-place) save mode.
 * Without `fs`, the default browser has File System Access but no IndexedDB
 * handle store, so it uses download fallback. Pass `fileSystemAccess: false`
 * to exercise an unsupported browser.
 */
export function loadApp(html = appSource(), { url = DEFAULT_APP_URL, fs, fileSystemAccess = true, beforeParse } = {}) {
  const downloads = [];
  // Silence jsdom's unimplemented-browser-feature noise, but keep real errors visible.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (!String(err.message).startsWith('Not implemented')) console.error(err);
  });

  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.__operationLogs = [];
      const originalLog = window.console.log.bind(window.console);
      window.console.log = (...parts) => {
        const line = parts.join(' ');
        if (line.startsWith('Operation started: ') || line.startsWith('Operation finished: ')) {
          window.__operationLogs.push(line);
        }
        originalLog(...parts);
      };
      window.URL.createObjectURL = (blob) => {
        const id = `blob:mock-${downloads.length + 1}`;
        downloads.push({ id, blob });
        return id;
      };
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = function () {
        const pending = downloads.find((d) => d.id === this.href);
        downloads.push({ name: this.download, href: this.href, blob: pending ? pending.blob : null });
      };
      if (fs) fs.install(window);
      else if (fileSystemAccess) window.showDirectoryPicker = () => Promise.reject(
        new window.DOMException('The user canceled the picker', 'AbortError'),
      );
      if (beforeParse) beforeParse(window);
    },
  });
  return { dom, window: dom.window, document: dom.window.document, downloads };
}

/**
 * Build the document's first section through the app's own standalone
 * "+ section" button (0040: bare boot — no section exists at boot, so
 * suites that need one build their own instead of leaning on boot content).
 */
export function addFirstSection(document) {
  document.querySelector('button[data-action="add-section"]').click();
  return document.querySelector('#evidence > .ev-section');
}

/**
 * Right-click a section title and return the single shared section palette.
 * The context-menu event is the public ownership seam for selecting a section
 * before a test invokes one of the palette's delegated actions.
 */
export function sectionPalette(section) {
  const title = section.querySelector(':scope > .ev-title > .ev-title-text');
  if (title) {
    title.dispatchEvent(new title.ownerDocument.defaultView.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 120,
      clientY: 80,
    }));
  }
  return section.ownerDocument.querySelector('#evidence > .ev-section-palette[data-section-palette]');
}

/** Dispatch a browser-like context-menu event through the app's public event seam. */
export function dispatchContextMenu(
  window,
  target,
  { x = 120, y = 80, button = 2, pointerType } = {},
) {
  const event = new window.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button,
    clientX: x,
    clientY: y,
  });
  if (pointerType) Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
  return event;
}

/** Select a section through its title and return one of the shared palette's actions. */
export function sectionAction(section, action) {
  if (section?.matches?.('.ev-section')) {
    const palette = sectionPalette(section);
    return palette?.querySelector(`[data-action="${action}"]`) || null;
  }
  return section?.querySelector?.(`[data-action="${action}"]`) || null;
}

/** Read the text of a captured download blob (downloads pushed by anchor click). */
export async function downloadText(entry) {
  return entry.blob.text();
}

/**
 * Poll until `fn` returns truthy (the paste chain spans several macrotasks;
 * jsdom's task counts vary), failing after the settle window.
 */
export async function waitFor(fn, { tries = 50 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('expected condition was not met within the settle window');
}

/**
 * jsdom has neither createImageBitmap nor a 2D canvas; stub the decode →
 * re-encode pipeline and record the toBlob type, mirroring how
 * plain-text.test.js stubs execCommand. `files` collects the Files handed
 * to createImageBitmap.
 */
export function stubImagePipeline(window, { decodeError = null, encodeFails = false } = {}) {
  const toBlobCalls = [];
  const files = [];
  window.createImageBitmap = (file) => {
    files.push(file);
    if (decodeError) return Promise.reject(new Error(decodeError));
    return Promise.resolve({ width: 40, height: 20, close() {} });
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.HTMLCanvasElement.prototype.toBlob = function (cb, type) {
    toBlobCalls.push(type);
    setTimeout(() => cb(encodeFails ? null : new window.Blob(['fake-png'], { type })), 0);
  };
  return { toBlobCalls, files };
}

/**
 * jsdom has no ClipboardEvent constructor; attach an image-bearing
 * clipboardData to a plain Event (same seam as plain-text.test.js).
 */
export function pasteImage(window, target, { plain = '' } = {}) {
  const file = new window.File(['img-bytes'], 'capture.png', { type: 'image/png' });
  const ev = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', {
    value: {
      items: [{ type: 'image/png', getAsFile: () => file }],
      getData: (type) => (type === 'text/plain' ? plain : ''),
    },
  });
  target.dispatchEvent(ev);
  return ev;
}
