'use strict';

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { normPath, isSubPath } = require('./fsx');

const PS = 'powershell.exe';
const GAME_NAMES = new Set(['scum.exe', 'scum-win64-shipping.exe', 'scum-win64-test.exe']);

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function encodePS(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runPS(script, timeout = 45000) {
  const full = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    '$OutputEncoding = [Console]::OutputEncoding',
    script,
  ].join('\n');
  return new Promise((resolve, reject) => {
    execFile(
      PS,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePS(full)],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(`PowerShell 调用失败: ${(stderr || err.message || '').trim()}`);
          e.code = 'EPS';
          e.stderr = stderr;
          reject(e);
          return;
        }
        resolve(stdout || '');
      }
    );
  });
}

function parseJsonArray(text) {
  const clean = String(text || '').replace(/^﻿/, '').trim();
  if (!clean) return [];
  let data;
  try {
    data = JSON.parse(clean);
  } catch {
    // Some PowerShell versions emit a stray warning before JSON.
    const start = clean.indexOf('[');
    const end = clean.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        data = JSON.parse(clean.slice(start, end + 1));
      } catch {
        // Fail closed: treating unreadable output as "no processes" would let
        // the switcher replace files while the game/launcher is still running.
        throw Object.assign(new Error(`无法解析进程列表输出: ${clean.slice(0, 200)}`), { code: 'EPS_PARSE' });
      }
    } else {
      throw Object.assign(new Error(`进程列表输出不是 JSON: ${clean.slice(0, 200)}`), { code: 'EPS_PARSE' });
    }
  }
  if (data === null || data === undefined) return [];
  return (Array.isArray(data) ? data : [data]).filter((p) => p && typeof p === 'object');
}

async function listProcesses() {
  const script = `
$procs = @(Get-CimInstance Win32_Process | Select-Object ProcessId, Name, ExecutablePath, CommandLine)
ConvertTo-Json -InputObject $procs -Compress -Depth 3
`;
  const out = await runPS(script);
  return parseJsonArray(out)
    .map((p) => ({
      pid: Number(p.ProcessId),
      name: String(p.Name || ''),
      exePath: String(p.ExecutablePath || ''),
      commandLine: String(p.CommandLine || ''),
    }))
    .filter((p) => Number.isInteger(p.pid) && p.pid > 0);
}

function profileMatchesProcess(profile, proc) {
  if (!profile || !profile.exePath || !proc || !proc.exePath) return false;
  if (normPath(profile.exePath) !== normPath(proc.exePath)) return false;
  const keyword = String(profile.commandLineKeyword || '').trim();
  if (keyword && !String(proc.commandLine || '').toLowerCase().includes(keyword.toLowerCase())) return false;
  return true;
}

function isGameProcess(proc, paths) {
  const name = String(proc.name || '').toLowerCase();
  if (GAME_NAMES.has(name)) return true;
  if (paths && paths.gameRoot && isSubPath(paths.gameRoot, proc.exePath)) {
    return name === 'scum.exe' || name.includes('scum-win64');
  }
  return false;
}

function detectFromList(config, paths, procs) {
  const launchers = [];
  for (const profile of config.profiles || []) {
    const matches = procs.filter((p) => profileMatchesProcess(profile, p));
    for (const m of matches) {
      launchers.push({
        profileId: profile.id,
        pid: m.pid,
        name: m.name,
        exePath: m.exePath,
        commandLine: m.commandLine,
      });
    }
  }
  const games = procs
    .filter((p) => isGameProcess(p, paths))
    .map((p) => ({ pid: p.pid, name: p.name, exePath: p.exePath }));

  // First configured launcher wins, but keep the full list for the UI.
  const detectedProfileId = launchers.length ? launchers[0].profileId : null;
  return { launchers, games, detectedProfileId };
}

async function detect(config, paths) {
  const procs = await listProcesses();
  return detectFromList(config, paths, procs);
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function runTaskkill(args) {
  return new Promise((resolve) => {
    execFile('taskkill.exe', args, { windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', error: err });
    });
  });
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return !isPidAlive(pid);
}

async function closeProcess(pid, options = {}) {
  const graceMs = options.graceMs ?? 4000;
  if (!isPidAlive(pid)) return { closed: true, forced: false, alreadyClosed: true };
  // Graceful attempt: taskkill without /F posts WM_CLOSE for GUI apps.
  await runTaskkill(['/PID', String(pid)]);
  if (await waitForExit(pid, graceMs)) return { closed: true, forced: false };
  await runTaskkill(['/F', '/PID', String(pid)]);
  const closed = await waitForExit(pid, 4000);
  return { closed, forced: true };
}

async function killProcess(pid) {
  if (!isPidAlive(pid)) return { closed: true, alreadyClosed: true };
  await runTaskkill(['/F', '/PID', String(pid)]);
  const closed = await waitForExit(pid, 4000);
  return { closed };
}

async function launchProcess(exePath, args = '', workDir = '') {
  if (!exePath || !fs.existsSync(exePath)) {
    throw Object.assign(new Error(`启动器不存在: ${exePath || '(空)'}`), { code: 'ENOEXE' });
  }
  if (/[\r\n]/.test(exePath) || /[\r\n]/.test(args) || /[\r\n]/.test(workDir)) {
    throw Object.assign(new Error('启动器路径或参数包含非法换行符'), { code: 'EINVAL' });
  }
  const commandLine = `"${exePath}"${args ? ' ' + args : ''}`;
  const cwd = workDir || path.dirname(exePath);
  const script = `
$CommandLine = ${psQuote(commandLine)}
$WorkingDirectory = ${psQuote(cwd)}
$startup = ([wmiclass]'Win32_ProcessStartup').CreateInstance()
$startup.ShowWindow = 1
try {
  $r = ([wmiclass]'Win32_Process').Create($CommandLine, $WorkingDirectory, $startup)
  [pscustomobject]@{ ReturnValue = [int]$r.ReturnValue; ProcessId = [int]$r.ProcessId } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ ReturnValue = -1; ProcessId = 0; Error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;
  const out = await runPS(script, 30000);
  let result;
  try {
    result = JSON.parse(String(out).replace(/^﻿/, '').trim() || '{}');
  } catch {
    throw Object.assign(new Error(`启动器返回无法解析: ${out}`), { code: 'ELAUNCH' });
  }
  const returnValue = Number(result.ReturnValue);
  if (returnValue !== 0) {
    const messages = {
      2: '访问被拒绝（启动器可能需要管理员权限）',
      3: '权限不足（启动器可能需要管理员权限）',
      8: '未知错误',
      9: '找不到启动器路径',
      21: '参数无效',
    };
    const detail = result.Error ? `: ${result.Error}` : '';
    throw Object.assign(
      new Error(`启动失败（代码 ${returnValue}）${messages[returnValue] ? ' - ' + messages[returnValue] : ''}${detail}`),
      { code: 'ELAUNCH', returnValue }
    );
  }
  return { pid: Number(result.ProcessId) || 0 };
}

async function findProfileProcesses(config, paths, profileId) {
  const profile = (config.profiles || []).find((p) => p.id === profileId);
  if (!profile) return [];
  const procs = await listProcesses();
  return procs.filter((p) => profileMatchesProcess(profile, p));
}

module.exports = {
  listProcesses,
  detect,
  detectFromList,
  profileMatchesProcess,
  isGameProcess,
  isPidAlive,
  closeProcess,
  killProcess,
  launchProcess,
  findProfileProcesses,
  waitForExit,
};
