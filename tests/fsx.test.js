'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fsx = require('../src/core/fsx');

function tmp(prefix = 'scum-sw-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

test('copyDir + verifyCopy copies nested files and preserves size', async () => {
  const root = tmp();
  const src = path.join(root, 'src');
  const dst = path.join(root, 'dst');
  write(path.join(src, 'a.txt'), 'hello');
  write(path.join(src, 'sub', 'b.bin'), Buffer.alloc(2048, 1));
  const events = [];
  await fsx.copyDir(src, dst, { onProgress: (p) => events.push(p) });
  const check = await fsx.verifyCopy(src, dst);
  assert.strictEqual(check.ok, true);
  assert.strictEqual(fs.readFileSync(path.join(dst, 'a.txt'), 'utf8'), 'hello');
  assert.strictEqual(fs.statSync(path.join(dst, 'sub', 'b.bin')).size, 2048);
  assert.ok(events.length > 0);
});

test('copyDir honours abort', async () => {
  const root = tmp();
  const src = path.join(root, 'src');
  const dst = path.join(root, 'dst');
  for (let i = 0; i < 40; i++) write(path.join(src, `f${i}.bin`), Buffer.alloc(64 * 1024, i));
  const signal = { aborted: false };
  await assert.rejects(
    fsx.copyDir(src, dst, {
      shouldAbort: () => signal.aborted,
      onProgress: () => {
        signal.aborted = true;
      },
    }),
    (err) => err.code === 'EABORTED'
  );
});

test('copyDir waits for every worker to stop before rejecting', async () => {
  const root = tmp();
  const src = path.join(root, 'src');
  const dst = path.join(root, 'dst');
  write(path.join(src, '000-fail.bin'), Buffer.alloc(1024, 1));
  for (let i = 1; i < 24; i++) write(path.join(src, `f${i}.bin`), Buffer.alloc(32 * 1024, i));

  // Slow the successful copies down so a naive Promise.all would reject while
  // workers are still pulling new files off the queue.
  const original = fs.promises.copyFile;
  let started = 0;
  let failNext = true;
  fs.promises.copyFile = async function patched(from, to) {
    started++;
    // The first call fails synchronously; the other workers are already
    // in flight, which is exactly the race this test guards against.
    if (failNext) {
      failNext = false;
      throw new Error('boom');
    }
    await new Promise((r) => setTimeout(r, 30));
    return original.call(fs.promises, from, to);
  };
  try {
    await assert.rejects(fsx.copyDir(src, dst, { concurrency: 4 }), /boom/);
    const atReject = started;
    await new Promise((r) => setTimeout(r, 250));
    assert.strictEqual(started, atReject, 'workers kept copying after copyDir rejected');
  } finally {
    fs.promises.copyFile = original;
  }
});

test('moveToTrash is a same-volume rename and prune keeps the newest N', async () => {
  const root = tmp();
  const live = path.join(root, 'Saved.0509');
  write(path.join(live, 'x.txt'), 'x');
  const trash = path.join(root, '.switcher-trash');
  const dest = fsx.moveToTrashSync(live, trash, 'Saved.0509');
  assert.strictEqual(fs.existsSync(live), false);
  assert.strictEqual(fs.existsSync(path.join(dest, 'x.txt')), true);

  for (let i = 0; i < 6; i++) {
    const p = path.join(root, `trash-${i}`);
    write(path.join(p, 'y.txt'), 'y');
    fsx.moveToTrashSync(p, trash, `entry-${i}`);
  }
  const before = fs.readdirSync(trash).length;
  const removed = await fsx.pruneTrash(trash, 2);
  const after = fs.readdirSync(trash).length;
  assert.strictEqual(before, 7);
  assert.strictEqual(after, 2);
  assert.strictEqual(removed.length, 5);
});

test('junction create/remove does not touch the target data', () => {
  const root = tmp();
  const target = path.join(root, 'Saved.8805');
  const link = path.join(root, 'Saved');
  write(path.join(target, 'save.dat'), 'data');
  fsx.createJunction(link, target);
  assert.strictEqual(fsx.isLinkSync(link), true);
  assert.strictEqual(fs.readFileSync(path.join(link, 'save.dat'), 'utf8'), 'data');
  fsx.removeJunctionSync(link);
  assert.strictEqual(fs.existsSync(link), false);
  assert.strictEqual(fs.readFileSync(path.join(target, 'save.dat'), 'utf8'), 'data');
});

test('normPath comparison is case and trailing-separator insensitive', () => {
  const root = tmp();
  assert.strictEqual(fsx.samePath(root, root + path.sep), true);
  assert.strictEqual(fsx.samePath(root.toUpperCase(), root.toLowerCase()), true);
});
