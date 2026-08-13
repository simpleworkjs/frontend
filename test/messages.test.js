'use strict';

const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {loadApp} = require('./helpers/loadApp');

function setup() {
  return loadApp([
    path.join(__dirname, '..', 'lib', 'app.js'),
    path.join(__dirname, '..', 'lib', 'app.messages.js'),
  ]);
}

const PAYLOAD = '<img src=x onerror=alert(1)>';

test('toast() escapes an untrusted message instead of injecting it as HTML', function() {
  const {window, $, app} = setup();
  app.messages.toast(PAYLOAD, 'danger');

  const body = $('.toast-body')[0];
  // Regression test: previously `${message}` was interpolated directly into
  // the toast template, so this payload would create a live <img> element
  // (and fire onerror) instead of appearing as literal text.
  assert.strictEqual(window.document.querySelectorAll('.toast-body img').length, 0);
  assert.ok(body.textContent.includes('<img src=x onerror=alert(1)>'));
});

test('action() escapes an untrusted message when rendering into an .actionMessage target', function() {
  const {window, $, app} = setup();
  $('body').html('<div class="card"><div class="actionMessage"></div></div>');
  const $card = $('.card');

  app.messages.action(PAYLOAD, $card, 'danger');

  assert.strictEqual(window.document.querySelectorAll('.actionMessage img').length, 0);
  assert.ok($('.actionMessage').text().includes('<img src=x onerror=alert(1)>'));
});

test('confirm() escapes an untrusted message but keeps its own Confirm/Cancel buttons intact', async function() {
  const {window, $, app} = setup();
  $('body').html('<div class="card"><div class="actionMessage"></div></div>');
  const $card = $('.card');

  const pending = app.messages.confirm(PAYLOAD, $card, 'danger');

  assert.strictEqual(window.document.querySelectorAll('.actionMessage img').length, 0);
  assert.ok($('.actionMessage').text().includes('<img src=x onerror=alert(1)>'));
  // The dialog's own trusted markup (Confirm/Cancel buttons) must still
  // render as real elements, proving we didn't just escape everything.
  assert.strictEqual($('.actionMessage button[data-confirm="true"]').length, 1);

  $('.actionMessage button[data-confirm="true"]').trigger('click');
  const confirmed = await pending;
  assert.strictEqual(confirmed, true);
});

test('action() falls back to an escaped toast when there is no .actionMessage target', function() {
  const {window, $, app} = setup();
  $('body').html('<div class="card"></div>');

  app.messages.action(PAYLOAD, $('.card'), 'danger');

  assert.strictEqual(window.document.querySelectorAll('.toast-body img').length, 0);
  assert.ok($('.toast-body').text().includes('<img src=x onerror=alert(1)>'));
});

test('confirm() falls back to a toast instead of throwing when called with a null target', async function() {
  // Regression test: a page with no inline .actionMessage calling
  // `app.messages.confirm(msg, null, 'warning')` (a documented, commonly used
  // form -- see e.g. theta-suite's ldif_import.ejs) used to throw
  // "Cannot read properties of null (reading 'closest')" from inside
  // renderActionHtml before the click handler was ever wired up, so the
  // dialog never appeared and the returned promise never resolved.
  const {window, $, app} = setup();
  $('body').html('');

  const pending = app.messages.confirm(PAYLOAD, null, 'warning');

  assert.strictEqual(window.document.querySelectorAll('.toast-body img').length, 0);
  assert.ok($('.toast-body').text().includes('<img src=x onerror=alert(1)>'));
  assert.strictEqual($('.toast-body button[data-confirm="true"]').length, 1);

  $('.toast-body button[data-confirm="true"]').trigger('click');
  const confirmed = await pending;
  assert.strictEqual(confirmed, true);
});

test('confirm() falls back to a toast when called with no target argument at all', async function() {
  const {window, $, app} = setup();
  $('body').html('');

  const pending = app.messages.confirm('Are you sure?');

  assert.strictEqual($('.toast-body').length, 1);
  $('.toast-body button[data-confirm="true"]').trigger('click');
  assert.strictEqual(await pending, true);
});
