'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const fsx = require('./fsx');

const MAX_FILES = 20000;

async function scanMods(modsDir, options = {}) {
  const result = {
    exists: false,
    path: modsDir,
    files: [],
    conflicts: [],
    totalBytes: 0,
    fileCount: 0,
    topLevel: [],
    truncated: false,
  };
  if (!modsDir || !(await fsx.exists(modsDir))) return result;
  result.exists = true;
  const isLink = await fsx.isLink(modsDir);
  result.isJunction = isLink;
  if (isLink) {
    try {
      result.linkTarget = fsx.readLinkSync(modsDir);
    } catch {
      result.linkTarget = null;
    }
  }

  const top = new Map();
  const pakMap = new Map();
  const stack = [{ dir: modsDir, rel: '' }];
  while (stack.length) {
    const { dir, rel } = stack.pop();
    let items;
    try {
      items = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      const abs = path.join(dir, it.name);
      const relPath = rel ? path.join(rel, it.name) : it.name;
      const first = relPath.split(/[\\/]/)[0];
      if (!top.has(first)) top.set(first, { name: first, isDir: it.isDirectory(), bytes: 0, files: 0 });
      const topEntry = top.get(first);
      if (it.isSymbolicLink()) {
        topEntry.files++;
        continue;
      }
      if (it.isDirectory()) {
        stack.push({ dir: abs, rel: relPath });
      } else if (it.isFile()) {
        let st;
        try {
          st = await fsp.stat(abs);
        } catch {
          continue;
        }
        result.fileCount++;
        result.totalBytes += st.size;
        topEntry.bytes += st.size;
        topEntry.files++;
        if (result.files.length < (options.maxFiles || MAX_FILES)) {
          const ext = path.extname(it.name).toLowerCase();
          result.files.push({ rel: relPath, size: st.size, ext });
          if (ext === '.pak') {
            const key = it.name.toLowerCase();
            if (!pakMap.has(key)) pakMap.set(key, []);
            pakMap.get(key).push(relPath);
          }
        } else {
          result.truncated = true;
        }
      }
    }
  }

  for (const [name, paths] of pakMap.entries()) {
    if (paths.length > 1) result.conflicts.push({ name, paths });
  }
  result.conflicts.sort((a, b) => a.name.localeCompare(b.name));
  result.topLevel = Array.from(top.values()).sort((a, b) => b.bytes - a.bytes);
  result.files.sort((a, b) => a.rel.localeCompare(b.rel));
  return result;
}

async function removeEmptyParents(startDir, stopDir) {
  const stop = path.resolve(stopDir);
  let dir = path.resolve(startDir);
  while (dir !== stop && fsx.isSubPath(stop, dir)) {
    try {
      const items = await fsp.readdir(dir);
      if (items.length) break;
      await fsp.rmdir(dir);
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
}

/**
 * Enable/disable a mod entry by moving it outside the mounted ~Mods folder.
 * This keeps the data recoverable and never deletes anything.
 */
async function setEntryEnabled(modsDir, relPath, enabled) {
  const paksDir = path.dirname(modsDir);
  const disabledRoot = path.join(paksDir, '~Mods.disabled');
  const sourceRel = String(relPath || '').replace(/^[\\/]+/, '');
  const segments = sourceRel.split(/[\\/]+/).filter(Boolean);
  // Reject traversal by segment (not substring: "mod..v2.pak" is a valid name)
  // and NTFS colon/ADS syntax.
  if (!segments.length || segments.some((seg) => seg === '..') || sourceRel.includes(':')) {
    throw Object.assign(new Error('Invalid mod path'), { code: 'EINVAL' });
  }
  if (enabled) {
    const src = path.join(disabledRoot, sourceRel);
    const dst = path.join(modsDir, sourceRel);
    if (!(await fsx.exists(src))) {
      throw Object.assign(new Error(`Disabled mod not found: ${src}`), { code: 'ENOENT' });
    }
    if (await fsx.exists(dst)) {
      throw Object.assign(new Error(`Target already exists: ${dst}`), { code: 'EEXIST' });
    }
    await fsx.mkdirp(modsDir);
    await fsx.rename(src, dst);

    // Restore the .sig companion too, mirroring the disable path. Without it
    // the .pak is mounted but its signature stays disabled, so the mod breaks.
    if (/\.pak$/i.test(src)) {
      const sig = src.replace(/\.pak$/i, '.sig');
      if (await fsx.exists(sig)) {
        const sigDst = dst.replace(/\.pak$/i, '.sig');
        if (!(await fsx.exists(sigDst))) {
          try {
            await fsx.rename(sig, sigDst);
          } catch {
            /* optional */
          }
        }
      }
    }
    await removeEmptyParents(path.dirname(src), disabledRoot);
    return { enabled: true, path: dst };
  }
  const src = path.join(modsDir, sourceRel);
  const dst = fsx.uniquePath(path.join(disabledRoot, sourceRel));
  if (!(await fsx.exists(src))) {
    throw Object.assign(new Error(`Mod not found: ${src}`), { code: 'ENOENT' });
  }
  await fsx.mkdirp(path.dirname(dst));
  await fsx.rename(src, dst);

  // If a .pak is disabled, move its companion .sig too (best-effort).
  if (/\.pak$/i.test(src)) {
    const sig = src.replace(/\.pak$/i, '.sig');
    if (await fsx.exists(sig)) {
      const sigDst = dst.replace(/\.pak$/i, '.sig');
      try {
        await fsx.mkdirp(path.dirname(sigDst));
        await fsx.rename(sig, sigDst);
      } catch {
        /* optional */
      }
    }
  }
  return { enabled: false, path: dst };
}

module.exports = { scanMods, setEntryEnabled };
