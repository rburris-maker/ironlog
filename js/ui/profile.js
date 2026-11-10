// Profile: account, sync status, units, rest timer, install help, backup.

import { h, icon, segmented, confirmDialog, toast, openSheet, add } from '../lib/dom.js';
import { fmtDate, fmtTime, plural } from '../lib/format.js';
import { store } from '../core/store.js';
import { E1RM_MAX_REPS } from '../core/calc.js';
import { APP_NAME } from '../../config.js';
import { registerScreen, screenHeader, ctx } from './app.js';
import { REST_PRESETS } from './rest.js';

function syncSection() {
  if (ctx.mode !== 'cloud') {
    return h('section', { class: 'block' },
      h('h2', { class: 'block-title' }, 'Storage'),
      h('p', { class: 'note' }, store.persistent
        ? 'This device only. Your workouts are saved in this browser and stay here after you close the app. They are not backed up, and they are not available on other devices.'
        : 'This browser is not allowing the app to store data, so workouts will be lost when the page closes. Open the app in a regular (non-private) browser window.'),
      h('p', { class: 'hint' }, 'Accounts and cloud backup turn on once the app is connected to its database — see the setup guide that came with the app.'));
  }
  const s = ctx.syncState;
  const status = ctx.offlineAuth ? 'Offline — using the copy on this device'
    : s.status === 'syncing' ? 'Syncing…'
      : s.status === 'offline' ? 'Offline — changes are saved on this device and will upload when you reconnect'
        : s.status === 'error' ? `Sync problem: ${s.error || 'unknown error'}`
          : s.pending ? 'Saving…' : 'Everything is saved to your account';
  return h('section', { class: 'block' },
    h('h2', { class: 'block-title' }, 'Account'),
    h('dl', { class: 'rec' },
      h('div', { class: 'rec-row' }, h('dt', null, 'Signed in as'), h('dd', null, h('strong', null, ctx.user ? ctx.user.email : ''))),
      h('div', { class: 'rec-row' }, h('dt', null, 'Sync'), h('dd', { 'data-sync-status': s.status }, h('strong', null, status),
        s.pending > 0 && h('span', { class: 'muted' }, `${plural(s.pending, 'change')} waiting to upload`),
        s.lastSyncedAt && h('span', { class: 'muted' }, `Last synced ${fmtDate(s.lastSyncedAt)} at ${fmtTime(s.lastSyncedAt)}`)))),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-quiet', onClick: () => { if (ctx.sync) ctx.sync.run(); } }, icon('cloud', 18), 'Sync now'),
      h('button', { class: 'btn btn-quiet', 'data-action': 'sign-out', onClick: signOut }, 'Sign out')));
}

async function signOut() {
  const pending = store.dirty().length;
  const ok = await confirmDialog({
    title: 'Sign out?',
    message: pending
      ? `${plural(pending, 'change has', 'changes have')} not uploaded yet. They stay on this device and upload the next time you sign in here.`
      : 'Your workouts stay safe in your account.',
    confirmLabel: 'Sign out',
  });
  if (!ok) return;
  if (ctx.onSignOut) await ctx.onSignOut({ keepLocal: pending > 0 });
}

function exportBackup() {
  const json = JSON.stringify(store.exportData(), null, 2);
  let downloaded = false;
  try {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = h('a', { href: url, download: `ironlog-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    downloaded = true;
  } catch { /* fall through to copy */ }
  openSheet({
    title: 'Backup',
    body: (close) => h('div', null,
      h('p', { class: 'sheet-text' }, downloaded ? 'A backup file should now be downloading. If nothing happened, copy the data instead.' : 'Copy your data and paste it somewhere safe.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-quiet', onClick: async () => { try { await navigator.clipboard.writeText(json); toast('Copied'); } catch { toast('Copy was blocked by the browser'); } } }, icon('copy', 18), 'Copy data'),
        h('button', { class: 'btn btn-primary', onClick: () => close() }, 'Done'))),
  });
}

function renderProfile(el) {
  const prefs = store.prefs;
  const total = store.workouts().length;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  add(el, 
    screenHeader('Profile'),
    syncSection(),
    h('section', { class: 'block' },
      h('h2', { class: 'block-title' }, 'Units'),
      segmented([{ id: 'lb', label: 'Pounds (lb)' }, { id: 'kg', label: 'Kilograms (kg)' }], prefs.unit, (id) => { store.setPrefs({ unit: id }); toast(`Showing weights in ${id}`); }, { label: 'Weight unit' }),
      h('p', { class: 'hint' }, 'Past workouts keep the numbers you entered; they are converted for display and for comparing records.')),
    h('section', { class: 'block' },
      h('h2', { class: 'block-title' }, 'Rest timer'),
      segmented(REST_PRESETS.map((s) => ({ id: String(s), label: `${s} s` })), String(prefs.restSeconds), (id) => store.setPrefs({ restSeconds: Number(id) }), { label: 'Default rest' }),
      h('label', { class: 'check-row' },
        h('input', { type: 'checkbox', checked: prefs.restAuto, onChange: (e) => store.setPrefs({ restAuto: e.target.checked }) }),
        h('span', null, 'Start the rest timer automatically when I check off a set'))),
    !standalone && h('section', { class: 'block' },
      h('h2', { class: 'block-title' }, 'Add to your home screen'),
      h('p', { class: 'note' }, 'The app opens full screen from your home screen, like one from the app store.'),
      h('ul', { class: 'steps' },
        h('li', null, h('strong', null, 'iPhone: '), 'open this page in Safari, tap Share, then “Add to Home Screen”.'),
        h('li', null, h('strong', null, 'Android: '), 'open it in Chrome, tap the menu, then “Add to Home screen” or “Install app”.'))),
    h('section', { class: 'block' },
      h('h2', { class: 'block-title' }, 'Your data'),
      h('p', { class: 'note' }, `${plural(total, 'completed workout')} saved.`),
      h('div', { class: 'btn-col' },
        ctx.mode === 'cloud' && ctx.importDeclined && ctx.importDeclined() && h('button', { class: 'btn btn-quiet', onClick: async () => { const n = await ctx.importLocalData(); toast(`${n} workout${n === 1 ? '' : 's'} added to your account`); } }, 'Add workouts saved on this device before sign-in'),
        h('button', { class: 'btn btn-quiet', onClick: exportBackup }, 'Export a backup'))),
    h('section', { class: 'block' },
      h('h2', { class: 'block-title' }, 'How records are calculated'),
      h('p', { class: 'note' }, `Only sets you check off count. Estimated 1RM uses the Epley formula, weight × (1 + reps ÷ 30), from sets of 1–${E1RM_MAX_REPS} reps, and is always labelled “est.” so it is never confused with a lift you actually completed. Your first session of an exercise sets the baseline; records are recalculated from your saved workouts every time one is added, edited or deleted.`)),
    h('p', { class: 'muted small center' }, `${APP_NAME}`));
}

registerScreen('profile', renderProfile);
