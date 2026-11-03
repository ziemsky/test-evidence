import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureDir = path.join(projectRoot, 'test/fixtures/default-content');
const emptyMain = '<main id="evidence"><h1 class="ev-doc-title"><span class="ev-text ev-doc-title-text"></span></h1></main>';

export function populatedHtml() {
  const app = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const main = readFileSync(path.join(fixtureDir, 'main.html'), 'utf8').trim();
  if (app.split(emptyMain).length !== 2) {
    throw new Error('Expected one empty evidence document in index.html');
  }
  return app.replace(emptyMain, main);
}

export function createTestDocument(outputDir = path.join(projectRoot, 'build/test-evidence')) {
  const destination = path.resolve(outputDir);
  if (destination === projectRoot || (existsSync(destination) && realpathSync(destination) === realpathSync(projectRoot))) {
    throw new Error('Choose an output directory other than the project root');
  }
  const assets = path.join(destination, 'assets');
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(destination, 'index.html'), populatedHtml());
  for (const name of readdirSync(path.join(fixtureDir, 'assets'))) {
    copyFileSync(path.join(fixtureDir, 'assets', name), path.join(assets, name));
  }
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(createTestDocument(process.argv[2]));
}
