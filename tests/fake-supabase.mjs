// Test double for the Supabase JS client.
//
// The browser side (CLIENT_SCRIPT) mimics the small part of supabase-js the app uses.
// Every data call is forwarded to this Node process, which runs it against a REAL
// local PostgreSQL loaded with supabase/schema.sql, as the "authenticated" role with
// the caller's user ID in the JWT claim — so row-level security and the write
// guards are genuinely enforced by the database, exactly as on Supabase.
// Only sign-up/sign-in themselves are simulated.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PG = { ...process.env, PGHOST: '127.0.0.1', PGPORT: process.env.PGPORT || '54329', PGUSER: 'postgres', PGDATABASE: process.env.PGDATABASE || 'ironlog_test' };
const TABLES = { profiles: 'user_id', exercises: 'id', templates: 'id', workouts: 'id' };

export function sql(text) {
  return execFileSync('psql', ['-qAt', '-v', 'ON_ERROR_STOP=1', '-c', text], { env: PG, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const asUser = (uid, statement) => `begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${statement}; commit;`;
const uuidOk = (v) => /^[0-9a-f-]{36}$/i.test(v);

export function createServer() {
  const users = new Map(); // email -> { id, password }
  const calls = [];

  function handle(req) {
    calls.push({ op: req.op, table: req.table, user: req.token, rows: req.rows ? req.rows.length : undefined });
    try {
      if (req.op === 'signup') {
        if (users.has(req.email)) return { error: { message: 'User already registered' } };
        const id = randomUUID();
        users.set(req.email, { id, password: req.password });
        sql(`insert into auth.users (id, email) values ('${id}', '${req.email.replace(/'/g, "''")}')`);
        return { data: { user: { id, email: req.email } } };
      }
      if (req.op === 'signin') {
        const u = users.get(req.email);
        if (!u || u.password !== req.password) return { error: { message: 'Invalid login credentials' } };
        return { data: { user: { id: u.id, email: req.email } } };
      }
      if (!(req.table in TABLES)) return { error: { message: `unknown table ${req.table}` } };
      if (!req.token || !uuidOk(req.token)) return { error: { message: 'JWT required' } };

      if (req.op === 'select') {
        const cursor = String(req.cursor).replace(/'/g, '');
        const out = sql(asUser(req.token,
          `select coalesce(jsonb_agg(to_jsonb(x) order by x.synced_at), '[]'::jsonb) from (select * from public.${req.table} where synced_at > '${cursor}'::timestamptz order by synced_at limit ${Number(req.limit) || 500}) x`));
        return { data: JSON.parse(out) };
      }
      if (req.op === 'upsert') {
        if (!req.rows.length) return { data: null };
        const cols = Object.keys(req.rows[0]);
        if (!cols.every((c) => /^[a-z_]+$/.test(c))) return { error: { message: 'bad column' } };
        const pk = TABLES[req.table];
        const json = JSON.stringify(req.rows).replace(/\$j\$/g, '');
        const set = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`).join(', ');
        sql(asUser(req.token,
          `insert into public.${req.table} (${cols.join(', ')}) select ${cols.join(', ')} from jsonb_populate_recordset(null::public.${req.table}, $j$${json}$j$::jsonb) on conflict (${pk}) do update set ${set}`));
        return { data: null };
      }
      return { error: { message: `unknown op ${req.op}` } };
    } catch (err) {
      return { error: { message: String(err.stderr || err.message).trim() } };
    }
  }

  return { handle, calls, users };
}

/** Injected into the page before the app loads. Talks to window.__srv (exposed by the test). */
export const CLIENT_SCRIPT = `
(() => {
  const KEY = 'fake-supabase-session';
  const listeners = [];
  const session = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const fire = (ev) => { const s = session(); listeners.forEach((fn) => fn(ev, s)); };
  const netDown = () => navigator.onLine === false;
  const failed = { data: null, error: { message: 'TypeError: Failed to fetch' } };
  const call = async (req) => {
    if (netDown()) return failed;
    const s = session();
    const res = await window.__srv({ ...req, token: s ? s.user.id : null });
    return { data: res.data ?? null, error: res.error ?? null };
  };
  const from = (table) => {
    const q = { table };
    const api = {
      select() { return api; },
      gt(col, v) { q.cursor = v; return api; },
      order() { return api; },
      range(a, b) { return call({ op: 'select', table, cursor: q.cursor, limit: b - a + 1 }); },
      upsert(rows, opts) { return call({ op: 'upsert', table, rows, conflict: opts && opts.onConflict }); },
    };
    return api;
  };
  const start = (user) => { localStorage.setItem(KEY, JSON.stringify({ user, access_token: 'test' })); };
  window.__IRONLOG_TEST_CLIENT__ = {
    from,
    auth: {
      async getSession() { return { data: { session: session() }, error: null }; },
      onAuthStateChange(fn) { listeners.push(fn); setTimeout(() => fn('INITIAL_SESSION', session()), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async signUp({ email, password }) {
        if (netDown()) return failed;
        const res = await window.__srv({ op: 'signup', email, password });
        if (res.error) return { data: { user: null, session: null }, error: res.error };
        start(res.data.user); fire('SIGNED_IN');
        return { data: { user: res.data.user, session: session() }, error: null };
      },
      async signInWithPassword({ email, password }) {
        if (netDown()) return failed;
        const res = await window.__srv({ op: 'signin', email, password });
        if (res.error) return { data: { user: null, session: null }, error: res.error };
        start(res.data.user); fire('SIGNED_IN');
        return { data: { user: res.data.user, session: session() }, error: null };
      },
      async signOut() { localStorage.removeItem(KEY); fire('SIGNED_OUT'); return { error: null }; },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      async updateUser() { return { data: {}, error: null }; },
    },
  };
})();
`;
