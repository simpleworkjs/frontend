'use strict';

const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {loadApp} = require('./helpers/loadApp');

function setup() {
  return loadApp([
    path.join(__dirname, '..', 'lib', 'app.validate.js'),
  ]);
}

test('validateField: eq rule matches against another field by name', function() {
  const {$} = setup();
  $('body').html(`
    <form>
      <div class="form-group"><input name="password" value="hunter2"><b class="invalid-feedback"></b></div>
      <div class="form-group"><input name="confirm" value="hunter2" validate="eq:password"><b class="invalid-feedback"></b></div>
    </form>
  `);

  assert.strictEqual($('[name=confirm]').validateField(), true);
  assert.ok($('[name=confirm]').hasClass('is-valid'));

  $('[name=confirm]').val('nope');
  assert.strictEqual($('[name=confirm]').validateField(), false);
  assert.ok($('[name=confirm]').hasClass('is-invalid'));
});

test('validateField: password rule enforces length and character-class mix', function() {
  const {$} = setup();
  $('body').html(`
    <div class="form-group"><input name="pw" validate="password"><b class="invalid-feedback"></b></div>
  `);
  const $pw = $('[name=pw]');

  $pw.val('short');
  assert.strictEqual($pw.validateField(), false);

  $pw.val('averylongpassphrase');
  assert.strictEqual($pw.validateField(), true);

  $pw.val('Ab1!');
  assert.strictEqual($pw.validateField(), false);

  $pw.val('Ab1!fghi');
  assert.strictEqual($pw.validateField(), true);
});

test('validate(): runs every [validate] field and reports overall pass/fail', function() {
  const {$} = setup();
  $('body').html(`
    <form>
      <div class="form-group"><input name="user" value="not valid!" validate="user"><b class="invalid-feedback"></b></div>
    </form>
  `);

  assert.strictEqual($('form').validate(), false);

  $('[name=user]').val('valid.user');
  assert.strictEqual($('form').validate(), true);
});

test('$.validateSettings() registers app-specific rules alongside the built-ins', function() {
  const {$} = setup();
  $.validateSettings({
    rule: {
      evenLength: function(value){
        if (String(value).length % 2 !== 0) return 'Must be even length';
      }
    }
  });
  $('body').html(`
    <div class="form-group"><input name="code" value="abc" validate="evenLength"><b class="invalid-feedback"></b></div>
  `);

  assert.strictEqual($('[name=code]').validateField(), false);
  $('[name=code]').val('abcd');
  assert.strictEqual($('[name=code]').validateField(), true);
});
