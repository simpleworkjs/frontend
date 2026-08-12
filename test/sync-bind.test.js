'use strict';

const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {loadApp} = require('./helpers/loadApp');

// A stand-in for a jq-repeat scope: same method surface (indexOf/update/
// remove/unshift/getByKey) and the same String()-coercing key comparison, so
// these tests exercise the argument forms bind() actually emits.
function makeScope(rows, indexKey) {
  const scope = rows.slice();
  scope.__jqIndexKey = indexKey;
  scope.calls = [];
  scope.indexOf = function (key, value) {
    if (arguments.length === 1) throw new Error('single-arg indexOf is index-based; bind() must not use it');
    return scope.findIndex((r) => r && String(r[key]) === String(value));
  };
  scope.update = function (key, value, row) {
    scope.calls.push(['update', value]);
    const i = scope.indexOf(key, value);
    if (i >= 0) scope[i] = row;
  };
  scope.remove = function (key, value) {
    scope.calls.push(['remove', value]);
    const i = scope.indexOf(key, value);
    if (i >= 0) scope.splice(i, 1);
  };
  scope.unshift = function (row) {
    scope.calls.push(['unshift', row[indexKey]]);
    Array.prototype.unshift.call(scope, row);
  };
  scope.getByKey = function (key, value) {
    return scope[scope.indexOf(key, value)];
  };
  return scope;
}

// The framework stack: app.js provides app.pubsub + app.util, and events carry
// a self-describing {model, action, pk, data} payload.
function frameworkApp() {
  const ctx = loadApp([
    path.join(__dirname, '..', 'lib', 'app.js'),
    path.join(__dirname, '..', 'lib', 'app.sync.js'),
  ]);
  ctx.emit = function (model, action, pk, data) {
    ctx.app.pubsub.publish('model:' + model + ':' + action, {model, action, pk, data});
  };
  return ctx;
}

// The theta42 stack: a minimal app-base-shaped bus (RegExp subscribe, no
// unsubscribe handle) with pk-in-topic and the bare record as payload.
function appBaseApp() {
  const ctx = loadApp([]);
  const {window} = ctx;
  window.eval(`
    var app = {};
    app.topics = {};
    app.subscribe = function(topic, listener){
      if (topic instanceof RegExp) { listener.match = topic; topic = '__REGEX__'; }
      if (!app.topics[topic]) app.topics[topic] = [];
      app.topics[topic].push(listener);
    };
    app.publish = function(topic, data){
      var matches = (app.topics[topic] || []).slice();
      (app.topics['__REGEX__'] || []).forEach(function(l){
        if (topic.match(l.match)) matches.push(l);
      });
      matches.forEach(function(l){ l(data, topic); });
    };
  `);
  const fs = require('fs');
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'lib', 'app.sync.js'), 'utf8'));
  ctx.app = window.app;
  ctx.emit = function (model, action, pk, record) {
    window.app.publish('model:' + model + ':' + action + ':' + pk, record);
  };
  return ctx;
}

test('bind() patches the changed row in place on the framework bus', function () {
  const {$, app, emit} = frameworkApp();
  const scope = makeScope([{id: '1', title: 'a'}, {id: '2', title: 'b'}], 'id');
  $.scope = {Task: scope};

  app.sync.bind('Task', 'Task', {reveal: false});
  emit('Task', 'update', '2', {id: '2', title: 'b-edited'});

  assert.deepStrictEqual(scope.calls, [['update', '2']], 'patched one row, no full reload');
  assert.strictEqual(scope[1].title, 'b-edited');
  assert.strictEqual(scope.length, 2, 'row count unchanged');
});

test('bind() works on the app-base dialect (pk in topic, bare record payload)', function () {
  const {app, emit, window} = appBaseApp();
  const scope = makeScope([{host: 'a.example.com'}], 'host');
  window.$.scope = {hosts: scope};

  app.sync.bind('hosts', 'Host', {reveal: false});
  emit('Host', 'update', 'a.example.com', {host: 'a.example.com', ip: '10.0.0.9'});

  assert.strictEqual(scope[0].ip, '10.0.0.9', 'record payload applied');
});

test('a pk containing colons survives topic parsing', function () {
  const {app, emit, window} = appBaseApp();
  const dn = 'cn=admin,dc=example:dc=com';
  const scope = makeScope([{dn: dn, name: 'old'}], 'dn');
  window.$.scope = {entries: scope};

  app.sync.bind('entries', 'Entry', {reveal: false});
  emit('Entry', 'update', dn, {dn: dn, name: 'new'});

  assert.strictEqual(scope[0].name, 'new', 'pk rejoined rather than truncated at the first colon');
});

test('creates are inserted, deletes remove, unknown updates are inserted', function () {
  const {$, app, emit} = frameworkApp();
  const scope = makeScope([{id: '1'}], 'id');
  $.scope = {Task: scope};
  app.sync.bind('Task', 'Task', {reveal: false});

  emit('Task', 'create', '2', {id: '2'});
  assert.strictEqual(scope.length, 2);
  assert.strictEqual(scope[0].id, '2', 'new row goes to the top');

  // An update for a row this client never loaded should appear, not vanish.
  emit('Task', 'update', '3', {id: '3'});
  assert.strictEqual(scope.length, 3);

  emit('Task', 'delete', '1', null);
  assert.strictEqual(scope.length, 2);
  assert.strictEqual(scope.indexOf('id', '1'), -1);
});

test('numeric primary keys are matched by key, never as a positional index', function () {
  const {$, app, emit} = frameworkApp();
  // Row with id 5 sits at index 0. A positional interpretation of pk=5 would
  // miss it entirely (or patch the wrong row on a longer list).
  const scope = makeScope([{id: 5, title: 'five'}, {id: 6, title: 'six'}], 'id');
  $.scope = {Task: scope};

  app.sync.bind('Task', 'Task', {reveal: false});
  emit('Task', 'update', 5, {id: 5, title: 'five-edited'});

  assert.strictEqual(scope[0].title, 'five-edited', 'matched by key value, not index');
  assert.strictEqual(scope[1].title, 'six', 'the row at index 5-ish untouched');
});

test('remove/delete verbs from either dialect both delete', function () {
  const {app, emit, window} = appBaseApp();
  const scope = makeScope([{host: 'a'}, {host: 'b'}], 'host');
  window.$.scope = {hosts: scope};
  app.sync.bind('hosts', 'Host', {reveal: false});

  // app-base publishes 'remove'; the framework publishes 'delete'.
  emit('Host', 'remove', 'a', null);
  assert.strictEqual(scope.length, 1);
  emit('Host', 'delete', 'b', null);
  assert.strictEqual(scope.length, 0);
});

test('parse() maps the server record into the view\'s row shape', function () {
  const {$, app, emit} = frameworkApp();
  const scope = makeScope([], 'id');
  $.scope = {Task: scope};

  app.sync.bind('Task', 'Task', {
    reveal: false,
    parse: function (r) { return {id: r.id, label: r.title.toUpperCase()}; },
  });
  emit('Task', 'create', '1', {id: '1', title: 'hello'});

  assert.strictEqual(scope[0].label, 'HELLO');
});

test('filter() evicts a row that no longer belongs in the list', function () {
  const {$, app, emit} = frameworkApp();
  const scope = makeScope([{id: '1', done: false}], 'id');
  $.scope = {Task: scope};

  app.sync.bind('Task', 'Task', {
    reveal: false,
    filter: function (row) { return row.done === false; },
  });

  // Another user completes the task; this list only shows open ones.
  emit('Task', 'update', '1', {id: '1', done: true});
  assert.strictEqual(scope.length, 0, 'row left the filtered set');

  // And a create that does not match never enters it.
  emit('Task', 'create', '2', {id: '2', done: true});
  assert.strictEqual(scope.length, 0);
});

test('events for other models are ignored', function () {
  const {$, app, emit} = frameworkApp();
  const scope = makeScope([{id: '1'}], 'id');
  $.scope = {Task: scope};
  app.sync.bind('Task', 'Task', {reveal: false});

  emit('User', 'update', '1', {id: '1', name: 'x'});
  assert.deepStrictEqual(scope.calls, [], 'no scope mutation from a foreign model');
});

test('a missing scope is ignored rather than throwing', function () {
  const {$, app, emit} = frameworkApp();
  $.scope = {};
  app.sync.bind('Task', 'Task', {reveal: false});
  assert.doesNotThrow(function () { emit('Task', 'update', '1', {id: '1'}); });
});

test('unbind() stops updates on both dialects', function () {
  const fw = frameworkApp();
  const fwScope = makeScope([{id: '1', v: 'a'}], 'id');
  fw.$.scope = {Task: fwScope};
  fw.app.sync.bind('Task', 'Task', {reveal: false}).unbind();
  fw.emit('Task', 'update', '1', {id: '1', v: 'b'});
  assert.strictEqual(fwScope[0].v, 'a', 'framework bus listener removed');

  // app-base has no unsubscribe handle, so bind() must gate the listener.
  const ab = appBaseApp();
  const abScope = makeScope([{host: 'a', v: 'a'}], 'host');
  ab.window.$.scope = {hosts: abScope};
  ab.app.sync.bind('hosts', 'Host', {reveal: false}).unbind();
  ab.emit('Host', 'update', 'a', {host: 'a', v: 'b'});
  assert.strictEqual(abScope[0].v, 'a', 'app-base listener gated');
});

test('fetch() fills in a row when the event carries no body', function () {
  const {$, app, emit} = frameworkApp();
  const scope = makeScope([], 'id');
  $.scope = {Task: scope};
  let asked = null;

  app.sync.bind('Task', 'Task', {
    reveal: false,
    fetch: function (pk) { asked = pk; return $.Deferred().resolve({id: pk, title: 'fetched'}).promise(); },
  });

  emit('Task', 'create', '9', true);
  assert.strictEqual(asked, '9', 'fetch called with the pk');
  assert.strictEqual(scope[0].title, 'fetched');
});

test('bind() accepts the single-object form', function () {
  const {$, app, emit} = frameworkApp();
  const scope = makeScope([{id: '1', v: 'a'}], 'id');
  $.scope = {Task: scope};

  app.sync.bind({scope: 'Task', model: 'Task', reveal: false});
  emit('Task', 'update', '1', {id: '1', v: 'b'});

  assert.strictEqual(scope[0].v, 'b');
});
