'use strict';

const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {loadApp} = require('./helpers/loadApp');

function setup() {
  return loadApp([
    path.join(__dirname, '..', 'lib', 'app.js'),
    path.join(__dirname, '..', 'lib', 'app.sync.js'),
    path.join(__dirname, '..', 'lib', 'app.filter.js'),
  ]);
}

// Scope stand-in whose rows carry a real DOM element, so show/hide is
// observable exactly as jq-repeat's __jq_$el makes it in a browser.
function makeScope($, rows, indexKey) {
  const scope = [];
  scope.__jqIndexKey = indexKey;
  scope.indexOf = function (key, value) {
    if (arguments.length === 1) throw new Error('single-arg indexOf is index-based');
    return scope.findIndex((r) => r && String(r[key]) === String(value));
  };
  scope.update = function (key, value, row) {
    const i = scope.indexOf(key, value);
    if (i >= 0) { row.__jq_$el = scope[i].__jq_$el; scope[i] = row; }
  };
  scope.remove = function (key, value) {
    const i = scope.indexOf(key, value);
    if (i >= 0) scope.splice(i, 1);
  };
  scope.unshift = function (row) {
    row.__jq_$el = $('<tr>').appendTo('body');
    Array.prototype.unshift.call(scope, row);
  };
  scope.getByKey = function (key, value) { return scope[scope.indexOf(key, value)]; };
  scope.replace = function (list) {
    scope.length = 0;
    list.forEach((r) => { r.__jq_$el = $('<tr>').appendTo('body'); Array.prototype.push.call(scope, r); });
  };
  rows.forEach((r) => scope.unshift(r));
  Array.prototype.reverse.call(scope);
  return scope;
}

function visible(scope) {
  return scope.filter((r) => r.__jq_$el.css('display') !== 'none').map((r) => r.id);
}

test('client mode hides non-matching rows without touching the scope', function () {
  const {$, app} = setup();
  const scope = makeScope($, [{id: 'a', host: 'alpha.example.com'}, {id: 'b', host: 'beta.example.com'}], 'id');
  $.scope = {hosts: scope};

  const filter = app.filter.bind('hosts', {fields: ['host']});
  filter.set('search', 'alpha');

  assert.strictEqual(filter.mode(), 'client');
  assert.strictEqual(scope.length, 2, 'rows stay in the scope; only visibility changes');
  assert.deepStrictEqual(visible(scope), ['a']);

  filter.clear();
  assert.deepStrictEqual(visible(scope), ['a', 'b'], 'clearing restores every row');
});

test('search matches across all configured fields, case-insensitively', function () {
  const {$, app} = setup();
  const scope = makeScope($, [
    {id: 'a', host: 'alpha.example.com', ip: '10.0.0.1'},
    {id: 'b', host: 'beta.example.com', ip: '10.0.0.2'},
  ], 'id');
  $.scope = {hosts: scope};
  const filter = app.filter.bind('hosts', {fields: ['host', 'ip']});

  filter.set('search', 'BETA');
  assert.deepStrictEqual(visible(scope), ['b'], 'case-insensitive');

  filter.set('search', '0.0.2');
  assert.deepStrictEqual(visible(scope), ['b'], 'matched on the second field');
});

test('nested field paths are searchable', function () {
  const {$, app} = setup();
  const scope = makeScope($, [
    {id: 'a', domain: {provider: 'cloudflare'}},
    {id: 'b', domain: {provider: 'porkbun'}},
  ], 'id');
  $.scope = {hosts: scope};

  app.filter.bind('hosts', {fields: ['domain.provider']}).set('search', 'pork');
  assert.deepStrictEqual(visible(scope), ['b']);
});

test('a row missing the searched field is excluded, not crashed on', function () {
  const {$, app} = setup();
  const scope = makeScope($, [{id: 'a', host: 'alpha'}, {id: 'b'}], 'id');
  $.scope = {hosts: scope};

  assert.doesNotThrow(function () {
    app.filter.bind('hosts', {fields: ['host']}).set('search', 'alpha');
  });
  assert.deepStrictEqual(visible(scope), ['a']);
});

test('facets combine with search as AND', function () {
  const {$, app} = setup();
  const scope = makeScope($, [
    {id: 'a', host: 'alpha', ssl: true},
    {id: 'b', host: 'alphabet', ssl: false},
    {id: 'c', host: 'gamma', ssl: true},
  ], 'id');
  $.scope = {hosts: scope};

  const filter = app.filter.bind('hosts', {
    fields: ['host'],
    facets: {ssl: function (row, value) { return row.ssl === value; }},
  });

  filter.set('search', 'alpha');
  assert.deepStrictEqual(visible(scope), ['a', 'b']);

  filter.set('ssl', true);
  assert.deepStrictEqual(visible(scope), ['a'], 'search AND facet');
});

test('the count readout reports shown vs total', function () {
  const {$, app} = setup();
  const scope = makeScope($, [{id: 'a', host: 'alpha'}, {id: 'b', host: 'beta'}], 'id');
  $.scope = {hosts: scope};
  const $count = $('<span id="count">').appendTo('body');

  const filter = app.filter.bind('hosts', {fields: ['host'], count: '#count'});
  filter.set('search', 'alpha');
  assert.strictEqual($count.text(), '1 of 2 shown');

  filter.clear();
  assert.strictEqual($count.text(), '2 shown');
});

test('a typed search box drives the filter', function () {
  const {$, app} = setup();
  const scope = makeScope($, [{id: 'a', host: 'alpha'}, {id: 'b', host: 'beta'}], 'id');
  $.scope = {hosts: scope};
  const $input = $('<input id="search">').appendTo('body');

  app.filter.bind('hosts', {fields: ['host'], input: '#search'});
  $input.val('beta').trigger('input');

  assert.deepStrictEqual(visible(scope), ['b']);
});

test('the set switches to server mode once it outgrows the threshold', function () {
  const {$, app} = setup();
  const scope = makeScope($, [{id: 'a', host: 'alpha'}], 'id');
  $.scope = {hosts: scope};

  const filter = app.filter.bind('hosts', {
    fields: ['host'],
    threshold: 10,
    fetch: function () { return $.Deferred().resolve({results: [], total: 0}).promise(); },
  });

  assert.strictEqual(filter.mode(), 'client', 'small set filters in the browser');
  filter.setTotal(5000);
  assert.strictEqual(filter.mode(), 'server', 'grown set switches by itself');
});

test('without a fetch() the filter stays client-side however big the set is', function () {
  const {$, app} = setup();
  const scope = makeScope($, [{id: 'a', host: 'alpha'}], 'id');
  $.scope = {hosts: scope};

  // Silently switching to a server mode with no way to query would filter
  // nothing at all; staying client-side degrades honestly instead.
  const filter = app.filter.bind('hosts', {fields: ['host'], threshold: 0});
  filter.setTotal(9999);
  assert.strictEqual(filter.mode(), 'client');
});

test('server mode queries with the filter state and replaces the scope', function (t, done) {
  const {$, app} = setup();
  const scope = makeScope($, [], 'id');
  $.scope = {hosts: scope};
  let seen = null;

  const filter = app.filter.bind('hosts', {
    fields: ['host'],
    threshold: 0,
    debounce: 1,
    fetch: function (state) {
      seen = state;
      return $.Deferred().resolve({results: [{id: 'z', host: 'zeta'}], total: 900}).promise();
    },
  });
  filter.setTotal(900);
  filter.set('search', 'zet');

  setTimeout(function () {
    assert.strictEqual(filter.mode(), 'server');
    assert.strictEqual(seen.search, 'zet', 'search text sent to the server');
    assert.deepStrictEqual(scope.map((r) => r.id), ['z'], 'scope replaced with results');
    done();
  }, 20);
});

test('a superseded server response does not overwrite a newer one', function (t, done) {
  const {$, app} = setup();
  const scope = makeScope($, [], 'id');
  $.scope = {hosts: scope};

  const deferreds = [];
  const filter = app.filter.bind('hosts', {
    fields: ['host'],
    threshold: 0,
    debounce: 1,
    fetch: function () { const d = $.Deferred(); deferreds.push(d); return d.promise(); },
  });
  filter.setTotal(900);

  filter.set('search', 'a');
  setTimeout(function () {
    filter.set('search', 'ab');
    setTimeout(function () {
      // Two requests are in flight; the slow first one lands last.
      assert.strictEqual(deferreds.length, 2, 'both keystrokes queried');
      deferreds[1].resolve({results: [{id: 'new'}], total: 1});
      deferreds[0].resolve({results: [{id: 'stale'}], total: 1});
      // jQuery 4 fires .done() asynchronously, so let both land first.
      setTimeout(function () {
        assert.deepStrictEqual(scope.map((r) => r.id), ['new'], 'stale response ignored');
        done();
      }, 10);
    }, 10);
  }, 10);
});

test('live(): a socket insert that matches the filter shows, one that does not stays hidden', function () {
  const {$, app} = setup();
  const scope = makeScope($, [{id: 'a', host: 'alpha'}], 'id');
  $.scope = {hosts: scope};

  const {filter} = app.filter.live('hosts', 'Host', {fields: ['host'], reveal: false});
  filter.set('search', 'alpha');

  // Another user creates a matching host.
  app.pubsub.publish('model:Host:create', {model: 'Host', action: 'create', pk: 'b', data: {id: 'b', host: 'alpha2'}});
  assert.ok(visible(scope).indexOf('b') !== -1, 'matching live row is visible');

  // And a non-matching one.
  app.pubsub.publish('model:Host:create', {model: 'Host', action: 'create', pk: 'c', data: {id: 'c', host: 'zeta'}});
  assert.strictEqual(visible(scope).indexOf('c'), -1, 'non-matching live row stays hidden');
  assert.ok(scope.some((r) => r.id === 'c'), 'but it is still in the scope, ready to show when the filter clears');
});

test('live(): clearing the filter reveals rows that arrived while filtered', function () {
  const {$, app} = setup();
  const scope = makeScope($, [{id: 'a', host: 'alpha'}], 'id');
  $.scope = {hosts: scope};

  const {filter} = app.filter.live('hosts', 'Host', {fields: ['host'], reveal: false});
  filter.set('search', 'alpha');
  app.pubsub.publish('model:Host:create', {model: 'Host', action: 'create', pk: 'c', data: {id: 'c', host: 'zeta'}});

  filter.clear();
  assert.deepStrictEqual(visible(scope).sort(), ['a', 'c']);
});
