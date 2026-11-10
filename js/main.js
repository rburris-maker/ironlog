// Boot: decide between device-only mode and signed-in cloud mode, open the right
// local database, start syncing, and keep the screen in step with the data.

import { store } from './core/store.js';
import { cloudConfigured, getClient, rememberUser, rememberedUser } from './core/auth.js';
import { createSync } from './core/sync.js';
import { ctx, renderApp, refresh, refreshWhenIdle, initialRoute, onShellChange } from './ui/app.js';
import { showAuth, hideAuth, showNewPassword, showFatal } from './ui/authview.js';
import { drawActiveBar, tickClocks } from './ui/active.js';
import { initRestBar, tickRest } from './ui/rest.js';
import { toast, confirmDialog } from './lib/dom.js';
import { openDocs } from './core/idb.js';
import './ui/home.js';
import './ui/workouts.js';
import './ui/history.js';
import './ui/progress.js';
import './ui/profile.js';

let started = false;
let currentUserId = null;

function startTicker() {
  if (started) return;
  started = true;
  const tick = () => { tickClocks(); tickRest(); };
  setInterval(tick, 250);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  window.addEventListener('pageshow', tick);

  // Re-render when data changes. Changes made by the set editor are "silent": it updates itself.
  store.subscribe((change) => {
    drawActiveBar();
    if (change.silent) return;
    if (change.origin === 'sync') refreshWhenIdle(); else refresh();
  });
  onShellChange(drawActiveBar);

  // Keep the page's bottom padding equal to the height of the bottom bars (nav, rest timer, resume bar).
  const dock = document.getElementById('dock');
  const fit = () => document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(dock);
  fit();

  // Make sure the latest keystrokes are on disk before the page goes away.
  const flush = () => { const w = store.active(); if (w) store._mirrorActive(w); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

async function openApp(user, { offline = false } = {}) {
  if (ctx.sync) { ctx.sync.stop(); ctx.sync = null; }
  currentUserId = user ? user.id : 'local';
  ctx.user = user;
  ctx.offlineAuth = offline;
  await store.init(currentUserId);
  if (ctx.mode === 'local') store.seedIfNeeded();
  hideAuth();
  initialRoute();
  startTicker();
  initRestBar();
  renderApp();
  drawActiveBar();
  if (ctx.mode === 'cloud' && ctx.client && !offline) {
    let firstError = true;
    let importChecked = false;
    ctx.sync = createSync({
      client: ctx.client,
      userId: user.id,
      store,
      onStatus: (s) => {
        const before = ctx.syncState;
        ctx.syncState = s;
        if (s.status === 'idle' && s.lastSyncedAt && !importChecked) { importChecked = true; offerLocalImport().catch((e) => console.error(e)); }
        if (s.status === 'error' && firstError) { firstError = false; toast('Could not sync. Your changes are saved on this device and will retry.', { duration: 5000 }); }
        if (before.status !== s.status || before.pending !== s.pending) {
          const badge = document.querySelector('.sync-badge');
          const onProfile = document.querySelector('[data-sync-status]');
          if (badge || onProfile) refreshWhenIdle();
        }
      },
    });
    ctx.sync.start();
  }
  if (!store.persistent) toast('This browser is blocking storage, so data will not be kept after you close the page.', { duration: 7000 });
}

// ---------- moving device-only data into an account ----------
// Workouts logged before accounts were switched on live in a separate local database.
// After signing in, offer (once) to copy them into the account.

const IMPORT_FLAG = 'ironlog:localImport';
const importFlag = () => { try { return localStorage.getItem(IMPORT_FLAG); } catch { return 'unknown'; } };

async function localDocs() {
  const db = await openDocs('ironlog-local');
  try { return db.persistent ? (await db.all()).filter((r) => ['workout', 'template', 'exercise'].includes(r.type) && !r.doc.deletedAt) : []; }
  finally { db.close(); }
}

export async function importLocalData() {
  const docs = await localDocs();
  const names = new Set(store.templates().map((t) => t.name.toLowerCase()));
  let workouts = 0;
  for (const r of docs) {
    if (store.get(r.type, r.id)) continue;
    if (r.type === 'template' && names.has((r.doc.name || '').toLowerCase())) continue;
    if (r.type === 'workout' && r.doc.status !== 'completed') continue;
    store.put(r.type, r.doc, { touch: false, silent: true });
    if (r.type === 'workout') workouts += 1;
  }
  try { localStorage.setItem(IMPORT_FLAG, 'imported'); } catch { /* ignore */ }
  refresh();
  return workouts;
}

async function offerLocalImport() {
  if (importFlag()) return;
  const count = (await localDocs()).filter((r) => r.type === 'workout' && r.doc.status === 'completed').length;
  if (!count) return;
  const ok = await confirmDialog({
    title: 'Bring your workouts into this account?',
    message: `${count} workout${count === 1 ? ' was' : 's were'} saved on this device before you signed in. Add ${count === 1 ? 'it' : 'them'} to your account so ${count === 1 ? 'it is' : 'they are'} backed up and available everywhere.`,
    confirmLabel: 'Add to my account', cancelLabel: 'Not now',
  });
  if (!ok) { try { localStorage.setItem(IMPORT_FLAG, 'declined'); } catch { /* ignore */ } refresh(); return; }
  const n = await importLocalData();
  toast(`${n} workout${n === 1 ? '' : 's'} added to your account`);
}

ctx.importLocalData = importLocalData;
ctx.importDeclined = () => importFlag() === 'declined';

async function closeApp({ keepLocal = true } = {}) {
  if (ctx.sync) { ctx.sync.stop(); ctx.sync = null; }
  if (!keepLocal) { try { await store.flush(); await store.db.clear(); localStorage.removeItem(store._mirrorKey()); } catch { /* ignore */ } }
  currentUserId = null;
  ctx.user = null;
}

async function boot() {
  if (!cloudConfigured()) {
    ctx.mode = 'local';
    await openApp(null);
    return;
  }
  ctx.mode = 'cloud';
  let client;
  try {
    client = await getClient();
  } catch (err) {
    // The sign-in library could not load (no connection on first launch).
    const remembered = rememberedUser();
    if (remembered) { await openApp(remembered, { offline: true }); window.addEventListener('online', () => location.reload(), { once: true }); return; }
    showFatal('You’re offline', 'Connect to the internet once to sign in. After that the app works without a connection.', 'Try again', () => location.reload());
    return;
  }
  ctx.client = client;
  ctx.onSignOut = async ({ keepLocal }) => {
    await closeApp({ keepLocal });
    rememberUser(null);
    await client.auth.signOut();
    try { history.replaceState(null, '', '#home'); } catch { /* ignore */ } // the next sign-in starts on Home
    showAuth(client);
  };

  let recovering = false;
  client.auth.onAuthStateChange((event, session) => {
    // Never do async Supabase work inside this callback; defer it.
    setTimeout(async () => {
      if (event === 'PASSWORD_RECOVERY') {
        recovering = true;
        showNewPassword(client, async () => { recovering = false; const { data } = await client.auth.getSession(); if (data.session) { rememberUser(data.session.user); await openApp(data.session.user); toast('Password updated'); } });
        return;
      }
      if (recovering) return;
      if (session && session.user && session.user.id !== currentUserId) {
        rememberUser(session.user);
        await openApp(session.user);
      } else if (!session && event === 'SIGNED_OUT' && currentUserId) {
        await closeApp();
        showAuth(client, { message: 'You have been signed out.' });
      }
    }, 0);
  });

  let session = null;
  let sessionError = null;
  try {
    const { data, error } = await client.auth.getSession();
    session = data ? data.session : null;
    sessionError = error || null;
  } catch (err) { session = null; sessionError = err; }

  if (session && session.user) {
    if (session.user.id !== currentUserId) { rememberUser(session.user); await openApp(session.user); }
    return;
  }
  const remembered = rememberedUser();
  if (remembered && !currentUserId && (navigator.onLine === false || sessionError)) {
    // Signed in before, but the session cannot be refreshed right now (no signal):
    // keep working from the copy on this device and reconnect as soon as possible.
    await openApp(remembered, { offline: true });
    const reconnect = async () => {
      try { const { data } = await client.auth.getSession(); if (data && data.session) location.reload(); } catch { /* still offline */ }
    };
    window.addEventListener('online', reconnect);
    setInterval(reconnect, 30000);
    return;
  }
  if (!currentUserId && !recovering) showAuth(client);
}

boot().catch((err) => {
  console.error(err);
  showFatal('The app could not start', String((err && err.message) || err), 'Reload', () => location.reload());
});

// Offline support and home-screen install. Not available in every host, so failures are ignored.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
