'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanMods, setEntryEnabled } = require('../src/core/mods');

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scum-mods-'));
  const paks = path.join(root, 'Content', 'Paks');
  const mods = path.join(paks, '~Mods');
  write(path.join(mods, 'A', 'same.pak'), Buffer.alloc(100, 1));
  write(path.join(mods, 'B', 'same.pak'), Buffer.alloc(200, 2));
  write(path.join(mods, 'B', 'same.sig'), 'sig');
  write(path.join(mods, 'C', 'unique.pak'), Buffer.alloc(300, 3));
  return { root, paks, mods };
}

test('scanMods reports totals and duplicate .pak basenames', async () => {
  const { mods } = setup();
  const scan = await scanMods(mods);
  assert.strictEqual(scan.exists, true);
  assert.strictEqual(scan.fileCount, 4);
  assert.strictEqual(scan.totalBytes, 600 + 3);
  assert.strictEqual(scan.conflicts.length, 1);
  assert.strictEqual(scan.conflicts[0].name, 'same.pak');
  assert.strictEqual(scan.conflicts[0].paths.length, 2);
  assert.strictEqual(scan.topLevel.length, 3);
});

test('setEntryEnabled moves a folder outside ~Mods and back', async () => {
  const { paks, mods } = setup();
  const res = await setEntryEnabled(mods, 'A', false);
  assert.strictEqual(res.enabled, false);
  assert.strictEqual(fs.existsSync(path.join(mods, 'A')), false);
  assert.strictEqual(fs.existsSync(path.join(paks, '~Mods.disabled', 'A', 'same.pak')), true);

  const back = await setEntryEnabled(mods, 'A', true);
  assert.strictEqual(back.enabled, true);
  assert.strictEqual(fs.existsSync(path.join(mods, 'A', 'same.pak')), true);
  assert.strictEqual(fs.existsSync(path.join(paks, '~Mods.disabled', 'A')), false);
});

test('setEntryEnabled moves a .pak and its .sig together', async () => {
  const { mods } = setup();
  await setEntryEnabled(mods, path.join('B', 'same.pak'), false);
  assert.strictEqual(fs.existsSync(path.join(mods, 'B', 'same.pak')), false);
  assert.strictEqual(fs.existsSync(path.join(mods, 'B', 'same.sig')), false);
  assert.strictEqual(fs.existsSync(path.join(mods, '..', '~Mods.disabled', 'B', 'same.pak')), true);
  assert.strictEqual(fs.existsSync(path.join(mods, '..', '~Mods.disabled', 'B', 'same.sig')), true);
});

test('setEntryEnabled restores the .sig companion when re-enabling a .pak', async () => {
  const { mods } = setup();
  await setEntryEnabled(mods, path.join('B', 'same.pak'), false);
  await setEntryEnabled(mods, path.join('B', 'same.pak'), true);
  assert.strictEqual(fs.existsSync(path.join(mods, 'B', 'same.pak')), true);
  assert.strictEqual(fs.existsSync(path.join(mods, 'B', 'same.sig')), true);
  assert.strictEqual(fs.existsSync(path.join(mods, '..', '~Mods.disabled', 'B')), false);
});

test('setEntryEnabled recreates ~Mods when re-enabling while it is absent', async () => {
  const { mods, paks } = setup();
  await setEntryEnabled(mods, path.join('B', 'same.pak'), false);
  fs.rmSync(mods, { recursive: true, force: true });
  await setEntryEnabled(mods, path.join('B', 'same.pak'), true);
  assert.strictEqual(fs.existsSync(path.join(mods, 'B', 'same.pak')), true);
  assert.strictEqual(fs.existsSync(path.join(paks, '~Mods.disabled', 'B', 'same.pak')), false);
});
