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

test('_reload fetches the full list and replaces the bound scope', function() {
  // Live create/update/delete all funnel through _reload, which re-fetches the
  // list and hands it to jq-repeat's replace() (the reliable render path).
  const {$, app} = setup();
  const replaced = [];
  $.scope = {Task: {replace: function(list) { replaced.push(list); }}};
  const results = [{id: '1', title: 'a'}, {id: '2', title: 'b'}];
  app.model = {list: function() { return $.Deferred().resolve({results: results}).promise(); }};

  app.render._reload('Task', 'Task');

  assert.deepStrictEqual(replaced, [results], 'scope.replace called once with the full list');
});

test('_reload replaces the correctly-named scope (e.g. the cards scope)', function() {
  const {$, app} = setup();
  const calls = {};
  $.scope = {
    Task: {replace: function(l) { calls.table = l; }},
    'Task-cards': {replace: function(l) { calls.cards = l; }},
  };
  app.model = {list: function() { return $.Deferred().resolve({results: [{id: '1'}]}).promise(); }};

  app.render._reload('Task', 'Task-cards');

  assert.strictEqual(calls.table, undefined, 'table scope untouched');
  assert.deepStrictEqual(calls.cards, [{id: '1'}], 'cards scope replaced');
});

test('_reload is a no-op when the scope is not registered yet', function() {
  const {$, app} = setup();
  $.scope = {};
  app.model = {list: function() { return $.Deferred().resolve({results: [{id: '1'}]}).promise(); }};
  assert.doesNotThrow(function() { app.render._reload('Task', 'Task'); });
});
