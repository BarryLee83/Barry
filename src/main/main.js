'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  loadConfig,
  saveConfig,
  validateConfig,
  buildPaths,
  discoverExistingIds,
  mergeDiscoveredProfiles,
  isValidProfileId,
} = require('../core/config');
const { runSwitch } = require('../core/switcher');
const { loadJournal, clearJournal, readHistory } = require('../core/journal');
const { rollbackJournal } = require('../core/rollback');
const processes = require('../core/processes');
const fsx = require('../core/fsx');
const { scanMods, setEntryEnabled } = require('../core/mods');
const { CATEGORIES, COMMANDS } = require('../data/admin-commands');
const { makeT } = require('../core/messages');

// Keep user data in a predictable ASCII folder, even if productName changes.
app.setPath('userData', path.join(app.getPath('appData'), 'SCUM-Switcher'));
if (process.platform === 'win32') app.setAppUserModelId('SCUM.ServerSwitcher');

const ICON_FILE = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');
const USER_DATA = app.getPath('userData');
const CONFIG_FILE = path.join(USER_DATA, 'config.json');
const JOURNAL_FILE = path.join(USER_DATA, 'switch-journal.json');
const HISTORY_FILE = path.join(USER_DATA, 'history.json');
const CUSTOM_COMMANDS_FILE = path.join(USER_DATA, 'admin-custom.json');
const MAP_FILE = path.join(USER_DATA, 'map-config.json');
const LOG_DIR = path.join(USER_DATA, 'logs');

const OVERLAY = {
  cyberpunk: { color: '#080c16', symbolColor: '#d8f4ff', bg: '#080c16' },
  apple: { color: '#f5f5f7', symbolColor: '#1d1d1f', bg: '#f5f5f7' },
  classic: { color: '#0a246a', symbolColor: '#ffffff', bg: '#d4d0c8' },
};

let win = null;
let config = null;
let detectedCache = null;
let detectedAt = 0;
let switchState = null;
let pollTimer = null;
let quitting = false;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function logLine(level, message) {
  try {
    ensureDir(LOG_DIR);
    const stamp = new Date().toISOString();
    const day = stamp.slice(0, 10);
    fs.appendFileSync(path.join(LOG_DIR, `app-${day}.log`), `[${stamp}] [${level}] ${message}\n`, 'utf8');
  } catch {
    /* logging must never break the app */
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function getPaths() {
  return buildPaths(config);
}

function detectGameRoot() {
  const candidates = [];
  const steamRoots = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'E:\\Steam',
    'D:\\SteamLibrary',
    'E:\\SteamLibrary',
  ];
  for (const steamRoot of steamRoots) {
    const vdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
    try {
      if (!fs.existsSync(vdf)) continue;
      const text = fs.readFileSync(vdf, 'utf8');
      const re = /"path"\s+"([^"]+)"/g;
      let m;
      while ((m = re.exec(text))) {
        candidates.push(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps', 'common', 'SCUM'));
      }
    } catch {
      /* ignore */
    }
  }
  candidates.push(
    'E:\\SteamLibrary\\steamapps\\common\\SCUM',
    'D:\\SteamLibrary\\steamapps\\common\\SCUM',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SCUM',
    'C:\\Program Files\\Steam\\steamapps\\common\\SCUM'
  );
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'SCUM', 'Content', 'Paks'))) return c;
    } catch {
      /* ignore */
    }
  }
  return '';
}

function detectScumDataDir() {
  const base = process.env.LOCALAPPDATA || path.join(app.getPath('appData'), '..', 'Local');
  const p = path.join(base, 'SCUM');
  try {
    if (fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  return p;
}

function initializeConfig() {
  const loaded = loadConfig(CONFIG_FILE);
  config = loaded.config;
  let changed = false;

  if (!config.scumDataDir) {
    const detected = detectScumDataDir();
    if (detected) {
      config.scumDataDir = detected;
      changed = true;
    }
  }
  if (!config.gameRoot) {
    const detected = detectGameRoot();
    if (detected) {
      config.gameRoot = detected;
      changed = true;
    }
  }

  const paths = buildPaths(config);
  const discovered = discoverExistingIds(paths);
  if (!loaded.existed || (!config.profiles.length && discovered.length)) {
    const added = mergeDiscoveredProfiles(config, discovered);
    if (added) changed = true;
  }

  if (changed || !loaded.existed) {
    try {
      config = saveConfig(CONFIG_FILE, config);
    } catch (err) {
      logLine('error', `Failed to save initial config: ${err.message}`);
    }
  }
  logLine('info', `Config loaded (${config.profiles.length} profiles, mode=${config.mode})`);
}

function determineCurrent(detected) {
  if (detected && detected.detectedProfileId) {
    return { profileId: detected.detectedProfileId, source: 'detected' };
  }
  if (config.activeProfileId) {
    return { profileId: config.activeProfileId, source: config.activeSource || 'remembered' };
  }
  return { profileId: null, source: null };
}

async function detectProcesses(force = false) {
  if (!force && detectedCache && Date.now() - detectedAt < 2000) return detectedCache;
  try {
    const state = await processes.detect(config, getPaths());
    detectedCache = { ...state, error: null };
  } catch (err) {
    detectedCache = { launchers: [], games: [], detectedProfileId: null, error: err.message };
    logLine('warn', `Process detection failed: ${err.message}`);
  }
  detectedAt = Date.now();
  return detectedCache;
}

function profileInfo(detected) {
  const paths = getPaths();
  return config.profiles.map((p) => {
    const savedPath = paths.savedProfile(p.id);
    const modsPath = paths.modsProfile(p.id);
    const running = (detected.launchers || []).filter((l) => l.profileId === p.id).map((l) => l.pid);
    return {
      ...p,
      savedPath,
      savedExists: fsx.existsSync(savedPath),
      modsPath,
      modsExists: fsx.existsSync(modsPath),
      launcherExists: p.exePath ? fs.existsSync(p.exePath) : null,
      runningPids: running,
    };
  });
}

async function buildState(forceDetect = false) {
  const detected = await detectProcesses(forceDetect);
  const paths = getPaths();

  if (
    detected.detectedProfileId &&
    !detected.error &&
    (detected.launchers || []).length === 1 &&
    config.activeProfileId !== detected.detectedProfileId
  ) {
    config.activeProfileId = detected.detectedProfileId;
    config.activeSource = 'detected';
    try {
      saveConfig(CONFIG_FILE, config);
    } catch {
      /* ignore */
    }
  }

  const current = determineCurrent(detected);
  const journal = loadJournal(JOURNAL_FILE);
  const recovery =
    journal && !['completed', 'rolledback', 'dismissed'].includes(journal.status) ? journal : null;
  if (journal && ['completed', 'rolledback', 'dismissed'].includes(journal.status)) {
    clearJournal(JOURNAL_FILE);
  }

  const gameRootValid = !!(paths.gameRoot && fsx.existsSync(paths.paksDir));
  const dataDirValid = !!(paths.scumDataDir && fsx.existsSync(paths.scumDataDir));

  return {
    config,
    // buildPaths() contains helper functions, which cannot cross IPC.
    paths: {
      gameRoot: paths.gameRoot,
      scumDataDir: paths.scumDataDir,
      contentDir: paths.contentDir,
      paksDir: paths.paksDir,
      savedLive: paths.savedLive,
      savedTrash: paths.savedTrash,
      modsLive: paths.modsLive,
      modsTrash: paths.modsTrash,
    },
    current,
    detected,
    gameRootValid,
    dataDirValid,
    profiles: profileInfo(detected),
    discoveries: discoverExistingIds(paths).filter(
      (d) => !config.profiles.some((p) => p.id.toLowerCase() === d.id.toLowerCase())
    ),
    recovery,
    history: readHistory(HISTORY_FILE, 30),
    app: {
      version: app.getVersion(),
      userData: USER_DATA,
      logs: LOG_DIR,
      electron: process.versions.electron,
      platform: process.platform,
      switched: !!switchState,
      mode: config.mode,
    },
  };
}

function sanitizeSwitchOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    createEmptySaved: !!o.createEmptySaved,
    cloneCurrent: !!o.cloneCurrent,
    noMods: !!o.noMods,
    forceKillGame: !!o.forceKillGame,
  };
}

function currentWindowOverlay() {
  return OVERLAY[config.theme] || OVERLAY.cyberpunk;
}

function applyTheme(theme) {
  const o = OVERLAY[theme] || OVERLAY.cyberpunk;
  if (win && !win.isDestroyed()) {
    try {
      win.setBackgroundColor(o.bg);
      if (typeof win.setTitleBarOverlay === 'function') {
        win.setTitleBarOverlay({ color: o.color, symbolColor: o.symbolColor, height: 40 });
      }
    } catch {
      /* not supported on this platform */
    }
  }
}

function createWindow() {
  const overlay = currentWindowOverlay();
  win = new BrowserWindow({
    width: Math.max(980, config.window.width || 1200),
    height: Math.max(660, config.window.height || 780),
    minWidth: 980,
    minHeight: 660,
    show: false,
    backgroundColor: overlay.bg,
    icon: fs.existsSync(ICON_FILE) ? ICON_FILE : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: overlay.color, symbolColor: overlay.symbolColor, height: 40 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    if (config.window.maximized) win.maximize();
    win.show();
  });

  win.on('resize', () => {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized()) return;
    const [width, height] = win.getSize();
    config.window.width = width;
    config.window.height = height;
  });

  win.on('maximize', () => {
    config.window.maximized = true;
  });
  win.on('unmaximize', () => {
    config.window.maximized = false;
  });

  win.on('close', (e) => {
    if (switchState && !quitting) {
      e.preventDefault();
      dialog
        .showMessageBox(win, {
          type: 'warning',
          buttons: ['OK'],
          defaultId: 0,
          title: 'SCUM Server Switcher',
          message:
            config.language === 'en'
              ? 'A switch is still running. Please wait for it to finish.'
              : '正在切换中，请等待完成后再关闭。',
        })
        .catch(() => {});
      return;
    }
    try {
      saveConfig(CONFIG_FILE, config);
    } catch {
      /* ignore */
    }
  });

  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  let polling = false;
  pollTimer = setInterval(async () => {
    // A PowerShell process scan can take longer than 5s on a busy machine.
    // Never let two scans overlap and deliver results out of order.
    if (polling) return;
    if (!win || win.isDestroyed() || !win.isVisible() || switchState) return;
    polling = true;
    try {
      const detected = await detectProcesses(true);
      send('state:detected', {
        detected,
        current: determineCurrent(detected),
        profiles: profileInfo(detected),
      });
    } catch {
      /* ignore polling errors */
    } finally {
      polling = false;
    }
  }, 5000);
}

function setupIpc() {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await fn(event, ...args);
      } catch (err) {
        logLine('error', `${channel}: ${err.stack || err.message}`);
        return { ok: false, code: err.code || 'IPC_ERROR', message: err.message };
      }
    });
  };

  handle('state:get', async () => ({ ok: true, state: await buildState(false) }));
  handle('state:refresh', async () => ({ ok: true, state: await buildState(true) }));

  handle('switch:start', async (_event, payload) => {
    if (switchState) {
      return { ok: false, code: 'BUSY', message: config.language === 'en' ? 'A switch is already running' : '正在切换中' };
    }
    const fromId = payload && payload.fromId;
    const toId = payload && payload.toId;
    if (!fromId || !isValidProfileId(fromId)) {
      return { ok: false, code: 'CURRENT_UNKNOWN', message: config.language === 'en' ? 'Current profile is unknown' : '当前配置未确定' };
    }
    if (!toId || !isValidProfileId(toId)) {
      return { ok: false, code: 'PROFILE_MISSING', message: config.language === 'en' ? 'Target profile is invalid' : '目标配置无效' };
    }
    const existing = loadJournal(JOURNAL_FILE);
    if (existing && !['completed', 'rolledback', 'dismissed'].includes(existing.status)) {
      return {
        ok: false,
        code: 'ACTIVE_JOURNAL',
        message:
          config.language === 'en'
            ? 'A previous switch is unfinished. Roll it back or dismiss it first.'
            : '上一次切换尚未完成，请先回滚或清除记录。',
        recovery: existing,
      };
    }

    const signal = { aborted: false };
    switchState = { signal, startedAt: Date.now() };
    try {
      const result = await runSwitch({
        config,
        paths: getPaths(),
        fromId,
        toId,
        options: sanitizeSwitchOptions(payload.options),
        journalFile: JOURNAL_FILE,
        signal,
        t: makeT(config.language),
        onProgress: (p) => send('switch:progress', p),
        onLog: (entry) => {
          send('switch:log', entry);
          logLine(entry.level || 'info', entry.message || '');
        },
      });

      try {
        config = saveConfig(CONFIG_FILE, config);
      } catch (err) {
        logLine('error', `Failed to save config after switch: ${err.message}`);
        result.warnings = result.warnings || [];
        result.warnings.push(
          config.language === 'en' ? 'Settings could not be saved.' : '设置保存失败，请检查目录权限。'
        );
      }
      if (result.ok) {
        send('state:changed', { state: await buildState(true) });
      }
      return result;
    } finally {
      switchState = null;
      detectedCache = null;
    }
  });

  handle('switch:cancel', async () => {
    if (!switchState) return { ok: false, code: 'IDLE', message: 'No switch running' };
    switchState.signal.aborted = true;
    return { ok: true };
  });

  handle('config:update', async (_event, patch) => {
    if (!patch || typeof patch !== 'object') return { ok: false, message: 'Invalid patch' };
    const allowed = ['language', 'theme', 'mode', 'safety', 'onboardingDone', 'window', 'gameRoot', 'scumDataDir'];
    const next = { ...config };
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
    }
    config = saveConfig(CONFIG_FILE, next);
    applyTheme(config.theme);
    return { ok: true, config, state: await buildState(true) };
  });

  handle('current:set', async (_event, profileId) => {
    if (profileId && !config.profiles.some((p) => p.id === profileId)) {
      return { ok: false, message: 'Unknown profile' };
    }
    config.activeProfileId = profileId || null;
    config.activeSource = profileId ? 'manual' : null;
    config = saveConfig(CONFIG_FILE, config);
    return { ok: true, config, state: await buildState(true) };
  });

  handle('profile:add', async (_event, raw) => {
    const id = String((raw && raw.id) || '').trim();
    if (!isValidProfileId(id)) {
      return { ok: false, code: 'INVALID_ID', message: config.language === 'en' ? 'ID may only contain letters, digits, _ and -' : '编号只能包含字母、数字、_ 和 -' };
    }
    if (config.profiles.some((p) => p.id.toLowerCase() === id.toLowerCase())) {
      return { ok: false, code: 'DUPLICATE_ID', message: config.language === 'en' ? 'This ID already exists' : '该编号已存在' };
    }
    config.profiles.push({
      id,
      name: String((raw && raw.name) || `SCUM ${id}`).trim().slice(0, 60),
      exePath: String((raw && raw.exePath) || ''),
      args: String((raw && raw.args) || ''),
      workDir: String((raw && raw.workDir) || ''),
      commandLineKeyword: String((raw && raw.commandLineKeyword) || ''),
      noMods: !!(raw && raw.noMods),
    });
    config = saveConfig(CONFIG_FILE, config);
    return { ok: true, config, state: await buildState(true) };
  });

  handle('profile:update', async (_event, payload) => {
    const profile = config.profiles.find((p) => p.id === (payload && payload.id));
    if (!profile) return { ok: false, message: 'Profile not found' };
    const patch = (payload && payload.patch) || {};
    for (const key of ['name', 'exePath', 'args', 'workDir', 'commandLineKeyword']) {
      if (typeof patch[key] === 'string') profile[key] = patch[key].replace(/[\r\n]+/g, ' ').trim();
    }
    if (typeof patch.noMods === 'boolean') profile.noMods = patch.noMods;
    config = saveConfig(CONFIG_FILE, config);
    return { ok: true, config, state: await buildState(true) };
  });

  handle('profile:delete', async (_event, id) => {
    const index = config.profiles.findIndex((p) => p.id === id);
    if (index < 0) return { ok: false, message: 'Profile not found' };
    const [removed] = config.profiles.splice(index, 1);
    if (config.activeProfileId === removed.id) {
      config.activeProfileId = null;
      config.activeSource = null;
    }
    config = saveConfig(CONFIG_FILE, config);
    return {
      ok: true,
      config,
      state: await buildState(true),
      note: config.language === 'en'
        ? 'Profile removed from the list. Files on disk were not deleted.'
        : '配置已从列表移除，磁盘上的文件没有删除。',
    };
  });

  handle('profile:autodetect', async () => {
    const discovered = discoverExistingIds(getPaths());
    const added = mergeDiscoveredProfiles(config, discovered);
    if (added) config = saveConfig(CONFIG_FILE, config);
    return { ok: true, added, config, state: await buildState(true) };
  });

  handle('dialog:pickFile', async (_event, options) => {
    const opts = options || {};
    const result = await dialog.showOpenDialog(win, {
      title: opts.title || 'Select file',
      defaultPath: typeof opts.defaultPath === 'string' && opts.defaultPath ? opts.defaultPath : undefined,
      properties: ['openFile'],
      filters: Array.isArray(opts.filters) ? opts.filters : [{ name: 'Executable', extensions: ['exe'] }],
    });
    if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  handle('dialog:pickFolder', async (_event, options) => {
    const opts = options || {};
    const result = await dialog.showOpenDialog(win, {
      title: opts.title || 'Select folder',
      defaultPath: typeof opts.defaultPath === 'string' && opts.defaultPath ? opts.defaultPath : undefined,
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  handle('shell:openPath', async (_event, p) => {
    const target = String(p || '');
    if (!target) return { ok: false, message: 'Empty path' };
    const error = await shell.openPath(target);
    return error ? { ok: false, message: error } : { ok: true };
  });

  handle('shell:showItem', async (_event, p) => {
    const target = String(p || '');
    if (!target) return { ok: false, message: 'Empty path' };
    shell.showItemInFolder(target);
    return { ok: true };
  });

  handle('clipboard:write', async (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  handle('profile:launch', async (_event, id) => {
    const profile = config.profiles.find((p) => p.id === id);
    if (!profile) return { ok: false, code: 'PROFILE_MISSING', message: 'Profile not found' };
    if (!profile.exePath) {
      return {
        ok: false,
        code: 'NO_LAUNCHER',
        message: config.language === 'en' ? 'No launcher path configured' : '该配置未设置启动器路径',
      };
    }
    if (!fs.existsSync(profile.exePath)) {
      return {
        ok: false,
        code: 'LAUNCHER_MISSING',
        message: config.language === 'en' ? 'Launcher not found' : '启动器不存在',
      };
    }
    const detected = await detectProcesses(true);
    if ((detected.launchers || []).some((l) => l.profileId === id)) {
      return { ok: true, alreadyRunning: true };
    }
    try {
      const result = await processes.launchProcess(
        profile.exePath,
        profile.args || '',
        profile.workDir || path.dirname(profile.exePath)
      );
      return { ok: true, pid: result.pid };
    } catch (err) {
      return { ok: false, code: err.code || 'LAUNCH_FAILED', message: err.message };
    }
  });

  handle('path:autodetect', async () => {
    const gameRoot = detectGameRoot();
    const scumDataDir = detectScumDataDir();
    const next = { ...config };
    if (gameRoot) next.gameRoot = gameRoot;
    if (scumDataDir && fsx.existsSync(scumDataDir)) next.scumDataDir = scumDataDir;
    config = saveConfig(CONFIG_FILE, next);
    return { ok: true, config, gameRoot, scumDataDir, state: await buildState(true) };
  });

  handle('mods:scan', async (_event, which) => {
    let target = getPaths().modsLive;
    if (which && which.profileId) {
      if (!config.profiles.some((p) => p.id === which.profileId)) {
        return { ok: false, message: 'Unknown profile' };
      }
      target = getPaths().modsProfile(which.profileId);
    }
    if (!target) return { ok: false, message: 'Invalid path' };
    const scan = await scanMods(target);
    return { ok: true, scan };
  });

  handle('mods:scanDisabled', async () => {
    const paksDir = getPaths().paksDir;
    if (!paksDir) return { ok: false, message: 'Invalid path' };
    const scan = await scanMods(path.join(paksDir, '~Mods.disabled'));
    return { ok: true, scan };
  });

  handle('mods:setEnabled', async (_event, payload) => {
    const rel = payload && payload.rel;
    const enabled = !!(payload && payload.enabled);
    if (!rel || typeof rel !== 'string') return { ok: false, message: 'Invalid mod path' };
    const live = getPaths().modsLive;
    if (!live) return { ok: false, message: 'Invalid mods path' };
    const res = await setEntryEnabled(live, rel, enabled);
    return { ok: true, result: res, scan: await scanMods(live) };
  });

  handle('admin:list', async () => {
    let custom = [];
    try {
      custom = JSON.parse(fs.readFileSync(CUSTOM_COMMANDS_FILE, 'utf8'));
      if (!Array.isArray(custom)) custom = [];
    } catch {
      custom = [];
    }
    return { ok: true, categories: CATEGORIES, commands: COMMANDS, custom };
  });

  handle('admin:addCustom', async (_event, raw) => {
    const item = raw && typeof raw === 'object' ? raw : {};
    const cmd = String(item.cmd || '').trim().slice(0, 200);
    if (!cmd) return { ok: false, message: 'Command is required' };
    const entry = {
      id: `custom-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      category: String(item.category || 'server'),
      cmd,
      syntax: String(item.syntax || cmd).slice(0, 400),
      example: String(item.example || cmd).slice(0, 400),
      desc: { zh: String(item.descZh || '').slice(0, 400), en: String(item.descEn || '').slice(0, 400) },
      note: { zh: String(item.noteZh || '').slice(0, 400), en: String(item.noteEn || '').slice(0, 400) },
      custom: true,
    };
    let custom = [];
    try {
      custom = JSON.parse(fs.readFileSync(CUSTOM_COMMANDS_FILE, 'utf8'));
      if (!Array.isArray(custom)) custom = [];
    } catch {
      custom = [];
    }
    custom.push(entry);
    ensureDir(USER_DATA);
    fs.writeFileSync(CUSTOM_COMMANDS_FILE, JSON.stringify(custom, null, 2), 'utf8');
    return { ok: true, entry };
  });

  handle('admin:removeCustom', async (_event, id) => {
    let custom = [];
    try {
      custom = JSON.parse(fs.readFileSync(CUSTOM_COMMANDS_FILE, 'utf8'));
      if (!Array.isArray(custom)) custom = [];
    } catch {
      custom = [];
    }
    custom = custom.filter((c) => c.id !== id);
    fs.writeFileSync(CUSTOM_COMMANDS_FILE, JSON.stringify(custom, null, 2), 'utf8');
    return { ok: true };
  });

  handle('map:get', async () => {
    let map = { image: null, calibration: null, waypoints: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
      map = { ...map, ...raw };
    } catch {
      /* first run */
    }
    let imageUrl = null;
    if (map.image) {
      const imagePath = path.join(USER_DATA, 'assets', path.basename(map.image));
      if (fs.existsSync(imagePath)) imageUrl = pathToFileURL(imagePath).href;
    }
    return { ok: true, map, imageUrl };
  });

  handle('map:import', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: config.language === 'en' ? 'Select a map image' : '选择地图图片',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true };
    const source = result.filePaths[0];
    const ext = path.extname(source).toLowerCase() || '.png';
    const assetsDir = path.join(USER_DATA, 'assets');
    ensureDir(assetsDir);
    const dest = path.join(assetsDir, `map${ext}`);
    fs.copyFileSync(source, dest);
    let map = { image: null, calibration: null, waypoints: [] };
    try {
      map = { ...map, ...JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) };
    } catch {
      /* ignore */
    }
    // Remove older map images with different extensions.
    for (const name of fs.readdirSync(assetsDir)) {
      if (/^map\.(png|jpg|jpeg|webp)$/i.test(name) && name !== path.basename(dest)) {
        try {
          fs.unlinkSync(path.join(assetsDir, name));
        } catch {
          /* ignore */
        }
      }
    }
    map.image = path.basename(dest);
    fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2), 'utf8');
    return { ok: true, map, imageUrl: pathToFileURL(dest).href };
  });

  handle('map:save', async (_event, map) => {
    if (!map || typeof map !== 'object') return { ok: false, message: 'Invalid map data' };
    const clean = {
      image: typeof map.image === 'string' ? path.basename(map.image) : null,
      calibration: map.calibration && typeof map.calibration === 'object' ? map.calibration : null,
      waypoints: Array.isArray(map.waypoints)
        ? map.waypoints.slice(0, 500).map((w) => ({
            id: String(w.id || ''),
            name: String(w.name || '').slice(0, 80),
            x: Number(w.x) || 0,
            y: Number(w.y) || 0,
            z: Number(w.z) || 0,
            note: String(w.note || '').slice(0, 200),
          }))
        : [],
    };
    ensureDir(USER_DATA);
    fs.writeFileSync(MAP_FILE, JSON.stringify(clean, null, 2), 'utf8');
    return { ok: true, map: clean };
  });

  handle('history:list', async () => ({ ok: true, history: readHistory(HISTORY_FILE, 100) }));

  handle('recovery:rollback', async () => {
    const journal = loadJournal(JOURNAL_FILE);
    if (!journal) return { ok: false, message: 'No unfinished switch' };
    if (['completed', 'rolledback'].includes(journal.status)) {
      clearJournal(JOURNAL_FILE);
      return { ok: true, failures: [] };
    }
    const result = await rollbackJournal(journal, {
      onLog: (entry) => send('switch:log', entry),
    });
    if (result.failures.length) {
      journal.status = 'failed';
      fs.writeFileSync(JOURNAL_FILE, JSON.stringify(journal, null, 2), 'utf8');
      return { ok: false, failures: result.failures, state: await buildState(true) };
    }
    try {
      fs.renameSync(JOURNAL_FILE, path.join(USER_DATA, `journal.rolledback-${Date.now()}.json`));
    } catch {
      clearJournal(JOURNAL_FILE);
    }
    return { ok: true, failures: [], state: await buildState(true) };
  });

  handle('recovery:dismiss', async () => {
    if (fs.existsSync(JOURNAL_FILE)) {
      try {
        fs.renameSync(JOURNAL_FILE, path.join(USER_DATA, `journal.dismissed-${Date.now()}.json`));
      } catch {
        clearJournal(JOURNAL_FILE);
      }
    }
    return { ok: true, state: await buildState(true) };
  });

  handle('window:minimize', async () => {
    if (win) win.minimize();
    return { ok: true };
  });
  handle('window:maximize', async () => {
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
    return { ok: true };
  });
  handle('window:close', async () => {
    if (win) win.close();
    return { ok: true };
  });
  handle('app:openUserData', async () => {
    await shell.openPath(USER_DATA);
    return { ok: true };
  });
  handle('app:openLogs', async () => {
    ensureDir(LOG_DIR);
    await shell.openPath(LOG_DIR);
    return { ok: true };
  });
  handle('app:quit', async () => {
    quitting = true;
    app.quit();
    return { ok: true };
  });
  handle('theme:overlay', async (_event, theme) => {
    applyTheme(theme);
    return { ok: true };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    initializeConfig();
    ensureDir(USER_DATA);
    setupIpc();
    createWindow();
    startPolling();
    logLine('info', `App started, userData=${USER_DATA}`);
    nativeTheme.themeSource = 'system';
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      quitting = true;
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
