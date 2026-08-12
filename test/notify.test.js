'use strict';

const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const {loadApp} = require('./helpers/loadApp');

const NOTIFY = path.join(__dirname, '..', 'lib', 'app.notify.js');
const SHELL = `
  <div id="notify-bell" style="display:none">
    <span id="notify-badge" style="display:none">0</span>
    <a id="notify-desktop-toggle"></a>
    <ul id="notify-list"></ul>
  </div>`;

// The framework stack: app.js provides app.pubsub, and events are
// self-describing {model, action, pk, data}.
function frameworkApp(feed) {
  const ctx = loadApp([path.join(__dirname, '..', 'lib', 'app.js')]);
  ctx.window.document.body.innerHTML = SHELL;
  stubApi(ctx, feed);
  ctx.window.eval(fs.readFileSync(NOTIFY, 'utf8'));
  ctx.app = ctx.window.app;
  ctx.emit = (model, action, pk, data) =>
    ctx.app.pubsub.publish('model:' + model + ':' + action, {model, action, pk, data});
  return ctx;
}

// The app-base stack: RegExp subscribe, model/action/pk in the TOPIC, and the
// bare record as the payload.
function appBaseApp(feed) {
  const ctx = loadApp([]);
  ctx.window.document.body.innerHTML = SHELL;
  ctx.window.eval(`
    var app = {};
    app.topics = {};
    app.subscribe = function(topic, listener){
      if (topic instanceof RegExp) { listener.match = topic; topic = '__REGEX__'; }
      (app.topics[topic] = app.topics[topic] || []).push(listener);
    };
    app.publish = function(topic, data){
      var m = (app.topics[topic] || []).slice();
      (app.topics['__REGEX__'] || []).forEach(function(l){ if (topic.match(l.match)) m.push(l); });
      m.forEach(function(l){ l(data, topic); });
    };
  `);
  stubApi(ctx, feed);
  ctx.window.eval(fs.readFileSync(NOTIFY, 'utf8'));
  ctx.app = ctx.window.app;
  ctx.emit = (model, action, pk, record) =>
    ctx.window.app.publish('model:' + model + ':' + action + ':' + pk, record);
  return ctx;
}

function stubApi(ctx, feed) {
  ctx.puts = [];
  ctx.window.app = ctx.window.app || {};
  ctx.window.app.api = {
    get: () => ctx.$.Deferred().resolve(feed || {results: [], unread: 0, seen_at: 0}).promise(),
    put: (path, body) => { ctx.puts.push([path, body]); return ctx.$.Deferred().resolve({}).promise(); },
  };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms == null ? 10 : ms));

test('the bell stays hidden until the feed actually loads', async function () {
  // Deliberately not keyed off a CSS class: the apps' shells have diverged, and
  // one of them has no "logged in" class at all — the bell silently never
  // appeared there.
  const {$, app} = frameworkApp({results: [], unread: 0, seen_at: 0});
  // jsdom does no layout, so :visible is always false — assert on the style.
  assert.strictEqual($('#notify-bell')[0].style.display, 'none');
  app.notify.init();
  await tick();
  assert.notStrictEqual($('#notify-bell')[0].style.display, 'none');
});

test('a burst of one kind collapses into a single row', async function () {
  const now = Date.now();
  const results = Array.from({length: 12}, (_, i) => ({
    model: 'Resource', action: 'create', target: 'r' + i, actor: 'alice', created_on: now - i * 100,
  }));
  const {$, app} = frameworkApp({results, unread: 12, seen_at: 0});
  app.notify.init();
  await tick();

  const rows = $('#notify-list a span:first-child').map(function () { return $(this).text(); }).get();
  assert.deepStrictEqual(rows, ['12 resources created'.replace('created', 'added')]);
});

test('events far apart in time are not collapsed together', async function () {
  const now = Date.now();
  const results = [
    {model: 'Host', action: 'create', target: 'a', created_on: now},
    {model: 'Host', action: 'create', target: 'b', created_on: now - 10 * 60 * 1000},
  ];
  const {$, app} = frameworkApp({results, unread: 2, seen_at: 0});
  app.notify.init();
  await tick();
  assert.strictEqual($('#notify-list a').length, 2);
});

test('a live event on the framework bus reaches the feed', async function () {
  const {$, app, emit} = frameworkApp();
  app.notify.init();
  await tick();
  emit('Host', 'create', 'a.example.com', {created_by: 'alice'});
  await tick();

  assert.strictEqual(app.notify.unread, 1);
  assert.match($('#notify-list a span:first-child').first().text(), /host added: a\.example\.com/);
});

test('a live event on the app-base bus reaches the feed', async function () {
  // Regression: written for the self-describing payload alone, the feed was
  // silently dead in the app that publishes model/action/pk in the TOPIC — the
  // socket delivered events and the badge never moved.
  const {$, app, emit} = appBaseApp();
  app.notify.init();
  await tick();
  emit('Host', 'create', 'b.example.com', {created_by: 'alice'});
  await tick();

  assert.strictEqual(app.notify.unread, 1);
  assert.match($('#notify-list a span:first-child').first().text(), /host added: b\.example\.com/);
});

test('a pk containing colons survives topic parsing', async function () {
  const {app, emit} = appBaseApp();
  app.notify.init();
  await tick();
  emit('Entry', 'update', 'cn=a,dc=x:dc=y', {});
  await tick();
  assert.strictEqual(app.notify.events[0].target, 'cn=a,dc=x:dc=y');
});

test('a UUID target is left out of the wording but keeps its link', async function () {
  const {$, app} = frameworkApp({
    results: [{model: 'Resource', action: 'create', target: 'b789186e-d26f-47a3-9e86-01e26c487c60', created_on: Date.now()}],
    unread: 1, seen_at: 0,
  });
  app.notify.configure({links: {Resource: (pk) => '/directory/' + pk}});
  app.notify.init();
  await tick();

  const $a = $('#notify-list a').first();
  assert.strictEqual($a.find('span').first().text(), 'resource added');
  assert.strictEqual($a.attr('href'), '/directory/b789186e-d26f-47a3-9e86-01e26c487c60');
});

test('a collapsed group links to the list, without a dangling segment', async function () {
  const now = Date.now();
  const {$, app} = frameworkApp({
    results: [
      {model: 'Host', action: 'create', target: 'a', created_on: now},
      {model: 'Host', action: 'create', target: 'b', created_on: now - 50},
    ],
    unread: 2, seen_at: 0,
  });
  app.notify.configure({links: {Host: (pk) => '/hosts/' + pk}});
  app.notify.init();
  await tick();

  // '/hosts/' would 404 where '/hosts' is the page you want.
  assert.strictEqual($('#notify-list a').first().attr('href'), '/hosts');
});

test('a model with no link renders unlinked rather than breaking', async function () {
  const {$, app} = frameworkApp({
    results: [{model: 'Unmapped', action: 'create', target: 'x', created_on: Date.now()}],
    unread: 1, seen_at: 0,
  });
  app.notify.init();
  await tick();
  assert.strictEqual($('#notify-list a').first().attr('href'), '#');
});

test('opening the bell moves the watermark and clears the badge', async function () {
  const {$, app, puts} = frameworkApp({results: [], unread: 4, seen_at: 0});
  app.notify.init();
  await tick();
  assert.strictEqual($('#notify-badge').text(), '4');

  app.notify.markSeen();
  await tick();
  assert.strictEqual(app.notify.unread, 0);
  assert.strictEqual($('#notify-badge')[0].style.display, 'none');
  assert.strictEqual(puts[0][0], 'activity/seen');
  assert.ok(puts[0][1].seen_at > 0);
});

test('the endpoint is configurable', async function () {
  const {app, puts} = frameworkApp({results: [], unread: 0, seen_at: 0});
  app.notify.configure({endpoint: 'events'});
  app.notify.init();
  await tick();
  app.notify.markSeen();
  assert.strictEqual(puts[0][0], 'events/seen');
});

test('desktop notifications stay silent while the tab is focused', async function () {
  const {app, window} = frameworkApp();
  const fired = [];
  function Fake(title, opts) { fired.push({title, opts}); this.close = () => {}; }
  Fake.permission = 'granted';
  window.Notification = Fake;
  Object.defineProperty(window.document, 'hidden', {configurable: true, get: () => false});

  app.notify.init();
  await tick();
  app.notify.push({model: 'Host', action: 'create', pk: 'a', data: {}});
  assert.strictEqual(fired.length, 0, 'you are already looking at the page');

  Object.defineProperty(window.document, 'hidden', {configurable: true, get: () => true});
  app.notify.push({model: 'Host', action: 'create', pk: 'b', data: {}});
  assert.strictEqual(fired.length, 1);
  // Same tag replaces rather than stacks, so a burst is one desktop popup.
  assert.strictEqual(fired[0].opts.tag, 'theta-Host:create');
});

test('desktop permission is never requested without a click', async function () {
  const {app, window} = frameworkApp();
  let asked = 0;
  function Fake() { this.close = () => {}; }
  Fake.permission = 'default';
  Fake.requestPermission = () => { asked++; return Promise.resolve('granted'); };
  window.Notification = Fake;

  app.notify.init();
  await tick();
  // A permission bubble on page load is hostile, and browsers penalise it.
  assert.strictEqual(asked, 0);
});

test('an actor placeholder is not reported as a person', async function () {
  // A record created and never updated carries updated_by: '__NONE__'.
  const {app, emit} = frameworkApp();
  app.notify.init();
  await tick();
  emit('Host', 'create', 'a', {updated_by: '__NONE__', created_by: 'alice'});
  await tick();
  assert.strictEqual(app.notify.events[0].actor, 'alice');
});

test('an event with no recognisable model is ignored', async function () {
  const {app} = frameworkApp();
  app.notify.init();
  await tick();
  assert.doesNotThrow(() => app.notify.push(null, 'garbage'));
  assert.doesNotThrow(() => app.notify.push({}, 'also:garbage'));
  assert.strictEqual(app.notify.events.length, 0);
});

test('init is idempotent, so an event is never counted twice', async function () {
  // The shell may call init() itself after configure(); it also runs on ready.
  const {app, emit} = frameworkApp();
  app.notify.init();
  app.notify.init();
  await tick();
  emit('Host', 'create', 'a', {});
  await tick();
  assert.strictEqual(app.notify.unread, 1);
});
