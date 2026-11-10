# Ironlog — workout tracker

A phone-first web app for logging lifts. It opens in a browser, can be saved to the
home screen, and then runs full screen like an app-store app — no store submission.

- Log sets with one tap; what you lifted last time sits beside every set
- Start blank, from a template, or by repeating any past workout
- AMRAP sets with an optional time and countdown, and supersets (in workouts and templates)
- Personal records detected automatically and recalculated when history changes
- Workout timer that keeps correct time through refreshes, app switches and a locked phone
- History with search and filters, per-exercise progress charts, PR dashboard
- Accounts with private cloud storage (Supabase / PostgreSQL), and it keeps working offline

"Ironlog" is a working name. Change `APP_NAME` in `config.js`, plus the name in
`manifest.webmanifest` and the `<title>` in `index.html`.

---

## 1. Try it right now (no setup)

Out of the box the app runs in **this-device-only mode**: no accounts, data stored in
the browser on that one device. Host the folder anywhere static, or run it locally:

```
cd ironlog
python3 -m http.server 8765
# open http://localhost:8765
```

## 2. Turn on accounts and cloud storage

You need a free Supabase project and about ten minutes.

1. **Create a project** at supabase.com.
2. **Create the tables.** In the project, open the SQL Editor, paste all of
   `supabase/schema.sql`, and run it. (Safe to run again later.)
3. **Copy two values** from the project's API settings (Settings → API Keys, or the
   Connect button): the **Project URL** and the **publishable key** (`sb_publishable_…`).
   Paste them into `config.js`:

   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_KEY = 'sb_publishable_…';
   ```

   The publishable key is meant to be public. Never put a secret key in this file.
4. **Decide how sign-up emails work** (Authentication settings in Supabase):
   - Supabase's built-in email sender is for testing only: about 2 emails an hour, and
     only to addresses on your Supabase team. For real users, either
     **connect an email provider** (custom SMTP — Resend, Brevo, etc.), or
     **turn off "Confirm email"** so people can sign up and start immediately.
     With confirmation off, anyone can register with an address they don't own, and
     "forgot password" emails still need a working email provider.
   - Set the **Site URL** to the address where you host the app, so confirmation and
     password-reset links come back to it.
5. **Deploy** (next section) and create your account in the app.

Workouts logged in this-device-only mode before step 3 are not lost: after the first
sign-in on that device the app offers to move them into the account.

## 3. Put it online

It is a plain static site — there is no build step.

- **GitHub + Vercel:** create a repository, upload the contents of this folder, then
  import the repository in Vercel. Leave the build command empty; the output is the
  repository root. Every later commit redeploys automatically.
- Netlify, Cloudflare Pages and GitHub Pages work the same way.

It must be served over **https** (all of the above do this) for home-screen install and
offline use to work.

**When you deploy a change**, bump `VERSION` at the top of `sw.js` (e.g. `ironlog-v2`).
Phones show cached files instantly and pick up the new version on the next launch.

## 4. Install on a phone

- **iPhone:** open the site in Safari → Share → **Add to Home Screen**.
- **Android:** open it in Chrome → menu → **Add to Home screen** / **Install app**.

---

## How it is built

**Stack:** plain HTML/CSS/JavaScript (ES modules, no framework, no build), Supabase Auth
+ PostgreSQL for accounts and storage, IndexedDB for the on-device copy, a service
worker for offline. The only outside code loaded is the Supabase client library and two
web fonts.

**Local-first.** Every change is written to the device first and flagged for upload; a
sync loop pushes flagged documents to Supabase and pulls what changed elsewhere. That is
why logging a set never waits on the network, and why a dropped connection loses nothing.

```
index.html, config.js, manifest.webmanifest, sw.js
css/app.css
js/main.js              boot: device-only vs account mode, sync, re-rendering
js/core/calc.js         pure maths: Epley 1RM, volume, previous-lift lookup, PRs, timer
js/core/store.js        on-device data store (IndexedDB) + change tracking
js/core/sync.js         push/pull with Supabase
js/core/session.js      create / repeat / finish workouts
js/core/exercises.js    built-in exercise library and starter templates
js/core/auth.js, idb.js
js/ui/…                 one file per screen (home, active workout, editor, history,
                        progress, workouts/templates, profile, sign-in, charts, rest timer)
supabase/schema.sql     tables, row-level security, write guards
tests/                  unit, browser end-to-end and database tests
```

### Database structure (`supabase/schema.sql`)

| Table | One row is | Key columns |
|---|---|---|
| `profiles` | a user's preferences | `user_id`, `prefs` (unit, rest timer…) |
| `exercises` | a custom exercise | `id`, `user_id`, `name`, `muscle_group`, `muscles` (which muscles it works) |
| `templates` | a reusable routine | `id`, `user_id`, `name`, `exercises` (JSON: order + target sets) |
| `workouts` | one workout session | `id`, `user_id`, `name`, `status`, `started_at`, `duration_seconds`, `exercises` (JSON: sets, weights, reps, notes), `repeated_from_id` |

Every table also has `updated_at`, `deleted_at` (soft delete, so deletions reach other
devices) and a server-stamped `synced_at`.

Design decisions worth knowing:

- **A workout is one row.** Its exercises and sets are stored together as JSON, so a
  workout is saved or replaced atomically and can never be half-written. The
  `workout_sets` view flattens it to one row per set if you want to query in SQL.
- **Personal records are never stored.** They are recalculated from the saved workouts
  each time, so editing or deleting a workout cannot leave a stale record.
- **Exercises have permanent IDs.** Built-in ones use fixed IDs such as `bench-press`;
  custom ones get a UUID. Workouts reference the ID, so "previous lift" and PRs follow
  an exercise across every routine, and survive renaming.
- **Privacy is enforced by the database.** Row-level security on every table restricts
  each signed-in user to rows where `user_id` is their own; signed-out visitors get nothing.
- **Write guards (triggers):** an older copy cannot overwrite a newer one, a completed
  workout cannot be turned back into an unfinished one, a row's owner cannot change.
- **No duplicates:** uploads are upserts by ID, so sending the same workout twice
  updates it in place.

### Rules the app applies

- Only sets that are **checked off** count toward history, volume and records.
- **Estimated 1RM** = weight × (1 + reps ÷ 30) (Epley), from sets of 1–12 reps. It is
  always labelled "est." and is tracked separately from the heaviest lift actually completed.
- The **first session** of an exercise sets the baseline and is not announced as a PR.
- **AMRAP sets** count like any other set, but their reps are never filled in from last
  time — you type what you got. Tap a set number to make it AMRAP and give it a time.
- **Supersets** link neighbouring exercises (exercise menu → Superset with…). With the
  automatic rest timer on, rest starts only after the last exercise of the round.
- PR types: heaviest weight, best estimated 1RM, most reps at a given weight, most
  volume for an exercise in one workout, and most total volume in a workout.
- **Repeating** a workout creates a new session with its own ID; the original is only read.
- The **timer** stores a start time and accumulated time rather than counting ticks, so
  the elapsed time is always recomputed from the clock.

---

### Body: muscle ratings and recovery (`js/core/body.js`)

Progress → Body shows a front/back muscle map with two views. Both are calculated from saved workouts, never stored.

- **Strength.** Each muscle takes the level of your best lift that trains it directly (last 6 months): estimated 1RM ÷ bodyweight on the day of the lift, compared with the bodyweight-ratio standards published by [Strength Level](https://strengthlevel.com/strength-standards) (Beginner, Novice, Intermediate, Advanced, Elite — stronger than 5 / 20 / 50 / 80 / 95% of lifters). The ratios for the 15 rated lifts are in `STANDARDS`; the score is 20 points per level with straight lines between. Bodyweight and the men's/women's table are set in Profile and kept in `profiles.prefs`. Forearms, abs and calves have no standard and are not rated.
- **Recovery.** An estimate, not a measurement. Every checked-off set adds load to the exercise's primary muscles (assisting muscles half; warm-ups less; AMRAP sets more). Load halves every 24 hours; ten hard sets = 100%. 60% and up is "needs rest", under 25% is "fresh". Tapping a muscle lets the user say how it actually feels, which overrides the estimate from that moment. The constants are in `RECOVERY`.
- The muscles each built-in exercise works are listed in `js/core/exercises.js`; custom exercises choose theirs when created.

## Tests

```
node --test tests/unit.test.mjs        # calculations (15 tests)
```

`tests/e2e.mjs` drives the real app in headless Chrome at phone size (needs Playwright
and the folder served on port 8765). Part 2 of it, and `tests/db/rls.test.sql`, run
against a local PostgreSQL loaded with `schema.sql` — see the comments at the top of
`tests/fake-supabase.mjs` for exactly what is real and what is simulated.

## Known limitations

- **Not yet run against a live Supabase project.** The schema, privacy rules and sync
  were tested against a real local PostgreSQL 16, with sign-in itself simulated. Still
  to be confirmed on your own project: a real sign-up, the confirmation email and the
  password-reset link.
- **Rest timer alerts only while the app is on screen.** A web app cannot beep or
  vibrate from a locked phone, and vibration may not be available to web apps on
  iPhone at all. The countdown itself stays correct.
- **Two devices editing the same workout at the same moment:** the most recent save wins.
- **Supabase's free plan pauses a project after about a week with little activity.**
  You resume it from the Supabase dashboard; data is kept. The app keeps working from
  the device copy in the meantime and uploads when the project is back.
- **Device-only mode has no backup.** Clearing the browser's site data erases it. Use
  Profile → Export a backup, or turn on accounts.
- **Signing out** leaves that account's device copy in the browser only if it still has
  changes waiting to upload; otherwise it is removed from the device.
- Fonts and the sign-in library are fetched from public CDNs on first load, then cached
  for offline use.
- No social features, plate calculator or Apple Health/Google Fit integration.

## Going native later

The app is a self-contained web bundle, so it can be wrapped with Capacitor (or a
similar shell) for the App Store and Play Store without rewriting the screens. The data
layer (`js/core`) has no browser-UI dependencies beyond IndexedDB.
