'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateConfig, buildPaths } = require('../src/core/config');
const { runSwitch } = require('../src/core/switcher');
const fsx = require('../src/core/fsx');
const { detectFromList, profileMatchesProcess } = require('../src/core/processes');

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function setup(mode = 'copy') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scum-switch-'));
  const dataDir = path.join(root, 'LocalAppData', 'SCUM');
  const gameRoot = path.join(root, 'SteamLibrary', 'SCUM');
  const content = path.join(gameRoot, 'SCUM', 'Content');
  const paks = path.join(content, 'Paks');
  write(path.join(dataDir, 'Saved', 'SaveFiles', 'world.db'), 'SAVE-0509');
  write(path.join(paks, '~Mods', '0509.pak'), 'MOD-0509');
  write(path.join(dataDir, 'Saved.8805', 'SaveFiles', 'world.db'), 'SAVE-8805');
  write(path.join(content, '~Mods.8805', '8805.pak'), 'MOD-8805');
  const launcher = path.join(root, 'launcher8805.exe');
  write(launcher, 'dummy');

  const config = validateConfig({
    gameRoot,
    scumDataDir: dataDir,
    mode,
    profiles: [
      { id: '0509', name: '启动 0509 服', exePath: '' },
      { id: '8805', name: '启动 8805 服', exePath: launcher },
    ],
    safety: { trashKeep: 5 },
  });
  const paths = buildPaths(config);
  return { root, dataDir, gameRoot, content, paks, launcher, config, paths };
}

function fakeProc(overrides = {}) {
  return {
    detect: async () => ({ launchers: [], games: [], detectedProfileId: null }),
    killProcess: async () => ({ closed: true }),
    closeProcess: async () => ({ closed: true }),
    isPidAlive: () => false,
    findProfileProcesses: async () => [{ pid: 4321 }],
    ...overrides,
  };
}

async function run(env, fromId, toId, options = {}, proc = fakeProc()) {
  const journalFile = path.join(env.root, 'state', 'switch-journal.json');
  return runSwitch({
    config: env.config,
    paths: env.paths,
    fromId,
    toId,
    options,
    journalFile,
    deps: { processes: proc, launch: async () => ({ pid: 4321 }) },
    onProgress: () => {},
    onLog: () => {},
    t: (key, params) => {
      let s = key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
      return s;
    },
  });
}

test('copy mode switches Saved and ~Mods and remembers the active profile', async () => {
  const env = setup('copy');
  const result = await run(env, '0509', '8805');
  assert.strictEqual(result.ok, true, result.message);
  assert.strictEqual(read(path.join(env.dataDir, 'Saved', 'SaveFiles', 'world.db')), 'SAVE-8805');
  assert.strictEqual(read(path.join(env.dataDir, 'Saved.0509', 'SaveFiles', 'world.db')), 'SAVE-0509');
  assert.strictEqual(read(path.join(env.paks, '~Mods', '8805.pak')), 'MOD-8805');
  assert.strictEqual(read(path.join(env.content, '~Mods.0509', '0509.pak')), 'MOD-0509');
  assert.strictEqual(env.config.activeProfileId, '8805');
  assert.strictEqual(fs.existsSync(path.join(env.root, 'state', 'switch-journal.json')), false);
  assert.strictEqual(fs.existsSync(path.join(env.root, 'state', 'history.json')), true);
});

test('safety.verify=false skips copy verification', async () => {
  const env = setup('copy');
  env.config.safety.verify = false;
  const original = fsx.verifyCopy;
  fsx.verifyCopy = async () => {
    throw new Error('verify must not run when disabled');
  };
  try {
    const result = await run(env, '0509', '8805');
    assert.strictEqual(result.ok, true, result.message);
  } finally {
    fsx.verifyCopy = original;
  }
  assert.strictEqual(read(path.join(env.dataDir, 'Saved', 'SaveFiles', 'world.db')), 'SAVE-8805');
});

test('launch verification uses PID liveness instead of polling the process list', async () => {
  const env = setup('copy');
  let scanned = false;
  const proc = fakeProc({
    isPidAlive: () => true,
    findProfileProcesses: async () => {
      scanned = true;
      return [];
    },
  });
  const started = Date.now();
  const result = await run(env, '0509', '8805', {}, proc);
  const elapsed = Date.now() - started;
  assert.strictEqual(result.ok, true, result.message);
  assert.strictEqual(scanned, false);
  assert.deepStrictEqual(result.warnings, []);
  // Old code would spend 40 * (500ms + one process scan) here.
  assert.ok(elapsed < 5000, `switch took ${elapsed}ms`);
});

test('switching back keeps the newest live data in the profile folder', async () => {
  const env = setup('copy');
  let result = await run(env, '0509', '8805');
  assert.strictEqual(result.ok, true);
  // Simulate the game writing new data while 8805 is live.
  write(path.join(env.dataDir, 'Saved', 'SaveFiles', 'world.db'), 'SAVE-8805-NEW');
  write(path.join(env.paks, '~Mods', 'extra.pak'), 'NEW-MOD');
  result = await run(env, '8805', '0509');
  assert.strictEqual(result.ok, true, result.message);
  assert.strictEqual(read(path.join(env.dataDir, 'Saved', 'SaveFiles', 'world.db')), 'SAVE-0509');
  assert.strictEqual(read(path.join(env.dataDir, 'Saved.8805', 'SaveFiles', 'world.db')), 'SAVE-8805-NEW');
  assert.strictEqual(read(path.join(env.paks, '~Mods', '0509.pak')), 'MOD-0509');
  assert.strictEqual(read(path.join(env.content, '~Mods.8805', 'extra.pak')), 'NEW-MOD');
});

test('junction mode links live folders and is instant', async () => {
  const env = setup('junction');
  const result = await run(env, '0509', '8805');
  assert.strictEqual(result.ok, true, result.message);
  assert.strictEqual(fsx.isLinkSync(path.join(env.dataDir, 'Saved')), true);
  assert.strictEqual(fsx.isLinkSync(path.join(env.paks, '~Mods')), true);
  assert.strictEqual(
    fsx.samePath(fsx.readLinkSync(path.join(env.dataDir, 'Saved')), path.join(env.dataDir, 'Saved.8805')),
    true
  );
  assert.strictEqual(read(path.join(env.dataDir, 'Saved', 'SaveFiles', 'world.db')), 'SAVE-8805');
  assert.strictEqual(read(path.join(env.paks, '~Mods', '8805.pak')), 'MOD-8805');

  const back = await run(env, '8805', '0509');
  assert.strictEqual(back.ok, true, back.message);
  assert.strictEqual(
    fsx.samePath(fsx.readLinkSync(path.join(env.dataDir, 'Saved')), path.join(env.dataDir, 'Saved.0509')),
    true
  );
  assert.strictEqual(read(path.join(env.dataDir, 'Saved', 'SaveFiles', 'world.db')), 'SAVE-0509');
  assert.strictEqual(read(path.join(env.paks, '~Mods', '0509.pak')), 'MOD-0509');
});

test('missing target mods aborts before touching anything', async () => {
  const env = setup('copy');
  fs.rmSync(path.join(env.content, '~Mods.8805'), { recursive: true, force: true });
  const result = await run(env, '0509', '8805');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'TARGET_MODS_MISSING');
  assert.strictEqual(read(path.join(env.dataDir, 'Saved', 'SaveFiles', 'world.db')), 'SAVE-0509');
  assert.strictEqual(fs.existsSync(path.join(env.dataDir, 'Saved.0509')), false);
  assert.strictEqual(read(path.join(env.paks, '~Mods', '0509.pak')), 'MOD-0509');
});

test('missing target saved asks the caller for a strategy', async () => {
  const env = setup('copy');
  fs.rmSync(path.join(env.dataDir, 'Saved.8805'), { recursive: true, force: true });
  const result = await run(env, '0509', '8805');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'TARGET_SAVED_MISSING');
  assert.strictEqual(result.info.canClone, true);
});

test('createEmptySaved creates a new profile and switches', async () => {
  const env = setup('copy');
  fs.rmSync(path.join(env.dataDir, 'Saved.8805'), { recursive: true, force: true });
  const result = await run(env, '0509', '8805', { createEmptySaved: true });
  assert.strictEqual(result.ok, true, result.message);
  assert.strictEqual(fs.existsSync(path.join(env.dataDir, 'Saved')), true);
  assert.strictEqual(fs.readdirSync(path.join(env.dataDir, 'Saved')).length, 0);
});

test('a failure during copy rolls everything back', async () => {
  const env = setup('copy');
  const original = fsx.copyDir;
  fsx.copyDir = async (src, dst, opts) => {
    await original(src, dst, opts);
    throw new Error('injected copy failure');
  };
  let result;
  try {
    result = await run(env, '0509', '8805');
  } finally {
    fsx.copyDir = original;
  }
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.rolledBack, true);
  assert.strictEqual(read(path.join(env.dataDir, 'Saved', 'SaveFiles', 'world.db')), 'SAVE-0509');
  assert.strictEqual(fs.existsSync(path.join(env.dataDir, 'Saved.0509')), false);
  assert.strictEqual(read(path.join(env.paks, '~Mods', '0509.pak')), 'MOD-0509');
  assert.strictEqual(fs.existsSync(path.join(env.root, 'state', 'switch-journal.json')), false);
});

test('game running blocks the switch unless force is allowed', async () => {
  const env = setup('copy');
  const proc = fakeProc({
    detect: async () => ({ launchers: [], games: [{ pid: 777, name: 'SCUM.exe', exePath: 'x' }] }),
  });
  const blocked = await run(env, '0509', '8805', {}, proc);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, 'GAME_RUNNING');
  assert.strictEqual(read(path.join(env.dataDir, 'Saved', 'SaveFiles', 'world.db')), 'SAVE-0509');
});

test('process matching uses full path and optional command-line keyword', () => {
  const profile = {
    exePath: 'C:\\Tools\\Launcher.exe',
    commandLineKeyword: 'server=8805',
  };
  const good = {
    pid: 1,
    exePath: 'c:/tools/launcher.exe',
    commandLine: '"C:\\Tools\\Launcher.exe" --server=8805',
  };
  const noKeyword = { pid: 2, exePath: 'C:\\Tools\\Launcher.exe', commandLine: '"C:\\Tools\\Launcher.exe"' };
  const other = { pid: 3, exePath: 'C:\\Tools\\Other.exe', commandLine: '--server=8805' };
  assert.strictEqual(profileMatchesProcess(profile, good), true);
  assert.strictEqual(profileMatchesProcess(profile, noKeyword), false);
  assert.strictEqual(profileMatchesProcess(profile, other), false);
});

test('detectFromList reports launchers and the SCUM game process', () => {
  const config = {
    profiles: [{ id: '0509', exePath: 'C:\\L\\0509.exe', commandLineKeyword: '' }],
  };
  const paths = { gameRoot: 'E:\\SteamLibrary\\steamapps\\common\\SCUM' };
  const procs = [
    { pid: 10, name: '0509.exe', exePath: 'C:\\L\\0509.exe', commandLine: 'x' },
    { pid: 20, name: 'SCUM.exe', exePath: 'E:\\SteamLibrary\\steamapps\\common\\SCUM\\SCUM\\Binaries\\Win64\\SCUM.exe', commandLine: 'y' },
    { pid: 30, name: 'notepad.exe', exePath: 'C:\\Windows\\notepad.exe', commandLine: 'z' },
  ];
  const state = detectFromList(config, paths, procs);
  assert.strictEqual(state.detectedProfileId, '0509');
  assert.strictEqual(state.launchers.length, 1);
  assert.strictEqual(state.games.length, 1);
  assert.strictEqual(state.games[0].pid, 20);
});
