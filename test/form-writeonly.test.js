'use strict';

const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {loadApp} = require('./helpers/loadApp');

function setup() {
  return loadApp([
    path.join(__dirname, '..', 'lib', 'app.js'),
    path.join(__dirname, '..', 'lib', 'app.messages.js'),
    path.join(__dirname, '..', 'lib', 'app.render.js'),
  ]);
}

function userSchema($) {
  return {
    pk: 'id',
    display: {titleField: 'userName'},
    fields: {
      id: {name: 'id', primaryKey: true, isPrivate: false, display: {}},
      userName: {name: 'userName', htmlType: 'text', isRequired: true, isPrivate: false, display: {}},
      // Write-only, like a password-bcrypt field: private on output, settable on input.
      password: {name: 'password', htmlType: 'password', isRequired: true, isPrivate: true, writeOnly: true, display: {}},
    },
  };
}

function stubModel($, app, editData) {
  app.model = {
    schema: function() { return null; },
    list: function() { return $.Deferred().resolve({results: []}).promise(); },
    get: function() { return $.Deferred().resolve({data: editData || {}}).promise(); },
  };
}

test('create form renders a required password input for the write-only field', function() {
  const {$, app} = setup();
  stubModel($, app);
  $('body').html('<div id="t"></div>');

  app.render.form($('#t'), 'User', userSchema($), null);

  const $pw = $('input[name="password"]');
  assert.strictEqual($pw.length, 1, 'password field is present (was missing before the fix)');
  assert.strictEqual($pw.attr('type'), 'password');
  assert.ok($pw.is('[required]'), 'required when creating');
});

test('edit form shows the password field but not required (blank keeps current)', function() {
  const {$, app} = setup();
  stubModel($, app, {id: '1', userName: 'admin'}); // note: no password returned
  $('body').html('<div id="t"></div>');

  app.render.form($('#t'), 'User', userSchema($), '1');

  const $pw = $('input[name="password"]');
  assert.strictEqual($pw.length, 1, 'password field present on edit');
  assert.strictEqual($pw.is('[required]'), false, 'not required on edit');
  assert.strictEqual($pw.val(), '', 'password renders blank (never sent back)');
});
