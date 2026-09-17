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
    <div id="notify-filters"></div>
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

  // Popups are held for `burstMs` and collapsed; a short window keeps this
  // test about the focused/hidden gate rather than about timing.
  app.notify.configure({ burstMs: 5 });

  app.notify.init();
  await tick();
  app.notify.push({model: 'Host', action: 'create', pk: 'a', data: {}});
  await tick(40);
  assert.strictEqual(fired.length, 0, 'you are already looking at the page');

  Object.defineProperty(window.document, 'hidden', {configurable: true, get: () => true});
  app.notify.push({model: 'Host', action: 'create', pk: 'b', data: {}});
  await tick(40);
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

test('model icons render in dropdown and custom icons can be configured', async function () {
  const {$, app, emit} = frameworkApp();
  app.notify.configure({
    icons: { CustomModel: 'fa-solid fa-star text-gold' }
  });
  app.notify.init();
  await tick();
  emit('Host', 'create', 'server1', {});
  emit('CustomModel', 'update', 'item1', {});
  await tick();

  assert.ok($('#notify-list').html().includes('fa-server'));
  assert.ok($('#notify-list').html().includes('fa-star text-gold'));
});

// Toasts are held for `burstMs` and collapsed, so a short window is configured
// here rather than waiting most of a second in every test.
function toastApp(window, app, options) {
  const toasts = [];
  app.messages = { toast: (msg, type) => toasts.push({msg, type}) };
  app.notify.configure(Object.assign({ toast: true, burstMs: 5 }, options || {}));
  Object.defineProperty(window.document, 'hidden', {configurable: true, get: () => false});
  return toasts;
}

test('toast notifications are raised when toast is enabled in focused tab', async function () {
  const {app, window, emit} = frameworkApp();
  const toasts = toastApp(window, app);

  app.notify.init();
  await tick();
  emit('Host', 'create', 'node1', {});
  await tick(40);

  assert.strictEqual(toasts.length, 1);
  assert.strictEqual(toasts[0].type, 'success');
  assert.match(toasts[0].msg, /host added: node1/);
});

// The complaint this exists for: "I'm getting a lot of notifications at once."
//
// Events do not arrive one at a time. A directory's status evaluator walks
// every resource and writes the ones that changed; a discovery poll touches
// `last_seen` on every guest. Each write is its own model event, so one sweep
// delivers dozens inside a second.
//
// The bell LIST always handled that -- render() collapses the whole history.
// The toast path called `collapse([event])` on an array of exactly ONE event,
// which can never merge and is a no-op wrapper, so the same sweep that made one
// tidy row also fired one toast per event.
test('a burst of same-kind events raises ONE collapsed toast', async function () {
  const {app, window, emit} = frameworkApp();
  const toasts = toastApp(window, app);

  app.notify.init();
  await tick();
  for (let i = 0; i < 42; i++) emit('Resource', 'update', 'r' + i, {});
  await tick(40);

  assert.strictEqual(toasts.length, 1, 'one sweep should be one toast');
  assert.match(toasts[0].msg, /42 resources updated/);
  // The list is unaffected -- it was already correct, and still holds it all.
  assert.strictEqual(app.notify.events.length, 42);
  assert.strictEqual(app.notify.unread, 42);
});

test('a burst spanning several kinds is capped', async function () {
  const {app, window, emit} = frameworkApp();
  const toasts = toastApp(window, app, { maxToastsPerBurst: 2 });

  app.notify.init();
  await tick();
  // Alternating kinds: nothing collapses, so this is the worst case.
  for (let i = 0; i < 30; i++) emit(i % 3 === 0 ? 'Resource' : (i % 3 === 1 ? 'Host' : 'User'), 'update', 't' + i, {});
  await tick(40);

  assert.ok(toasts.length <= 2, 'got ' + toasts.length + ' toasts, expected at most 2');
  assert.strictEqual(app.notify.events.length, 30, 'the bell still holds every event');
});

test('a continuous stream is reported once it settles, not every window', async function () {
  const {app, window, emit} = frameworkApp();
  const toasts = toastApp(window, app, { burstMs: 30 });

  app.notify.init();
  await tick();
  // Arrivals closer together than the window: the timer keeps being pushed out.
  for (let i = 0; i < 5; i++) { emit('Resource', 'update', 'r' + i, {}); await tick(10); }
  await tick(60);

  assert.strictEqual(toasts.length, 1);
  assert.match(toasts[0].msg, /5 resources updated/);
});

test('burstMs: 0 restores one toast per event', async function () {
  const {app, window, emit} = frameworkApp();
  const toasts = toastApp(window, app, { burstMs: 0 });

  app.notify.init();
  await tick();
  for (let i = 0; i < 3; i++) emit('Resource', 'update', 'r' + i, {});
  await tick(40);

  assert.strictEqual(toasts.length, 3);
});

test('clearing the feed cancels toasts that have not popped yet', async function () {
  const {app, window, emit} = frameworkApp();
  const toasts = toastApp(window, app, { burstMs: 30 });

  app.notify.init();
  await tick();
  emit('Resource', 'update', 'r1', {});
  app.notify.clear();
  await tick(60);

  assert.strictEqual(toasts.length, 0, 'cleared the feed, then got toasted for it anyway');
});

test('clear() empties events and pushes seen_at watermark', async function () {
  const {app, puts, emit} = frameworkApp();
  app.notify.init();
  await tick();
  emit('Host', 'create', 'node1', {});
  await tick();
  assert.strictEqual(app.notify.events.length, 1);

  app.notify.clear();
  assert.strictEqual(app.notify.events.length, 0);
  assert.strictEqual(app.notify.unread, 0);
  assert.strictEqual(puts.length > 0, true);
});


// A tab left open on a page whose models churn on a timer used to accumulate
// every event for the life of the session, and re-collapse the whole array on
// each new one. theta-directory reached multiple GB and the tab was killed.
test('a long-lived socket stream does not grow the event list without bound', async function () {
  const {app} = frameworkApp({results: [], unread: 0, seen_at: 0});
  app.notify.init();
  await tick();

  const max = app.notify.config().maxEvents;
  // Well past the cap, and past any single burst a real page produces.
  for (let i = 0; i < max * 5; i++) app.notify.push({model: 'Resource', action: 'update', pk: 'r' + i}, null);

  assert.strictEqual(app.notify.events.length, max);
  // Newest-first: the cap drops the OLDEST, never the event that just arrived.
  assert.strictEqual(app.notify.events[0].target, 'r' + (max * 5 - 1));
  assert.strictEqual(app.notify.unread, max * 5);
});

test('the server feed is capped the same way as the live stream', async function () {
  const now = Date.now();
  // A server that hands back more history than the feed will ever render.
  const results = Array.from({length: 5000}, (_, i) => ({
    model: 'Resource', action: 'update', target: 'r' + i, created_on: now - i * 1000,
  }));
  const {app} = frameworkApp({results, unread: 5000, seen_at: 0});
  app.notify.init();
  await tick();
  assert.strictEqual(app.notify.events.length, app.notify.config().maxEvents);
});

// collapse() stops early now; the rows that get rendered must be identical to
// what a full walk produced.
test('early-exit collapsing renders the same rows as a full walk', async function () {
  const now = Date.now();
  // Alternating models so nothing collapses -- the worst case for early exit,
  // and the one where an off-by-one would show.
  const results = Array.from({length: 200}, (_, i) => ({
    model: i % 2 ? 'Host' : 'Resource', action: 'update', target: 't' + i, created_on: now - i,
  }));
  const {$, app} = frameworkApp({results, unread: 0, seen_at: 0});
  app.notify.init();
  await tick();

  const rows = $('#notify-list a span:first-child').map(function () { return $(this).text(); }).get();
  assert.strictEqual(rows.length, app.notify.config().maxRows);
  assert.strictEqual(rows[0], 'resource updated: t0');
  assert.strictEqual(rows[1], 'host updated: t1');
  assert.strictEqual(rows[rows.length - 1], 'host updated: t' + (app.notify.config().maxRows - 1));
});

// ---------------------------------------------------------------------------
// Muting.
//
// The feed subscribes to every model event the socket delivers. That is right
// for a change log and wrong for a person: most of the volume is routine churn
// -- a status evaluator rewriting `status`, a discovery poll touching
// `last_seen` -- and the events worth seeing are buried in it.
//
// A mute is a VIEW, not a filter on what is recorded, so unmuting shows the
// history you had been ignoring rather than a gap.

function mutedApp(feed, mutes) {
  const ctx = frameworkApp(feed);
  // Isolate from whatever a previous test persisted.
  try { ctx.window.localStorage.clear(); } catch (e) {}
  ctx.app.notify.configure({mutes: mutes || [], mutesKey: 'test.mutes.' + Math.random()});
  return ctx;
}

test('a muted model is hidden from the list, and does not count as unread', async function () {
  const {app, emit, $} = mutedApp(undefined, ['Resource']);
  app.notify.init();
  await tick();

  for (let i = 0; i < 5; i++) emit('Resource', 'update', 'r' + i, {});
  emit('User', 'create', 'alice', {});
  await tick();

  const rows = $('#notify-list a span:first-child').map(function () { return $(this).text(); }).get();
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0], /user added: alice/);
  assert.strictEqual(app.notify.unread, 1, 'muting something should stop the badge nagging');
});

test('muted events are still retained, so unmuting reveals the history', async function () {
  const {app, emit, $} = mutedApp(undefined, ['Resource']);
  app.notify.init();
  await tick();
  for (let i = 0; i < 5; i++) emit('Resource', 'update', 'r' + i, {});
  await tick();

  assert.strictEqual(app.notify.events.length, 5, 'recorded but not shown');
  assert.strictEqual($('#notify-list a').length, 0);

  app.notify.unmute('Resource');
  const rows = $('#notify-list a span:first-child').map(function () { return $(this).text(); }).get();
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0], /5 resources updated/);
});

test("'*:update' mutes routine churn across every model", async function () {
  // The key the "hide updates" button sets: a status sweep and a discovery poll
  // both write updates, across whichever models they touch.
  const {app, emit, $} = mutedApp(undefined, ['*:update']);
  app.notify.init();
  await tick();

  emit('Resource', 'update', 'r1', {});
  emit('Host', 'update', 'h1', {});
  emit('Resource', 'create', 'r2', {});
  await tick();

  const rows = $('#notify-list a span:first-child').map(function () { return $(this).text(); }).get();
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0], /resource added: r2/);
});

test("'Model:action' mutes one pair without muting the model", async function () {
  const {app, emit, $} = mutedApp(undefined, ['Resource:update']);
  app.notify.init();
  await tick();

  emit('Resource', 'update', 'r1', {});
  emit('Resource', 'delete', 'r2', {});
  await tick();

  const rows = $('#notify-list a span:first-child').map(function () { return $(this).text(); }).get();
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0], /resource removed: r2/);
  assert.strictEqual(app.notify.isMuted('Resource', 'update'), true);
  assert.strictEqual(app.notify.isMuted('Resource', 'delete'), false);
});

test('a muted kind raises no toast', async function () {
  const {app, window, emit} = mutedApp(undefined, ['Resource']);
  const toasts = toastApp(window, app);
  app.notify.configure({mutes: ['Resource']});
  app.notify.init();
  await tick();

  emit('Resource', 'update', 'r1', {});
  await tick(40);
  assert.strictEqual(toasts.length, 0);

  emit('User', 'create', 'alice', {});
  await tick(40);
  assert.strictEqual(toasts.length, 1);
});

test('mutes survive a reload through storage', async function () {
  const key = 'test.mutes.persist';
  const first = frameworkApp();
  try { first.window.localStorage.clear(); } catch (e) {}
  first.app.notify.configure({mutes: [], mutesKey: key});
  first.app.notify.init();
  await tick();
  first.app.notify.mute('Resource');
  const stored = first.window.localStorage.getItem(key);
  assert.deepStrictEqual(JSON.parse(stored), ['Resource']);
});

test('a corrupt stored preference does not break the feed', async function () {
  const key = 'test.mutes.corrupt';
  const {app, window, emit, $} = frameworkApp();
  window.localStorage.setItem(key, 'not json at all');
  app.notify.configure({mutes: [], mutesKey: key});
  app.notify.init();
  await tick();
  emit('User', 'create', 'alice', {});
  await tick();
  assert.strictEqual($('#notify-list a').length, 1);
});

test('the filter panel is built from what is actually in the feed', async function () {
  const {app, emit, $} = mutedApp();
  app.notify.init();
  await tick();
  emit('Resource', 'update', 'r1', {});
  emit('Resource', 'update', 'r2', {});
  emit('User', 'create', 'alice', {});
  await tick();

  const labels = $('#notify-filters button').map(function () { return $(this).text(); }).get();
  assert.ok(labels.some((t) => /^resource 2$/.test(t)), 'got: ' + labels.join(' | '));
  assert.ok(labels.some((t) => /^user 1$/.test(t)));
  assert.ok(labels.some((t) => /hide updates/.test(t)));
  // A model nobody emits never clutters the panel.
  assert.ok(!labels.some((t) => /mesh/.test(t)));
});

test('a muted model stays listed so the mute can be undone', async function () {
  const {app, emit, $} = mutedApp();
  app.notify.init();
  await tick();
  emit('Resource', 'update', 'r1', {});
  await tick();

  app.notify.mute('Resource');
  const labels = $('#notify-filters button').map(function () { return $(this).text(); }).get();
  assert.ok(labels.some((t) => /resource/.test(t)), 'a mute you cannot see is a mute you cannot undo');
});

test('everything muted reads as muted, not as empty', async function () {
  const {app, emit, $} = mutedApp(undefined, ['Resource']);
  app.notify.init();
  await tick();
  emit('Resource', 'update', 'r1', {});
  await tick();
  assert.match($('#notify-list').text(), /everything recent is muted/i);
});

test('the filter panel is not rebuilt on every event in a burst', async function () {
  // render() runs per arriving event and a status sweep delivers dozens. The
  // panel only changes structurally when the model set or the mutes change;
  // counts alone must retext the existing buttons, not rebuild them.
  const {app, emit, $} = mutedApp();
  app.notify.init();
  await tick();
  emit('Resource', 'update', 'r0', {});
  await tick();

  const first = $('#notify-filters button')[0];
  for (let i = 1; i < 20; i++) emit('Resource', 'update', 'r' + i, {});
  await tick();

  assert.strictEqual($('#notify-filters button')[0], first, 'buttons were rebuilt');
  // ...and the count still tracked.
  const labels = $('#notify-filters button').map(function () { return $(this).text(); }).get();
  assert.ok(labels.some((t) => /^resource 20$/.test(t)), 'got: ' + labels.join(' | '));
});

test('the panel does rebuild when a mute changes', async function () {
  const {app, emit, $} = mutedApp();
  app.notify.init();
  await tick();
  emit('Resource', 'update', 'r0', {});
  await tick();

  const before = $('#notify-filters button')[0];
  app.notify.mute('Resource');
  assert.notStrictEqual($('#notify-filters button')[0], before);
});

// ---------------------------------------------------------------------------
// Naming UUID-keyed events.
//
// readableTarget() suppresses UUIDs, which is right -- a UUID in a sentence is
// noise. The consequence was that a UUID-keyed model rendered as a bare
// "access request created": no who, no what. Correct for a change log, useless
// as a notification, and it hit exactly the models a person cares about most.

test('a configured title names an event whose pk is a UUID', async function () {
  const {app, emit, $} = frameworkApp();
  app.notify.configure({
    titles: { AccessRequest: (r) => r.uid + ' → ' + r.groupCn },
  });
  app.notify.init();
  await tick();

  emit('AccessRequest', 'create', '3f1b8c2e-7a4d-4b1e-9c5a-2d6e8f0a1b3c',
       {uid: 'alice', groupCn: 'site_x_app_emby_access'});
  await tick();

  const row = $('#notify-list a span:first-child').first().text();
  assert.match(row, /access request added: alice → site_x_app_emby_access/);
});

test('without a title a UUID is still suppressed', async function () {
  const {app, emit, $} = frameworkApp();
  app.notify.init();
  await tick();
  emit('AccessRequest', 'create', '3f1b8c2e-7a4d-4b1e-9c5a-2d6e8f0a1b3c', {uid: 'alice'});
  await tick();
  assert.strictEqual($('#notify-list a span:first-child').first().text().trim(), 'access request added');
});

test('a collapsed group counts rather than naming one of them', async function () {
  const {app, emit, $} = frameworkApp();
  app.notify.configure({ titles: { AccessRequest: (r) => r.uid } });
  app.notify.init();
  await tick();
  for (let i = 0; i < 4; i++) emit('AccessRequest', 'create', 'id' + i, {uid: 'u' + i});
  await tick();

  const row = $('#notify-list a span:first-child').first().text();
  assert.match(row, /4 access requests added/);
});

test('a throwing title function does not take the feed down', async function () {
  const {app, emit, $} = frameworkApp();
  app.notify.configure({ titles: { Resource: () => { throw new Error('bad record'); } } });
  app.notify.init();
  await tick();
  emit('Resource', 'create', 'r1', {});
  await tick();
  assert.strictEqual($('#notify-list a').length, 1);
});

test('a title is escaped like any other text', async function () {
  // Titles are derived from server records, which carry user-written fields.
  const {app, emit, $} = frameworkApp();
  app.notify.configure({ titles: { AccessRequest: (r) => r.uid } });
  app.notify.init();
  await tick();
  emit('AccessRequest', 'create', 'id1', {uid: '<img src=x onerror=alert(1)>'});
  await tick();
  assert.strictEqual($('#notify-list img').length, 0);
  assert.match($('#notify-list').html(), /&lt;img/);
});
