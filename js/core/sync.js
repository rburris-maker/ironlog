// Cloud sync between the local store and Supabase (PostgreSQL).
//
//  pull  — fetch rows changed on the server since the last sync and merge them
//  push  — upload documents changed on this device (an upsert by ID, so sending
//          the same workout twice can never create a duplicate)
//
// If a request fails, the documents simply stay flagged and are retried when
// the connection returns.

const iso = (v) => (v ? new Date(v).toISOString() : null);

const TABLES = [
  {
    type: 'prefs', table: 'profiles', conflict: 'user_id',
    toRow: (d, userId) => {
      const { id, createdAt, updatedAt, deletedAt, ...prefs } = d;
      return { user_id: userId, prefs, updated_at: updatedAt };
    },
    fromRow: (r) => ({ ...(r.prefs || {}), id: 'prefs', createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) }),
  },
  {
    type: 'exercise', table: 'exercises', conflict: 'id',
    toRow: (d, userId) => ({ id: d.id, user_id: userId, name: d.name, muscle_group: d.group || 'Other', muscles: d.muscles || null, created_at: d.createdAt, updated_at: d.updatedAt, deleted_at: d.deletedAt || null }),
    fromRow: (r) => ({ id: r.id, name: r.name, group: r.muscle_group || 'Other', ...(r.muscles ? { muscles: r.muscles } : {}), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), deletedAt: iso(r.deleted_at) }),
  },
  {
    type: 'template', table: 'templates', conflict: 'id',
    toRow: (d, userId) => ({ id: d.id, user_id: userId, name: d.name, unit: d.unit || 'lb', sort: d.sort ?? null, exercises: d.exercises || [], created_at: d.createdAt, updated_at: d.updatedAt, deleted_at: d.deletedAt || null }),
    fromRow: (r) => ({ id: r.id, name: r.name, unit: r.unit || 'lb', sort: r.sort ?? undefined, exercises: r.exercises || [], createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), deletedAt: iso(r.deleted_at) }),
  },
  {
    type: 'workout', table: 'workouts', conflict: 'id',
    toRow: (d, userId) => ({
      id: d.id, user_id: userId, name: d.name, status: d.status, unit: d.unit,
      started_at: d.startedAt, ended_at: d.endedAt || null, duration_seconds: d.durationSec ?? null,
      timer: d.timer || null, template_id: d.templateId || null, repeated_from_id: d.repeatedFromId || null,
      notes: d.notes || '', exercises: d.exercises || [],
      group_post_id: d.groupPostId || null, highlights: d.highlights || null,
      created_at: d.createdAt, updated_at: d.updatedAt, deleted_at: d.deletedAt || null,
    }),
    fromRow: (r) => ({
      id: r.id, name: r.name, status: r.status, unit: r.unit,
      startedAt: iso(r.started_at), endedAt: iso(r.ended_at), durationSec: r.duration_seconds,
      timer: r.timer || null, templateId: r.template_id || null, repeatedFromId: r.repeated_from_id || null,
      notes: r.notes || '', exercises: r.exercises || [],
      ...(r.group_post_id ? { groupPostId: r.group_post_id } : {}), ...(r.highlights ? { highlights: r.highlights } : {}),
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), deletedAt: iso(r.deleted_at),
    }),
  },
];

const PAGE = 500;
const BATCH = 50;

export function createSync({ client, userId, store, onStatus = () => {} }) {
  const state = { status: 'idle', lastSyncedAt: store.meta('lastSyncedAt'), error: null, pending: 0 };
  let running = null;
  let again = false;
  let timerId = null;
  let intervalId = null;
  let stopped = false;
  const cleanups = [];

  const report = (patch = {}) => {
    Object.assign(state, patch, { pending: store.dirty().length });
    onStatus({ ...state });
  };

  async function pull() {
    const cursors = { ...(store.meta('cursors') || {}) };
    let changed = false;
    for (const t of TABLES) {
      let cursor = cursors[t.table] || '1970-01-01T00:00:00Z';
      for (;;) {
        const { data, error } = await client.from(t.table).select('*').gt('synced_at', cursor).order('synced_at', { ascending: true }).range(0, PAGE - 1);
        if (error) throw error;
        for (const row of data) {
          if (store.applyRemote(t.type, t.fromRow(row))) changed = true;
          cursor = row.synced_at;
        }
        if (data.length < PAGE) break;
      }
      cursors[t.table] = cursor;
    }
    store.setMeta('cursors', cursors);
    return changed;
  }

  async function push() {
    const dirty = store.dirty();
    for (const t of TABLES) {
      const recs = dirty.filter((r) => r.type === t.type);
      for (let i = 0; i < recs.length; i += BATCH) {
        const batch = recs.slice(i, i + BATCH);
        const sent = batch.map((r) => ({ key: r.key, updatedAt: r.doc.updatedAt }));
        const rows = batch.map((r) => t.toRow(r.doc, userId));
        const { error } = await client.from(t.table).upsert(rows, { onConflict: t.conflict });
        if (error) throw error;
        for (const s of sent) store.markClean(s.key, s.updatedAt);
      }
    }
  }

  async function runOnce() {
    if (stopped) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { report({ status: 'offline' }); return; }
    report({ status: 'syncing', error: null });
    try {
      const changed = await pull();
      if (!store.prefs.seeded) store.seedIfNeeded();
      await push();
      const at = new Date().toISOString();
      store.setMeta('lastSyncedAt', at);
      report({ status: 'idle', lastSyncedAt: at });
      if (changed) store.emit({ origin: 'sync' });
    } catch (err) {
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || /fetch|network|load failed/i.test(String(err && err.message));
      report({ status: offline ? 'offline' : 'error', error: offline ? null : (err && err.message) || String(err) });
      if (!offline) console.error('Sync failed', err);
    }
  }

  /** Sync now. Calls made while a sync is running are folded into one follow-up run. */
  function run() {
    if (running) { again = true; return running; }
    running = (async () => {
      do { again = false; await runOnce(); } while (again && !stopped);
    })().finally(() => { running = null; });
    return running;
  }

  function schedule(delay = 2000) {
    clearTimeout(timerId);
    timerId = setTimeout(run, delay);
    report();
  }

  function start() {
    const on = (target, ev, fn) => { target.addEventListener(ev, fn); cleanups.push(() => target.removeEventListener(ev, fn)); };
    on(window, 'online', () => run());
    on(window, 'offline', () => report({ status: 'offline' }));
    on(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') run(); else if (store.dirty().length) run(); });
    cleanups.push(store.subscribe((c) => { if (c.origin !== 'sync' && c.origin !== 'init') schedule(); }));
    intervalId = setInterval(() => { if (store.dirty().length || document.visibilityState === 'visible') run(); }, 60000);
    return run();
  }

  function stop() {
    stopped = true;
    clearTimeout(timerId);
    clearInterval(intervalId);
    cleanups.forEach((fn) => fn());
  }

  return { start, stop, run, schedule, get state() { return { ...state, pending: store.dirty().length }; } };
}
