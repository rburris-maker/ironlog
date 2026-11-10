// Accounts, via Supabase Auth. The Supabase library is only downloaded when
// cloud accounts are configured, so device-only mode has no outside dependencies.

import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const LAST_USER = 'ironlog:lastUser';

export const cloudConfigured = () => !!(globalThis.__IRONLOG_TEST_CLIENT__ || (SUPABASE_URL && SUPABASE_KEY));

let client = null;

export async function getClient() {
  if (client) return client;
  if (globalThis.__IRONLOG_TEST_CLIENT__) { client = globalThis.__IRONLOG_TEST_CLIENT__; return client; }
  const { createClient } = await import(SUPABASE_JS);
  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export function rememberUser(user) {
  try {
    if (user) localStorage.setItem(LAST_USER, JSON.stringify({ id: user.id, email: user.email }));
    else localStorage.removeItem(LAST_USER);
  } catch { /* ignore */ }
}

export function rememberedUser() {
  try { return JSON.parse(localStorage.getItem(LAST_USER) || 'null'); } catch { return null; }
}

/** Turn Supabase's error messages into something a person can act on. */
export function friendlyAuthError(error) {
  const m = (error && error.message) || String(error || '');
  if (/invalid login credentials/i.test(m)) return 'That email and password don’t match an account. Tap Show to check for typos, or use “Forgot your password?” to set a new one.';
  if (/different from the old password|same_password/i.test(m)) return 'That is already your password. Choose a different one.';
  if (/already registered|already exists/i.test(m)) return 'An account with that email already exists. Sign in instead.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first — open the link we sent you, then sign in.';
  if (/password.*(at least|should be|short)/i.test(m)) return 'Choose a password with at least 6 characters.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/fetch|network|load failed/i.test(m)) return 'Can’t reach the server. Check your connection and try again.';
  return m || 'Something went wrong. Try again.';
}
