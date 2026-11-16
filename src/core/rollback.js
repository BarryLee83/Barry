'use strict';

const fsx = require('./fsx');

/**
 * Reverses a single journal action. All operations are existence-checked so
 * this is safe to run on a partially executed journal (after a crash).
 */
async function undoAction(action) {
  if (!action || action.state === 'undone') return { skipped: true };
  switch (action.kind) {
    case 'trash': {
      if (!action.trash || !action.orig) return { skipped: true };
      if ((await fsx.exists(action.trash)) && !(await fsx.exists(action.orig))) {
        await fsx.rename(action.trash, action.orig);
        return { done: true };
      }
      return { skipped: true };
    }
    case 'move': {
      if (!action.from || !action.to) return { skipped: true };
      if ((await fsx.exists(action.to)) && !(await fsx.exists(action.from))) {
        await fsx.rename(action.to, action.from);
        return { done: true };
      }
      return { skipped: true };
    }
    case 'copy': {
      if (!action.to) return { skipped: true };
      if (await fsx.exists(action.to)) {
        await fsx.removeEntry(action.to);
        return { done: true };
      }
      return { skipped: true };
    }
    case 'junction': {
      if (!action.path) return { skipped: true };
      if (await fsx.isLink(action.path)) {
        fsx.removeJunctionSync(action.path);
        return { done: true };
      }
      return { skipped: true };
    }
    case 'junction-removed': {
      if (!action.path || !action.target) return { skipped: true };
      if (!(await fsx.exists(action.path)) && (await fsx.exists(action.target))) {
        fsx.createJunction(action.path, action.target);
        return { done: true };
      }
      return { skipped: true };
    }
    case 'mkdir': {
      if (!action.path) return { skipped: true };
      if ((await fsx.exists(action.path)) && (await fsx.isDirEmpty(action.path))) {
        await fsx.removeEntry(action.path);
        return { done: true };
      }
      return { skipped: true };
    }
    default:
      return { skipped: true };
  }
}

async function rollbackJournal(journal, options = {}) {
  const { onLog = () => {}, onAction = () => {} } = options;
  const failures = [];
  const actions = Array.isArray(journal.actions) ? [...journal.actions].reverse() : [];
  for (const action of actions) {
    if (action.state === 'undone') continue;
    try {
      await undoAction(action);
      action.state = 'undone';
      onAction(action);
    } catch (err) {
      failures.push({ action, error: err.message });
      onLog({ level: 'error', key: 'log.rollback_failed', params: { detail: `${action.kind}: ${err.message}` } });
    }
  }
  return { failures, actions };
}

module.exports = { undoAction, rollbackJournal };
