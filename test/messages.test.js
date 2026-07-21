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
