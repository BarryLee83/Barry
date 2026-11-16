'use strict';

const fs = require('fs');
const path = require('path');
const { mkdirpSync, existsSync } = require('./fsx');

const SCHEMA_VERSION = 1;
const THEMES = ['cyberpunk', 'apple', 'classic'];
const LANGUAGES = ['zh-CN', 'en'];
const MODES = ['copy', 'junction'];
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function defaultConfig() {
  return {
    schemaVersion: SCHEMA_VERSION,
    language: 'zh-CN',
    theme: 'cyberpunk',
    gameRoot: '',
    scumDataDir: '',
    mode: 'copy',
    safety: {
      trashKeep: 5,
      closeGame: 'ask',
      verify: true,
    },
    profiles: [],
    activeProfileId: null,
    activeSource: null,
    window: { width: 1200, height: 780, maximized: false },
    onboardingDone: false,
  };
}

function cleanString(value, max = 2048) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function cleanProfile(raw, usedIds) {
  if (!raw || typeof raw !== 'object') return null;
  let id = cleanString(raw.id, 32);
  if (!ID_RE.test(id)) return null;
  if (usedIds.has(id.toLowerCase())) return null;
  usedIds.add(id.toLowerCase());
  const profile = {
    id,
    name: cleanString(raw.name, 60) || `SCUM ${id}`,
    exePath: cleanString(raw.exePath, 1024),
    args: cleanString(raw.args, 1024),
    workDir: cleanString(raw.workDir, 1024),
    commandLineKeyword: cleanString(raw.commandLineKeyword, 200),
    noMods: !!raw.noMods,
    autoDiscovered: !!raw.autoDiscovered,
  };
  return profile;
}

function validateConfig(input) {
  const base = defaultConfig();
  const raw = input && typeof input === 'object' ? input : {};
  const cfg = { ...base, ...raw };
  cfg.schemaVersion = SCHEMA_VERSION;
  cfg.language = LANGUAGES.includes(raw.language) ? raw.language : base.language;
  cfg.theme = THEMES.includes(raw.theme) ? raw.theme : base.theme;
  cfg.mode = MODES.includes(raw.mode) ? raw.mode : base.mode;
  cfg.gameRoot = cleanString(raw.gameRoot, 1024);
  cfg.scumDataDir = cleanString(raw.scumDataDir, 1024);
  cfg.activeProfileId = typeof raw.activeProfileId === 'string' ? cleanString(raw.activeProfileId, 32) : null;
  cfg.activeSource = ['detected', 'remembered', 'manual', 'launched'].includes(raw.activeSource)
    ? raw.activeSource
    : null;
  cfg.safety = { ...base.safety, ...(raw.safety && typeof raw.safety === 'object' ? raw.safety : {}) };
  cfg.safety.trashKeep = Math.min(50, Math.max(2, Number(cfg.safety.trashKeep) || 5));
  cfg.safety.closeGame = ['ask', 'force'].includes(cfg.safety.closeGame) ? cfg.safety.closeGame : 'ask';
  cfg.safety.verify = cfg.safety.verify !== false;
  cfg.window = { ...base.window, ...(raw.window && typeof raw.window === 'object' ? raw.window : {}) };
  cfg.window.width = Math.max(980, Number(cfg.window.width) || 1200);
  cfg.window.height = Math.max(660, Number(cfg.window.height) || 780);
  cfg.window.maximized = !!cfg.window.maximized;
  cfg.onboardingDone = !!raw.onboardingDone;

  const used = new Set();
  cfg.profiles = Array.isArray(raw.profiles)
    ? raw.profiles.map((p) => cleanProfile(p, used)).filter(Boolean)
    : [];
  if (cfg.activeProfileId && !cfg.profiles.some((p) => p.id === cfg.activeProfileId)) {
    cfg.activeProfileId = null;
    cfg.activeSource = null;
  }
  return cfg;
}

function loadConfig(file) {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // keep a damaged copy for inspection, then start fresh
      try {
        fs.copyFileSync(file, `${file}.damaged-${Date.now()}`);
      } catch {
        /* ignore */
      }
    }
  }
  return { config: validateConfig(raw), existed: !!raw };
}

function saveConfig(file, config) {
  const cfg = validateConfig(config);
  mkdirpSync(path.dirname(file));
  if (existsSync(file)) {
    try {
      fs.copyFileSync(file, `${file}.bak`);
    } catch {
      /* ignore */
    }
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  // Windows rename over an existing file can transiently fail (AV/indexer).
  let lastError = null;
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(tmp, file);
      return cfg;
    } catch (err) {
      lastError = err;
      if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') break;
      const until = Date.now() + 120;
      while (Date.now() < until) {
        /* tiny sync backoff */
      }
    }
  }
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  throw lastError;
}

function buildPaths(config) {
  const gameRoot = config.gameRoot ? path.resolve(config.gameRoot) : '';
  const scumDataDir = config.scumDataDir ? path.resolve(config.scumDataDir) : '';
  const contentDir = gameRoot ? path.join(gameRoot, 'SCUM', 'Content') : '';
  const paksDir = contentDir ? path.join(contentDir, 'Paks') : '';
  return {
    gameRoot,
    scumDataDir,
    contentDir,
    paksDir,
    savedLive: scumDataDir ? path.join(scumDataDir, 'Saved') : '',
    savedProfile: (id) => (scumDataDir ? path.join(scumDataDir, `Saved.${id}`) : ''),
    savedTrash: scumDataDir ? path.join(scumDataDir, '.switcher-trash') : '',
    modsLive: paksDir ? path.join(paksDir, '~Mods') : '',
    modsProfile: (id) => (contentDir ? path.join(contentDir, `~Mods.${id}`) : ''),
    modsTrash: contentDir ? path.join(contentDir, '.switcher-trash') : '',
  };
}

function isValidProfileId(id) {
  return ID_RE.test(String(id || ''));
}

function discoverExistingIds(paths) {
  const found = new Map();
  const scan = (dir, re, source) => {
    let items = [];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      if (!it.isDirectory() && !it.isSymbolicLink()) continue;
      const m = re.exec(it.name);
      if (!m) continue;
      const id = m[1];
      if (!isValidProfileId(id)) continue;
      const key = id.toLowerCase();
      if (!found.has(key)) found.set(key, { id, saved: false, mods: false, sources: [] });
      const entry = found.get(key);
      if (source === 'saved') entry.saved = true;
      if (source === 'mods') entry.mods = true;
      if (!entry.sources.includes(source)) entry.sources.push(source);
    }
  };
  if (paths.scumDataDir) scan(paths.scumDataDir, /^Saved\.(.+)$/i, 'saved');
  if (paths.contentDir) scan(paths.contentDir, /^~Mods\.(.+)$/i, 'mods');
  return Array.from(found.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function mergeDiscoveredProfiles(config, discovered) {
  const existing = new Set(config.profiles.map((p) => p.id.toLowerCase()));
  let added = 0;
  for (const d of discovered) {
    if (existing.has(d.id.toLowerCase())) continue;
    config.profiles.push({
      id: d.id,
      name: `SCUM ${d.id}`,
      exePath: '',
      args: '',
      workDir: '',
      commandLineKeyword: '',
      noMods: false,
      autoDiscovered: true,
    });
    existing.add(d.id.toLowerCase());
    added++;
  }
  return added;
}

module.exports = {
  SCHEMA_VERSION,
  THEMES,
  LANGUAGES,
  MODES,
  ID_RE,
  defaultConfig,
  validateConfig,
  loadConfig,
  saveConfig,
  buildPaths,
  isValidProfileId,
  discoverExistingIds,
  mergeDiscoveredProfiles,
};
