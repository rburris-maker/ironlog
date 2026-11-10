// End-to-end tests in a real (headless) browser at phone size.
// Covers the ten acceptance scenarios from the brief, plus sync behaviour.
//
//   Part 1 — device-only mode, real IndexedDB in the browser
//   Part 2 — account mode: the app talks to a real local PostgreSQL loaded with
//            supabase/schema.sql (see tests/fake-supabase.mjs for what is simulated)
//
// Usage: serve the project folder on http://127.0.0.1:8765/ then  node tests/e2e.mjs

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createServer, CLIENT_SCRIPT, sql } from './fake-supabase.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const WITH_DB = process.env.WITH_DB !== '0';
const results = [];
let lastPage = null;
const errors = [];

async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log(`  ✓ ${name}`); }
  catch (err) {
    results.push(['FAIL', name, err]);
    if (SHOTS && lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: `${SHOTS}/FAIL-${results.length}.png` }).catch(() => {}); console.log(`  ✗ ${name}\n      ${String(err && err.message).split('\n').slice(0, 6).join('\n      ')}`);
  }
}

// ---------- helpers ----------

const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

async function open(context, url = BASE) {
  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(Number(process.env.TIMEOUT) || 8000);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(url);
  return page;
}
const ready = (page) => page.waitForSelector('#nav button');
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const tab = (page, id) => page.click(`#nav [data-tab="${id}"]`);

async function startBlank(page) {
  await page.click('[data-action="start"]');
  await page.click('[data-start="blank"]');
  await page.waitForSelector('.live-head');
}
async function addExercise(page, name) {
  await page.click('[data-action="add-exercise"]');
  await page.fill('.pick input[type="search"]', name);
  await page.locator('.pick-item', { has: page.locator('.pick-name', { hasText: new RegExp(`^${name}$`) }) }).first().click();
  await page.waitForSelector(`.ex:has(.ex-name:text-is("${name}"))`);
}
const exercise = (page, name) => page.locator(`.ex:has(.ex-name:text-is("${name}"))`);
const rows = (page, name) => exercise(page, name).locator('.set-row:not(.set-head)');
async function logSet(page, name, i, weight, reps) {
  const row = rows(page, name).nth(i);
  if (weight != null) await row.locator('input').nth(0).fill(String(weight));
  if (reps != null) await row.locator('input').nth(1).fill(String(reps));
  await row.locator('.set-check').click();
  await page.waitForSelector(`.ex:has(.ex-name:text-is("${name}")) .set-row.done >> nth=${i}`);
}
async function finish(page) {
  await page.click('[data-action="finish"]');
  await page.click('[data-finish="count"]');
  await page.waitForSelector('.summary');
}
/** Read the app's own data layer from inside the page. */
const data = (page, fn, arg) => page.evaluate(async ({ src, arg }) => {
  const { store } = await import('./js/core/store.js');
  await store.flush();
  return (new Function('store', 'arg', `return (${src})(store, arg)`))(store, arg);
}, { src: fn.toString(), arg });
const clockSeconds = async (page) => {
  const t = await page.locator('.clock').innerText();
  const [h, m, s] = t.trim().split(':').map(Number);
  return h * 3600 + m * 60 + s;
};
const renameWorkout = async (page, name) => {
  await page.click('.live-name');
  await page.fill('.sheet input[type="text"]', name);
  await page.click('.sheet button[type="submit"]');
};

// ---------- Part 1: device-only mode ----------

const browser = await chromium.launch({ channel: 'chrome' });

console.log('\nPart 1 — device-only mode');
{
  const context = await browser.newContext(phone);
  let page = await open(context);
  await ready(page);
  await shot(page, '01-home-empty');
  let pushDayId;
  let originalJson;

  await step('1. A user can create and save a workout', async () => {
    await startBlank(page);
    await renameWorkout(page, 'Push Day');
    await addExercise(page, 'Bench Press');
    assert.equal(await rows(page, 'Bench Press').count(), 3, 'a new exercise starts with three sets');
    await logSet(page, 'Bench Press', 0, 135, 10);
    await logSet(page, 'Bench Press', 1, 155, 8);
    await logSet(page, 'Bench Press', 2, 185, 5);
    await addExercise(page, 'Incline Dumbbell Press');
    await logSet(page, 'Incline Dumbbell Press', 0, 50, 10);
    await logSet(page, 'Incline Dumbbell Press', 1, 55, 8);
    await logSet(page, 'Incline Dumbbell Press', 2, 60, 6);
    await addExercise(page, 'Tricep Pushdowns');
    await logSet(page, 'Tricep Pushdowns', 0, 40, 12);
    await logSet(page, 'Tricep Pushdowns', 1, 50, 10);
    await shot(page, '02-live-workout');
    await finish(page);
    await shot(page, '03-summary');
    const text = await page.locator('.summary').innerText();
    assert.match(text, /Workout saved/i);
    assert.match(text, /Push Day/i);
    assert.match(text, /3\s*exercises/);
    assert.match(text, /8\s*sets/);
    assert.match(text, /lb lifted/);
    await page.click('[data-action="summary-done"]');
    assert.equal(await page.locator('.stats .stat-value').first().innerText(), '1');
  });

  await step('10. The workout is saved with every exercise, set, weight, rep and the duration', async () => {
    const w = await data(page, (store) => store.workouts()[0]);
    pushDayId = w.id;
    originalJson = JSON.stringify(w);
    assert.equal(w.name, 'Push Day');
    assert.equal(w.status, 'completed');
    assert.deepEqual(w.exercises.map((e) => e.exerciseId), ['bench-press', 'incline-dumbbell-press', 'tricep-pushdown']);
    assert.deepEqual(w.exercises.map((e) => e.sets.map((s) => [s.weight, s.reps])), [
      [[135, 10], [155, 8], [185, 5]],
      [[50, 10], [55, 8], [60, 6]],
      [[40, 12], [50, 10]],
    ]);
    assert.ok(Number.isInteger(w.durationSec) && w.durationSec >= 0, 'duration saved');
    assert.ok(w.startedAt && w.endedAt && new Date(w.endedAt) >= new Date(w.startedAt), 'timestamps saved');
    // volume = 135·10 + 155·8 + 185·5 + 50·10 + 55·8 + 60·6 + 40·12 + 50·10 = 5,795
    await tab(page, 'history');
    await page.click(`[data-workout="${pushDayId}"]`);
    const detail = await page.locator('#view').innerText();
    assert.match(detail, /5,795/);
    assert.match(detail, /185 × 5/);
    await shot(page, '04-history-detail');
  });

  await step('2. After closing the app, the workout is still there', async () => {
    await page.close();
    page = await open(context);
    await ready(page);
    assert.equal(await page.locator('.stats .stat-value').first().innerText(), '1');
    await tab(page, 'history');
    assert.equal(await page.locator('[data-workout]').count(), 1);
    assert.match(await page.locator('[data-workout]').first().innerText(), /Push Day/);
  });

  await step('3 + 5. Repeating a workout shows last time\'s numbers, earns a PR, and leaves the original unchanged', async () => {
    await page.click(`[data-workout="${pushDayId}"]`);
    await page.click('[data-action="repeat"]');
    await page.waitForSelector('.live-head');
    assert.deepEqual(await page.locator('.ex-name').allTextContents(), ['Bench Press', 'Incline Dumbbell Press', 'Tricep Pushdowns']);
    // previous performance is shown automatically, and suggested in the empty inputs
    assert.deepEqual(await rows(page, 'Bench Press').locator('.set-prev').allInnerTexts(), ['135 × 10', '155 × 8', '185 × 5']);
    assert.equal(await rows(page, 'Bench Press').nth(0).locator('input').nth(0).getAttribute('placeholder'), '135');
    assert.equal(await rows(page, 'Bench Press').nth(0).locator('input').nth(0).inputValue(), '', 'today starts empty');
    const stats = await exercise(page, 'Bench Press').locator('.ex-stats').innerText();
    assert.match(stats, /Heaviest\s*185/);
    assert.match(stats, /Est\. 1RM\s*216/); // 185 × (1 + 5/30) = 215.8
    await shot(page, '05-repeat-previous');

    await rows(page, 'Bench Press').nth(0).locator('.set-check').click(); // one tap accepts 135 × 10
    assert.equal(await rows(page, 'Bench Press').nth(0).locator('input').nth(0).inputValue(), '135');
    await logSet(page, 'Bench Press', 1, 165, 8);
    await logSet(page, 'Bench Press', 2, 195, 5);
    const toast = await page.locator('.toast-pr').first().innerText();
    assert.match(toast, /New personal record!/i);
    assert.match(toast, /Bench Press — 195 lb/);
    await page.waitForSelector('.ex:has(.ex-name:text-is("Bench Press")) .set-row.pr');
    await shot(page, '06-pr-toast');
    await finish(page);
    const summary = await page.locator('.summary').innerText();
    assert.match(summary, /Heaviest lift: 195 × 5 lb/);
    assert.match(summary, /was 185 lb/);
    await shot(page, '07-summary-pr');
    await page.click('[data-action="summary-done"]');

    const state = await data(page, (store, id) => ({ original: JSON.stringify(store.get('workout', id)), count: store.workouts().length, newest: store.workouts()[0] }), pushDayId);
    assert.equal(state.original, originalJson, 'the original workout is byte-for-byte unchanged');
    assert.equal(state.count, 2);
    assert.notEqual(state.newest.id, pushDayId);
    assert.equal(state.newest.repeatedFromId, pushDayId);
    assert.equal(state.newest.exercises.length, 1, 'only the exercise actually performed is saved');
  });

  await step('4. Previous lifts appear when the exercise is added to a different routine', async () => {
    await startBlank(page);
    await renameWorkout(page, 'Upper Body');
    await addExercise(page, 'Bench Press');
    assert.deepEqual(await rows(page, 'Bench Press').locator('.set-prev').allInnerTexts(), ['135 × 10', '165 × 8', '195 × 5']);
    const stats = await exercise(page, 'Bench Press').locator('.ex-stats').innerText();
    assert.match(stats, /Last\s*Today/);
    assert.match(stats, /Top set\s*195 × 5/);
    assert.match(stats, /Heaviest\s*195/);
    assert.match(await exercise(page, 'Bench Press').locator('.ex-count').innerText(), /2 sessions/);
    await addExercise(page, 'Barbell Row');
    assert.match(await exercise(page, 'Barbell Row').innerText(), /First time logging/);
  });

  await step('8. An interrupted workout is recovered with everything entered so far', async () => {
    await logSet(page, 'Bench Press', 0, 140, 10);
    await rows(page, 'Bench Press').nth(1).locator('input').nth(0).fill('170'); // typed, not checked off
    await page.close({ runBeforeUnload: false }); // abrupt close
    page = await open(context);
    await ready(page);
    assert.match(await page.locator('[data-action="resume"]').innerText(), /Resume Upper Body/i);
    await page.click('[data-action="resume"]');
    assert.equal(await rows(page, 'Bench Press').nth(0).locator('input').nth(0).inputValue(), '140');
    assert.ok(await rows(page, 'Bench Press').nth(0).evaluate((el) => el.classList.contains('done')));
    assert.equal(await rows(page, 'Bench Press').nth(1).locator('input').nth(0).inputValue(), '170');
    // even if the database write had been lost, the synchronous mirror restores the session
    await page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase('ironlog-local'); r.onsuccess = resolve; r.onerror = reject; r.onblocked = resolve; }));
    await page.reload();                                     // reopens straight into the workout
    await page.waitForSelector('.live-head');
    assert.match(await page.locator('.live-name').innerText(), /Upper Body/i);
    assert.equal(await rows(page, 'Bench Press').nth(1).locator('input').nth(0).inputValue(), '170');
  });

  await context.close();
}

console.log('\nPart 1b — timer and record recalculation (fresh device)');
{
  const context = await browser.newContext(phone);
  let page = await open(context);
  await ready(page);

  await step('7. The timer stays accurate across navigation, refresh, closing the app, pause and manual adjustment', async () => {
    await startBlank(page);
    const startedAt = await data(page, (store) => store.active().timer.runningSince);
    await page.waitForTimeout(2100);
    assert.ok(await clockSeconds(page) >= 2, 'timer starts automatically and counts');
    await tab(page, 'history');                              // navigate away…
    assert.match(await page.locator('#active-bar').innerText(), /0:00:0\d/); // …a running clock stays visible
    await page.reload();                                     // refresh
    await ready(page);
    await page.click('#active-bar button');
    const afterReload = await clockSeconds(page);
    const expected = Math.floor((Date.now() - startedAt) / 1000);
    assert.ok(Math.abs(afterReload - expected) <= 1, `after refresh: showed ${afterReload}s, expected ${expected}s`);

    await page.close();                                      // close the app completely for 3 seconds
    await new Promise((r) => setTimeout(r, 3000));
    page = await open(context, `${BASE}#workout`);
    await page.waitForSelector('.clock');
    const afterReopen = await clockSeconds(page);
    const expected2 = Math.floor((Date.now() - startedAt) / 1000);
    assert.ok(Math.abs(afterReopen - expected2) <= 1, `after reopening: showed ${afterReopen}s, expected ${expected2}s`);
    assert.ok(afterReopen >= afterReload + 3, 'time kept counting while the app was closed');

    await page.click('[data-action="pause"]');               // pause holds the time…
    const paused = await clockSeconds(page);
    await page.waitForTimeout(2200);
    assert.equal(await clockSeconds(page), paused);
    await page.reload();                                     // …even through a refresh
    await page.waitForSelector('.clock');
    assert.equal(await clockSeconds(page), paused);
    await page.click('[data-action="pause"]');               // resume
    await page.waitForTimeout(1200);
    assert.ok(await clockSeconds(page) > paused);

    await page.click('.clock');                              // manual adjustment to 1:12:30
    const parts = page.locator('.sheet .time-part input');
    await parts.nth(0).fill('1'); await parts.nth(1).fill('12'); await parts.nth(2).fill('30');
    await page.click('.sheet button[type="submit"]');
    await page.waitForTimeout(1100);
    const adjusted = await clockSeconds(page);
    assert.ok(adjusted >= 4350 && adjusted <= 4356, `adjusted clock shows ${adjusted}s`);
    assert.match(await page.locator('.clock').innerText(), /^1:12:3\d$/);
    await shot(page, '08-timer');

    await addExercise(page, 'Bench Press');
    await logSet(page, 'Bench Press', 0, 185, 5);
    await finish(page);
    assert.match(await page.locator('[data-summary="duration"]').innerText(), /^1 hr 12 min 3\d sec$/);
    const saved = await data(page, (store) => store.workouts()[0].durationSec);
    assert.ok(saved >= 4350 && saved <= 4360, 'the adjusted duration is what gets saved');
    await page.click('[data-action="summary-done"]');
  });

  await step('Rest timer counts down and can be skipped', async () => {
    await startBlank(page);
    await page.click('[data-action="rest"]');
    await page.locator('.preset', { hasText: '90' }).click();
    await page.waitForSelector('#rest-bar:not([hidden])');
    assert.match(await page.locator('#rest-time').innerText(), /^1:(30|29)$/);
    await page.waitForTimeout(1500);
    assert.match(await page.locator('#rest-time').innerText(), /^1:2[789]$/);
    await page.reload();
    await page.waitForSelector('#rest-bar:not([hidden])');   // survives a refresh
    await page.click('#rest-bar >> text=Skip');
    assert.ok(await page.locator('#rest-bar').isHidden());
    await page.click('[data-action="discard"]');
    await page.click('[data-confirm]');
    await ready(page);
  });

  await step('5 + 6. PRs are identified, and stay correct after a workout is edited or deleted', async () => {
    // history so far: Bench 185 × 5 (baseline). Add 205 × 3, then 225 × 1.
    for (const [w, r] of [[205, 3], [225, 1]]) {
      await startBlank(page);
      await addExercise(page, 'Bench Press');
      await logSet(page, 'Bench Press', 0, w, r);
      assert.match(await page.locator('.toast-pr').last().innerText(), new RegExp(`Bench Press — ${w} lb`));
      await finish(page);
      await page.click('[data-action="summary-done"]');
      await page.waitForTimeout(250); // distinct start times
    }
    const before = await data(page, (store) => { const ix = store.index('lb'); const r = ix.exercises.get('bench-press').records; return { heaviest: r.heaviest.weight, est: Math.round(r.bestEst.value), prs: ix.totals.prs }; });
    assert.equal(before.heaviest, 225);
    assert.equal(before.est, 226); // 205 × (1 + 3/30) = 225.5 beats the 225 single
    assert.ok(before.prs >= 2);

    await tab(page, 'progress');
    await page.click('.seg-item:text-is("Personal records")');
    assert.match(await page.locator('[data-record="bench-press"]').innerText(), /Heaviest\s*225 × 1/);
    await shot(page, '09-records');

    // EDIT the 225 single down to 215 (fixing a typo)
    await tab(page, 'history');
    await page.locator('[data-workout]').first().click();
    await page.click('[data-action="workout-menu"]');
    await page.click('.menu-item:has-text("Edit workout")');
    await rows(page, 'Bench Press').nth(0).locator('input').nth(0).fill('215');
    await page.click('[data-action="save-edit"]');
    await page.waitForSelector('.detail-date');
    assert.match(await page.locator('#view').innerText(), /215 × 1/);
    let rec = await data(page, (store) => { const r = store.index('lb').exercises.get('bench-press').records; return { heaviest: r.heaviest.weight, est: Math.round(r.bestEst.value) }; });
    assert.equal(rec.heaviest, 215, 'record follows the edit');

    // DELETE that workout → the record falls back to 205 × 3
    await page.click('[data-action="workout-menu"]');
    await page.click('.menu-item:has-text("Delete workout")');
    await page.click('[data-confirm]');
    await page.waitForSelector('.history-list');
    assert.equal(await page.locator('[data-workout]').count(), 2);
    rec = await data(page, (store) => { const ix = store.index('lb'); const r = ix.exercises.get('bench-press').records; return { heaviest: r.heaviest.weight, reps: r.heaviest.reps, prs: ix.totals.prs, last: ix.exercises.get('bench-press').sessions.at(-1).top.weight }; });
    assert.deepEqual([rec.heaviest, rec.reps], [205, 3], 'record recalculated without the deleted workout');
    assert.equal(rec.last, 205, 'previous-lift lookup no longer sees the deleted workout');
    await tab(page, 'progress');
    assert.match(await page.locator('[data-record="bench-press"]').innerText(), /Heaviest\s*205 × 3/);
    await tab(page, 'home');
    await shot(page, '10-home');
  });

  await step('Templates: start from one, duplicate, rename, edit without touching history', async () => {
    await tab(page, 'workouts');
    await shot(page, '11-templates');
    await page.locator('[data-template="Push Day"] .btn-primary').click();
    await page.waitForSelector('.live-head');
    assert.deepEqual((await page.locator('.ex-name').allTextContents()).slice(0, 2), ['Bench Press', 'Incline Dumbbell Press']);
    assert.equal(await rows(page, 'Bench Press').nth(0).locator('.set-prev').innerText(), '205 × 3');
    assert.equal(await rows(page, 'Bench Press').nth(0).locator('input').nth(1).getAttribute('placeholder'), '8'); // template target reps
    await page.click('[data-action="discard"]');
    await page.click('[data-confirm]');
    await tab(page, 'workouts');
    await page.locator('[data-template="Push Day"] .icon-btn').click();
    await page.click('.menu-item:has-text("Duplicate")');
    await page.waitForSelector('[data-template="Push Day copy"]');
    await page.locator('[data-template="Push Day copy"] .icon-btn').click();
    await page.click('.menu-item:has-text("Rename")');
    await page.fill('.sheet input[type="text"]', 'Heavy Push');
    await page.click('.sheet button[type="submit"]');
    await page.waitForSelector('[data-template="Heavy Push"]');
    const historyBefore = await data(page, (store) => JSON.stringify(store.workouts()));
    await page.locator('[data-template="Heavy Push"] .list-main').click();
    await page.locator('.ex').first().locator('input').first().fill('225');
    await page.click('[data-action="save-template"]');
    await page.waitForSelector('[data-template="Heavy Push"]');
    const after = await data(page, (store) => ({ history: JSON.stringify(store.workouts()), push: store.templates().find((t) => t.name === 'Push Day').exercises[0].sets[0].weight, heavy: store.templates().find((t) => t.name === 'Heavy Push').exercises[0].sets[0].weight }));
    assert.equal(after.history, historyBefore, 'editing a template never changes completed workouts');
    assert.equal(after.heavy, 225);
    assert.equal(after.push, null, 'the template it was copied from is unaffected');
  });

  await step('History search and filters; progress charts render from saved data', async () => {
    await tab(page, 'history');
    await page.fill('.search-row input', 'bench');
    assert.equal(await page.locator('[data-workout]').count(), 2);
    await page.fill('.search-row input', 'squat');
    assert.equal(await page.locator('[data-workout]').count(), 0);
    await page.fill('.search-row input', '');
    await page.click('[data-action="filters"]');
    await page.fill('.filters input[type="date"] >> nth=0', '2099-01-01');
    assert.equal(await page.locator('[data-workout]').count(), 0);
    await page.fill('.filters input[type="date"] >> nth=0', '');
    await shot(page, '12-history');
    await tab(page, 'progress');
    await page.click('.seg-item:text-is("By exercise")');
    await page.waitForSelector('.chart svg .line');
    assert.equal(await page.locator('.chart svg circle.dot:not(.dot-focus)').count(), 2, 'one point per saved session');
    await page.click('.seg-item:text-is("Est. 1RM")');
    await page.waitForSelector('.chart svg .line');
    await shot(page, '13-progress');
    await tab(page, 'profile');
    await page.click('.seg-item:text-is("Kilograms (kg)")');
    await tab(page, 'progress');
    await page.click('.seg-item:text-is("Personal records")');
    assert.match(await page.locator('[data-record="bench-press"]').innerText(), /92\.99 × 3/); // 205 lb in kg
    await tab(page, 'profile');
    await page.click('.seg-item:text-is("Pounds (lb)")');
    await shot(page, '14-profile');
  });

  await context.close();
}

console.log('\nPart 1c — browser storage blocked');
{
  const context = await browser.newContext(phone);
  await context.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined });
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const page = await open(context);
  await step('With storage blocked the app still runs, and says plainly that nothing will be kept', async () => {
    await ready(page);
    await page.waitForSelector('.toast');
    assert.match(await page.locator('.toast').first().innerText(), /blocking storage/);
    await startBlank(page);
    await addExercise(page, 'Bench Press');
    await logSet(page, 'Bench Press', 0, 135, 10);
    await finish(page);
    await page.click('[data-action="summary-done"]');
    assert.equal(await page.locator('.stats .stat-value').first().innerText(), '1');
    await tab(page, 'profile');
    assert.match(await page.locator('#view').innerText(), /not allowing the app to store data/);
  });
  await context.close();
}

// ---------- Part 2: accounts + real PostgreSQL ----------

if (WITH_DB) {
  console.log('\nPart 2 — accounts, sync and privacy (real PostgreSQL with schema.sql)');
  sql('truncate public.workouts, public.templates, public.exercises, public.profiles; delete from auth.users;');
  const server = createServer();
  const device = async () => {
    const context = await browser.newContext(phone);
    await context.exposeFunction('__srv', (req) => server.handle(req));
    await context.addInitScript(CLIENT_SCRIPT);
    return context;
  };
  const signUp = async (page, email) => {
    await page.waitForSelector('.auth-form');
    await page.click('.seg-item:text-is("Create account")');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'correct-horse');
    await page.click('.auth-form button[type="submit"]');
    await ready(page);
  };
  const signIn = async (page, email, password = 'correct-horse') => {
    await page.waitForSelector('.auth-form');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('.auth-form button[type="submit"]');
  };
  /** Poll the app's data layer until `predicate(store)` is true. */
  const until = async (page, predicate, what, timeout = 15000) => {
    const end = Date.now() + timeout;
    for (;;) {
      if (await data(page, predicate)) return;
      if (Date.now() > end) throw new Error(`timed out waiting until ${what}`);
      await page.waitForTimeout(150);
    }
  };
  const synced = (page) => until(page, (store) => store.ready && store.dirty().length === 0 && !!store.meta('lastSyncedAt'), 'everything is uploaded');
  const logQuick = async (page, name, weight, reps) => {
    await startBlank(page);
    await renameWorkout(page, name);
    await addExercise(page, 'Back Squat');
    await logSet(page, 'Back Squat', 0, weight, reps);
    await finish(page);
    await page.click('[data-action="summary-done"]');
  };
  const dbCount = (where = 'true') => Number(sql(`select count(*) from public.workouts where ${where}`));

  const phoneA = await device();
  const phoneA2 = await device();
  const phoneB = await device();
  let a = await open(phoneA);

  await step('Sign-up is required; wrong passwords are rejected', async () => {
    await a.waitForSelector('.auth-form');
    assert.ok(await a.locator('#app').isHidden(), 'no app data is shown before signing in');
    await shot(a, '15-sign-in');
    await signUp(a, 'alice@example.com');
    await synced(a);
    assert.equal(await a.locator('[data-quick]').count(), 6, 'new account gets the starter templates');
  });

  let aliceId, bobId;
  await step('A finished workout is uploaded to the account (real database row, owned by the user)', async () => {
    await logQuick(a, 'Leg Day', 225, 5);
    await synced(a);
    aliceId = server.users.get('alice@example.com').id;
    assert.equal(dbCount(`user_id = '${aliceId}' and status = 'completed' and deleted_at is null`), 1);
    const row = JSON.parse(sql(`select to_jsonb(w) from public.workouts w where status = 'completed'`));
    assert.equal(row.name, 'Leg Day');
    assert.equal(row.exercises[0].exerciseId, 'squat');
    assert.deepEqual([row.exercises[0].sets[0].weight, row.exercises[0].sets[0].reps], [225, 5]);
    assert.ok(row.duration_seconds >= 0);
  });

  await step('9. Two different users cannot access each other\'s workout data', async () => {
    const b = await open(phoneB);
    await signUp(b, 'bob@example.com');
    await synced(b);
    bobId = server.users.get('bob@example.com').id;
    assert.notEqual(aliceId, bobId);
    assert.equal(await b.locator('.stats .stat-value').first().innerText(), '0', 'Bob starts with an empty history');
    const bobSees = await data(b, (store) => store.list('workout').length);
    assert.equal(bobSees, 0, 'nothing of Alice\'s reached Bob\'s device');

    // Ask the database directly, as Bob, for everything — and try to tamper with Alice's row.
    const asBob = (stmt) => sql(`begin; set local role authenticated; set local request.jwt.claim.sub = '${bobId}'; ${stmt}; commit;`);
    assert.equal(asBob('select count(*) from public.workouts'), '0');
    assert.equal(asBob('select count(*) from public.templates where user_id <> auth.uid()'), '0');
    asBob(`update public.workouts set name = 'hacked', updated_at = now() + interval '1 day'`);
    asBob('delete from public.workouts');
    assert.equal(sql(`select name from public.workouts where user_id = '${aliceId}' and status = 'completed'`), 'Leg Day', 'Alice\'s row is untouched');

    // Bob's own data works normally and stays separate
    await logQuick(b, 'Bob Squats', 315, 3);
    await synced(b);
    assert.equal(dbCount(`user_id = '${bobId}' and status = 'completed'`), 1);

    // Same phone, different account: Alice signs out, Bob signs in on Alice's device
    await tab(a, 'profile');
    await a.click('[data-action="sign-out"]');
    await a.click('[data-confirm]');
    await signIn(a, 'bob@example.com');
    await ready(a);
    await synced(a);
    const onSharedPhone = await data(a, (store) => store.workouts().map((w) => w.name));
    assert.deepEqual(onSharedPhone, ['Bob Squats'], 'Bob sees only his own workout on the shared phone');
    await tab(a, 'profile');
    await a.click('[data-action="sign-out"]');
    await a.click('[data-confirm]');
    await signIn(a, 'alice@example.com', 'wrong-password');
    await a.waitForSelector('.auth-note.bad');
    assert.match(await a.locator('.auth-note').innerText(), /don’t match/);
    await signIn(a, 'alice@example.com');
    await ready(a);
    await synced(a);
    assert.deepEqual(await data(a, (store) => store.workouts().map((w) => w.name)), ['Leg Day']);
    await b.close();
  });

  let a2;
  await step('2 (cloud). Signing in on a second device brings the history and records with it', async () => {
    a2 = await open(phoneA2);
    await signIn(a2, 'alice@example.com');
    await ready(a2);
    await synced(a2);
    assert.deepEqual(await data(a2, (store) => store.workouts().map((w) => w.name)), ['Leg Day']);
    assert.equal(await a2.locator('[data-quick]').count(), 6, 'starter templates are not duplicated on the second device');
    await startBlank(a2);
    await addExercise(a2, 'Back Squat');
    assert.equal(await rows(a2, 'Back Squat').nth(0).locator('.set-prev').innerText(), '225 × 5', 'previous lift follows the account');
    // a workout in progress follows the account too: it shows up on the other device…
    await synced(a2);
    await a.evaluate(() => window.dispatchEvent(new Event('online')));
    await until(a, (store) => !!store.active(), 'the first device sees the workout in progress');
    await a.waitForSelector('[data-action="resume"]');
    // …and disappears there when it is discarded here
    await a2.click('[data-action="discard"]');
    await a2.click('[data-confirm]');
    await ready(a2);
    await synced(a2);
    await a.evaluate(() => window.dispatchEvent(new Event('online')));
    await until(a, (store) => !store.active(), 'the discarded workout is gone from the first device');
    await a.waitForSelector('[data-action="start"]');
  });

  await step('Network failure: the workout is saved on the device and uploads once, later', async () => {
    await phoneA.setOffline(true);
    await logQuick(a, 'Offline Legs', 235, 5);
    await a.waitForTimeout(2600);
    const pending = await data(a, (store) => store.dirty().length);
    assert.ok(pending >= 1, 'changes are queued while offline');
    assert.equal(dbCount(`name = 'Offline Legs'`), 0, 'nothing reached the server yet');
    await a.reload();                               // even a refresh while offline keeps it
    await ready(a);
    assert.deepEqual(await data(a, (store) => store.workouts().map((w) => w.name)), ['Offline Legs', 'Leg Day']);
    await phoneA.setOffline(false);
    await a.evaluate(() => window.dispatchEvent(new Event('online')));
    await synced(a);
    assert.equal(dbCount(`name = 'Offline Legs' and status = 'completed'`), 1, 'uploaded exactly once');
    await a2.evaluate(() => window.dispatchEvent(new Event('online')));
    await until(a2, (store) => store.workouts().length === 2, 'the second device has both workouts');
    await a2.waitForSelector('[data-action="start"]');
    assert.equal(await a2.locator('.stats .stat-value').first().innerText(), '2', 'the other device updates itself');
  });

  await step('No duplicates: double-tapping Finish and repeated syncs create one workout', async () => {
    const before = dbCount(`user_id = '${aliceId}' and status = 'completed' and deleted_at is null`);
    await startBlank(a);
    await addExercise(a, 'Back Squat');
    await logSet(a, 'Back Squat', 0, 245, 5);
    await a.click('[data-action="finish"]');
    await a.evaluate(() => { const b = document.querySelector('[data-finish="count"]'); b.click(); b.click(); b.click(); }); // rapid repeat taps
    await a.waitForSelector('.summary');
    await a.click('[data-action="summary-done"]');
    await synced(a);
    await a.evaluate(() => window.dispatchEvent(new Event('online')));
    await a.waitForTimeout(600);
    await synced(a);
    assert.equal(dbCount(`user_id = '${aliceId}' and status = 'completed' and deleted_at is null`), before + 1);
    assert.equal(await data(a, (store) => store.workouts().length), before + 1);
    assert.equal(dbCount(`user_id = '${aliceId}' and status = 'active' and deleted_at is null`), 0, 'no unfinished copy left behind');
  });

  await step('6 (cloud). Deleting on one device removes it — and its record — on the other', async () => {
    await tab(a, 'history');
    await a.locator('[data-workout]').first().click();
    await a.click('[data-action="workout-menu"]');
    await a.click('.menu-item:has-text("Delete workout")');
    await a.click('[data-confirm]');
    await synced(a);
    await a2.evaluate(() => window.dispatchEvent(new Event('online')));
    await until(a2, (store) => store.workouts().length === 2 && store.index('lb').exercises.get('squat').records.heaviest.weight === 235, 'the deletion and the recalculated record reach the second device');
  });

  await step('A password-reset link asks for a new password first, and the new password then works', async () => {
    const context = await device();
    let p = await open(context);
    await signUp(p, 'dave@example.com');
    await synced(p);
    const session = await p.evaluate(() => localStorage.getItem('fake-supabase-session'));
    await tab(p, 'profile');
    await p.click('[data-action="sign-out"]');
    await p.click('[data-confirm]');
    await p.waitForSelector('.auth-form');
    await signIn(p, 'dave@example.com', 'not-my-password');
    await p.waitForSelector('.auth-note.bad');
    // "open the emailed link": arrives signed in, with type=recovery in the address
    await p.evaluate((sess) => localStorage.setItem('fake-supabase-session', sess), session);
    await p.goto('about:blank');                       // an emailed link is always a fresh page load
    await p.goto(`${BASE}#access_token=test&type=recovery`);
    await p.waitForSelector('[data-new-password]');
    await p.waitForTimeout(1500);
    assert.ok(await p.locator('#app').isHidden(), 'the app stays hidden until a new password is chosen');
    assert.ok(await p.locator('[data-new-password]').isVisible(), 'the new-password form is still showing');
    const field = p.locator('[data-new-password] input');
    await field.fill('brand-new-pass');
    assert.equal(await field.getAttribute('type'), 'password');
    await p.click('[data-new-password] .pw-toggle');
    assert.equal(await field.getAttribute('type'), 'text', 'Show reveals what was typed');
    await p.click('[data-new-password] button[type="submit"]');
    await ready(p);
    assert.ok(await p.locator('#auth').isHidden());
    // old password no longer works, the new one does
    await tab(p, 'profile');
    await p.click('[data-action="sign-out"]');
    await p.click('[data-confirm]');
    await signIn(p, 'dave@example.com', 'correct-horse');
    await p.waitForSelector('.auth-note.bad');
    await signIn(p, 'dave@example.com', 'brand-new-pass');
    await ready(p);
    // change it again from Profile while signed in
    await tab(p, 'profile');
    await p.click('[data-action="change-password"]');
    await p.fill('.sheet input[name="new-password"]', 'third-password');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.toast >> text=Password updated');
    await p.click('[data-action="sign-out"]');
    await p.click('[data-confirm]');
    await signIn(p, 'dave@example.com', 'third-password');
    await ready(p);
    await context.close();
  });

  await step('Workouts logged before accounts were turned on can be moved into the account', async () => {
    const context = await browser.newContext(phone);
    let p = await open(context);                    // device-only mode first
    await ready(p);
    await startBlank(p);
    await renameWorkout(p, 'Garage Session');
    await addExercise(p, 'Deadlift');
    await logSet(p, 'Deadlift', 0, 315, 5);
    await finish(p);
    await p.click('[data-action="summary-done"]');
    await p.close();
    await context.exposeFunction('__srv', (req) => server.handle(req));   // now "deploy" with accounts on
    await context.addInitScript(CLIENT_SCRIPT);
    p = await open(context);
    await signUp(p, 'carol@example.com');
    await p.waitForSelector('.sheet-confirm');
    assert.match(await p.locator('.sheet-confirm').innerText(), /1 workout was saved on this device/);
    await p.click('[data-confirm]');
    await until(p, (store) => store.workouts().length === 1, 'the device-only workout is in the account store');
    await synced(p);
    assert.deepEqual(await data(p, (store) => store.workouts().map((w) => w.name)), ['Garage Session']);
    const carol = server.users.get('carol@example.com').id;
    assert.equal(dbCount(`user_id = '${carol}' and name = 'Garage Session' and status = 'completed'`), 1);
    assert.equal(await data(p, (store) => store.templates().length), 6, 'no duplicate starter templates');
    await context.close();
  });

  await phoneA.close(); await phoneA2.close(); await phoneB.close();
}

await browser.close();

const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (errors.length) console.log('Browser errors:\n  ' + [...new Set(errors)].join('\n  '));
process.exit(failed.length || errors.length ? 1 : 0);
