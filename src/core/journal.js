'use strict';

const fs = require('fs');
const path = require('path');
const { mkdirpSync } = require('./fsx');

function writeJson(file, data) {
  mkdirpSync(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function createJournal({ fromId, toId, mode, baseDir }) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    phase: 'precheck',
    fromId,
    toId,
    mode,
    baseDir,
    actions: [],
    error: null,
  };
}

function saveJournal(file, journal) {
  journal.updatedAt = new Date().toISOString();
  writeJson(file, journal);
}

function loadJournal(file) {
  const data = readJson(file, null);
  if (!data || !data.status) return null;
  return data;
}

function clearJournal(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

function addAction(journal, action) {
  const entry = { seq: journal.actions.length + 1, state: 'pending', ...action };
  journal.actions.push(entry);
  return entry;
}

function setActionState(journal, seq, state, extra = {}) {
  const action = journal.actions.find((a) => a.seq === seq);
  if (action) Object.assign(action, extra, { state });
}

function appendHistory(file, record, limit = 100) {
  const list = readJson(file, []);
  const arr = Array.isArray(list) ? list : [];
  arr.unshift(record);
  writeJson(file, arr.slice(0, limit));
}

function readHistory(file, limit = 100) {
  const list = readJson(file, []);
  return Array.isArray(list) ? list.slice(0, limit) : [];
}

module.exports = {
  writeJson,
  readJson,
  createJournal,
  saveJournal,
  loadJournal,
  clearJournal,
  addAction,
  setActionState,
  appendHistory,
  readHistory,
};
