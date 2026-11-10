// Minimal DOM toolkit: element builder, icons, bottom sheets, confirm dialogs, toasts.

const SVG_NS = 'http://www.w3.org/2000/svg';

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

function setProps(el, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
}

/** h('button', { class: 'btn', onClick }, 'Save') */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) setProps(el, props);
  append(el, kids);
  return el;
}

export function svg(tag, props, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) setProps(el, props);
  append(el, kids);
  return el;
}

/** Append children like h() does: skips null/false, flattens arrays. */
export function add(el, ...kids) { append(el, kids); return el; }

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const ICONS = {
  home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6.5 10v9.5h11V10"/>',
  dumbbell: '<path d="M3 9.5v5M6.5 7v10M17.5 7v10M21 9.5v5M6.5 12h11"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5v4h4"/><path d="M12 8v4.5l3 1.8"/>',
  chart: '<path d="M4 19.5h16"/><path d="M5 15.5l4.5-5 3.5 3L19 6.5"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20c.9-3.6 3.8-5.4 7.2-5.4s6.3 1.8 7.2 5.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  next: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
  pause: '<path d="M8.5 6v12M15.5 6v12"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  timer: '<circle cx="12" cy="13.5" r="6.5"/><path d="M12 10v3.5l2 1.5M9.5 3.5h5"/>',
  repeat: '<path d="M5 9.5V8a2 2 0 0 1 2-2h11"/><path d="m15.5 3 3 3-3 3"/><path d="M19 14.5V16a2 2 0 0 1-2 2H6"/><path d="m8.5 21-3-3 3-3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  trash: '<path d="M5 7h14M9.5 7V4.8h5V7M7 7l.8 12.2h8.4L17 7"/>',
  edit: '<path d="M5 19l1-4L16.5 4.5l3 3L9 18z"/>',
  up: '<path d="M6 14.5 12 8.5l6 6"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  note: '<path d="M6 4.5h12v15H6z"/><path d="M9 9h6M9 12.5h6M9 16h3.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V5a.5.5 0 0 0-.5-.5H5a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h3.5"/>',
  medal: '<path d="M12 3.2l2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.1 6.9 19l1.1-5.8-4.3-4 5.8-.7z" fill="currentColor" stroke-width="1.4"/>',
  cloud: '<path d="M7 18.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 9.5a4.5 4.5 0 0 1 .5 9z"/>',
  link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1-1"/>',
  swap: '<path d="M4.5 8.5h14M15 5l3.5 3.5L15 12M19.5 15.5h-14M9 12l-3.5 3.5L9 19"/>',
};

export function icon(name, size = 22) {
  const el = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' });
  el.innerHTML = ICONS[name] || '';
  return el;
}

// ---------- bottom sheets ----------

const sheetRoot = () => document.getElementById('overlays');
const openSheets = [];

/**
 * openSheet({ title, body, full }) → { close, el }
 * `body` is a node or a function (close) => node.
 */
export function openSheet({ title, body, full = false, onClose, dismissable = true, className = '' }) {
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    const i = openSheets.indexOf(api); if (i >= 0) openSheets.splice(i, 1);
    backdrop.remove();
    if (lastFocus && lastFocus.isConnected) { try { lastFocus.focus({ preventScroll: true }); } catch { /* ignore */ } }
    if (onClose) onClose(result);
  };
  const lastFocus = document.activeElement;
  const content = h('div', { class: 'sheet-body' });
  const sheet = h('div', { class: `sheet ${full ? 'sheet-full' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
    h('div', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title' }, title || ''),
      dismissable && h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: () => close() }, icon('close'))),
    content);
  const backdrop = h('div', { class: 'backdrop', onClick: (e) => { if (e.target === backdrop && dismissable) close(); } }, sheet);
  const api = { close, el: sheet, content };
  append(content, [typeof body === 'function' ? body(close) : body]);
  sheetRoot().append(backdrop);
  openSheets.push(api);
  return api;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openSheets.length) openSheets[openSheets.length - 1].close();
});

export function closeAllSheets() { [...openSheets].forEach((s) => s.close()); }

/** A list of actions in a sheet. items: [{ label, icon, danger, onSelect }] */
export function actionSheet(title, items) {
  const s = openSheet({
    title,
    body: (close) => h('div', { class: 'menu' }, items.filter(Boolean).map((it) =>
      h('button', { class: `menu-item ${it.danger ? 'danger' : ''}`, onClick: () => { close(); it.onSelect(); } },
        it.icon && icon(it.icon, 20), h('span', null, it.label)))),
  });
  return s;
}

/** Promise<boolean>. Built in-page because browser confirm() is blocked in some hosts. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v, close) => { answered = true; close(); resolve(v); };
    openSheet({
      title,
      className: 'sheet-confirm',
      onClose: () => { if (!answered) resolve(false); },
      body: (close) => h('div', null,
        message && h('p', { class: 'sheet-text' }, message),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-quiet', onClick: () => answer(false, close) }, cancelLabel),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, 'data-confirm': '', onClick: () => answer(true, close) }, confirmLabel))),
    });
  });
}

/** Ask for one line of text. Resolves to the trimmed string, or null if cancelled. */
export function promptDialog({ title, label, value = '', confirmLabel = 'Save', placeholder = '' }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title,
      onClose: () => { if (!answered) resolve(null); },
      body: (close) => {
        const input = h('input', { class: 'field', type: 'text', value, placeholder, 'aria-label': label || title, autocomplete: 'off', maxlength: '60' });
        const submit = () => { const v = input.value.trim(); if (!v) { input.focus(); return; } answered = true; close(); resolve(v); };
        setTimeout(() => { input.focus(); input.select(); }, 50);
        return h('form', { onSubmit: (e) => { e.preventDefault(); submit(); } },
          input,
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => close() }, 'Cancel'),
            h('button', { class: 'btn btn-primary', type: 'submit' }, confirmLabel)));
      },
    });
  });
}

// ---------- toasts ----------

export function toast(message, { kind = 'info', title = '', duration = 3200 } = {}) {
  const root = document.getElementById('toasts');
  // one plain message at a time; a personal-record toast may sit alongside it
  if (kind !== 'pr') root.querySelectorAll('.toast:not(.toast-pr)').forEach((n) => n.remove());
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' },
    kind === 'pr' && h('span', { class: 'toast-icon' }, icon('medal', 22)),
    h('div', null, title && h('div', { class: 'toast-title' }, title), h('div', { class: 'toast-msg' }, message)));
  root.append(el);
  const remove = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 220); };
  const t = setTimeout(remove, duration);
  el.addEventListener('click', () => { clearTimeout(t); remove(); });
  return el;
}

/** Segmented control. options: [{ id, label }] */
export function segmented(options, current, onChange, { label = '', small = false } = {}) {
  const el = h('div', { class: `seg ${small ? 'seg-small' : ''}`, role: 'tablist', 'aria-label': label });
  const draw = (cur) => {
    clear(el);
    for (const o of options) {
      el.append(h('button', { class: `seg-item ${o.id === cur ? 'on' : ''}`, role: 'tab', 'aria-selected': o.id === cur ? 'true' : 'false', type: 'button', onClick: () => { if (o.id !== cur) { draw(o.id); onChange(o.id); } } }, o.label));
    }
  };
  draw(current);
  return el;
}
