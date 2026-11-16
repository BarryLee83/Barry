'use strict';

import { t, setLang, getLang, applyStatic } from './i18n.js';

const $ = (selector, root = document) => root.querySelector(selector);
const api = window.api;

const STEP_KEYS = [
  'precheck',
  'stop-game',
  'stop-launcher',
  'stash-saved',
  'load-saved',
  'stash-mods',
  'load-mods',
  'verify',
  'launch',
];

const SETTINGS_TABS = ['general', 'paths', 'profiles', 'safety', 'history', 'about'];

const ICONS = {
  edit:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke-linejoin="round"/><path d="M13.5 6.5l4 4"/></svg>',
  folder:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke-linejoin="round"/></svg>',
  copy:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" stroke-linejoin="round"/></svg>',
  play:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5Z"/></svg>',
};

/* ------------------------------------------------------------------ state */

let state = null;
const modals = [];
const ui = {
  selectedId: null,
  switching: false,
  stepStates: {},
  logs: [],
  progress: 0,
  activeSettingsTab: 'general',
  settingsCtl: null,
  hideTimer: null,
};

const els = {};

/* ----------------------------------------------------------------- helpers */

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs && typeof attrs === 'object') {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'dataset') {
        for (const [dataKey, dataValue] of Object.entries(value)) {
          if (dataValue === undefined || dataValue === null || dataValue === false) continue;
          node.dataset[dataKey] = dataValue === true ? '' : String(dataValue);
        }
      } else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key === 'value') node.value = value;
      else if (key === 'checked') node.checked = !!value;
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendChildren(node, child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

function joinPath(dir, name) {
  if (!dir) return '';
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

function savedProfilePath(id) {
  return state && state.paths ? joinPath(state.paths.scumDataDir, `Saved.${id}`) : '';
}

function modsProfilePath(id) {
  return state && state.paths ? joinPath(state.paths.contentDir, `~Mods.${id}`) : '';
}

function profileById(id) {
  return state ? state.profiles.find((p) => p.id === id) : null;
}

function currentProfile() {
  if (!state || !state.current) return null;
  return profileById(state.current.profileId);
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function formatTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString(getLang() === 'en' ? 'en-US' : 'zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatClock(ts) {
  return new Date(ts || Date.now()).toLocaleTimeString(getLang() === 'en' ? 'en-US' : 'zh-CN', {
    hour12: false,
  });
}

function durationText(startedAt, finishedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt || Date.now()).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return t('history.duration', { seconds });
}

function modeLabel(mode) {
  return t(mode === 'junction' ? 'route.modeJunction' : 'route.modeCopy');
}

function sourceLabel(source) {
  const known = ['detected', 'launched', 'manual', 'remembered'];
  return t(`current.source.${known.includes(source) ? source : 'manual'}`);
}

/* ------------------------------------------------------------------ toasts */

function toast(message, tone = 'info', ms = 2600) {
  if (!message) return;
  const root = $('#toastRoot');
  const glyph = tone === 'error' ? '!' : tone === 'success' ? '✓' : tone === 'warning' ? '▲' : '·';
  const node = el(
    'div',
    { class: 'toast', dataset: { tone } },
    el('span', { class: 'toast-glyph', text: glyph }),
    el('span', { class: 'toast-msg', text: message })
  );
  node.addEventListener('click', () => node.remove());
  root.appendChild(node);
  while (root.children.length > 4) root.firstElementChild.remove();
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  }, ms);
}

/* ------------------------------------------------------------------ modals */

function openModal(options) {
  const {
    title,
    sub = '',
    size = '',
    bodyClass = '',
    headActions = [],
    footer = null,
    dismissible = true,
    onClose = null,
  } = options;

  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal' + (size ? ` ${size}` : '') });
  const titleEl = el('h3', { text: title });
  const head = el(
    'div',
    { class: 'modal-head' },
    el('div', {}, titleEl, sub ? el('div', { class: 'sub', text: sub }) : null)
  );
  if (headActions.length) {
    const actions = el('div', { class: 'head-actions' });
    for (const action of headActions) actions.appendChild(action);
    head.appendChild(actions);
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    const index = modals.indexOf(ctl);
    if (index >= 0) modals.splice(index, 1);
    if (onClose) onClose();
  };

  if (dismissible) {
    head.appendChild(
      el('button', { class: 'icon-btn', title: t('common.close'), onclick: close }, '✕')
    );
  }

  const body = el('div', { class: 'modal-body' + (bodyClass ? ` ${bodyClass}` : '') });
  if (typeof options.body === 'function') options.body(body);
  else if (options.body instanceof Node) body.appendChild(options.body);
  const foot = footer ? el('div', { class: 'modal-foot' }) : null;
  if (foot && Array.isArray(footer)) for (const item of footer) foot.appendChild(item);

  modal.append(head, body);
  if (foot) modal.appendChild(foot);
  backdrop.appendChild(modal);

  if (dismissible) {
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close();
    });
  }

  const ctl = {
    close,
    body,
    modal,
    root: backdrop,
    dismissible,
    setTitle: (text) => {
      titleEl.textContent = text;
    },
  };
  modals.push(ctl);
  $('#modalRoot').appendChild(backdrop);
  return ctl;
}

function confirmDialog({ title, body, confirmText = t('common.confirm'), tone = 'primary' }) {
  return new Promise((resolve) => {
    let settled = false;
    const cancelBtn = el('button', {
      class: 'ghost',
      text: t('common.cancel'),
      onclick: () => {
        settled = true;
        ctl.close();
        resolve(false);
      },
    });
    const okBtn = el('button', {
      class: tone === 'danger' ? 'danger' : 'primary',
      text: confirmText,
      onclick: () => {
        settled = true;
        ctl.close();
        resolve(true);
      },
    });
    const ctl = openModal({
      title,
      body: el('div', { class: 'modal-text' }, body),
      footer: [cancelBtn, okBtn],
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
  });
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  bindShell();
  els.logList.classList.add('log-empty');

  if (!api) {
    document.body.textContent = 'Preload bridge missing.';
    return;
  }

  try {
    const res = await api.getState();
    if (!res || !res.ok) throw new Error((res && res.message) || 'state unavailable');
    state = res.state;
  } catch (err) {
    document.body.replaceChildren(
      el('div', { class: 'loading-screen' }, el('div', { text: String(err.message || err) }))
    );
    return;
  }

  setLang(state.config.language);
  applyLocale();
  chooseSelected();
  resetSteps();
  renderAll();
  subscribe();

  if (state.recovery) showRecovery(state.recovery);
  else if (!state.config.onboardingDone) showOnboarding();
}

function subscribe() {
  api.onProgress((progress) => {
    if (!progress) return;
    showProgress(true);
    if (progress.phase === 'done') {
      for (const key of STEP_KEYS) ui.stepStates[key] = 'done';
      ui.progress = 100;
    }
    if (STEP_KEYS.includes(progress.phase)) {
      const map = {
        start: 'running',
        progress: 'running',
        done: 'done',
        skip: 'skip',
        error: 'error',
      };
      if (map[progress.status]) ui.stepStates[progress.phase] = map[progress.status];
    }
    if (typeof progress.percent === 'number') ui.progress = progress.percent;
    if (progress.message) $('#progressLabel').textContent = progress.message;
    renderProgress();
    renderSteps();
  });

  api.onLog((entry) => {
    if (!entry) return;
    ui.logs.push(entry);
    if (ui.logs.length > 400) ui.logs.splice(0, ui.logs.length - 400);
    renderLog();
  });

  api.onStateChanged((payload) => {
    if (!payload || !payload.state) return;
    state = payload.state;
    chooseSelected();
    applyLocale();
    renderAll();
    if (ui.settingsCtl) ui.settingsCtl.refresh();
  });

  api.onDetected((payload) => {
    if (!payload || !state) return;
    if (payload.detected) state.detected = payload.detected;
    if (payload.current) state.current = payload.current;
    if (payload.profiles) state.profiles = payload.profiles;
    renderPills();
    renderProfiles();
    renderCurrentBanner();
    renderRoute();
    renderSummary();
    renderSwitchButton();
  });
}

/* --------------------------------------------------------------- localization */

function applyLocale() {
  if (!state) return;
  setLang(state.config.language);
  document.documentElement.dataset.theme = state.config.theme || 'cyberpunk';
  document.title = t('app.title');
  applyStatic(document);

  els.btnLang.textContent = getLang() === 'zh-CN' ? 'EN' : '中';
  els.btnLang.title = getLang() === 'zh-CN' ? 'English' : '中文';
  els.btnTheme.title = t('settings.theme');
  els.btnAdmin.title = t('admin.title');
  els.btnSettings.title = t('settings.title');
  els.btnAddProfile.title = t('profiles.add');
}

async function updateConfig(patch, silent = true) {
  const res = await api.updateConfig(patch);
  if (!res || !res.ok) {
    toast((res && res.message) || t('settings.saveFailed'), 'error');
    return false;
  }
  if (res.state) state = res.state;
  applyLocale();
  chooseSelected();
  renderAll();
  if (ui.settingsCtl) ui.settingsCtl.refresh();
  if (!silent) toast(t('toast.saved'), 'success', 1500);
  return true;
}

/* ---------------------------------------------------------------- rendering */

function chooseSelected() {
  if (!state || !state.profiles.length) {
    ui.selectedId = null;
    return;
  }
  if (ui.selectedId && state.profiles.some((p) => p.id === ui.selectedId)) return;
  const current = state.current ? state.current.profileId : null;
  const candidate = state.profiles.find((p) => p.id !== current) || state.profiles[0];
  ui.selectedId = candidate ? candidate.id : null;
}

function renderAll() {
  if (!state) return;
  renderPills();
  renderProfiles();
  renderCurrentBanner();
  renderRoute();
  renderSummary();
  renderSwitchButton();
  renderSteps();
  renderLog();
  renderFooter();
  els.btnChangeCurrent.textContent = t('switch.changeCurrent');
  els.btnLaunchCurrent.textContent = t('switch.launchCurrent');
}

function renderPills() {
  const games = (state.detected && state.detected.games) || [];
  const launchers = (state.detected && state.detected.launchers) || [];
  const error = state.detected && state.detected.error;

  const gamePill = els.pillGame;
  gamePill.dataset.state = games.length ? 'warn' : 'off';
  gamePill.textContent = games.length
    ? `${t('status.gameRunning')} · ${games.map((g) => g.pid).join(', ')}`
    : t('status.gameStopped');

  const launcherPill = els.pillLauncher;
  if (error) {
    launcherPill.dataset.state = 'off';
    launcherPill.textContent = t('status.launcherUnknown');
  } else if (launchers.length) {
    launcherPill.dataset.state = 'on';
    const names = Array.from(new Set(launchers.map((l) => l.name || l.exePath || '?')));
    launcherPill.textContent = `${t('status.launcherRunning')} · ${names.join(', ')}`;
  } else {
    launcherPill.dataset.state = 'off';
    launcherPill.textContent = t('status.launcherStopped');
  }

  const cur = currentProfile();
  els.pillCurrent.dataset.state = cur ? 'accent' : 'off';
  els.pillCurrent.textContent = `${t('status.current')} · ${cur ? cur.name : t('current.unknown')}`;
}

function renderProfiles() {
  const list = els.profileList;
  const scrollTop = list.scrollTop;
  clear(list);

  if (state.discoveries && state.discoveries.length) {
    list.appendChild(
      el(
        'div',
        { class: 'callout' },
        el('span', { class: 'callout-icon', text: '＋' }),
        el(
          'div',
          { style: { flex: '1' } },
          el('div', { text: t('profiles.discovered', { count: state.discoveries.length }) }),
          el(
            'div',
            { class: 'mono faint', style: { marginTop: '3px', fontSize: '10px' } },
            state.discoveries.map((d) => d.id).join(' · ')
          )
        ),
        el('button', { class: 'ghost small', text: t('profiles.import'), onclick: importDiscoveries })
      )
    );
  }

  if (!state.profiles.length) {
    list.appendChild(
      el(
        'div',
        { class: 'empty-state' },
        el('div', { class: 'big', text: '◫' }),
        el('div', { text: t('profiles.empty') }),
        el('div', { text: t('profiles.emptyHint') }),
        el('button', {
          class: 'ghost small',
          text: t('profiles.add'),
          style: { marginTop: '8px' },
          onclick: () => openProfileEditor(null),
        })
      )
    );
    return;
  }

  const current = state.current ? state.current.profileId : null;

  for (const profile of state.profiles) {
    const selected = profile.id === ui.selectedId;
    const active = profile.id === current;
    const running = (profile.runningPids || []).length > 0;

    const badges = [];
    if (active) badges.push(el('span', { class: 'badge', dataset: { tone: 'accent' }, text: t('profiles.active') }));
    if (running) {
      badges.push(
        el('span', {
          class: 'badge',
          dataset: { tone: 'success' },
          text: `${t('profiles.running')} · ${profile.runningPids.join(', ')}`,
        })
      );
    } else if (profile.exePath && !(state.detected && state.detected.error)) {
      badges.push(el('span', { class: 'badge', text: t('profiles.stopped') }));
    }
    if (!profile.exePath) {
      badges.push(el('span', { class: 'badge', dataset: { tone: 'warning' }, text: t('profiles.noLauncher') }));
    } else if (profile.launcherExists === false) {
      badges.push(el('span', { class: 'badge', dataset: { tone: 'danger' }, text: t('profiles.launcherMissing') }));
    }
    badges.push(
      el('span', {
        class: 'badge',
        dataset: { tone: profile.savedExists ? 'success' : undefined },
        text: t(profile.savedExists ? 'profiles.savedExists' : 'profiles.savedMissing'),
      })
    );
    if (profile.noMods) {
      badges.push(el('span', { class: 'badge', text: t('profiles.noMods') }));
    } else {
      badges.push(
        el('span', {
          class: 'badge',
          dataset: { tone: profile.modsExists ? 'success' : undefined },
          text: t(profile.modsExists ? 'profiles.modsExists' : 'profiles.modsMissing'),
        })
      );
    }

    const card = el(
      'div',
      {
        class: 'profile' + (selected ? ' selected' : '') + (active ? ' active' : ''),
        role: 'radio',
        'aria-checked': selected ? 'true' : 'false',
        tabindex: '0',
        onclick: () => selectProfile(profile.id),
        ondblclick: () => {
          if (profile.id !== current) beginSwitch();
        },
        onkeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectProfile(profile.id);
          }
        },
      },
      el('span', { class: 'profile-radio' }),
      el(
        'div',
        { class: 'profile-main' },
        el(
          'div',
          { class: 'profile-name-row' },
          el('span', { class: 'profile-name', text: profile.name }),
          el('span', { class: 'id-chip', text: profile.id })
        ),
        el('div', { class: 'profile-meta' }, badges)
      ),
      el(
        'div',
        { class: 'profile-actions' },
        el(
          'button',
          {
            class: 'mini-btn',
            title: t('profiles.edit'),
            html: ICONS.edit,
            onclick: (event) => {
              event.stopPropagation();
              openProfileEditor(profile);
            },
          }
        )
      )
    );
    list.appendChild(card);
  }

  list.scrollTop = scrollTop;
}

function selectProfile(id) {
  if (ui.switching) return;
  ui.selectedId = id;
  renderProfiles();
  renderRoute();
  renderSummary();
  renderSwitchButton();
}

function renderCurrentBanner() {
  const banner = els.currentBanner;
  clear(banner);
  banner.appendChild(el('span', { class: 'cb-label', text: t('current.label') }));

  const cur = currentProfile();
  if (cur) {
    banner.appendChild(el('strong', { text: cur.name }));
    if (state.current && state.current.source) {
      banner.appendChild(
        el('span', { class: 'cb-source', text: sourceLabel(state.current.source) })
      );
    }
  } else {
    banner.appendChild(el('span', { text: t('current.unknown') }));
    banner.appendChild(el('span', { class: 'faint', text: '· ' + t('current.unknownHint') }));
  }

  const actions = el('div', { class: 'cb-actions' });
  if (cur && !ui.switching) {
    actions.appendChild(
      el('button', {
        class: 'ghost tiny',
        text: t('current.launch'),
        title: t('current.launch'),
        onclick: launchCurrent,
      })
    );
  }
  if (state.profiles.length && !ui.switching) {
    actions.appendChild(
      el('button', {
        class: 'ghost tiny',
        text: t('current.change'),
        onclick: async () => {
          const picked = await pickCurrentProfile();
          if (picked === undefined) return;
          await applyCurrent(picked);
        },
      })
    );
  }
  banner.appendChild(actions);
}

async function applyCurrent(id) {
  const res = await api.setCurrent(id);
  if (!res || !res.ok) {
    toast((res && res.message) || t('toast.error'), 'error');
    return false;
  }
  if (res.state) state = res.state;
  chooseSelected();
  applyLocale();
  renderAll();
  if (id) toast(t('current.setDone'), 'success', 1600);
  return true;
}

function renderRoute() {
  const cur = currentProfile();
  const target = profileById(ui.selectedId);

  const from = els.fromNode;
  clear(from);
  from.append(
    el('div', { class: 'route-label', text: t('route.from') }),
    el('div', {
      class: 'route-name' + (cur ? '' : ' dim'),
      text: cur ? cur.name : t('route.none'),
    }),
    el('div', {
      class: 'route-sub',
      text: cur ? `Saved.${cur.id}` : 'Saved',
    })
  );

  const to = els.toNode;
  clear(to);
  to.append(
    el('div', { class: 'route-label', text: t('route.to') }),
    el('div', {
      class: 'route-name' + (target ? '' : ' dim'),
      text: target ? target.name : t('route.none'),
    }),
    el('div', {
      class: 'route-sub',
      text: target ? `Saved.${target.id}` : '—',
    })
  );
}

function renderSummary() {
  const box = els.switchSummary;
  clear(box);
  const rows = [];
  const cur = currentProfile();
  const target = profileById(ui.selectedId);

  if (!state.gameRootValid) rows.push([t('paths.needsGameRoot'), 'danger']);
  if (!state.dataDirValid) rows.push([t('paths.needsDataDir'), 'danger']);

  if (!target) {
    rows.push([t('switch.buttonNoTarget'), 'warning']);
  } else if (cur && cur.id === target.id) {
    rows.push([t('route.sameHint'), 'success']);
  } else {
    rows.push([`${t('switch.mode')}: ${modeLabel(state.config.mode)}`, null]);

    if (!cur) {
      rows.push([t('route.unknownCurrent'), 'warning']);
    } else {
      rows.push([
        `${t('route.willStashSaved', { id: cur.id })} → ${t('route.willLoadSaved', { id: target.id })}`,
        null,
      ]);
      if (target.noMods) {
        rows.push([t('route.noMods'), null]);
      } else {
        rows.push([
          `${t('route.willStashMods', { id: cur.id })} → ${t('route.willLoadMods', { id: target.id })}`,
          null,
        ]);
      }
    }

    const games = (state.detected && state.detected.games) || [];
    if (games.length) rows.push([t('route.gameWillClose'), 'warning']);

    if (!target.savedExists) rows.push([t('route.targetSavedMissing'), 'warning']);
    if (!target.noMods && !target.modsExists) rows.push([t('route.targetModsMissing'), 'warning']);
  }

  for (const [text, tone] of rows) {
    box.appendChild(el('div', { class: 'summary-row', dataset: tone ? { tone } : {}, text }));
  }
}

function renderSwitchButton() {
  const cur = currentProfile();
  const target = profileById(ui.selectedId);
  const invalidPaths = !state.gameRootValid || !state.dataDirValid;
  const same = !!(cur && target && cur.id === target.id);

  let label;
  if (ui.switching) label = t('switch.buttonRunning');
  else if (!target) label = t('switch.buttonNoTarget');
  else if (same) label = t('switch.buttonSame');
  else label = t('switch.button');

  els.btnSwitch.disabled = ui.switching || !target || same || invalidPaths;
  els.btnSwitch.querySelector('.switch-label').textContent = label;

  els.btnLaunchCurrent.hidden = !cur || ui.switching;
  els.btnChangeCurrent.hidden = !state.profiles.length || ui.switching;
  els.profileList.style.pointerEvents = ui.switching ? 'none' : '';
  els.btnAddProfile.disabled = ui.switching;
}

function renderSteps() {
  const list = els.stepList;
  if (list.children.length !== STEP_KEYS.length) {
    clear(list);
    STEP_KEYS.forEach((key, index) => {
      list.appendChild(
        el(
          'div',
          { class: 'step', dataset: { phase: key, state: 'pending' } },
          el('span', { class: 'step-num', text: String(index + 1) }),
          el('span', { class: 'step-name', text: t(`step.${key}`) })
        )
      );
    });
  }
  for (const node of list.children) {
    const phase = node.dataset.phase;
    const stepState = ui.stepStates[phase] || 'pending';
    node.dataset.state = stepState;
    node.title = `${t(`step.${phase}`)} · ${t(`step.state.${stepState}`)}`;
    const name = node.querySelector('.step-name');
    if (name) name.textContent = t(`step.${phase}`);
  }
}

function resetSteps() {
  ui.stepStates = {};
  for (const key of STEP_KEYS) ui.stepStates[key] = 'pending';
  ui.progress = 0;
  renderProgress();
  renderSteps();
}

function renderProgress() {
  els.progressBar.style.width = `${Math.max(0, Math.min(100, ui.progress || 0))}%`;
  els.progressPercent.textContent = `${Math.round(ui.progress || 0)}%`;
}

function showProgress(visible) {
  if (visible) {
    if (ui.hideTimer) {
      clearTimeout(ui.hideTimer);
      ui.hideTimer = null;
    }
    els.progressBlock.hidden = false;
  } else {
    els.progressBlock.hidden = true;
  }
}

function renderLog() {
  const list = els.logList;
  const nearBottom =
    list.scrollHeight - list.scrollTop - list.clientHeight < 36 || list.scrollHeight === 0;
  clear(list);
  list.classList.toggle('log-empty', ui.logs.length === 0);
  if (!ui.logs.length) {
    list.appendChild(el('div', { class: 'log-empty', text: t('log.empty') }));
    return;
  }
  for (const entry of ui.logs) {
    list.appendChild(
      el(
        'div',
        { class: 'log-entry', dataset: { level: entry.level || 'info' } },
        el('span', { class: 'log-time', text: formatClock(entry.time) }),
        el('span', { class: 'log-msg', text: entry.message || entry.key || '' })
      )
    );
  }
  if (nearBottom) list.scrollTop = list.scrollHeight;
}

function renderFooter() {
  els.footerPath.textContent = state.paths.savedLive || '';
  els.footerPath.title = state.paths.savedLive || '';
  els.footerVersion.textContent = `v${state.app.version} · Electron ${state.app.electron}`;
}

/* ------------------------------------------------------------- shell events */

function bindShell() {
  els.btnLang = $('#btnLang');
  els.btnTheme = $('#btnTheme');
  els.btnAdmin = $('#btnAdmin');
  els.btnSettings = $('#btnSettings');
  els.btnAddProfile = $('#btnAddProfile');
  els.pillGame = $('#pillGame');
  els.pillLauncher = $('#pillLauncher');
  els.pillCurrent = $('#pillCurrent');
  els.currentBanner = $('#currentBanner');
  els.profileList = $('#profileList');
  els.fromNode = $('#fromNode');
  els.toNode = $('#toNode');
  els.switchSummary = $('#switchSummary');
  els.btnSwitch = $('#btnSwitch');
  els.btnLaunchCurrent = $('#btnLaunchCurrent');
  els.btnChangeCurrent = $('#btnChangeCurrent');
  els.progressBlock = $('#progressBlock');
  els.progressBar = $('#progressBar');
  els.progressPercent = $('#progressPercent');
  els.progressLabel = $('#progressLabel');
  els.btnCancel = $('#btnCancel');
  els.stepList = $('#stepList');
  els.logList = $('#logList');
  els.btnClearLog = $('#btnClearLog');
  els.footerPath = $('#footerPath');
  els.footerVersion = $('#footerVersion');

  els.btnLang.addEventListener('click', () => {
    const next = getLang() === 'zh-CN' ? 'en' : 'zh-CN';
    updateConfig({ language: next });
  });

  els.btnTheme.addEventListener('click', () => {
    const themes = ['cyberpunk', 'apple', 'classic'];
    const index = themes.indexOf(state.config.theme);
    const next = themes[(index + 1) % themes.length];
    updateConfig({ theme: next });
  });

  els.btnAdmin.addEventListener('click', () => {
    if (ensureIdle()) openAdminTool();
  });
  els.btnSettings.addEventListener('click', () => {
    if (ensureIdle()) openSettings('general');
  });
  els.btnAddProfile.addEventListener('click', () => {
    if (ensureIdle()) openProfileEditor(null);
  });
  els.btnSwitch.addEventListener('click', beginSwitch);
  els.btnLaunchCurrent.addEventListener('click', launchCurrent);
  els.btnChangeCurrent.addEventListener('click', async () => {
    const picked = await pickCurrentProfile();
    if (picked === undefined) return;
    await applyCurrent(picked);
  });
  els.btnCancel.addEventListener('click', async () => {
    const res = await api.switchCancel();
    if (res && res.ok) {
      els.btnCancel.disabled = true;
      els.btnCancel.textContent = t('switch.cancelling');
      toast(t('toast.cancelRequested'), 'warning');
    } else {
      toast(t('toast.idle'), 'warning');
    }
  });
  els.btnClearLog.addEventListener('click', () => {
    ui.logs = [];
    renderLog();
    toast(t('log.cleared'), 'info', 1400);
  });

  document.querySelectorAll('.tool').forEach((button) => {
    button.addEventListener('click', () => {
      if (!ensureIdle()) return;
      const tool = button.dataset.tool;
      if (tool === 'admin') openAdminTool();
      else if (tool === 'map') openMapTool();
      else if (tool === 'mods') openModsTool();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const top = modals[modals.length - 1];
      if (top && top.dismissible) top.close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      if (modals.length) return;
      event.preventDefault();
      if (!els.btnSwitch.disabled) beginSwitch();
    }
  });
}

/* ------------------------------------------------------------- switch flow */

function ensureIdle() {
  if (!ui.switching) return true;
  toast(t('switch.buttonRunning'), 'warning');
  return false;
}

async function beginSwitch() {
  if (ui.switching || !state) return;
  const targetId = ui.selectedId;
  if (!targetId) return;
  const target = profileById(targetId);
  if (!target) return;

  if (!state.gameRootValid || !state.dataDirValid) {
    toast(!state.gameRootValid ? t('paths.needsGameRoot') : t('paths.needsDataDir'), 'error');
    openSettings('paths');
    return;
  }

  let fromId = state.current ? state.current.profileId : null;
  if (fromId && !profileById(fromId)) fromId = null;

  if (!fromId) {
    const picked = await pickCurrentProfile();
    if (picked === undefined) return;
    if (!picked) {
      toast(t('route.unknownCurrent'), 'warning');
      return;
    }
    const ok = await applyCurrent(picked);
    if (!ok) return;
    fromId = picked;
  }

  if (fromId === targetId) return;

  ui.switching = true;
  ui.logs = [];
  renderLog();
  resetSteps();
  showProgress(true);
  $('#progressLabel').textContent = t('switch.progress');
  els.btnCancel.disabled = false;
  els.btnCancel.textContent = t('switch.cancel');
  renderSwitchButton();

  let options = {};
  if (state.config.safety && state.config.safety.closeGame === 'force') options.forceKillGame = true;

  try {
    // Preflight failures happen before any file is touched, so asking the user
    // and retrying here is always safe.
    for (;;) {
      resetSteps();
      showProgress(true);
      $('#progressLabel').textContent = t('switch.progress');
      const res = await api.switchStart({ fromId, toId: targetId, options });
      if (res && res.ok) {
        finishSwitch(res);
        break;
      }
      const retry = await handleSwitchFailure(res || {}, target, options);
      if (!retry) break;
      options = retry.options;
    }
  } catch (err) {
    showErrorDialog({ code: 'IPC', message: String((err && err.message) || err) });
  } finally {
    ui.switching = false;
    setTimeout(() => {
      if (!ui.switching) showProgress(false);
    }, 900);
    els.btnCancel.disabled = false;
    els.btnCancel.textContent = t('switch.cancel');
    renderSwitchButton();
    await refreshState();
  }
}

function finishSwitch(res) {
  ui.progress = 100;
  for (const key of STEP_KEYS) ui.stepStates[key] = 'done';
  renderProgress();
  renderSteps();
  $('#progressLabel').textContent = t('switch.done');
  if (res.warnings && res.warnings.length) {
    for (const warning of res.warnings) {
      ui.logs.push({ time: Date.now(), level: 'warn', message: warning });
    }
    renderLog();
    toast(t('switch.doneWarnings'), 'warning', 4200);
  } else {
    toast(t('switch.done'), 'success', 2400);
  }
}

async function handleSwitchFailure(res, target, options) {
  switch (res.code) {
    case 'TARGET_SAVED_MISSING': {
      const action = await missingSavedDialog(target, res.info || {});
      if (action === 'empty') return { options: { ...options, createEmptySaved: true } };
      if (action === 'clone') return { options: { ...options, cloneCurrent: true } };
      return null;
    }
    case 'TARGET_MODS_MISSING': {
      const action = await missingModsDialog(target);
      if (action === 'retry') return { options };
      if (action === 'noMods') return { options: { ...options, noMods: true } };
      return null;
    }
    case 'GAME_RUNNING': {
      const action = await gameRunningDialog(res);
      if (action === 'force') return { options: { ...options, forceKillGame: true } };
      if (action === 'retry') return { options };
      return null;
    }
    case 'ACTIVE_JOURNAL':
      if (res.recovery) showRecovery(res.recovery);
      else await showErrorDialog(res);
      return null;
    case 'ABORTED':
      toast(t('switch.failed'), 'warning', 2000);
      return null;
    case 'BUSY':
      toast(res.message || t('switch.buttonRunning'), 'warning');
      return null;
    default:
      await showErrorDialog(res);
      return null;
  }
}

async function refreshState() {
  try {
    const res = await api.refreshState();
    if (res && res.ok && res.state) {
      state = res.state;
      chooseSelected();
      applyLocale();
      renderAll();
      if (ui.settingsCtl) ui.settingsCtl.refresh();
    }
  } catch {
    /* keep the last known state */
  }
}

async function launchCurrent() {
  const cur = currentProfile();
  if (!cur) {
    toast(t('current.unknown'), 'warning');
    return;
  }
  if (!cur.exePath) {
    toast(t('profiles.noLauncher'), 'warning');
    openProfileEditor(cur);
    return;
  }
  const res = await api.launchProfile(cur.id);
  if (res && res.ok) {
    if (res.alreadyRunning) toast(t('profiles.running'), 'info');
    else toast(t('current.launchDone'), 'success');
    setTimeout(refreshState, 1200);
  } else {
    toast((res && res.message) || t('toast.launchFailed'), 'error');
  }
}

/* --------------------------------------------------------------- pickers */

function pickCurrentProfile() {
  return new Promise((resolve) => {
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      ctl.close();
      resolve(value);
    }

    const body = el('div', { class: 'stack' });
    body.appendChild(el('div', { class: 'modal-text', text: t('current.unknownHint') }));

    for (const profile of state.profiles) {
      const active = state.current && state.current.profileId === profile.id;
      body.appendChild(
        el(
          'button',
          {
            class: 'option' + (active ? ' selected' : ''),
            style: { display: 'flex', alignItems: 'center', gap: '8px' },
            onclick: () => finish(profile.id),
          },
          el('strong', { style: { margin: '0', flex: '1' }, text: profile.name }),
          el('span', { class: 'id-chip', text: profile.id }),
          active ? el('span', { class: 'badge', dataset: { tone: 'accent' }, text: t('profiles.active') }) : null
        )
      );
    }

    body.appendChild(
      el(
        'button',
        {
          class: 'ghost small',
          text: t('common.none') + ' / ' + t('current.unknown'),
          style: { alignSelf: 'flex-start' },
          onclick: () => finish(null),
        }
      )
    );

    const ctl = openModal({
      title: t('current.label'),
      sub: t('current.change'),
      body,
      footer: [
        el('button', { class: 'ghost', text: t('common.cancel'), onclick: () => finish(undefined) }),
      ],
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(undefined);
        }
      },
    });
  });
}

/* ---------------------------------------------------------- switch dialogs */

function missingSavedDialog(target, info) {
  return new Promise((resolve) => {
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      ctl.close();
      resolve(value);
    }
    const canClone = !!info.canClone;
    const body = el(
      'div',
      { class: 'stack' },
      el('div', {
        class: 'modal-text',
        text: t(canClone ? 'missingSaved.bodyClone' : 'missingSaved.body', { id: target.id }),
      }),
      el(
        'div',
        { class: 'mono faint', style: { fontSize: '11px' }, text: state.paths.savedLive || '' }
      )
    );

    const foot = [
      el('button', {
        class: 'ghost small',
        text: t('missingSaved.openData'),
        onclick: () => api.openPath(state.paths.scumDataDir),
      }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'ghost', text: t('common.cancel'), onclick: () => finish(null) }),
      el('button', {
        class: 'ghost',
        text: t('missingSaved.createEmpty'),
        title: t('missingSaved.createEmptyHint'),
        onclick: () => finish('empty'),
      }),
      canClone
        ? el('button', {
            class: 'primary',
            text: t('missingSaved.clone'),
            title: t('missingSaved.cloneHint'),
            onclick: () => finish('clone'),
          })
        : null,
    ].filter(Boolean);

    const ctl = openModal({
      title: t('missingSaved.title'),
      sub: `Saved.${target.id}`,
      body,
      footer: foot,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });
  });
}

function missingModsDialog(target) {
  return new Promise((resolve) => {
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      ctl.close();
      resolve(value);
    }
    const body = el(
      'div',
      { class: 'stack' },
      el('div', {
        class: 'modal-text',
        text: t(target.noMods ? 'missingMods.bodyNoMods' : 'missingMods.body', { id: target.id }),
      }),
      el('div', { class: 'mono faint', style: { fontSize: '11px' }, text: modsProfilePath(target.id) })
    );

    const foot = [
      el('button', {
        class: 'ghost small',
        text: t('missingMods.openContent'),
        onclick: () => api.openPath(state.paths.contentDir),
      }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'ghost', text: t('common.cancel'), onclick: () => finish(null) }),
      el('button', { class: 'ghost', text: t('missingMods.noMods'), onclick: () => finish('noMods') }),
      el('button', { class: 'primary', text: t('common.continue'), onclick: () => finish('retry') }),
    ];

    const ctl = openModal({
      title: t('missingMods.title'),
      sub: `~Mods.${target.id}`,
      body,
      footer: foot,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });
  });
}

function gameRunningDialog(res) {
  return new Promise((resolve) => {
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      ctl.close();
      resolve(value);
    }
    const games = res.info && Array.isArray(res.info.games) ? res.info.games : [];
    const pids = games.map((game) => game.pid).filter((pid) => pid !== undefined);
    const body = el(
      'div',
      { class: 'stack' },
      el('div', { class: 'modal-text', text: t('gameRunning.body') }),
      pids.length ? el('div', { class: 'mono faint', text: `PID: ${pids.join(', ')}` }) : null,
      el('div', { class: 'callout', dataset: { tone: 'danger' } }, t('gameRunning.forceHint'))
    );

    const ctl = openModal({
      title: t('gameRunning.title'),
      body,
      footer: [
        el('div', { class: 'spacer' }),
        el('button', { class: 'ghost', text: t('gameRunning.cancel'), onclick: () => finish(null) }),
        el('button', { class: 'ghost', text: t('gameRunning.retry'), onclick: () => finish('retry') }),
        el('button', { class: 'danger', text: t('gameRunning.force'), onclick: () => finish('force') }),
      ],
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });
  });
}

function showErrorDialog(res) {
  return new Promise((resolve) => {
    let settled = false;
    const details = [res.code, res.message, res.info ? JSON.stringify(res.info, null, 2) : '']
      .filter(Boolean)
      .join('\n\n');

    const ctl = openModal({
      title: t('error.title'),
      sub: res.code || '',
      body: el(
        'div',
        { class: 'stack' },
        el('div', { class: 'modal-text', text: res.message || t('toast.error') }),
        res.info
          ? el('details', {}, el('summary', { text: t('error.details') }), el('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap', fontSize: '10.5px' }, text: JSON.stringify(res.info, null, 2) }))
          : null
      ),
      footer: [
        el('button', {
          class: 'ghost small',
          text: t('error.copy'),
          onclick: async () => {
            await api.copyText(details);
            toast(t('toast.copied'), 'success', 1400);
          },
        }),
        el('button', {
          class: 'ghost small',
          text: t('error.openLogs'),
          onclick: () => api.openLogs(),
        }),
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'primary',
          text: t('common.close'),
          onclick: () => {
            settled = true;
            ctl.close();
            resolve();
          },
        }),
      ],
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      },
    });
  });
}

/* -------------------------------------------------------------- discovery */

async function importDiscoveries() {
  const res = await api.profileAutodetect();
  if (!res || !res.ok) {
    toast((res && res.message) || t('toast.error'), 'error');
    return;
  }
  if (res.state) state = res.state;
  chooseSelected();
  applyLocale();
  renderAll();
  if (ui.settingsCtl) ui.settingsCtl.refresh();
  toast(res.added ? t('profiles.importDone', { count: res.added }) : t('profiles.importNone'), res.added ? 'success' : 'info');
}

/* ------------------------------------------------------------ profile editor */

function openProfileEditor(existing) {
  const isEdit = !!existing;
  const draft = {
    name: existing ? existing.name : '',
    id: existing ? existing.id : '',
    exePath: existing ? existing.exePath || '' : '',
    args: existing ? existing.args || '' : '',
    workDir: existing ? existing.workDir || '' : '',
    commandLineKeyword: existing ? existing.commandLineKeyword || '' : '',
    noMods: existing ? !!existing.noMods : false,
  };

  const nameInput = el('input', {
    type: 'text',
    value: draft.name,
    placeholder: t('profileEditor.namePlaceholder'),
    maxlength: '60',
  });
  const idInput = el('input', {
    type: 'text',
    value: draft.id,
    placeholder: '0509',
    maxlength: '32',
    disabled: isEdit,
  });
  const exeInput = el('input', { type: 'text', value: draft.exePath, placeholder: 'C:\\...\\launcher.exe' });
  const argsInput = el('input', {
    type: 'text',
    value: draft.args,
    placeholder: t('profileEditor.argsPlaceholder'),
  });
  const workInput = el('input', {
    type: 'text',
    value: draft.workDir,
    placeholder: t('profileEditor.workDirPlaceholder'),
  });
  const keywordInput = el('input', {
    type: 'text',
    value: draft.commandLineKeyword,
    placeholder: t('profileEditor.keywordPlaceholder'),
  });
  const noModsInput = el('input', { type: 'checkbox', checked: draft.noMods });

  const errorText = el('div', { class: 'error-text' });

  const body = el(
    'div',
    {},
    el(
      'div',
      { class: 'form-grid' },
      el(
        'div',
        { class: 'field' },
        el('label', { text: t('profileEditor.name') }),
        nameInput
      ),
      el(
        'div',
        { class: 'field' },
        el('label', { text: t('profileEditor.id') }),
        idInput,
        el('div', { class: 'hint', text: isEdit ? t('profileEditor.idLocked') : t('profileEditor.idHint') })
      )
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { text: t('profileEditor.exe') }),
      el(
        'div',
        { class: 'row grow' },
        exeInput,
        el('button', {
          class: 'ghost small',
          text: t('profileEditor.browse'),
          onclick: async () => {
            const res = await api.pickFile({
              filters: [{ name: 'Executable', extensions: ['exe'] }],
            });
            if (res && res.ok && res.path) exeInput.value = res.path;
          },
        })
      ),
      el('div', { class: 'hint', text: t('profileEditor.exeHint') })
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { text: t('profileEditor.args') }),
      argsInput,
      el('div', { class: 'hint', text: t('profileEditor.argsHint') })
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { text: t('profileEditor.workDir') }),
      el(
        'div',
        { class: 'row grow' },
        workInput,
        el('button', {
          class: 'ghost small',
          text: t('profileEditor.browse'),
          onclick: async () => {
            const res = await api.pickFolder();
            if (res && res.ok && res.path) workInput.value = res.path;
          },
        })
      ),
      el('div', { class: 'hint', text: t('profileEditor.workDirHint') })
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { text: t('profileEditor.keyword') }),
      keywordInput,
      el('div', { class: 'hint', text: t('profileEditor.keywordHint') })
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { text: t('profileEditor.noMods') }),
      el('label', { class: 'toggle' }, noModsInput, el('span', { class: 'track' })),
      el('div', { class: 'hint', text: t('profileEditor.noModsHint') })
    )
  );

  if (isEdit) {
    const savedPath = existing.savedPath || savedProfilePath(existing.id);
    const modsPath = existing.modsPath || modsProfilePath(existing.id);
    body.appendChild(
      el(
        'div',
        { class: 'field' },
        el('label', { text: t('profileEditor.folders') }),
        folderRow(`Saved.${existing.id}`, savedPath, existing.savedExists),
        folderRow(`~Mods.${existing.id}`, modsPath, existing.modsExists)
      )
    );
  }

  body.appendChild(errorText);

  let closed = false;
  const saveBtn = el('button', {
    class: 'primary',
    text: t('common.save'),
    onclick: async () => {
      const name = nameInput.value.trim();
      const id = idInput.value.trim();
      errorText.textContent = '';

      if (!name) {
        errorText.textContent = t('profileEditor.nameRequired');
        return;
      }
      if (!isEdit && !/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
        errorText.textContent = t('profileEditor.idInvalid');
        return;
      }

      const payload = {
        name,
        exePath: exeInput.value.trim(),
        args: argsInput.value.trim(),
        workDir: workInput.value.trim(),
        commandLineKeyword: keywordInput.value.trim(),
        noMods: noModsInput.checked,
      };

      saveBtn.disabled = true;
      const res = isEdit
        ? await api.profileUpdate(existing.id, payload)
        : await api.profileAdd({ ...payload, id });
      saveBtn.disabled = false;

      if (!res || !res.ok) {
        errorText.textContent = (res && res.message) || t('toast.error');
        return;
      }
      if (res.state) state = res.state;
      if (!isEdit) ui.selectedId = id;
      closed = true;
      ctl.close();
      chooseSelected();
      applyLocale();
      renderAll();
      if (ui.settingsCtl) ui.settingsCtl.refresh();
      toast(t(isEdit ? 'toast.profileUpdated' : 'toast.profileAdded'), 'success');
    },
  });

  const foot = [];
  if (isEdit) {
    foot.push(
      el('button', {
        class: 'ghost small',
        text: t('profileEditor.delete'),
        style: { color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 50%, transparent)' },
        onclick: async () => {
          const ok = await confirmDialog({
            title: t('profileEditor.deleteTitle'),
            body: t('profileEditor.deleteBody', { name: existing.name, id: existing.id }),
            confirmText: t('profileEditor.delete'),
            tone: 'danger',
          });
          if (!ok) return;
          const res = await api.profileDelete(existing.id);
          if (!res || !res.ok) {
            toast((res && res.message) || t('toast.error'), 'error');
            return;
          }
          if (res.state) state = res.state;
          closed = true;
          ctl.close();
          chooseSelected();
          applyLocale();
          renderAll();
          if (ui.settingsCtl) ui.settingsCtl.refresh();
          toast(t('toast.profileDeleted'), 'success');
        },
      })
    );
    foot.push(el('div', { class: 'spacer' }));
  }
  foot.push(el('button', { class: 'ghost', text: t('common.cancel'), onclick: () => ctl.close() }));
  foot.push(saveBtn);

  const ctl = openModal({
    title: t(isEdit ? 'profileEditor.editTitle' : 'profileEditor.addTitle'),
    sub: isEdit ? existing.id : '',
    size: 'medium',
    body,
    footer: foot,
    onClose: () => {
      if (!closed) {
        // Nothing to undo: the editor keeps no state outside its DOM.
      }
    },
  });
}

function folderRow(label, path, exists) {
  return el(
    'div',
    { class: 'path-row' },
    el('span', { class: 'p-label', text: label }),
    el('span', { class: 'p-value', text: path || '—', title: path || '' }),
    el('span', { class: 'file-state ' + (exists ? 'ok' : 'missing'), text: exists ? '✓' : '✕' }),
    el('button', {
      class: 'ghost tiny',
      text: t('profileEditor.openFolder'),
      onclick: () => api.openPath(path),
    })
  );
}

/* ----------------------------------------------------------------- settings */

function openSettings(tab) {
  if (ui.activeSettingsTab && tab) ui.activeSettingsTab = tab;
  let navEl = null;
  let panelEl = null;
  let closeBtn = null;

  const ctl = openModal({
    title: t('settings.title'),
    size: 'wide',
    bodyClass: 'flush',
    body: (body) => {
      const wrap = el('div', { class: 'settings' });
      navEl = el('div', { class: 'settings-nav' });
      panelEl = el('div', { class: 'settings-panel' });
      wrap.append(navEl, panelEl);
      body.appendChild(wrap);
    },
    footer: [],
    onClose: () => {
      ui.settingsCtl = null;
    },
  });

  closeBtn = el('button', { class: 'ghost', text: t('common.close'), onclick: () => ctl.close() });
  ctl.modal.querySelector('.modal-foot').appendChild(closeBtn);

  function refresh() {
    if (!navEl || !panelEl) return;
    ctl.setTitle(t('settings.title'));
    closeBtn.textContent = t('common.close');

    clear(navEl);
    for (const key of SETTINGS_TABS) {
      navEl.appendChild(
        el('button', {
          class: key === ui.activeSettingsTab ? 'active' : '',
          text: t(`settings.tab.${key}`),
          onclick: () => {
            ui.activeSettingsTab = key;
            refresh();
          },
        })
      );
    }

    clear(panelEl);
    const render = {
      general: renderSettingsGeneral,
      paths: renderSettingsPaths,
      profiles: renderSettingsProfiles,
      safety: renderSettingsSafety,
      history: renderSettingsHistory,
      about: renderSettingsAbout,
    }[ui.activeSettingsTab];
    if (render) render(panelEl);
  }

  ui.settingsCtl = { refresh, close: ctl.close };
  refresh();
}

function optionCard(title, desc, selected, onClick) {
  return el(
    'button',
    { class: 'option' + (selected ? ' selected' : ''), onclick: onClick },
    el('strong', { text: title }),
    desc ? el('span', { text: desc }) : null
  );
}

function panelHead(panel, title, sub) {
  panel.appendChild(el('div', { class: 'panel-title', text: title }));
  if (sub) panel.appendChild(el('div', { class: 'panel-sub', text: sub }));
}

function renderSettingsGeneral(panel) {
  panelHead(panel, t('settings.language'), t('settings.languageHint'));
  panel.appendChild(
    el(
      'div',
      { class: 'option-grid two' },
      optionCard('简体中文', 'Chinese (Simplified)', getLang() === 'zh-CN', () =>
        updateConfig({ language: 'zh-CN' })
      ),
      optionCard('English', 'English (US)', getLang() === 'en', () => updateConfig({ language: 'en' }))
    )
  );

  panel.appendChild(el('div', { class: 'divider' }));
  panelHead(panel, t('settings.theme'), t('settings.themeHint'));
  const themeWrap = el('div', { class: 'option-grid' });
  const themes = [
    ['cyberpunk', 'settings.themeCyberpunk', 'settings.themeCyberpunkDesc'],
    ['apple', 'settings.themeApple', 'settings.themeAppleDesc'],
    ['classic', 'settings.themeClassic', 'settings.themeClassicDesc'],
  ];
  for (const [id, titleKey, descKey] of themes) {
    themeWrap.appendChild(
      optionCard(t(titleKey), t(descKey), state.config.theme === id, () =>
        updateConfig({ theme: id })
      )
    );
  }
  panel.appendChild(themeWrap);

  panel.appendChild(el('div', { class: 'divider' }));
  panelHead(panel, t('settings.mode'), t('settings.modeHint'));
  panel.appendChild(
    el(
      'div',
      { class: 'option-grid two' },
      optionCard(t('settings.modeCopy'), t('settings.modeCopyDesc'), state.config.mode === 'copy', () =>
        updateConfig({ mode: 'copy' })
      ),
      optionCard(
        t('settings.modeJunction'),
        t('settings.modeJunctionDesc'),
        state.config.mode === 'junction',
        () => updateConfig({ mode: 'junction' })
      )
    )
  );
}

function renderSettingsPaths(panel) {
  panelHead(panel, t('paths.title'), '');

  const gameInput = el('input', { type: 'text', value: state.config.gameRoot || '' });
  const dataInput = el('input', { type: 'text', value: state.config.scumDataDir || '' });
  let busy = false;

  panel.appendChild(
    el(
      'div',
      { class: 'field' },
      el('label', { text: t('paths.gameRoot') }),
      el(
        'div',
        { class: 'row grow' },
        gameInput,
        el('button', {
          class: 'ghost small',
          text: t('paths.browse'),
          onclick: async () => {
            const res = await api.pickFolder({ defaultPath: gameInput.value });
            if (res && res.ok && res.path) gameInput.value = res.path;
          },
        })
      ),
      el('div', { class: 'hint', text: t('paths.gameRootHint') })
    )
  );

  panel.appendChild(
    el(
      'div',
      { class: 'field' },
      el('label', { text: t('paths.scumData') }),
      el(
        'div',
        { class: 'row grow' },
        dataInput,
        el('button', {
          class: 'ghost small',
          text: t('paths.browse'),
          onclick: async () => {
            const res = await api.pickFolder({ defaultPath: dataInput.value });
            if (res && res.ok && res.path) dataInput.value = res.path;
          },
        })
      ),
      el('div', { class: 'hint', text: t('paths.scumDataHint') })
    )
  );

  const detectBtn = el('button', {
    class: 'ghost small',
    text: t('paths.autoDetect'),
    onclick: async () => {
      if (busy) return;
      busy = true;
      detectBtn.disabled = true;
      detectBtn.textContent = t('paths.autoDetecting');
      const res = await api.autoDetectPaths();
      busy = false;
      detectBtn.disabled = false;
      detectBtn.textContent = t('paths.autoDetect');
      if (res && res.ok && (res.gameRoot || res.scumDataDir)) {
        if (res.state) state = res.state;
        applyLocale();
        renderAll();
        if (ui.settingsCtl) ui.settingsCtl.refresh();
        toast(t('paths.autoDetectDone'), 'success');
      } else {
        toast(t('paths.autoDetectFailed'), 'warning');
      }
    },
  });

  const saveBtn = el('button', {
    class: 'primary',
    text: t('common.save'),
    onclick: async () => {
      saveBtn.disabled = true;
      const ok = await updateConfig(
        { gameRoot: gameInput.value.trim(), scumDataDir: dataInput.value.trim() },
        false
      );
      saveBtn.disabled = false;
      if (ok) renderAll();
    },
  });

  panel.appendChild(el('div', { class: 'row-end', style: { marginTop: '4px' } }, detectBtn, saveBtn));

  panel.appendChild(el('div', { class: 'divider' }));

  const paths = state.paths;
  panel.appendChild(
    el(
      'div',
      {},
      pathInfoRow(t('paths.liveSaved'), paths.savedLive, true),
      pathInfoRow(t('paths.liveMods'), paths.modsLive, true),
      pathInfoRow(t('paths.trashSaved'), paths.savedTrash, false),
      pathInfoRow(t('paths.trashMods'), paths.modsTrash, false)
    )
  );
}

function pathInfoRow(label, value, openable) {
  const row = el(
    'div',
    { class: 'path-row' },
    el('span', { class: 'p-label', text: label }),
    el('span', { class: 'p-value', text: value || '—', title: value || '' })
  );
  if (openable && value) {
    row.appendChild(
      el('button', {
        class: 'ghost tiny',
        text: t('paths.open'),
        onclick: () => api.openPath(value),
      })
    );
  }
  return row;
}

function renderSettingsProfiles(panel) {
  panelHead(panel, t('profiles.title'), t('profiles.hint'));

  panel.appendChild(
    el(
      'div',
      { class: 'row-end', style: { justifyContent: 'flex-start', marginBottom: '10px' } },
      el('button', { class: 'ghost small', text: t('profiles.add'), onclick: () => openProfileEditor(null) }),
      state.discoveries && state.discoveries.length
        ? el('button', { class: 'ghost small', text: t('profiles.import'), onclick: importDiscoveries })
        : null
    )
  );

  if (!state.profiles.length) {
    panel.appendChild(el('div', { class: 'empty-state', text: t('profiles.empty') }));
    return;
  }

  const list = el('div', { class: 'mods-list' });
  for (const profile of state.profiles) {
    list.appendChild(
      el(
        'div',
        { class: 'mod-row' },
        el('span', { class: 'mod-name', text: `${profile.name}  ·  ${profile.id}` }),
        el('span', { class: 'badge', dataset: { tone: profile.savedExists ? 'success' : undefined }, text: 'Saved' }),
        el('span', {
          class: 'badge',
          dataset: { tone: profile.noMods ? undefined : profile.modsExists ? 'success' : undefined },
          text: profile.noMods ? t('profiles.noMods') : '~Mods',
        }),
        el('button', {
          class: 'ghost tiny',
          text: t('profiles.edit'),
          onclick: () => openProfileEditor(profile),
        })
      )
    );
  }
  panel.appendChild(list);
}

function renderSettingsSafety(panel) {
  panelHead(panel, t('safety.title'), t('safety.noteBody'));

  const keepInput = el('input', {
    type: 'number',
    min: '2',
    max: '50',
    value: String(state.config.safety.trashKeep),
    style: { width: '110px' },
    onchange: async () => {
      let value = Number(keepInput.value);
      if (!Number.isFinite(value)) value = 5;
      value = Math.min(50, Math.max(2, Math.round(value)));
      keepInput.value = String(value);
      await updateConfig({ safety: { ...state.config.safety, trashKeep: value } });
    },
  });

  panel.appendChild(
    el(
      'div',
      { class: 'field' },
      el('label', { text: t('safety.trashKeep') }),
      keepInput,
      el('div', { class: 'hint', text: t('safety.trashKeepHint') })
    )
  );

  panel.appendChild(
    el(
      'div',
      { class: 'field' },
      el('label', { text: t('safety.closeGame') }),
      el(
        'div',
        { class: 'option-grid two' },
        optionCard(t('safety.closeGameAsk'), '', state.config.safety.closeGame !== 'force', () =>
          updateConfig({ safety: { ...state.config.safety, closeGame: 'ask' } })
        ),
        optionCard(t('safety.closeGameForce'), '', state.config.safety.closeGame === 'force', () =>
          updateConfig({ safety: { ...state.config.safety, closeGame: 'force' } })
        )
      ),
      el('div', { class: 'hint', text: t('safety.closeGameHint') })
    )
  );

  panel.appendChild(
    el(
      'div',
      { class: 'toggle-row' },
      el(
        'div',
        { class: 'toggle-copy' },
        el('strong', { text: t('safety.verify') }),
        el('span', { text: t('safety.verifyHint') })
      ),
      el(
        'label',
        { class: 'toggle' },
        el('input', {
          type: 'checkbox',
          checked: !!state.config.safety.verify,
          onchange: async (event) => {
            await updateConfig({
              safety: { ...state.config.safety, verify: event.target.checked },
            });
          },
        }),
        el('span', { class: 'track' })
      )
    )
  );

  panel.appendChild(el('div', { class: 'divider' }));

  panelHead(panel, t('safety.trash'), t('safety.trashHint'));
  panel.appendChild(
    el(
      'div',
      { class: 'row', style: { flexWrap: 'wrap' } },
      el('button', {
        class: 'ghost small',
        text: t('safety.openSavedTrash'),
        onclick: () => api.openPath(state.paths.savedTrash),
      }),
      el('button', {
        class: 'ghost small',
        text: t('safety.openModsTrash'),
        onclick: () => api.openPath(state.paths.modsTrash),
      })
    )
  );
}

function renderSettingsHistory(panel) {
  panelHead(panel, t('history.title'), '');
  const refreshBtn = el('button', {
    class: 'ghost small',
    text: t('history.refresh'),
    onclick: async () => {
      const res = await api.historyList();
      if (res && res.ok) {
        state.history = res.history;
        if (ui.settingsCtl) ui.settingsCtl.refresh();
      }
    },
  });
  panel.appendChild(el('div', { class: 'row-end', style: { justifyContent: 'flex-start', marginBottom: '10px' } }, refreshBtn));

  const history = state.history || [];
  if (!history.length) {
    panel.appendChild(el('div', { class: 'empty-state', text: t('history.empty') }));
    return;
  }

  const table = el(
    'table',
    { class: 'history-table' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { text: t('history.col.time') }),
        el('th', { text: t('history.col.route') }),
        el('th', { text: t('history.col.mode') }),
        el('th', { text: t('history.col.status') })
      )
    )
  );
  const tbody = el('tbody');
  for (const entry of history) {
    const status = entry.status || 'failed';
    tbody.appendChild(
      el(
        'tr',
        {},
        el('td', {},
          el('div', { class: 'mono', text: formatTime(entry.startedAt) }),
          el('div', { class: 'faint', style: { fontSize: '9.5px' }, text: durationText(entry.startedAt, entry.finishedAt) })
        ),
        el('td', { class: 'mono', text: `${entry.fromId || '?'} → ${entry.toId || '?'}` }),
        el('td', { text: entry.mode === 'junction' ? t('history.mode.junction') : t('history.mode.copy') }),
        el(
          'td',
          {},
          el('span', {
            class: 'status-dot',
            dataset: { status },
            text: t(`history.status.${status}`),
          })
        )
      )
    );
  }
  table.appendChild(tbody);
  panel.appendChild(table);
}

function renderSettingsAbout(panel) {
  panelHead(panel, t('about.title'), t('app.subtitle'));

  const rows = [
    [t('about.version'), 'v' + state.app.version],
    [t('about.electron'), state.app.electron],
    [t('about.dataDir'), state.app.userData],
    [t('about.logs'), state.app.logs],
  ];
  const kv = el('dl', { class: 'kv' });
  for (const [key, value] of rows) {
    kv.append(el('dt', { text: key }), el('dd', { text: value }));
  }
  panel.appendChild(kv);

  panel.appendChild(
    el(
      'div',
      { class: 'row', style: { marginTop: '14px', flexWrap: 'wrap' } },
      el('button', { class: 'ghost small', text: t('about.openData'), onclick: () => api.openUserData() }),
      el('button', { class: 'ghost small', text: t('about.openLogs'), onclick: () => api.openLogs() })
    )
  );

  panel.appendChild(el('div', { class: 'divider' }));
  panelHead(panel, t('about.shortcuts'), '');
  panel.appendChild(
    el(
      'div',
      { class: 'stack tight', style: { fontSize: '11.5px', color: 'var(--text-dim)' } },
      el('div', { class: 'spread' }, el('span', { text: t('about.shortcutSwitch') }), el('span', { class: 'kbd', text: 'Ctrl + Enter' })),
      el('div', { class: 'spread' }, el('span', { text: t('about.shortcutEsc') }), el('span', { class: 'kbd', text: 'Esc' }))
    )
  );

  panel.appendChild(el('div', { class: 'divider' }));
  panelHead(panel, t('about.disclaimer'), t('about.disclaimerBody'));
}

/* --------------------------------------------------------------- admin tool */

async function openAdminTool() {
  const res = await api.adminList();
  if (!res || !res.ok) {
    toast(t('toast.error'), 'error');
    return;
  }

  const data = {
    categories: res.categories || [],
    commands: [...(res.commands || []), ...(res.custom || [])],
    filter: { category: 'all', query: '' },
  };

  let sideEl = null;
  let mainHeadEl = null;
  let gridEl = null;

  const addBtn = el('button', {
    class: 'ghost small',
    text: t('admin.addCustom'),
    onclick: () => openAddCustom(() => reloadAdmin()),
  });

  const ctl = openModal({
    title: t('admin.title'),
    sub: t('admin.subtitle'),
    size: 'wide',
    bodyClass: 'flush',
    headActions: [addBtn],
    body: (body) => {
      const layout = el('div', { class: 'admin-layout' });
      sideEl = el('div', { class: 'admin-side' });
      const main = el('div', { class: 'admin-main' });
      mainHeadEl = el('div', { class: 'admin-main-head' });
      const scroll = el('div', { class: 'cmd-scroll' });
      gridEl = el('div', { class: 'cmd-grid' });
      scroll.appendChild(gridEl);
      main.append(mainHeadEl, scroll);
      layout.append(sideEl, main);
      body.appendChild(layout);
    },
    footer: [
      el('div', { class: 'spacer' }),
      el('button', { class: 'ghost', text: t('common.close'), onclick: () => ctl.close() }),
    ],
  });

  function categoryCount(id) {
    return data.commands.filter((c) => id === 'all' || c.category === id).length;
  }

  function renderSide() {
    clear(sideEl);
    const searchWrap = el('div', { class: 'search-box side-search' });
    const search = el('input', {
      type: 'search',
      placeholder: t('admin.searchPlaceholder'),
      value: data.filter.query,
      oninput: (event) => {
        data.filter.query = event.target.value;
        renderGrid();
      },
    });
    searchWrap.appendChild(search);
    sideEl.appendChild(searchWrap);

    const cats = data.categories.length ? data.categories : [{ id: 'all' }];
    for (const cat of cats) {
      const label = t(`admin.category.${cat.id}`);
      sideEl.appendChild(
        el(
          'button',
          {
            class: 'cat-btn' + (data.filter.category === cat.id ? ' active' : ''),
            onclick: () => {
              data.filter.category = cat.id;
              renderSide();
              renderGrid();
            },
          },
          el('span', { text: label }),
          el('span', { class: 'count', text: String(categoryCount(cat.id)) })
        )
      );
    }

    sideEl.appendChild(
      el('div', {
        class: 'map-help',
        style: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' },
        text: t('admin.chatHint'),
      })
    );
  }

  function filteredCommands() {
    const query = data.filter.query.trim().toLowerCase();
    return data.commands.filter((command) => {
      if (data.filter.category !== 'all' && command.category !== data.filter.category) return false;
      if (!query) return true;
      const desc = command.desc ? command.desc[getLang() === 'en' ? 'en' : 'zh'] || '' : '';
      return [command.cmd, command.syntax, command.example, desc]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }

  function renderGrid() {
    const list = filteredCommands();
    clear(mainHeadEl);
    mainHeadEl.append(
      el('span', { text: t('admin.showing', { count: list.length }) }),
      el('span', { text: t('admin.search') })
    );
    clear(gridEl);

    if (!list.length) {
      gridEl.appendChild(el('div', { class: 'empty-state', text: t('admin.empty') }));
      return;
    }

    for (const command of list) {
      const desc = command.desc
        ? command.desc[getLang() === 'en' ? 'en' : 'zh'] || command.desc.zh || command.desc.en || ''
        : '';
      const note = command.note
        ? command.note[getLang() === 'en' ? 'en' : 'zh'] || ''
        : '';

      const actions = el('div', { class: 'cmd-actions' });
      actions.appendChild(
        el('button', {
          class: 'ghost tiny',
          html: ICONS.copy,
          title: t('admin.copyCmd'),
          onclick: async () => {
            await api.copyText(command.example || command.syntax || command.cmd);
            toast(t('admin.copied'), 'success', 1200);
          },
        })
      );
      if (command.custom) {
        actions.appendChild(
          el('button', {
            class: 'ghost tiny',
            html: ICONS.trash,
            title: t('admin.deleteCustom'),
            onclick: async () => {
              const ok = await api.adminRemoveCustom(command.id);
              if (ok && ok.ok) {
                data.commands = data.commands.filter((c) => c.id !== command.id);
                renderSide();
                renderGrid();
                toast(t('admin.customRemoved'), 'success', 1400);
              }
            },
          })
        );
      }

      gridEl.appendChild(
        el(
          'div',
          { class: 'cmd-card' },
          el(
            'div',
            { class: 'cmd-head' },
            el('code', { text: command.cmd }),
            command.custom ? el('span', { class: 'badge', text: t('admin.custom') }) : null,
            command.perm
              ? el('span', {
                  class: 'permission-tag',
                  dataset: { perm: command.perm },
                  text: t(`admin.perm.${command.perm}`),
                })
              : null,
            actions
          ),
          desc ? el('div', { class: 'cmd-desc', text: desc }) : null,
          command.syntax ? el('div', { class: 'cmd-syntax', text: command.syntax }) : null,
          note ? el('div', { class: 'map-help', text: note }) : null
        )
      );
    }
  }

  function reloadAdmin() {
    api.adminList().then((next) => {
      if (!next || !next.ok) return;
      data.commands = [...(next.commands || []), ...(next.custom || [])];
      renderSide();
      renderGrid();
    });
  }

  ctl.body.prepend(
    el('div', { class: 'callout', style: { margin: '10px 16px 0' }, dataset: { tone: 'warning' } },
      el('span', { class: 'callout-icon', text: 'i' }),
      el('div', {}, el('strong', { text: t('admin.disclaimerTitle') + '：' }), t('admin.disclaimerBody'))
    )
  );

  renderSide();
  renderGrid();
}

function openAddCustom(onDone) {
  const cmdInput = el('input', { type: 'text', placeholder: t('admin.cmdPlaceholder') });
  const syntaxInput = el('input', { type: 'text', placeholder: '#SetTime <时> <分>' });
  const exampleInput = el('input', { type: 'text', placeholder: '#SetTime 12 0' });
  const descZhInput = el('input', { type: 'text', placeholder: '中文说明' });
  const descEnInput = el('input', { type: 'text', placeholder: 'English description' });
  const catSelect = el(
    'select',
    {},
    ['server', 'player', 'teleport', 'item', 'vehicle', 'world', 'npc'].map((id) =>
      el('option', { value: id, text: t(`admin.category.${id}`) })
    )
  );
  const errorText = el('div', { class: 'error-text' });

  let ctl;
  const saveBtn = el('button', {
    class: 'primary',
    text: t('common.save'),
    onclick: async () => {
      const cmd = cmdInput.value.trim();
      if (!cmd) {
        errorText.textContent = t('admin.needCmd');
        return;
      }
      saveBtn.disabled = true;
      const res = await api.adminAddCustom({
        cmd,
        category: catSelect.value,
        syntax: syntaxInput.value.trim() || cmd,
        example: exampleInput.value.trim() || cmd,
        descZh: descZhInput.value.trim(),
        descEn: descEnInput.value.trim(),
      });
      saveBtn.disabled = false;
      if (!res || !res.ok) {
        errorText.textContent = (res && res.message) || t('toast.error');
        return;
      }
      ctl.close();
      toast(t('admin.customAdded'), 'success');
      if (onDone) onDone();
    },
  });

  ctl = openModal({
    title: t('admin.addTitle'),
    body: el(
      'div',
      {},
      el('div', { class: 'field' }, el('label', { text: t('admin.cmd') }), cmdInput),
      el(
        'div',
        { class: 'field' },
        el('label', { text: t('admin.categoryLabel') }),
        catSelect
      ),
      el(
        'div',
        { class: 'form-grid' },
        el('div', { class: 'field' }, el('label', { text: t('admin.syntax') }), syntaxInput),
        el('div', { class: 'field' }, el('label', { text: t('admin.example') }), exampleInput)
      ),
      el(
        'div',
        { class: 'form-grid' },
        el('div', { class: 'field' }, el('label', { text: t('admin.descZh') }), descZhInput),
        el('div', { class: 'field' }, el('label', { text: t('admin.descEn') }), descEnInput)
      ),
      errorText
    ),
    footer: [
      el('div', { class: 'spacer' }),
      el('button', { class: 'ghost', text: t('common.cancel'), onclick: () => ctl.close() }),
      saveBtn,
    ],
  });
}

/* ----------------------------------------------------------------- mod tool */

async function openModsTool() {
  let live = null;
  let disabled = null;

  const ctl = openModal({
    title: t('mods.title'),
    sub: t('mods.subtitle'),
    size: 'wide',
    headActions: [
      el('button', {
        class: 'ghost small',
        text: t('mods.refresh'),
        onclick: () => load(),
      }),
    ],
    body: (body) => {
      body.appendChild(el('div', { class: 'loading-screen', style: { position: 'static', padding: '40px' }, text: t('common.loading') }));
    },
    footer: [
      el('button', {
        class: 'ghost small',
        text: t('mods.openFolder'),
        onclick: () => api.openPath(state.paths.modsLive),
      }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'ghost', text: t('common.close'), onclick: () => ctl.close() }),
    ],
  });

  async function load() {
    const [liveRes, disabledRes] = await Promise.all([api.modsScan(null), api.modsScanDisabled()]);
    live = liveRes && liveRes.ok ? liveRes.scan : null;
    disabled = disabledRes && disabledRes.ok ? disabledRes.scan : null;
    render();
  }

  function render() {
    clear(ctl.body);
    const scan = live || { exists: false, files: [], topLevel: [], conflicts: [], totalBytes: 0, fileCount: 0 };
    const liveMissing = !scan.exists;

    if (liveMissing) {
      ctl.body.appendChild(
        el(
          'div',
          { class: 'empty-state' },
          el('div', { class: 'big', text: '▦' }),
          el('div', { text: t('mods.none') }),
          el('div', { class: 'mono faint', text: state.paths.modsLive || '' })
        )
      );
    }

    if (!liveMissing) {
      const summary = el(
        'div',
        { class: 'mods-summary' },
        el(
          'div',
          { class: 'stat' },
          el('div', { class: 'stat-label', text: t('mods.total') }),
          el('div', { class: 'stat-value', text: formatBytes(scan.totalBytes) })
        ),
        el(
          'div',
          { class: 'stat' },
          el('div', { class: 'stat-label', text: t('mods.files') }),
          el('div', { class: 'stat-value', text: String(scan.fileCount) })
        ),
        el(
          'div',
          { class: 'stat', dataset: { tone: scan.conflicts.length ? 'danger' : 'success' } },
          el('div', { class: 'stat-label', text: t('mods.conflicts') }),
          el('div', { class: 'stat-value', text: String(scan.conflicts.length) })
        )
      );
      ctl.body.appendChild(summary);

      if (scan.isJunction) {
        ctl.body.appendChild(
          el(
            'div',
            { class: 'callout' },
            el('span', { class: 'callout-icon', text: '↪' }),
            el('div', {}, el('strong', { text: t('mods.junction') + '：' }), t('mods.junctionHint', { target: scan.linkTarget || '?' }))
          )
        );
      }

      if (scan.conflicts.length) {
        const conflictBox = el('div', { class: 'conflict-box' });
        for (const conflict of scan.conflicts) {
          const box = el('div', { class: 'conflict-file' }, el('strong', { text: conflict.name }));
          const ul = el('ul');
          for (const rel of conflict.paths) {
            ul.appendChild(
              el(
                'li',
                { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
                el('span', { text: rel, style: { flex: '1' } }),
                el('button', {
                  class: 'ghost tiny',
                  text: t('mods.disable'),
                  onclick: () => toggleMod(rel, false),
                })
              )
            );
          }
          box.appendChild(ul);
          conflictBox.appendChild(box);
        }
        ctl.body.appendChild(
          el(
            'div',
            { class: 'mods-section' },
            el(
              'div',
              { class: 'mods-section-head' },
              el('span', { class: 'section-label', text: t('mods.conflictHint') }),
              el('span', { class: 'badge', dataset: { tone: 'warning' }, text: String(scan.conflicts.length) })
            ),
            conflictBox
          )
        );
      }

      const topList = el('div', { class: 'mods-list' });
      for (const entry of scan.topLevel) {
        topList.appendChild(
          el(
            'div',
            { class: 'mod-row' },
            el('span', { class: 'mod-name', text: entry.name + (entry.isDir ? '\\' : '') }),
            el('span', { class: 'mod-size', text: formatBytes(entry.bytes) }),
            el('span', { class: 'badge', text: `${entry.files}` }),
            el('button', {
              class: 'ghost tiny',
              text: t('mods.disable'),
              onclick: () => toggleMod(entry.name, false),
            })
          )
        );
      }

      ctl.body.appendChild(
        el(
          'div',
          { class: 'mods-section' },
          el(
            'div',
            { class: 'mods-section-head' },
            el('span', { class: 'section-label', text: t('mods.topLevel') }),
            el('span', { class: 'badge', text: String(scan.topLevel.length) })
          ),
          topList
        )
      );

      if (scan.truncated) {
        ctl.body.appendChild(el('div', { class: 'map-help', text: t('mods.truncated') }));
      }
    }

    const disabledList = el('div', { class: 'mods-list' });
    const disabledScan = disabled || { topLevel: [], exists: false };
    if (!disabledScan.topLevel.length) {
      disabledList.appendChild(el('div', { class: 'empty-state', text: t('mods.disabledEmpty') }));
    } else {
      for (const entry of disabledScan.topLevel) {
        disabledList.appendChild(
          el(
            'div',
            { class: 'mod-row' },
            el('span', { class: 'mod-name', text: entry.name + (entry.isDir ? '\\' : '') }),
            el('span', { class: 'mod-size', text: formatBytes(entry.bytes) }),
            el('button', {
              class: 'ghost tiny',
              text: t('mods.enable'),
              onclick: () => toggleMod(entry.name, true),
            })
          )
        );
      }
    }

    ctl.body.appendChild(
      el(
        'div',
        { class: 'mods-section' },
        el(
          'div',
          { class: 'mods-section-head' },
          el('span', { class: 'section-label', text: t('mods.disabledSection') }),
          el('span', { class: 'map-help', text: t('mods.disabledHint') })
        ),
        disabledList
      )
    );
  }

  async function toggleMod(rel, enabled) {
    const res = await api.modsSetEnabled({ rel, enabled });
    if (!res || !res.ok) {
      toast((res && res.message) || t('mods.error'), 'error');
      return;
    }
    toast(t(enabled ? 'mods.enabledDone' : 'mods.disabledDone', { name: rel }), 'success', 1600);
    await load();
  }

  await load();
}

/* ------------------------------------------------------------------ map tool */

async function openMapTool() {
  const res = await api.mapGet();
  if (!res || !res.ok) {
    toast(t('toast.error'), 'error');
    return;
  }

  const tool = createMapTool(res.map, res.imageUrl);
  const ctl = openModal({
    title: t('map.title'),
    sub: t('map.subtitle'),
    size: 'wide',
    bodyClass: 'flush',
    headActions: [
      el('button', {
        class: 'ghost small',
        text: t('map.import'),
        onclick: () => tool.importImage(),
      }),
    ],
    body: (body) => {
      tool.mount(body).catch(() => toast(t('map.importFailed'), 'error'));
    },
    footer: [
      el('div', { class: 'map-help', style: { marginRight: 'auto' }, text: t('map.worldHint') }),
      el('button', { class: 'ghost', text: t('common.close'), onclick: () => ctl.close() }),
    ],
  });
}

function createMapTool(initialMap, initialUrl) {
  const data = {
    image: initialMap.image || null,
    calibration: initialMap.calibration || null,
    waypoints: Array.isArray(initialMap.waypoints) ? [...initialMap.waypoints] : [],
  };
  let imageUrl = initialUrl || null;
  let img = null;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let armed = null;
  let stage = null;
  let canvas = null;
  let ctx = null;
  let side = null;
  let view = { scale: 1, ox: 0, oy: 0, iw: 1, ih: 1, w: 1, h: 1 };
  let drag = null;
  let calibInputs = null;
  let wpInputs = null;

  async function mount(body) {
    body.classList.add('flush');
    const layout = el('div', { class: 'map-layout' });
    stage = el('div', { class: 'map-stage' });
    canvas = el('canvas');
    stage.appendChild(canvas);
    side = el('div', { class: 'map-side' });
    layout.append(stage, side);
    body.appendChild(layout);
    ctx = canvas.getContext('2d');

    canvas.addEventListener('pointerdown', (event) => {
      if (!img) return;
      canvas.setPointerCapture(event.pointerId);
      drag = { x: event.clientX, y: event.clientY, px: panX, py: panY, moved: false };
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true;
      if (drag.moved) {
        panX = drag.px + dx;
        panY = drag.py + dy;
        draw();
      }
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (!moved) onCanvasClick(event);
    });
    canvas.addEventListener('pointercancel', () => {
      drag = null;
    });
    canvas.addEventListener(
      'wheel',
      (event) => {
        if (!img) return;
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.16 : 1 / 1.16;
        zoom = Math.min(10, Math.max(0.5, zoom * factor));
        draw();
      },
      { passive: false }
    );

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        if (img) draw();
      });
      observer.observe(stage);
    }

    rebuildSide();
    await loadImage();
    setTimeout(() => {
      if (img) draw();
    }, 40);
  }

  function loadImage() {
    return new Promise((resolve) => {
      if (!imageUrl) {
        img = null;
        resolve();
        return;
      }
      const image = new Image();
      image.onload = () => {
        img = image;
        zoom = 1;
        panX = 0;
        panY = 0;
        rebuildSide();
        draw();
        requestAnimationFrame(draw);
        resolve();
      };
      image.onerror = () => {
        img = null;
        resolve();
      };
      image.src = imageUrl;
    });
  }

  function computeView() {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;
    const base = Math.min(rect.width / iw, rect.height / ih) * 0.96;
    const scale = base * zoom;
    const ox = (rect.width - iw * scale) / 2 + panX;
    const oy = (rect.height - ih * scale) / 2 + panY;
    view = { scale, ox, oy, iw, ih, w: rect.width, h: rect.height };
  }

  function draw() {
    if (!ctx || !img || !stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    computeView();
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, view.ox, view.oy, view.iw * view.scale, view.ih * view.scale);

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#27e0ff';
    const warning = getComputedStyle(document.documentElement).getPropertyValue('--warning').trim() || '#ffc857';
    const text = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#fff';

    const calib = data.calibration;
    if (calib) {
      for (const key of ['a', 'b']) {
        const point = calib[key];
        if (!point) continue;
        const x = view.ox + Number(point.px) * view.scale;
        const y = view.oy + Number(point.py) * view.scale;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = warning;
        ctx.stroke();
        ctx.fillStyle = text;
        ctx.font = '600 11px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(key.toUpperCase(), x, y + 0.5);
      }
    }

    for (const waypoint of data.waypoints) {
      let px = waypoint.px == null ? NaN : Number(waypoint.px);
      let py = waypoint.py == null ? NaN : Number(waypoint.py);
      if (!Number.isFinite(px) || !Number.isFinite(py)) {
        const derived = pixelFromWorld(Number(waypoint.x), Number(waypoint.y));
        if (!derived) continue;
        px = derived.px;
        py = derived.py;
      }
      const x = view.ox + px * view.scale;
      const y = view.oy + py * view.scale;
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 6, y);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (waypoint.name) {
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const width = ctx.measureText(waypoint.name).width;
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(x + 9, y - 7, width + 8, 14);
        ctx.fillStyle = text;
        ctx.fillText(waypoint.name, x + 13, y + 0.5);
      }
    }
  }

  function toImage(event) {
    const rect = canvas.getBoundingClientRect();
    const px = (event.clientX - rect.left - view.ox) / view.scale;
    const py = (event.clientY - rect.top - view.oy) / view.scale;
    if (px < 0 || py < 0 || px > view.iw || py > view.ih) return null;
    return { px, py };
  }

  function onCanvasClick(event) {
    const point = toImage(event);
    if (!point) return;
    if (armed) {
      const target = calibInputs && calibInputs[armed];
      if (target) {
        target.px.value = String(Math.round(point.px));
        target.py.value = String(Math.round(point.py));
      }
      armed = null;
      draw();
      return;
    }
    if (!data.calibration) {
      toast(t('map.needCalibration'), 'warning');
      return;
    }
    const world = worldFromPixel(point.px, point.py);
    if (world && wpInputs) {
      wpInputs.x.value = String(world.x);
      wpInputs.y.value = String(world.y);
      wpInputs.name.focus();
    }
  }

  function worldFromPixel(px, py) {
    const calib = data.calibration;
    if (!calib || !calib.a || !calib.b) return null;
    const a = calib.a;
    const b = calib.b;
    const dpx = Number(b.px) - Number(a.px);
    const dpy = Number(b.py) - Number(a.py);
    if (!dpx || !dpy) return null;
    const x = Number(a.x) + ((px - Number(a.px)) * (Number(b.x) - Number(a.x))) / dpx;
    const y = Number(a.y) + ((py - Number(a.py)) * (Number(b.y) - Number(a.y))) / dpy;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function pixelFromWorld(x, y) {
    const calib = data.calibration;
    if (!calib || !calib.a || !calib.b) return null;
    const a = calib.a;
    const b = calib.b;
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    if (!dx || !dy) return null;
    return {
      px: Number(a.px) + ((x - Number(a.x)) * (Number(b.px) - Number(a.px))) / dx,
      py: Number(a.py) + ((y - Number(a.y)) * (Number(b.py) - Number(a.py))) / dy,
    };
  }

  async function saveMap() {
    const res = await api.mapSave({
      image: data.image,
      calibration: data.calibration,
      waypoints: data.waypoints,
    });
    if (!res || !res.ok) {
      toast(t('map.saveFailed'), 'error');
      return false;
    }
    if (res.map) {
      data.image = res.map.image;
      data.calibration = res.map.calibration;
      data.waypoints = res.map.waypoints;
    }
    return true;
  }

  function inputBox(label, value, extra = {}) {
    const input = el('input', {
      type: 'number',
      value: value === undefined || value === null ? '' : String(value),
      ...extra,
    });
    return {
      input,
      wrap: el(
        'label',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            fontSize: '9.5px',
            color: 'var(--text-faint)',
          },
        },
        label,
        input
      ),
    };
  }

  function rebuildSide() {
    if (!side) return;
    clear(side);
    calibInputs = {};
    wpInputs = null;

    const imageSection = el('div', { class: 'map-side-section' });
    imageSection.appendChild(
      el(
        'h4',
        {},
        el('span', { text: t('map.imported') }),
        el('span', {
          class: 'badge',
          dataset: { tone: data.calibration ? 'success' : undefined },
          text: t(data.calibration ? 'map.calibrated' : 'map.uncalibrated'),
        })
      )
    );
    imageSection.appendChild(
      el(
        'div',
        { class: 'row', style: { flexWrap: 'wrap' } },
        el('button', { class: 'ghost small', text: t('map.change'), onclick: () => importImage() }),
        data.calibration
          ? el('button', {
              class: 'ghost small',
              text: t('map.resetCalibration'),
              onclick: async () => {
                data.calibration = null;
                await saveMap();
                rebuildSide();
                draw();
              },
            })
          : null
      )
    );
    imageSection.appendChild(el('div', { class: 'map-help', style: { marginTop: '6px' }, text: t('map.zoomHint') }));
    side.appendChild(imageSection);

    const calibSection = el('div', { class: 'map-side-section' });
    calibSection.appendChild(el('h4', {}, el('span', { text: t('map.calibrate') })));
    calibSection.appendChild(el('div', { class: 'map-help', style: { marginBottom: '7px' }, text: t('map.calibrateHint') }));

    for (const key of ['a', 'b']) {
      const current = (data.calibration && data.calibration[key]) || {};
      const px = inputBox(t('map.pixelX'), current.px, { step: '1' });
      const py = inputBox(t('map.pixelY'), current.py, { step: '1' });
      const x = inputBox('X', current.x, { step: '1' });
      const y = inputBox('Y', current.y, { step: '1' });
      calibInputs[key] = { px: px.input, py: py.input, x: x.input, y: y.input };

      calibSection.appendChild(
        el(
          'div',
          { class: 'calib-point' },
          el(
            'div',
            { class: 'cp-head' },
            el('span', { text: t('map.point' + key.toUpperCase()) }),
            el('button', {
              class: 'ghost tiny',
              text: '⌖ ' + t('map.enterPixels'),
              onclick: () => {
                armed = key;
                toast(t('map.enterPixels'), 'info', 1600);
              },
            })
          ),
          el('div', { class: 'cp-coords' }, px.wrap, py.wrap, x.wrap, y.wrap)
        )
      );
    }

    calibSection.appendChild(
      el('button', {
        class: 'primary',
        text: t('map.saveCalibration'),
        style: { width: '100%', marginTop: '4px', padding: '8px' },
        onclick: async () => {
          const read = (key) => ({
            px: Number(calibInputs[key].px.value),
            py: Number(calibInputs[key].py.value),
            x: Number(calibInputs[key].x.value),
            y: Number(calibInputs[key].y.value),
          });
          const a = read('a');
          const b = read('b');
          if (![a.px, a.py, a.x, a.y, b.px, b.py, b.x, b.y].every(Number.isFinite) || a.px === b.px || a.py === b.py) {
            toast(t('map.invalidCoords'), 'error');
            return;
          }
          data.calibration = { a, b };
          if (await saveMap()) {
            toast(t('map.calibrationSaved'), 'success');
            rebuildSide();
            draw();
          }
        },
      })
    );
    side.appendChild(calibSection);

    const wpSection = el('div', { class: 'map-side-section' });
    wpSection.appendChild(el('h4', {}, el('span', { text: t('map.waypoints') })));
    wpSection.appendChild(el('div', { class: 'map-help', style: { marginBottom: '7px' }, text: data.calibration ? t('map.addHint') : t('map.needCalibration') }));

    const nameInput = el('input', { type: 'text', placeholder: t('map.namePlaceholder'), maxlength: '80', style: { marginBottom: '5px' } });
    const xInput = el('input', { type: 'number', step: '1', placeholder: 'X' });
    const yInput = el('input', { type: 'number', step: '1', placeholder: 'Y' });
    const zInput = el('input', { type: 'number', step: '1', value: '0', placeholder: 'Z' });
    wpInputs = { name: nameInput, x: xInput, y: yInput, z: zInput };

    wpSection.appendChild(
      el(
        'div',
        { class: 'stack tight' },
        nameInput,
        el(
          'div',
          { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' } },
          xInput,
          yInput,
          zInput
        ),
        el('button', {
          class: 'ghost small',
          text: t('common.add'),
          onclick: async () => {
            if (!data.calibration) {
              toast(t('map.needCalibration'), 'warning');
              return;
            }
            const x = Number(xInput.value);
            const y = Number(yInput.value);
            const z = Number(zInput.value) || 0;
            if (!Number.isFinite(x) || !Number.isFinite(y) || xInput.value === '' || yInput.value === '') {
              toast(t('map.invalidCoords'), 'error');
              return;
            }
            const name = nameInput.value.trim() || `WP ${data.waypoints.length + 1}`;
            data.waypoints.push({
              id: `wp-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
              name,
              x: Math.round(x),
              y: Math.round(y),
              z: Math.round(z),
              note: '',
            });
            if (await saveMap()) {
              toast(t('map.waypointAdded'), 'success', 1600);
              rebuildSide();
              draw();
            }
          },
        })
      )
    );

    const list = el('div', { class: 'waypoint-list', style: { marginTop: '9px' } });
    if (!data.waypoints.length) {
      list.appendChild(el('div', { class: 'empty-state', style: { padding: '10px' }, text: t('map.empty') }));
    }
    for (const waypoint of data.waypoints) {
      list.appendChild(
        el(
          'div',
          { class: 'waypoint' },
          el(
            'div',
            { style: { flex: '1', minWidth: '0' } },
            el('div', { class: 'wp-name', text: waypoint.name }),
            el('div', { class: 'wp-coords', text: `${waypoint.x}, ${waypoint.y}, ${waypoint.z}` })
          ),
          el('button', {
            class: 'mini-btn',
            html: ICONS.copy,
            title: t('map.copyTeleport'),
            onclick: async () => {
              await api.copyText(`#Teleport ${waypoint.x} ${waypoint.y} ${waypoint.z}`);
              toast(t('map.teleportCopied'), 'success', 1600);
            },
          }),
          el('button', {
            class: 'mini-btn',
            html: ICONS.trash,
            title: t('map.delete'),
            onclick: async () => {
              data.waypoints = data.waypoints.filter((w) => w.id !== waypoint.id);
              if (await saveMap()) {
                toast(t('map.waypointDeleted'), 'info', 1400);
                rebuildSide();
                draw();
              }
            },
          })
        )
      );
    }
    wpSection.appendChild(list);
    side.appendChild(wpSection);

    if (!img) {
      const empty = el(
        'div',
        { class: 'map-empty', style: { position: 'absolute', inset: '0', justifyContent: 'center' } },
        el('div', { class: 'glyph', text: '◎' }),
        el('div', { text: t('map.noImage') }),
        el('div', { text: t('map.noImageHint') }),
        el('button', {
          class: 'primary',
          text: t('map.import'),
          style: { marginTop: '6px' },
          onclick: () => importImage(),
        })
      );
      if (!stage.querySelector('.map-empty')) stage.appendChild(empty);
    } else {
      const existing = stage.querySelector('.map-empty');
      if (existing) existing.remove();
    }
  }

  async function importImage() {
    const res = await api.mapImport();
    if (!res || !res.ok || res.canceled) {
      if (res && !res.ok) toast(t('map.importFailed'), 'error');
      return;
    }
    data.image = res.map.image;
    imageUrl = res.imageUrl;
    // A different image almost always has different pixel geometry, so any
    // existing calibration would silently produce wrong coordinates.
    data.calibration = null;
    panX = 0;
    panY = 0;
    zoom = 1;
    await saveMap();
    await loadImage();
    toast(t('map.imported'), 'success', 1600);
  }

  return { mount, importImage };
}

/* ---------------------------------------------------------------- recovery */

function showRecovery(journal) {
  const phaseLabel = journal.phase
    ? STEP_KEYS.includes(journal.phase)
      ? t(`step.${journal.phase}`)
      : String(journal.phase)
    : '—';

  const ctl = openModal({
    title: t('recovery.title'),
    dismissible: false,
    body: el(
      'div',
      { class: 'stack' },
      el('div', { class: 'modal-text', text: t('recovery.body', { phase: phaseLabel }) }),
      el(
        'div',
        { class: 'recovery-card' },
        el(
          'dl',
          { class: 'kv', style: { marginTop: '0' } },
          el('dt', { text: t('recovery.phase') }),
          el('dd', { text: phaseLabel }),
          el('dt', { text: t('recovery.route') }),
          el('dd', { text: `${journal.fromId || '?'} → ${journal.toId || '?'}` }),
          el('dt', { text: t('recovery.started') }),
          el('dd', { text: formatTime(journal.startedAt) })
        )
      ),
      el('div', { class: 'callout', dataset: { tone: 'warning' } }, t('recovery.confirmBody'))
    ),
    footer: [
      el('button', {
        class: 'ghost small',
        text: t('recovery.dismiss'),
        title: t('recovery.dismissHint'),
        onclick: async () => {
          const res = await api.recoveryDismiss();
          if (res && res.ok) {
            state.recovery = null;
            ctl.close();
            toast(t('recovery.dismissed'), 'info');
            if (!state.config.onboardingDone) showOnboarding();
          }
        },
      }),
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'primary',
        text: t('recovery.rollback'),
        onclick: async () => {
          const ok = await confirmDialog({
            title: t('recovery.confirmTitle'),
            body: t('recovery.confirmBody'),
            confirmText: t('recovery.rollback'),
            tone: 'danger',
          });
          if (!ok) return;
          const res = await api.recoveryRollback();
          if (res && res.ok && (!res.failures || !res.failures.length)) {
            state.recovery = null;
            ctl.close();
            toast(t('recovery.rollbackDone'), 'success');
            await refreshState();
            if (!state.config.onboardingDone) showOnboarding();
          } else {
            toast(t('recovery.rollbackFailed'), 'error');
          }
        },
      }),
    ],
  });
}

/* --------------------------------------------------------------- onboarding */

function showOnboarding() {
  const steps = [
    ['1', 'onboarding.step1Title', 'onboarding.step1Body'],
    ['2', 'onboarding.step2Title', 'onboarding.step2Body'],
    ['3', 'onboarding.step3Title', 'onboarding.step3Body'],
  ];
  const body = el(
    'div',
    { class: 'stack' },
    el('div', { class: 'modal-text', text: t('onboarding.subtitle') }),
    ...steps.map(([num, titleKey, bodyKey]) =>
      el(
        'div',
        { class: 'callout' },
        el('span', { class: 'callout-icon', text: num }),
        el('div', {}, el('strong', { text: t(titleKey) }), el('div', { style: { marginTop: '2px' }, text: t(bodyKey) }))
      )
    )
  );

  const close = async () => {
    if (!state.config.onboardingDone) await updateConfig({ onboardingDone: true });
    ctl.close();
  };

  const ctl = openModal({
    title: t('onboarding.title'),
    dismissible: false,
    body,
    footer: [
      el('button', {
        class: 'ghost small',
        text: t('onboarding.dontShow'),
        onclick: () => close(),
      }),
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'ghost',
        text: t('onboarding.openSettings'),
        onclick: () => {
          updateConfig({ onboardingDone: true }).then(() => {
            ctl.close();
            openSettingsPanel();
          });
        },
      }),
      el('button', { class: 'primary', text: t('onboarding.start'), onclick: () => close() }),
    ],
  });
}

function openSettingsPanel() {
  openSettings('general');
}

/* -------------------------------------------------------------------- start */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
