// Sign in / create account / reset password.

import { h, clear, segmented } from '../lib/dom.js';
import { APP_NAME } from '../../config.js';
import { friendlyAuthError } from '../core/auth.js';

/** Wrap a password input with a Show / Hide button, so a typo can be seen before it is saved. */
export function passwordField(input) {
  const toggle = h('button', { class: 'pw-toggle', type: 'button', 'aria-label': 'Show password', 'aria-pressed': 'false', onClick: () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  } }, 'Show');
  return h('div', { class: 'pw' }, input, toggle);
}

/** Render the sign-in screen into #auth. `client` is the Supabase client. */
export function showAuth(client, { message = '' } = {}) {
  const root = document.getElementById('auth');
  root.hidden = false;
  document.getElementById('app').hidden = true;
  let mode = 'signin';

  const draw = (note = message, noteKind = 'info') => {
    clear(root);
    const email = h('input', { class: 'field field-lg', type: 'email', name: 'email', autocomplete: 'email', placeholder: 'Email', 'aria-label': 'Email', required: true, inputmode: 'email' });
    const password = h('input', { class: 'field field-lg', type: 'password', name: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', placeholder: mode === 'signup' ? 'Password (6+ characters)' : 'Password', 'aria-label': 'Password', required: true, minlength: '6' });
    const status = h('p', { class: `auth-note ${noteKind}`, role: 'status' }, note);
    const submit = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Email me a reset link' : 'Sign in');
    const say = (text, kind = 'info') => { status.textContent = text; status.className = `auth-note ${kind}`; };

    const onSubmit = async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      say(mode === 'reset' ? 'Sending…' : mode === 'signup' ? 'Creating your account…' : 'Signing in…');
      try {
        if (mode === 'reset') {
          const { error } = await client.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
          if (error) throw error;
          say('If that email has an account, a reset link is on its way.', 'good');
        } else if (mode === 'signup') {
          const { data, error } = await client.auth.signUp({ email: email.value.trim(), password: password.value });
          if (error) throw error;
          if (!data.session) say('Almost done — open the confirmation link we just emailed you, then sign in.', 'good');
        } else {
          const { error } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
          if (error) throw error;
        }
      } catch (err) {
        say(friendlyAuthError(err), 'bad');
      } finally {
        submit.disabled = false;
      }
    };

    root.append(h('div', { class: 'auth-card' },
      h('div', { class: 'wordmark wordmark-lg' }, APP_NAME),
      h('p', { class: 'auth-tag' }, 'Log every set. See what you lifted last time. Beat it.'),
      mode !== 'reset' && segmented([{ id: 'signin', label: 'Sign in' }, { id: 'signup', label: 'Create account' }], mode, (id) => { mode = id; draw(''); }, { label: 'Account' }),
      h('form', { class: 'auth-form', onSubmit },
        email,
        mode !== 'reset' && passwordField(password),
        submit,
        status),
      mode === 'reset'
        ? h('button', { class: 'link', type: 'button', onClick: () => { mode = 'signin'; draw(''); } }, 'Back to sign in')
        : h('button', { class: 'link', type: 'button', onClick: () => { mode = 'reset'; draw(''); } }, 'Forgot your password?')));
  };
  draw();
}

/** Shown after following a password-reset link: the user must choose a new password before going on. */
export function showNewPassword(client, done) {
  const root = document.getElementById('auth');
  root.hidden = false;
  document.getElementById('app').hidden = true;
  if (root.querySelector('[data-new-password]')) return; // already showing
  clear(root);
  const password = h('input', { class: 'field field-lg', type: 'password', name: 'new-password', autocomplete: 'new-password', placeholder: 'New password (6+ characters)', 'aria-label': 'New password', required: true, minlength: '6' });
  const status = h('p', { class: 'auth-note', role: 'status' });
  const submit = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Save password');
  root.append(h('div', { class: 'auth-card', 'data-new-password': '' },
    h('div', { class: 'wordmark wordmark-lg' }, APP_NAME),
    h('p', { class: 'auth-tag' }, 'Choose a new password. Tap Show to check it before saving.'),
    h('form', { class: 'auth-form', onSubmit: async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      if (password.value.length < 6) { status.textContent = 'Use at least 6 characters.'; status.className = 'auth-note bad'; return; }
      submit.disabled = true;
      status.textContent = 'Saving…'; status.className = 'auth-note';
      try {
        const { error } = await client.auth.updateUser({ password: password.value });
        if (error) throw error;
        await done();
      } catch (err) {
        status.textContent = friendlyAuthError(err); status.className = 'auth-note bad';
        submit.disabled = false;
      }
    } }, passwordField(password), submit, status)));
}

export function hideAuth() {
  const root = document.getElementById('auth');
  root.hidden = true;
  clear(root);
  document.getElementById('app').hidden = false;
}

export function showFatal(title, text, actionLabel, action) {
  const root = document.getElementById('auth');
  root.hidden = false;
  document.getElementById('app').hidden = true;
  clear(root);
  root.append(h('div', { class: 'auth-card' },
    h('div', { class: 'wordmark wordmark-lg' }, APP_NAME),
    h('h1', { class: 'auth-title' }, title),
    h('p', { class: 'auth-tag' }, text),
    actionLabel && h('button', { class: 'btn btn-primary btn-block btn-lg', onClick: action }, actionLabel)));
}
