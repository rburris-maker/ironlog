// ─────────────────────────────────────────────────────────────────────────────
// App settings. This is the only file you need to edit to turn on accounts.
//
// 1. Create a project at https://supabase.com
// 2. Run supabase/schema.sql in the project's SQL Editor
// 3. In the Supabase dashboard open Settings → API Keys (or the "Connect" button)
//    and copy the Project URL and the PUBLISHABLE key (starts with "sb_publishable_").
//    On an older project the legacy "anon" key also works.
//
// The publishable key is designed to be public. What keeps each person's data
// private is the row-level security set up by schema.sql.
// NEVER paste a secret key ("sb_secret_…") or the service_role key here.
//
// Leave both values empty to run in "this device only" mode (no accounts, no cloud).
// ─────────────────────────────────────────────────────────────────────────────

export const SUPABASE_URL = 'https://phxfbxxejspmfusltzzo.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_HRxbbL-j1cVkD2k6rAiKig_H2GXEfyI';

export const APP_NAME = 'Ironlog';

// Optional message shown at the top of the Home screen (used for the preview copy).
export const NOTICE = '';
