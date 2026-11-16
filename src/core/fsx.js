'use strict';

/**
 * Windows-focused filesystem helpers.
 * All long-running operations are async; small critical sections are sync.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const IS_WIN = process.platform === 'win32';

function longPath(p) {
  if (!IS_WIN) return p;
  if (p.startsWith('\\\\?\\')) return p;
  const abs = path.resolve(p);
  if (abs.length < 240) return abs;
  if (abs.startsWith('\\\\')) return '\\\\?\\UNC\\' + abs.slice(2);
  return '\\\\?\\' + abs;
}

function existsSync(p) {
  try {
    fs.lstatSync(longPath(p));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
    throw err;
  }
}

async function exists(p) {
  try {
    await fsp.lstat(longPath(p));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
    throw err;
  }
}

function isLinkSync(p) {
  try {
    return fs.lstatSync(longPath(p)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function isLink(p) {
  try {
    return (await fsp.lstat(longPath(p))).isSymbolicLink();
  } catch {
    return false;
  }
}

function mkdirpSync(p) {
  fs.mkdirSync(longPath(p), { recursive: true });
}

async function mkdirp(p) {
  await fsp.mkdir(longPath(p), { recursive: true });
}

/** Remove a file, a junction/symlink, or a real directory tree. Never follows links. */
function removeEntrySync(p) {
  const lp = longPath(p);
  let st;
  try {
    st = fs.lstatSync(lp);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
  if (st.isSymbolicLink()) {
    try {
      fs.unlinkSync(lp);
    } catch {
      fs.rmdirSync(lp);
    }
    return true;
  }
  if (st.isDirectory()) {
    fs.rmSync(lp, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 });
    return true;
  }
  fs.unlinkSync(lp);
  return true;
}

async function removeEntry(p) {
  return removeEntrySync(p);
}

function renameSync(src, dst) {
  mkdirpSync(path.dirname(dst));
  fs.renameSync(longPath(src), longPath(dst));
}

async function rename(src, dst) {
  await mkdirp(path.dirname(dst));
  await fsp.rename(longPath(src), longPath(dst));
}

function readLinkSync(p) {
  return fs.readlinkSync(longPath(p));
}

function createJunction(linkPath, targetPath) {
  mkdirpSync(path.dirname(linkPath));
  fs.symlinkSync(path.resolve(targetPath), path.resolve(linkPath), 'junction');
}

function removeJunctionSync(linkPath) {
  if (!isLinkSync(linkPath)) return false;
  const lp = longPath(linkPath);
  try {
    fs.rmdirSync(lp);
  } catch {
    fs.unlinkSync(lp);
  }
  return true;
}

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

function uniquePath(p) {
  if (!existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 1; i < 10000; i++) {
    const candidate = path.join(dir, `${base}-${i}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}-${crypto.randomBytes(4).toString('hex')}${ext}`);
}

/**
 * Move a folder/file into a trash root on the same volume (rename = instant).
 * Returns the new trash path.
 */
function moveToTrashSync(origPath, trashRoot, label) {
  mkdirpSync(trashRoot);
  const safeLabel = String(label || path.basename(origPath)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const dest = uniquePath(path.join(trashRoot, `${timestamp()}-${safeLabel}`));
  renameSync(origPath, dest);
  return dest;
}

async function pruneTrash(trashRoot, keep) {
  const keepN = Math.max(2, Number(keep) || 5);
  if (!(await exists(trashRoot))) return [];
  let items;
  try {
    items = await fsp.readdir(trashRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries = items
    .filter((it) => it.isDirectory() || it.isFile() || it.isSymbolicLink())
    .map((it) => it.name)
    .sort()
    .reverse();
  const removed = [];
  for (const name of entries.slice(keepN)) {
    const p = path.join(trashRoot, name);
    try {
      removeEntrySync(p);
      removed.push(p);
    } catch {
      /* ignore locked trash entries */
    }
  }
  return removed;
}

function statfs(p) {
  try {
    const st = fs.statfsSync(longPath(p));
    return { total: Number(st.blocks) * Number(st.bsize), free: Number(st.bavail) * Number(st.bsize) };
  } catch {
    return null;
  }
}

function checkWritableSync(dir) {
  mkdirpSync(dir);
  const probe = path.join(dir, `.switcher-write-test-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (err) {
    try {
      fs.unlinkSync(probe);
    } catch {
      /* ignore */
    }
    const e = new Error(`目录不可写: ${dir} (${err.code || err.message})`);
    e.code = 'EPERM';
    throw e;
  }
}

async function isDirEmpty(p) {
  try {
    const items = await fsp.readdir(longPath(p));
    return items.length === 0;
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

async function statDir(dir) {
  const result = { files: 0, dirs: 0, bytes: 0, links: 0 };
  if (!(await exists(dir))) return result;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let items;
    try {
      items = await fsp.readdir(longPath(current), { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    for (const it of items) {
      const abs = path.join(current, it.name);
      if (it.isSymbolicLink()) {
        result.links++;
        continue;
      }
      if (it.isDirectory()) {
        result.dirs++;
        stack.push(abs);
      } else if (it.isFile()) {
        try {
          const st = await fsp.stat(longPath(abs));
          result.files++;
          result.bytes += st.size;
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
      }
    }
  }
  return result;
}

function abortError() {
  const e = new Error('操作已取消 / Operation cancelled');
  e.code = 'EABORTED';
  return e;
}

/**
 * Recursively copy a directory. Does not follow symlinks (recreates them).
 * options: { onProgress, shouldAbort, concurrency }
 */
async function copyDir(src, dst, options = {}) {
  const { onProgress, shouldAbort, concurrency = 4 } = options;
  const entries = [];
  let totalBytes = 0;
  let totalFiles = 0;

  async function scan(dir, rel) {
    if (shouldAbort && shouldAbort()) throw abortError();
    const items = await fsp.readdir(longPath(dir), { withFileTypes: true });
    for (const it of items) {
      const abs = path.join(dir, it.name);
      const r = rel ? path.join(rel, it.name) : it.name;
      if (it.isSymbolicLink()) {
        entries.push({ type: 'link', rel: r, abs });
      } else if (it.isDirectory()) {
        entries.push({ type: 'dir', rel: r });
        await scan(abs, r);
      } else if (it.isFile()) {
        const st = await fsp.stat(longPath(abs));
        entries.push({ type: 'file', rel: r, abs, size: st.size, atime: st.atime, mtime: st.mtime });
        totalBytes += st.size;
        totalFiles++;
      }
    }
  }

  await scan(src, '');
  await mkdirp(dst);
  for (const e of entries) {
    if (e.type === 'dir') await mkdirp(path.join(dst, e.rel));
  }

  const queue = entries.filter((e) => e.type === 'file' || e.type === 'link');
  let index = 0;
  let doneBytes = 0;
  let doneFiles = 0;
  let current = '';
  let lastReport = 0;

  const report = (force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastReport < 150) return;
    lastReport = now;
    onProgress({ totalBytes, doneBytes, totalFiles, doneFiles, current });
  };

  // Workers share a failure flag. Without it, Promise.all rejects on the first
  // error while sibling workers are still copying; the caller then starts a
  // rollback that races with those writes. Wait for every worker to stop first.
  let workerError = null;

  async function worker() {
    while (!workerError && index < queue.length) {
      if (shouldAbort && shouldAbort()) {
        workerError = abortError();
        break;
      }
      const e = queue[index++];
      current = e.rel;
      const target = path.join(dst, e.rel);
      try {
        await mkdirp(path.dirname(target));
        if (e.type === 'link') {
          let linkTarget;
          try {
            linkTarget = await fsp.readlink(longPath(e.abs));
          } catch {
            continue;
          }
          let isDir = false;
          try {
            isDir = (await fsp.stat(longPath(e.abs))).isDirectory();
          } catch {
            /* dangling link */
          }
          try {
            await fsp.symlink(linkTarget, longPath(target), isDir ? 'junction' : 'file');
          } catch {
            /* non-critical: skip links we cannot recreate */
          }
        } else {
          await fsp.copyFile(longPath(e.abs), longPath(target));
          await fsp.utimes(longPath(target), e.atime, e.mtime).catch(() => {});
          doneBytes += e.size;
          doneFiles++;
        }
        report();
      } catch (err) {
        if (!workerError) workerError = err;
        break;
      }
    }
  }

  const workers = Math.max(1, Math.min(concurrency, queue.length || 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (workerError) throw workerError;
  report(true);
  return { totalBytes, totalFiles, doneBytes, doneFiles };
}

async function verifyCopy(src, dst) {
  const [a, b] = await Promise.all([statDir(src), statDir(dst)]);
  return {
    ok: a.files === b.files && a.bytes === b.bytes,
    expected: a,
    actual: b,
  };
}

function normPath(p) {
  if (!p) return '';
  let resolved;
  try {
    resolved = path.resolve(p);
  } catch {
    return String(p).toLowerCase();
  }
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    /* path may not exist */
  }
  return resolved.replace(/[\\/]+$/, '').toLowerCase();
}

function samePath(a, b) {
  return !!a && !!b && normPath(a) === normPath(b);
}

function isSubPath(parent, child) {
  const p = normPath(parent);
  const c = normPath(child);
  return !!p && !!c && (c === p || c.startsWith(p + path.sep) || c.startsWith(p + '/'));
}

module.exports = {
  IS_WIN,
  longPath,
  exists,
  existsSync,
  isLink,
  isLinkSync,
  mkdirp,
  mkdirpSync,
  removeEntry,
  removeEntrySync,
  rename,
  renameSync,
  readLinkSync,
  createJunction,
  removeJunctionSync,
  timestamp,
  uniquePath,
  moveToTrashSync,
  pruneTrash,
  statfs,
  checkWritableSync,
  isDirEmpty,
  statDir,
  copyDir,
  verifyCopy,
  normPath,
  samePath,
  isSubPath,
  abortError,
};
