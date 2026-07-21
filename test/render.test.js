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

const PAYLOAD_ID = 'x"><script>alert(1)</script>';
const PAYLOAD_TITLE = '<script>alert(2)</script>';

function fakeDeferred($, value) {
  return $.Deferred().resolve(value).promise();
}

test('form() escapes related-record option value/text instead of injecting raw HTML (dropdown XSS fix)', function() {
  const {window, $, app} = setup();

  // Stand in for app.model without making real AJAX calls.
  app.model = {
    schema: function(name) {
      if (name === 'User') return {pk: 'id', display: {titleField: 'title'}};
    },
    list: function(modelName) {
      return fakeDeferred($, {results: [{id: PAYLOAD_ID, title: PAYLOAD_TITLE}]});
    },
    get: function() { return fakeDeferred($, {data: {}}); },
  };

  const schema = {
    pk: 'id',
    display: {titleField: 'title'},
    fields: {
      id: {name: 'id', primaryKey: true, isPrivate: false, display: {}},
      owner: {
        name: 'owner', primaryKey: false, isPrivate: false, display: {},
        references: {type: 'hasOne', model: 'User'}, foreignKey: 'ownerId',
      },
    },
  };

  $('body').html('<div id="target"></div>');
  app.render.form($('#target'), 'Task', schema, null);

  const $select = $('select[data-references="User"]');
  assert.strictEqual($select.length, 1);

  // No live <script> element must have been created from the row data.
  assert.strictEqual(window.document.querySelectorAll('select[data-references] script').length, 0);

  const optionHtml = $select.html();
  assert.ok(optionHtml.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), 'option text is escaped');
  assert.ok(!optionHtml.includes('<script>alert(2)</script>'), 'raw script tag must not appear');

  const $evilOption = $select.find('option').last();
  // The value attribute must carry the escaped id, not one that breaks out
  // of the attribute (e.g. via an unescaped `">`).
  assert.strictEqual($evilOption.attr('value'), PAYLOAD_ID);
});

test('_teardown removes previously attached pubsub subscriptions', function() {
  const {$, app} = setup();
  $('body').html('<div id="target"></div>');
  const $el = $('#target');

  let removed = 0;
  const subs = [
    {remove: () => { removed++; }},
    {remove: () => { removed++; }},
  ];
  $el.data('sw-subs', subs);

  app.render._teardown($el);

  assert.strictEqual(removed, 2);
  assert.strictEqual($el.data('sw-subs'), undefined);
});
