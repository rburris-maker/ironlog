// Formatting helpers. Dates are stored in UTC and always displayed in the device's local time zone.

export function fmtNum(n, maxDecimals = 2) {
  if (n == null || !Number.isFinite(n)) return '';
  const f = 10 ** maxDecimals;
  return String(Math.round(n * f) / f);
}

export function fmtInt(n) {
  return Math.round(n || 0).toLocaleString();
}

export const fmtWeight = (n, unit) => `${fmtNum(n)} ${unit}`;
export const fmtSet = (weight, reps) => `${fmtNum(weight)} × ${reps}`;
export const fmtVolume = (n, unit) => `${fmtInt(n)} ${unit}`;

const pad = (n) => String(n).padStart(2, '0');

/** 4354 → "1:12:34" (always shows hours, minutes and seconds). */
export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 95 → "1:35" for the rest countdown. */
export function fmtCountdown(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds || 0));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** 4354 → "1 hr 12 min 34 sec". */
export function fmtDurationLong(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts = [];
  if (h) parts.push(`${h} hr`);
  if (h || m) parts.push(`${m} min`);
  parts.push(`${sec} sec`);
  return parts.join(' ');
}

/** 4354 → "1h 12m"; 754 → "12m". */
export function fmtDurationShort(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (h) return `${h}h ${pad(m)}m`;
  return `${Math.max(m, s > 0 ? 1 : 0)}m`;
}

export function fmtHours(totalSeconds) {
  const h = (totalSeconds || 0) / 3600;
  if (h < 10) return `${Math.round(h * 10) / 10}`;
  return fmtInt(h);
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function fmtDate(iso, { weekday = true, relative = true } = {}) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  if (relative) {
    if (sameDay(d, now)) return 'Today';
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday';
  }
  const opts = { month: 'short', day: 'numeric' };
  if (weekday) opts.weekday = 'short';
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export function fmtDateFull(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtMonth(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function fmtShortDate(d) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local "YYYY-MM-DD" for date filters. */
export function localDay(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseNum(text) {
  if (text == null) return null;
  const t = String(text).replace(',', '.').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
