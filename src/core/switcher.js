'use strict';

const path = require('path');
const fsx = require('./fsx');
const journalLib = require('./journal');
const rollbackLib = require('./rollback');
const processes = require('./processes');
const { makeT } = require('./messages');

const PHASE_RANGES = {
  precheck: [0, 3],
  'stop-game': [3, 6],
  'stop-launcher': [6, 13],
  'stash-saved': [13, 20],
  'load-saved': [20, 50],
  'stash-mods': [50, 55],
  'load-mods': [55, 95],
  verify: [95, 98],
  launch: [98, 100],
  done: [100, 100],
};

class SwitchError extends Error {
  constructor(code, message, info) {
    super(message);
    this.name = 'SwitchError';
    this.code = code;
    this.info = info || null;
  }
}

function fail(code, message, info) {
  return new SwitchError(code, message, info);
}

function historyPathFor(journalFile) {
  return path.join(path.dirname(journalFile), 'history.json');
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function driveOf(p) {
  const m = /^([A-Za-z]):/.exec(path.resolve(p));
  return m ? m[1].toUpperCase() : '?';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function precheck({ config, paths, fromId, toId, options, proc, t }) {
  const from = (config.profiles || []).find((p) => p.id === fromId);
  const to = (config.profiles || []).find((p) => p.id === toId);
  if (!from) throw fail('PROFILE_MISSING', t('err.profile_missing', { id: fromId || '(空)' }));
  if (!to) throw fail('PROFILE_MISSING', t('err.profile_missing', { id: toId || '(空)' }));
  if (fromId === toId) throw fail('SAME_PROFILE', t('err.same_profile'));

  const paks = paths.paksDir;
  if (!paths.gameRoot || !paks || !fsx.existsSync(paks)) {
    throw fail('INVALID_GAME_PATH', t('err.invalid_game_path', { path: paths.gameRoot || '(空)' }), {
      path: paths.gameRoot,
    });
  }
  if (!paths.scumDataDir || !fsx.existsSync(paths.scumDataDir)) {
    throw fail('INVALID_DATA_PATH', t('err.invalid_data_path', { path: paths.scumDataDir || '(空)' }), {
      path: paths.scumDataDir,
    });
  }
  if (to.exePath && !fsx.existsSync(to.exePath)) {
    throw fail('LAUNCHER_MISSING', t('err.launcher_missing', { path: to.exePath }), { path: to.exePath });
  }

  let procState;
  try {
    procState = await proc.detect(config, paths);
  } catch (err) {
    throw fail('PROCESS_QUERY_FAILED', t('err.process_query', { message: err.message }));
  }

  if (options.forceKillGame && procState.games.length) {
    // allowed; execution will terminate them
  } else if (procState.games.length) {
    throw fail('GAME_RUNNING', t('err.game_running', { pids: procState.games.map((g) => g.pid).join(', ') }), {
      games: procState.games,
    });
  }

  const liveSavedExists = await fsx.exists(paths.savedLive);
  const fromSavedExists = await fsx.exists(paths.savedProfile(fromId));
  const targetSaved = paths.savedProfile(toId);
  const targetSavedExists = await fsx.exists(targetSaved);

  let savedPlan;
  if (targetSavedExists) {
    savedPlan = { mode: 'existing', path: targetSaved };
  } else if (options.createEmptySaved) {
    savedPlan = { mode: 'empty', path: targetSaved };
  } else if (options.cloneCurrent) {
    savedPlan = { mode: 'clone', path: targetSaved };
  } else {
    throw fail(
      'TARGET_SAVED_MISSING',
      t('err.target_saved_missing', { path: targetSaved }),
      { path: targetSaved, canClone: liveSavedExists || fromSavedExists }
    );
  }

  const targetMods = paths.modsProfile(toId);
  const targetModsExists = await fsx.exists(targetMods);
  const noMods = !!options.noMods || !!to.noMods;
  if (!targetModsExists && !noMods) {
    throw fail('TARGET_MODS_MISSING', t('err.target_mods_missing', { path: targetMods }), {
      path: targetMods,
    });
  }

  const targetSavedSize = targetSavedExists ? await fsx.statDir(targetSaved) : { files: 0, bytes: 0 };
  let cloneSource = null;
  let cloneSourceSize = { files: 0, bytes: 0 };
  if (savedPlan.mode === 'clone') {
    if (fromSavedExists) cloneSource = paths.savedProfile(fromId);
    else if (liveSavedExists) cloneSource = paths.savedLive;
    if (cloneSource) cloneSourceSize = await fsx.statDir(cloneSource);
  }
  const targetModsSize =
    targetModsExists && !noMods ? await fsx.statDir(targetMods) : { files: 0, bytes: 0 };

  const margin = 200 * 1024 * 1024;
  let savedNeed = 0;
  if (savedPlan.mode === 'clone') {
    savedNeed = cloneSourceSize.bytes * (config.mode === 'copy' ? 2 : 1);
  } else if (savedPlan.mode === 'existing' && config.mode === 'copy') {
    savedNeed = targetSavedSize.bytes;
  }
  const modsNeed = config.mode === 'copy' ? targetModsSize.bytes : 0;
  // Saved and ~Mods often live on the same drive. Check the combined demand
  // per volume, otherwise two individually-passing checks can still overfill it.
  const needByVolume = new Map();
  for (const [dir, bytes] of [
    [paths.scumDataDir, savedNeed],
    [paths.contentDir, modsNeed],
  ]) {
    if (bytes <= 0) continue;
    const drive = driveOf(dir);
    const prev = needByVolume.get(drive);
    if (prev) prev.bytes += bytes;
    else needByVolume.set(drive, { dir, bytes });
  }
  for (const need of needByVolume.values()) {
    const sf = fsx.statfs(need.dir);
    if (sf && sf.free < need.bytes + margin) {
      throw fail(
        'NOT_ENOUGH_SPACE',
        t('err.not_enough_space', {
          volume: driveOf(need.dir),
          required: formatBytes(need.bytes + margin),
          free: formatBytes(sf.free),
        }),
        { required: need.bytes + margin, free: sf.free, target: need.dir }
      );
    }
  }

  for (const dir of [paths.scumDataDir, paths.contentDir, paths.paksDir]) {
    try {
      fsx.checkWritableSync(dir);
    } catch (err) {
      throw fail('PERMISSION_DENIED', t('err.permission', { path: dir }), { path: dir });
    }
  }

  return {
    from,
    to,
    fromId,
    toId,
    procState,
    liveSavedExists,
    fromSavedExists,
    targetSaved,
    targetSavedExists,
    targetSavedSize,
    savedPlan,
    cloneSource,
    cloneSourceSize,
    targetMods,
    targetModsExists,
    targetModsSize,
    noMods,
    mode: config.mode,
  };
}

async function runSwitch(input) {
  const {
    config,
    paths,
    fromId,
    toId,
    options = {},
    journalFile,
    signal = { aborted: false },
    deps = {},
    onProgress = () => {},
    onLog = () => {},
  } = input;
  const t = input.t || makeT(config.language || 'zh-CN');
  const proc = deps.processes || processes;
  const launchFn = deps.launch || proc.launchProcess;

  let journal = null;
  const warnings = [];

  const log = (key, params, level = 'info') => {
    onLog({ time: Date.now(), level, key, params, message: t(key, params) });
  };

  const emit = (phase, status, key, params, sub = 0) => {
    const range = PHASE_RANGES[phase] || [0, 100];
    let percent;
    if (status === 'done' || status === 'skip') percent = range[1];
    else if (status === 'start') percent = range[0];
    else percent = range[0] + (range[1] - range[0]) * Math.max(0, Math.min(1, sub));
    onProgress({
      phase,
      status,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      key,
      params,
      message: key ? t(key, params) : '',
      time: Date.now(),
    });
  };

  const checkAbort = () => {
    if (signal.aborted) throw new SwitchError('ABORTED', t('err.aborted'));
  };

  const saveJournal = () => {
    if (journal) journalLib.saveJournal(journalFile, journal);
  };

  const beginAction = (action) => {
    const entry = journalLib.addAction(journal, action);
    saveJournal();
    return entry;
  };

  const finishAction = (entry, extra = {}) => {
    journalLib.setActionState(journal, entry.seq, 'done', extra);
    saveJournal();
  };

  const setPhase = (phase) => {
    if (!journal) return;
    journal.phase = phase;
    saveJournal();
  };

  const copyWithProgress = async (src, dst, phase) => {
    let lastLog = 0;
    await fsx.copyDir(src, dst, {
      shouldAbort: () => signal.aborted,
      onProgress: (p) => {
        const sub = p.totalBytes ? p.doneBytes / p.totalBytes : 1;
        emit(phase, 'progress', 'log.copy_progress', {
          done: formatBytes(p.doneBytes),
          total: formatBytes(p.totalBytes),
          percent: Math.round(sub * 100),
        }, sub);
        if (Date.now() - lastLog > 2500) {
          lastLog = Date.now();
          log('log.copy_progress', {
            done: formatBytes(p.doneBytes),
            total: formatBytes(p.totalBytes),
            percent: Math.round(sub * 100),
          });
        }
      },
    });
  };

  const moveToTrash = (orig, trashRoot, label) => {
    fsx.mkdirpSync(trashRoot);
    const safe = String(label).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const dest = fsx.uniquePath(path.join(trashRoot, `${fsx.timestamp()}-${safe}`));
    const action = beginAction({ kind: 'trash', orig, trash: dest });
    fsx.renameSync(orig, dest);
    finishAction(action);
    return dest;
  };

  const stashEntry = async ({ live, profilePath, trashRoot, label, junctionLogKey, skipLogKey }) => {
    if (!(await fsx.exists(live))) {
      log(skipLogKey);
      return { skipped: true };
    }
    if (await fsx.isLink(live)) {
      const target = fsx.readLinkSync(live);
      const action = beginAction({ kind: 'junction-removed', path: live, target });
      fsx.removeJunctionSync(live);
      finishAction(action);
      log(junctionLogKey, { target });
      return { junction: true, target };
    }
    if (await fsx.exists(profilePath)) {
      moveToTrash(profilePath, trashRoot, path.basename(profilePath));
    }
    const action = beginAction({ kind: 'move', from: live, to: profilePath });
    await fsx.rename(live, profilePath);
    finishAction(action);
    return { moved: true };
  };

  const loadEntry = async ({ live, source, phase, mode, logKey, params }) => {
    if (await fsx.exists(live)) {
      throw fail('TARGET_EXISTS', t('err.target_exists', { path: live }), { path: live });
    }
    if (mode === 'junction') {
      const action = beginAction({ kind: 'junction', path: live, target: source });
      fsx.createJunction(live, source);
      finishAction(action);
      log('log.junction_created', { path: live, target: source });
      return;
    }
    const action = beginAction({ kind: 'copy', from: source, to: live });
    await copyWithProgress(source, live, phase);
    finishAction(action);
    log(logKey, params);
  };

  try {
    emit('precheck', 'start', 'log.precheck_start');
    log('log.precheck_start');
    const plan = await precheck({ config, paths, fromId, toId, options, proc, t });
    checkAbort();
    emit('precheck', 'done', 'log.precheck_done', { from: fromId, to: toId });
    if (options.forceKillGame && plan.procState.games.length) {
      log('log.game_force_start');
    }

    journal = journalLib.createJournal({
      fromId,
      toId,
      mode: config.mode,
      baseDir: paths.scumDataDir,
    });
    saveJournal();

    // 1) Stop the game if explicitly allowed.
    if (plan.procState.games.length) {
      setPhase('stop-game');
      emit('stop-game', 'start', 'step.stop-game');
      for (const game of plan.procState.games) {
        log('log.kill_game', { pid: game.pid });
        await proc.killProcess(game.pid);
      }
      const still = plan.procState.games.filter((g) => proc.isPidAlive(g.pid));
      if (still.length) {
        throw fail('GAME_STILL_RUNNING', t('err.game_still_running', { pids: still.map((g) => g.pid).join(', ') }));
      }
      log('log.game_closed');
      emit('stop-game', 'done', 'log.game_closed');
    } else {
      emit('stop-game', 'skip', 'step.stop-game');
    }

    // 2) Close every configured launcher that is running.
    setPhase('stop-launcher');
    emit('stop-launcher', 'start', 'step.stop-launcher');
    const currentState = await proc.detect(config, paths);
    const launcherPids = Array.from(new Set((currentState.launchers || []).map((l) => l.pid)));
    if (launcherPids.length) {
      log('log.launcher_scan', { count: launcherPids.length });
      for (const l of currentState.launchers) {
        checkAbort();
        log('log.close_launcher', { name: l.name || l.exePath, pid: l.pid });
        const res = await proc.closeProcess(l.pid);
        if (!res.closed) {
          throw fail('LAUNCHER_CLOSE_FAILED', t('err.launcher_close_failed', { pids: l.pid }));
        }
        log(res.forced ? 'log.launcher_forced' : 'log.launcher_closed', { name: l.name || l.exePath });
      }
    } else {
      log('log.skip_launcher');
    }
    await sleep(300);
    const afterClose = await proc.detect(config, paths);
    const remaining = Array.from(new Set((afterClose.launchers || []).map((l) => l.pid)));
    if (remaining.length) {
      throw fail('LAUNCHER_CLOSE_FAILED', t('err.launcher_close_failed', { pids: remaining.join(', ') }));
    }
    // The game may have been started while we were closing launchers.
    if ((afterClose.games || []).length) {
      if (!options.forceKillGame) {
        throw fail(
          'GAME_RUNNING',
          t('err.game_running', { pids: afterClose.games.map((g) => g.pid).join(', ') }),
          { games: afterClose.games }
        );
      }
      for (const game of afterClose.games) {
        log('log.kill_game', { pid: game.pid });
        await proc.killProcess(game.pid);
      }
      await sleep(400);
      const still = (await proc.detect(config, paths)).games || [];
      if (still.length) {
        throw fail(
          'GAME_STILL_RUNNING',
          t('err.game_still_running', { pids: still.map((g) => g.pid).join(', ') })
        );
      }
    }
    emit('stop-launcher', 'done', 'step.stop-launcher');

    // 3) Stash the live Saved folder under the source profile id.
    setPhase('stash-saved');
    emit('stash-saved', 'start', 'step.stash-saved');
    if (plan.liveSavedExists) log('log.stash_saved', { id: fromId });
    await stashEntry({
      live: paths.savedLive,
      profilePath: paths.savedProfile(fromId),
      trashRoot: paths.savedTrash,
      label: `Saved.${fromId}`,
      junctionLogKey: 'log.stash_saved_junction',
      skipLogKey: 'log.stash_saved_skip',
    });
    emit('stash-saved', 'done', 'log.stash_saved', { id: fromId });

    // 4) Prepare and load the target Saved folder.
    setPhase('load-saved');
    emit('load-saved', 'start', 'step.load-saved');
    checkAbort();
    if (plan.savedPlan.mode === 'empty') {
      const action = beginAction({ kind: 'mkdir', path: plan.targetSaved });
      fsx.mkdirpSync(plan.targetSaved);
      finishAction(action);
      log('log.load_saved_empty', { id: toId });
    } else if (plan.savedPlan.mode === 'clone') {
      checkAbort();
      if (plan.cloneSource && (await fsx.exists(plan.cloneSource))) {
        const action = beginAction({ kind: 'copy', from: plan.cloneSource, to: plan.targetSaved });
        await copyWithProgress(plan.cloneSource, plan.targetSaved, 'load-saved');
        finishAction(action);
        log('log.load_saved_clone', { id: toId });
      } else {
        warnings.push(t('warn.clone_source_missing'));
        const action = beginAction({ kind: 'mkdir', path: plan.targetSaved });
        fsx.mkdirpSync(plan.targetSaved);
        finishAction(action);
        log('log.load_saved_empty', { id: toId });
      }
    }
    checkAbort();
    log('log.load_saved', { id: toId });
    await loadEntry({
      live: paths.savedLive,
      source: plan.targetSaved,
      phase: 'load-saved',
      mode: config.mode,
      logKey: 'log.load_saved',
      params: { id: toId },
    });
    emit('load-saved', 'done', 'log.load_saved', { id: toId });

    // 5) Stash live mods.
    setPhase('stash-mods');
    emit('stash-mods', 'start', 'step.stash-mods');
    if (await fsx.exists(paths.modsLive)) log('log.stash_mods', { id: fromId });
    await stashEntry({
      live: paths.modsLive,
      profilePath: paths.modsProfile(fromId),
      trashRoot: paths.modsTrash,
      label: `~Mods.${fromId}`,
      junctionLogKey: 'log.stash_mods_junction',
      skipLogKey: 'log.stash_mods_skip',
    });
    emit('stash-mods', 'done', 'log.stash_mods', { id: fromId });

    // 6) Load target mods (or intentionally leave none).
    setPhase('load-mods');
    emit('load-mods', 'start', 'step.load-mods');
    checkAbort();
    if (plan.noMods) {
      log('log.no_mods');
      if (await fsx.exists(paths.modsLive)) {
        throw fail('MODS_STILL_PRESENT', t('err.target_missing', { path: paths.modsLive }), {
          path: paths.modsLive,
        });
      }
    } else {
      log('log.load_mods', { id: toId });
      await loadEntry({
        live: paths.modsLive,
        source: plan.targetMods,
        phase: 'load-mods',
        mode: config.mode,
        logKey: 'log.load_mods',
        params: { id: toId },
      });
    }
    emit('load-mods', 'done', 'log.load_mods', { id: toId });

    // 7) Verify.
    setPhase('verify');
    emit('verify', 'start', 'step.verify');
    checkAbort();
    const verifyFiles = config.safety.verify !== false;
    if (config.mode === 'junction') {
      if (!(await fsx.isLink(paths.savedLive))) {
        throw fail('VERIFY_FAILED', t('err.verify_failed', { detail: 'Saved is not a junction' }));
      }
      const link = fsx.normPath(fsx.readLinkSync(paths.savedLive));
      if (link !== fsx.normPath(plan.targetSaved)) {
        throw fail(
          'VERIFY_FAILED',
          t('err.verify_failed', { detail: `${link} != ${fsx.normPath(plan.targetSaved)}` })
        );
      }
    } else if (!verifyFiles) {
      log('log.verify_skip');
    } else {
      const result = await fsx.verifyCopy(plan.targetSaved, paths.savedLive);
      if (!result.ok) {
        throw fail(
          'VERIFY_FAILED',
          t('err.verify_failed', {
            detail: `${formatBytes(result.expected.bytes)} / ${formatBytes(result.actual.bytes)}`,
          })
        );
      }
      log('log.verify_ok', {
        files: result.actual.files,
        size: formatBytes(result.actual.bytes),
      });
    }

    if (plan.noMods) {
      log('log.verify_skip_mods');
    } else if (config.mode === 'junction') {
      if (!(await fsx.isLink(paths.modsLive))) {
        throw fail('VERIFY_FAILED', t('err.verify_failed', { detail: '~Mods is not a junction' }));
      }
      const link = fsx.normPath(fsx.readLinkSync(paths.modsLive));
      if (link !== fsx.normPath(plan.targetMods)) {
        throw fail(
          'VERIFY_FAILED',
          t('err.verify_failed', { detail: `${link} != ${fsx.normPath(plan.targetMods)}` })
        );
      }
    } else if (!verifyFiles) {
      log('log.verify_skip');
    } else {
      const result = await fsx.verifyCopy(plan.targetMods, paths.modsLive);
      if (!result.ok) {
        throw fail(
          'VERIFY_FAILED',
          t('err.verify_failed', {
            detail: `${formatBytes(result.expected.bytes)} / ${formatBytes(result.actual.bytes)}`,
          })
        );
      }
      log('log.verify_ok', {
        files: result.actual.files,
        size: formatBytes(result.actual.bytes),
      });
    }
    emit('verify', 'done', verifyFiles || config.mode === 'junction' ? 'log.verify_ok' : 'log.verify_skip', {});

    // 8) Launch target launcher. A launch failure does NOT undo the switch.
    setPhase('launch');
    emit('launch', 'start', 'step.launch');
    let launchResult = { ok: false, skipped: false };
    if (plan.to.exePath) {
      log('log.launch', { name: plan.to.name || path.basename(plan.to.exePath) });
      try {
        const launched = await launchFn(
          plan.to.exePath,
          plan.to.args || '',
          plan.to.workDir || path.dirname(plan.to.exePath)
        );
        launchResult = { ok: true, pid: launched.pid, verified: false };
        log('log.launch_ok', { pid: launched.pid });
        // Verifying by PID is immediate. The old loop polled the PowerShell
        // process list 40 times; each scan costs ~0.5-1s, so a launcher that
        // could not be matched by path+keyword made every switch wait ~45s.
        if (typeof proc.isPidAlive === 'function' && proc.isPidAlive(launched.pid)) {
          launchResult.verified = true;
        } else if (typeof proc.findProfileProcesses === 'function') {
          // Some launchers exit immediately after handing off to another
          // process; give that case one cheap detection pass.
          try {
            const found = await proc.findProfileProcesses(config, paths, toId);
            if (found && found.length) launchResult.verified = true;
          } catch {
            /* detection is best-effort */
          }
        }
        if (!launchResult.verified) {
          warnings.push(t('log.launch_unverified'));
          log('log.launch_unverified', {}, 'warn');
        }
      } catch (err) {
        launchResult = { ok: false, error: err.message };
        warnings.push(t('err.launch_failed', { message: err.message }));
        log('err.launch_failed', { message: err.message }, 'error');
      }
    } else {
      launchResult = { ok: false, skipped: true };
      warnings.push(t('warn.no_launcher_path'));
      log('log.launch_skipped', {}, 'warn');
    }
    emit('launch', 'done', 'step.launch');

    config.activeProfileId = toId;
    config.activeSource = launchResult.ok ? 'launched' : 'manual';

    journal.status = 'completed';
    journal.finishedAt = new Date().toISOString();
    journal.phase = 'done';
    saveJournal();
    try {
      journalLib.appendHistory(historyPathFor(journalFile), {
        id: journal.id,
        startedAt: journal.startedAt,
        finishedAt: journal.finishedAt,
        fromId,
        toId,
        mode: config.mode,
        status: 'success',
        warnings,
      });
    } catch {
      /* history is best-effort */
    }
    journalLib.clearJournal(journalFile);

    emit('done', 'done', 'log.done', { from: fromId, to: toId });
    log('log.done', { from: fromId, to: toId });

    try {
      const removedSaved = await fsx.pruneTrash(paths.savedTrash, config.safety.trashKeep);
      const removedMods = await fsx.pruneTrash(paths.modsTrash, config.safety.trashKeep);
      const count = removedSaved.length + removedMods.length;
      if (count) log('log.prune_trash', { count });
    } catch {
      /* pruning is best-effort */
    }

    return {
      ok: true,
      code: 'OK',
      message: t('log.done', { from: fromId, to: toId }),
      journalId: journal.id,
      config,
      launch: launchResult,
      warnings,
      plan: {
        fromId,
        toId,
        mode: config.mode,
        savedBytes: plan.targetSavedSize.bytes,
        modsBytes: plan.targetModsSize.bytes,
      },
    };
  } catch (rawErr) {
    const err =
      rawErr && rawErr.code === 'EABORTED' ? new SwitchError('ABORTED', t('err.aborted')) : rawErr;
    const code = err && err.code ? err.code : 'UNKNOWN';
    const message =
      err instanceof SwitchError
        ? err.message
        : t('err.unknown', { message: (err && err.message) || String(err) });

    if (!journal) {
      emit('precheck', 'error', null, null);
      onLog({ time: Date.now(), level: 'error', key: code, message, params: null });
      return { ok: false, code, message, info: err && err.info ? err.info : null, config };
    }

    journal.status = 'failed';
    journal.error = { code, message };
    saveJournal();
    emit(journal.phase || 'precheck', 'error', null, null);
    log('log.rollback_start', {}, 'warn');

    let rollbackResult = { failures: [] };
    try {
      rollbackResult = await rollbackLib.rollbackJournal(journal, {
        onLog: (entry) => onLog({ time: Date.now(), ...entry }),
        onAction: (action) => {
          log('log.rollback_action', { kind: action.kind, path: action.path || action.to || action.from || '' });
          saveJournal();
        },
      });
    } catch (rbErr) {
      rollbackResult.failures.push({ error: rbErr.message });
    }

    if (rollbackResult.failures.length) {
      journal.status = 'failed';
      journal.finishedAt = new Date().toISOString();
      saveJournal();
      log('log.rollback_failed', { detail: rollbackResult.failures.map((f) => f.error).join('; ') }, 'error');
    } else {
      journal.status = 'rolledback';
      journal.finishedAt = new Date().toISOString();
      saveJournal();
      journalLib.clearJournal(journalFile);
      log('log.rollback_done');
    }

    try {
      journalLib.appendHistory(historyPathFor(journalFile), {
        id: journal.id,
        startedAt: journal.startedAt,
        finishedAt: new Date().toISOString(),
        fromId,
        toId,
        mode: config.mode,
        status: rollbackResult.failures.length ? 'failed' : 'rolledback',
        code,
        message,
      });
    } catch {
      /* history is best-effort */
    }

    return {
      ok: false,
      code,
      message,
      info: err && err.info ? err.info : null,
      journalId: journal.id,
      rolledBack: rollbackResult.failures.length === 0,
      rollbackFailures: rollbackResult.failures,
      config,
    };
  }
}

module.exports = {
  runSwitch,
  precheck,
  SwitchError,
  formatBytes,
  PHASE_RANGES,
};
