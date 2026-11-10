// Local-first data store.
// Every change is written to this device first (IndexedDB) and flagged "dirty";
// sync.js later pushes dirty documents to the cloud. The app therefore keeps
// working with no signal, and nothing is lost if a request fails halfway.

import { openDocs, memoryDocs } from './idb.js';
import { buildIndex } from './calc.js';
import { BUILT_IN, STARTER_TEMPLATES, musclesOf } from './exercises.js';
import { latestBodyweight, withBodyweight } from './body.js';

export const uid = () => {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const hx = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-${hx.slice(12, 16)}-${hx.slice(16, 20)}-${hx.slice(20)}`;
};

export const nowIso = () => new Date().toISOString();

export const DEFAULT_PREFS = {
  unit: 'lb', restSeconds: 90, restAuto: false, displayName: '', seeded: false,
  standards: '',      // 'male' | 'female' — which published strength table to compare with
  bodyweightLog: [],  // [{ date, weight, unit }]
  soreness: {},       // { [muscle]: { level, at } } — recovery check-ins
};

const keyOf = (type, id) => `${type}:${id}`;
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

class Store {
  constructor() {
    this.userId = null;
    this.db = null;
    this.persistent = true;
    this.records = new Map(); // key -> { key, type, id, doc, dirty }
    this.listeners = new Set();
    this.version = 0;
    this._index = new Map();
    this._pending = Promise.resolve();
    this.ready = false;
  }

  // ---------- lifecycle ----------

  /** Open the private local database for one user. Each account gets its own database on the device. */
  async init(userId) {
    const name = `ironlog-${userId || 'local'}`;
    if (!(this.db && this._dbName === name && this.db.persistent)) {
      if (this.db) { try { this.db.close(); } catch { /* ignore */ } }
      this.db = await openDocs(name);
      this._dbName = name;
    }
    this._pending = Promise.resolve();
    this.userId = userId || 'local';
    this.records = new Map();
    this._index.clear();
    let rows;
    try { rows = await this.db.all(); }
    catch (err) {
      // Storage opened but will not answer: carry on in memory rather than freeze.
      console.error('Local storage is not responding', err);
      try { this.db.close(); } catch { /* ignore */ }
      this.db = memoryDocs(err);
      this._dbName = null;
      rows = [];
    }
    this.persistent = this.db.persistent;
    for (const rec of rows) this.records.set(rec.key, rec);
    this._recoverActiveMirror();
    this.ready = true;
    this._bump();
    this.emit({ origin: 'init' });
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(change = {}) { for (const fn of [...this.listeners]) { try { fn(change); } catch (e) { console.error(e); } } }
  _bump() { this.version += 1; this._index.clear(); }

  _persist(rec) {
    const copy = { key: rec.key, type: rec.type, id: rec.id, dirty: rec.dirty, doc: rec.doc };
    let snapshot;
    try { snapshot = structuredClone(copy); } catch { snapshot = JSON.parse(JSON.stringify(copy)); }
    this._pending = this._pending.then(() => this.db.put(snapshot)).catch((e) => { console.error('Local save failed', e); this.storageError = e; });
    return this._pending;
  }

  /** Resolves when every queued local write has landed. */
  flush() { return this._pending; }

  // ---------- generic documents ----------

  get(type, id) { const r = this.records.get(keyOf(type, id)); return r ? r.doc : null; }

  list(type) {
    const out = [];
    for (const r of this.records.values()) if (r.type === type && !r.doc.deletedAt) out.push(r.doc);
    return out;
  }

  put(type, doc, { dirty = true, touch = true, silent = false, origin = 'app' } = {}) {
    if (touch) doc.updatedAt = nowIso();
    if (!doc.createdAt) doc.createdAt = doc.updatedAt || nowIso();
    const key = keyOf(type, doc.id);
    const rec = { key, type, id: doc.id, doc, dirty };
    this.records.set(key, rec);
    if (type === 'workout') this._mirrorActive(doc);
    this._bump();
    this._persist(rec);
    // `silent` changes still notify (sync needs to hear about them); screens skip re-rendering for them.
    this.emit({ type, id: doc.id, origin, silent });
    return doc;
  }

  /** Soft delete, so the deletion also reaches the user's other devices. */
  remove(type, id) {
    const doc = this.get(type, id);
    if (!doc) return;
    doc.deletedAt = nowIso();
    this.put(type, doc);
  }

  dirty() { return [...this.records.values()].filter((r) => r.dirty && r.type !== 'meta'); }

  markClean(key, updatedAt) {
    const rec = this.records.get(key);
    if (!rec || rec.doc.updatedAt !== updatedAt) return; // changed again while uploading — stays dirty
    rec.dirty = false;
    this._persist(rec);
  }

  /**
   * Merge a document that arrived from the cloud. Rules:
   *  - a finished workout is never replaced by an unfinished copy of itself;
   *  - a local change that has not been uploaded yet wins if it is newer.
   */
  applyRemote(type, remote) {
    const key = keyOf(type, remote.id);
    const rec = this.records.get(key);
    if (rec) {
      const local = rec.doc;
      if (type === 'workout' && local.status === 'completed' && remote.status === 'active' && !remote.deletedAt) return false;
      if (rec.dirty && (local.updatedAt || '') > (remote.updatedAt || '')) return false;
      if (!rec.dirty && local.updatedAt === remote.updatedAt) return false;
    }
    const next = { key, type, id: remote.id, doc: remote, dirty: false };
    this.records.set(key, next);
    if (type === 'workout') this._mirrorActive(remote);
    this._bump();
    this._persist(next);
    return true;
  }

  // ---------- device-only metadata (sync cursors etc.) ----------

  meta(id, fallback = null) { const d = this.get('meta', id); return d ? d.value : fallback; }
  setMeta(id, value) {
    const key = keyOf('meta', id);
    const rec = { key, type: 'meta', id, doc: { id, value }, dirty: false };
    this.records.set(key, rec);
    this._persist(rec);
  }

  // ---------- preferences ----------

  get prefs() { return { ...DEFAULT_PREFS, ...(this.get('prefs', 'prefs') || {}) }; }
  setPrefs(patch) {
    const cur = this.get('prefs', 'prefs') || { id: 'prefs' };
    this.put('prefs', { ...cur, ...patch, id: 'prefs' });
  }

  // ---------- workouts ----------

  /** Completed workouts, newest first. */
  workouts() {
    return this.list('workout').filter((w) => w.status === 'completed').sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  /** The workout in progress, if any. */
  active() {
    const act = this.list('workout').filter((w) => w.status === 'active');
    if (!act.length) return null;
    return act.sort((a, b) => ((a.updatedAt || '') < (b.updatedAt || '') ? 1 : -1))[0];
  }

  saveWorkout(w, opts) { return this.put('workout', w, opts); }

  /** Derived history, records and PRs — recalculated whenever any workout changes. */
  index(unit = this.prefs.unit) {
    let ix = this._index.get(unit);
    if (!ix) { ix = buildIndex(this.list('workout'), unit); this._index.set(unit, ix); }
    return ix;
  }

  // The workout in progress is also mirrored synchronously to localStorage, so it
  // survives the tab being killed before an IndexedDB write completes.
  _mirrorKey() { return `ironlog:active:${this.userId}`; }
  _mirrorActive(w) {
    const k = this._mirrorKey();
    if (w.status === 'active' && !w.deletedAt) {
      ls.set(k, JSON.stringify(w));
    } else {
      const raw = ls.get(k);
      if (raw) { try { if (JSON.parse(raw).id === w.id) ls.del(k); } catch { ls.del(k); } }
    }
  }
  _recoverActiveMirror() {
    const raw = ls.get(this._mirrorKey());
    if (!raw) return;
    try {
      const m = JSON.parse(raw);
      if (!m || !m.id) return;
      const rec = this.records.get(keyOf('workout', m.id));
      if (rec && (rec.doc.status !== 'active' || rec.doc.deletedAt)) { ls.del(this._mirrorKey()); return; }
      if (!rec || (m.updatedAt || '') > (rec.doc.updatedAt || '')) {
        const next = { key: keyOf('workout', m.id), type: 'workout', id: m.id, doc: m, dirty: true };
        this.records.set(next.key, next);
        this._persist(next);
      }
    } catch { ls.del(this._mirrorKey()); }
  }

  // ---------- templates ----------

  templates() { return this.list('template').sort((a, b) => (a.sort ?? 1e9) - (b.sort ?? 1e9) || a.name.localeCompare(b.name)); }

  /** Give a brand-new account the standard starter templates, once. */
  seedIfNeeded() {
    if (this.prefs.seeded) return;
    if (!this.list('template').length) {
      STARTER_TEMPLATES.forEach((t, i) => {
        this.put('template', {
          id: uid(),
          name: t.name,
          unit: this.prefs.unit,
          sort: i,
          exercises: t.items.map((it) => ({
            uid: uid(),
            exerciseId: it.exerciseId,
            name: this.exerciseName(it.exerciseId),
            sets: Array.from({ length: it.sets }, () => ({ weight: null, reps: it.reps })),
          })),
        }, { silent: true });
      });
    }
    this.setPrefs({ seeded: true });
  }

  // ---------- exercise library ----------

  exercises() {
    const custom = this.list('exercise').map((e) => ({ ...e, builtIn: false }));
    return [...BUILT_IN, ...custom].sort((a, b) => a.name.localeCompare(b.name));
  }

  exercise(id) {
    return BUILT_IN.find((e) => e.id === id) || this.get('exercise', id) || null;
  }

  exerciseName(id, fallback = 'Exercise') { const e = this.exercise(id); return e ? e.name : fallback; }

  /** Create a custom exercise, or return the existing one with the same name. */
  addExercise(name, group = 'Other', primaryMuscles = null) {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return null;
    const existing = this.exercises().find((e) => e.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    const doc = { id: uid(), name: clean, group };
    if (Array.isArray(primaryMuscles)) doc.muscles = { primary: primaryMuscles, secondary: [] };
    return this.put('exercise', doc);
  }

  /** Muscles an exercise works: { primary, secondary }. Unknown exercises work nothing. */
  musclesFor(id) { return musclesOf(this.exercise(id)); }

  // ---------- body ----------

  /** Latest bodyweight entry: { date, weight, unit } or null. */
  bodyweight() { return latestBodyweight(this.prefs.bodyweightLog); }

  setBodyweight(weight, unit = this.prefs.unit) {
    if (!(weight > 0)) return;
    this.setPrefs({ bodyweightLog: withBodyweight(this.prefs.bodyweightLog, weight, unit) });
  }

  /** Record how a muscle feels ('fresh' | 'sore' | 'very'), or clear the check-in with null. */
  setSoreness(muscle, level) {
    const next = { ...(this.prefs.soreness || {}) };
    if (level) next[muscle] = { level, at: nowIso() }; else delete next[muscle];
    this.setPrefs({ soreness: next });
  }

  // ---------- backup ----------

  exportData() {
    return {
      exportedAt: nowIso(),
      preferences: this.prefs,
      exercises: this.list('exercise'),
      templates: this.list('template'),
      workouts: this.list('workout'),
    };
  }
}

export const store = new Store();
