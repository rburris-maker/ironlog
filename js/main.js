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
// True while a password-reset link is being completed: the app stays behind the
// "choose a new password" screen until the new password is saved.
let recovering = /(^|[#&?])type=recovery(&|$)/.test(location.hash) || /(^|[#&?])type=recovery(&|$)/.test(location.search);

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
  if (!recovering) hideAuth();
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

const withDeadline = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
]);

/** Remove this account's copy from the device (used at sign-out when everything is uploaded). */
async function wipeLocal() {
  try { await withDeadline(store.flush(), 2000, 'flush'); } catch { /* ignore */ }
  try { await withDeadline(store.db.clear(), 3000, 'clear'); } catch { /* ignore */ }
  try { localStorage.removeItem(store._mirrorKey()); } catch { /* ignore */ }
}

/**
 * Start over from a fresh page load. Signing in, signing out and finishing a
 * password reset all end here, so the app only ever opens one way: at startup.
 */
function restart() {
  try { history.replaceState(null, '', `${location.pathname}#home`); } catch { /* ignore */ }
  location.reload();
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
    client = await withDeadline(getClient(), 12000, 'Loading the sign-in library');
  } catch (err) {
    // The sign-in library could not load (no connection on first launch).
    const remembered = rememberedUser();
    if (remembered) { await openApp(remembered, { offline: true }); window.addEventListener('online', () => location.reload(), { once: true }); return; }
    showFatal('You’re offline', 'Connect to the internet once to sign in. After that the app works without a connection.', 'Try again', () => location.reload());
    return;
  }
  ctx.client = client;
  let booted = false;

  ctx.onSignOut = async ({ keepLocal }) => {
    if (ctx.sync) { ctx.sync.stop(); ctx.sync = null; }
    if (!keepLocal) await wipeLocal();
    rememberUser(null);
    currentUserId = null;
    try { await withDeadline(client.auth.signOut(), 6000, 'Sign-out'); } catch { /* the local session is cleared below either way */ }
    try { await withDeadline(client.auth.signOut({ scope: 'local' }), 3000, 'Sign-out'); } catch { /* ignore */ }
    restart();
  };

  const finishRecovery = async () => { recovering = false; restart(); };

  client.auth.onAuthStateChange((event, session) => {
    // Never do async Supabase work inside this callback; defer it.
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') {
        recovering = true;
        showNewPassword(client, finishRecovery);
        return;
      }
      if (recovering || !booted) return;
      const userId = session && session.user ? session.user.id : null;
      // Signed in (here or in another tab) as someone other than who is on screen, or signed out elsewhere.
      if ((userId && userId !== currentUserId) || (!userId && event === 'SIGNED_OUT' && currentUserId)) restart();
    }, 0);
  });

  let session = null;
  let sessionError = null;
  try {
    const { data, error } = await withDeadline(client.auth.getSession(), 8000, 'Checking your sign-in');
    session = data ? data.session : null;
    sessionError = error || null;
  } catch (err) { session = null; sessionError = err; }

  try {
    if (session && session.user) {
      if (recovering) { showNewPassword(client, finishRecovery); return; } // arrived from a reset link
      rememberUser(session.user);
      await openApp(session.user);
      return;
    }
    if (recovering) recovering = false; // the reset link was invalid or expired; fall through to sign-in
    const remembered = rememberedUser();
    if (remembered && (navigator.onLine === false || sessionError)) {
      // Signed in before, but the session cannot be refreshed right now (no signal):
      // keep working from the copy on this device and reconnect as soon as possible.
      await openApp(remembered, { offline: true });
      const reconnect = async () => {
        try { const { data } = await withDeadline(client.auth.getSession(), 8000, 'Reconnecting'); if (data && data.session) location.reload(); } catch { /* still offline */ }
      };
      window.addEventListener('online', reconnect);
      setInterval(reconnect, 30000);
      return;
    }
    const linkExpired = /error_code=otp_expired|error=access_denied/.test(location.hash);
    showAuth(client, linkExpired ? { message: 'That reset link has expired or was already used. Request a new one below.' } : {});
  } finally {
    booted = true;
  }
}

boot().catch((err) => {
  console.error(err);
  showFatal('The app could not start', String((err && err.message) || err), 'Reload', () => location.reload());
});

// Offline support and home-screen install. Not available in every host, so failures are ignored.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
