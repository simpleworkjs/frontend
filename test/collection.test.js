'use strict';

const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {loadApp} = require('./helpers/loadApp');

function setup() {
  return loadApp([
    path.join(__dirname, '..', 'lib', 'app.js'),
    path.join(__dirname, '..', 'lib', 'app.messages.js'),
    path.join(__dirname, '..', 'lib', 'app.modal.js'),
    path.join(__dirname, '..', 'lib', 'app.render.js'),
  ]);
}

test('app.modal opens with a title/body and closes', function() {
  const {window, $, app} = setup();
  const $body = app.modal.open({title: 'Hello', bodyHtml: '<p id="x">hi</p>'});
  const $m = $('#sw-modal');
  assert.strictEqual($m.length, 1, 'modal element created');
  assert.strictEqual($m.find('.modal-title').text(), 'Hello');
  assert.strictEqual($body.find('#x').length, 1, 'body html injected');
  assert.ok($m[0].classList.contains('show'), 'shown');

  app.modal.close();
  assert.ok(!$m[0].classList.contains('show'), 'hidden');
});

test('form in modal mode calls onSuccess and does not navigate', function() {
  const {window, $, app} = setup();
  const schema = {
    pk: 'id',
    display: {name: 'Task', titleField: 'title'},
    fields: {
      id: {name: 'id', primaryKey: true, isPrivate: false, display: {}},
      title: {name: 'title', htmlType: 'text', isRequired: true, isPrivate: false, display: {}},
    },
  };
  let created = null;
  app.model = {
    schema: function() { return schema; },
    list: function() { return $.Deferred().resolve({results: []}).promise(); },
    get: function() { return $.Deferred().resolve({data: {}}).promise(); },
    create: function(name, data) { created = data; return $.Deferred().resolve({data: {id: '1'}}).promise(); },
  };

  const hrefBefore = window.location.href;
  let onSuccessCalled = false;

  $('body').html('<div id="t"></div>');
  app.render.form($('#t'), 'Task', schema, null, {
    modal: true,
    onSuccess: function() { onSuccessCalled = true; },
  });

  $('#t input[name="title"]').val('Buy milk');
  $('#t form').trigger('submit');

  assert.ok(created, 'create was called');
  assert.strictEqual(created.title, 'Buy milk', 'create called with form data');
  assert.strictEqual(onSuccessCalled, true, 'onSuccess invoked in modal mode');
  assert.strictEqual(window.location.href, hrefBefore, 'did not navigate away');
});

test('_updateFooter renders the range and toggles prev/next', function() {
  const {$, app} = setup();
  $('body').html(
    '<div id="c">' +
      '<small class="sw-page-info"></small>' +
      '<button class="sw-prev"></button><button class="sw-next"></button>' +
    '</div>'
  );
  const $el = $('#c');

  // Middle page: both enabled.
  app.render._updateFooter($el, {page: 2, pageSize: 20, total: 55, pageCount: 3});
  assert.strictEqual($el.find('.sw-page-info').text(), 'Showing 21–40 of 55');
  assert.strictEqual($el.find('.sw-prev').prop('disabled'), false);
  assert.strictEqual($el.find('.sw-next').prop('disabled'), false);

  // First page of one: both disabled; range clamps to total.
  app.render._updateFooter($el, {page: 1, pageSize: 20, total: 7, pageCount: 1});
  assert.strictEqual($el.find('.sw-page-info').text(), 'Showing 1–7 of 7');
  assert.strictEqual($el.find('.sw-prev').prop('disabled'), true);
  assert.strictEqual($el.find('.sw-next').prop('disabled'), true);

  // Empty collection.
  app.render._updateFooter($el, {page: 1, pageSize: 20, total: 0, pageCount: 1});
  assert.strictEqual($el.find('.sw-page-info').text(), 'Showing 0–0 of 0');
});
