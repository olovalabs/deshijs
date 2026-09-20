import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const dist = path.resolve('dist');
const html = fs.readFileSync(path.join(dist, 'counter/index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost/counter',
  pretendToBeVisual: true,
});
const { window } = dom;

for (const key of [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLIFrameElement',
  'Event',
  'MouseEvent',
  'MutationObserver',
]) {
  Object.defineProperty(globalThis, key, {
    value: window[key],
    configurable: true,
    writable: true,
  });
}
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

const errors = [];
const originalError = console.error;
console.error = (...args) => errors.push(args.map(String).join(' '));

try {
  const root = window.document.querySelector('[data-deshi-island]');
  assert.ok(root, 'the counter page should contain an island root');
  assert.notEqual(root.style.display, 'contents', 'observable island roots must own a layout box');

  const props = JSON.parse(root.getAttribute('data-deshi-props') || '{}');
  const islandDir = path.join(dist, '_deshi/islands');
  const chunk = fs.readdirSync(islandDir).find((name) => name.endsWith('.js'));
  assert.ok(chunk, 'the build should emit a client island chunk');

  const cacheBust = `?test=${Date.now()}`;
  const module = await import(pathToFileURL(path.join(islandDir, chunk)).href + cacheBust);
  assert.equal(typeof module.default, 'function', 'the island chunk should export a mount function');

  module.default(root, { props, url: window.location.href });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const output = root.querySelector('.counter-value');
  const buttons = root.querySelectorAll('button');
  assert.equal(output?.textContent, '0');
  assert.equal(buttons.length, 2);

  buttons[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(output?.textContent, '1', 'the hydrated counter should respond to a click');
  assert.deepEqual(errors, [], `React hydration should not report errors:\n${errors.join('\n')}`);
  console.log('Island hydration: counter incremented from 0 to 1 without React errors.');
} finally {
  console.error = originalError;
  dom.window.close();
}
