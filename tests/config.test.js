'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateConfig,
  loadConfig,
  saveConfig,
  buildPaths,
  discoverExistingIds,
  mergeDiscoveredProfiles,
  defaultConfig,
} = require('../src/core/config');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scum-cfg-'));
}

test('validateConfig repairs bad values and rejects invalid/duplicate ids', () => {
  const cfg = validateConfig({
    theme: 'nope',
    language: 'fr',
    mode: 'magic',
    safety: { trashKeep: 999, closeGame: 'x' },
    profiles: [
      { id: '0509', name: 'a' },
      { id: '0509', name: 'dup' },
      { id: 'bad id', name: 'bad' },
      { id: '8805', name: 'b' },
    ],
  });
  assert.strictEqual(cfg.theme, 'cyberpunk');
  assert.strictEqual(cfg.language, 'zh-CN');
  assert.strictEqual(cfg.mode, 'copy');
  assert.strictEqual(cfg.safety.trashKeep, 50);
  assert.strictEqual(cfg.safety.closeGame, 'ask');
  assert.deepStrictEqual(cfg.profiles.map((p) => p.id), ['0509', '8805']);
});

test('saveConfig writes atomically and keeps a .bak of the previous version', () => {
  const root = tmp();
  const file = path.join(root, 'config.json');
  const cfg = defaultConfig();
  cfg.profiles = [{ id: '0509', name: 'one' }];
  saveConfig(file, cfg);
  cfg.profiles[0].name = 'two';
  saveConfig(file, cfg);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).profiles[0].name, 'two');
  assert.strictEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')).profiles[0].name, 'one');
  const loaded = loadConfig(file);
  assert.strictEqual(loaded.config.profiles[0].name, 'two');
  assert.strictEqual(loaded.existed, true);
});

test('loadConfig falls back to defaults for a missing file', () => {
  const root = tmp();
  const loaded = loadConfig(path.join(root, 'missing.json'));
  assert.strictEqual(loaded.config.schemaVersion, 1);
  assert.strictEqual(loaded.existed, false);
});

test('buildPaths derives save/profile/mods paths', () => {
  const paths = buildPaths({
    gameRoot: 'E:\\Games\\SCUM',
    scumDataDir: 'C:\\Users\\X\\AppData\\Local\\SCUM',
  });
  assert.strictEqual(paths.savedLive, 'C:\\Users\\X\\AppData\\Local\\SCUM\\Saved');
  assert.strictEqual(paths.savedProfile('0509'), 'C:\\Users\\X\\AppData\\Local\\SCUM\\Saved.0509');
  assert.strictEqual(paths.modsLive, 'E:\\Games\\SCUM\\SCUM\\Content\\Paks\\~Mods');
  assert.strictEqual(paths.modsProfile('8805'), 'E:\\Games\\SCUM\\SCUM\\Content\\~Mods.8805');
});

test('discoverExistingIds finds Saved.<id> and ~Mods.<id> folders', () => {
  const root = tmp();
  const dataDir = path.join(root, 'SCUM');
  const content = path.join(root, 'Content');
  fs.mkdirSync(path.join(dataDir, 'Saved.0509'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'Saved'), { recursive: true });
  fs.mkdirSync(path.join(content, '~Mods.6646'), { recursive: true });
  fs.mkdirSync(path.join(content, '~Mods.bad id'), { recursive: true });
  const found = discoverExistingIds({ scumDataDir: dataDir, contentDir: content });
  assert.deepStrictEqual(found.map((f) => f.id), ['0509', '6646']);
  const cfg = defaultConfig();
  const added = mergeDiscoveredProfiles(cfg, found);
  assert.strictEqual(added, 2);
  assert.strictEqual(cfg.profiles.length, 2);
  assert.strictEqual(mergeDiscoveredProfiles(cfg, found), 0);
});
