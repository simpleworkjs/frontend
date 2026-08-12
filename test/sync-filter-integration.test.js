'use strict';

const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {loadApp} = require('./helpers/loadApp');

// The unit tests for app.sync/app.filter drive a scope stand-in. These drive
// the real jq-repeat, which is where the assumptions that matter live: which
// argument forms it accepts, when __jq_$el is attached, and what a template
// re-render does to the row object. A stub can agree with a wrong assumption;
// jq-repeat cannot.
const JQ_REPEAT = path.join(__dirname, '..', 'node_modules', 'jq-repeat', 'dist', 'js', 'jq-repeat.js');

const fs = require('fs');

// The markup has to be in the document before jq-repeat loads: it scans for
// [jq-repeat] templates at startup, so a table inserted afterwards is never
// discovered. Load an empty app, plant the DOM, then evaluate the scripts in
// the order a page's <script> tags would.
function setup(html) {
  const ctx = loadApp([]);
  ctx.window.document.body.innerHTML = html;
  for (const file of [
    path.join(__dirname, '..', 'lib', 'app.js'),
    JQ_REPEAT,
    path.join(__dirname, '..', 'lib', 'app.sync.js'),
    path.join(__dirname, '..', 'lib', 'app.filter.js'),
  ]) {
    ctx.window.eval(fs.readFileSync(file, 'utf8'));
  }
  ctx.app = ctx.window.app;
  ctx.$ = ctx.window.$;
  return ctx;
}

// jq-repeat goes on the <tr>, matching how the theta42 views use it: the
// repeated element is the row, not the tbody.
const TABLE = `
  <table><tbody>
    <tr jq-repeat="hosts" jq-index-key="host"><td class="h">{{host}}</td><td class="ip">{{ip}}</td></tr>
  </tbody></table>`;

function rowsInDom($) {
  return $('tbody [jq-repeat-index]').map(function () { return $(this).find('.h').text(); }).get();
}

function visibleRowsInDom($) {
  return $('tbody [jq-repeat-index]').filter(function () {
    return $(this).css('display') !== 'none';
  }).map(function () { return $(this).find('.h').text(); }).get();
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms == null ? 5 : ms));
}

test('a live create renders a new row in the real DOM', async function () {
  const {$, app} = setup(TABLE);
  await tick();
  $.scope.hosts.push({host: 'a.example.com', ip: '10.0.0.1'});
  await tick();

  app.sync.bind('hosts', 'Host', {reveal: false});
  app.pubsub.publish('model:Host:create', {
    model: 'Host', action: 'create', pk: 'b.example.com',
    data: {host: 'b.example.com', ip: '10.0.0.2'},
  });
  await tick();

  assert.deepStrictEqual(rowsInDom($).sort(), ['a.example.com', 'b.example.com']);
});

test('a live update rewrites the existing row rather than adding one', async function () {
  const {$, app} = setup(TABLE);
  await tick();
  $.scope.hosts.push({host: 'a.example.com', ip: '10.0.0.1'});
  await tick();

  app.sync.bind('hosts', 'Host', {reveal: false});
  app.pubsub.publish('model:Host:update', {
    model: 'Host', action: 'update', pk: 'a.example.com',
    data: {host: 'a.example.com', ip: '10.9.9.9'},
  });
  await tick();

  assert.strictEqual(rowsInDom($).length, 1, 'still one row');
  assert.strictEqual($('tbody .ip').text(), '10.9.9.9', 'template re-rendered with new data');
});

test('a live delete removes the row from the DOM', async function () {
  const {$, app} = setup(TABLE);
  await tick();
  $.scope.hosts.push({host: 'a.example.com'}, {host: 'b.example.com'});
  await tick();

  app.sync.bind('hosts', 'Host', {reveal: false});
  app.pubsub.publish('model:Host:delete', {model: 'Host', action: 'delete', pk: 'a.example.com', data: null});
  await tick();

  assert.deepStrictEqual(rowsInDom($), ['b.example.com']);
});

test('filtering hides real rows and clearing brings them back', async function () {
  const {$, app} = setup(TABLE);
  await tick();
  $.scope.hosts.push({host: 'alpha.example.com'}, {host: 'beta.example.com'});
  await tick();

  const filter = app.filter.bind('hosts', {fields: ['host']});
  filter.set('search', 'alpha');
  await tick();
  assert.deepStrictEqual(visibleRowsInDom($), ['alpha.example.com']);

  filter.clear();
  await tick();
  assert.deepStrictEqual(visibleRowsInDom($).sort(), ['alpha.example.com', 'beta.example.com']);
});

test('a row arriving live while a filter is active is hidden, not shown', async function () {
  // The timing case the stub cannot prove: jq-repeat attaches the new row's
  // element itself, so the filter has to catch it after that happens.
  const {$, app} = setup(TABLE);
  await tick();
  $.scope.hosts.push({host: 'alpha.example.com'});
  await tick();

  const {filter} = app.filter.live('hosts', 'Host', {fields: ['host'], reveal: false});
  filter.set('search', 'alpha');
  await tick();

  app.pubsub.publish('model:Host:create', {
    model: 'Host', action: 'create', pk: 'zeta.example.com', data: {host: 'zeta.example.com'},
  });
  await tick(20);

  assert.deepStrictEqual(rowsInDom($).sort(), ['alpha.example.com', 'zeta.example.com'], 'row is in the table');
  assert.deepStrictEqual(visibleRowsInDom($), ['alpha.example.com'], 'but hidden by the active filter');

  filter.clear();
  await tick(20);
  assert.deepStrictEqual(visibleRowsInDom($).sort(), ['alpha.example.com', 'zeta.example.com']);
});

test('a numeric primary key patches the right row through real jq-repeat', async function () {
  const {$, app} = setup(`
    <table><tbody>
      <tr jq-repeat="items" jq-index-key="id"><td class="h">{{id}}</td><td class="ip">{{name}}</td></tr>
    </tbody></table>`);
  await tick();
  // id 5 sits at index 0; a positional read of pk=5 would miss it.
  $.scope.items.push({id: 5, name: 'five'}, {id: 6, name: 'six'});
  await tick();

  app.sync.bind('items', 'Item', {reveal: false});
  app.pubsub.publish('model:Item:update', {
    model: 'Item', action: 'update', pk: 5, data: {id: 5, name: 'five-edited'},
  });
  await tick();

  assert.strictEqual($('tbody [jq-repeat-index="5"] .ip').text(), 'five-edited');
  assert.strictEqual($('tbody [jq-repeat-index="6"] .ip').text(), 'six', 'the other row untouched');
  assert.strictEqual(rowsInDom($).length, 2, 'no duplicate row inserted');
});

test('a row carrying a Bootstrap display utility is really hidden', async function () {
  // Regression: .hide() writes a plain inline `display:none`, which loses to
  // `.d-flex { display: flex !important }` from the stylesheet. Rows in
  // list-groups and card grids stayed visible while the count claimed they
  // were filtered out.
  const {$, app, window} = setup(`
    <style>.d-flex { display: flex !important; }</style>
    <ul id="list">
      <li class="d-flex" jq-repeat="perms" jq-index-key="id"><span class="h">{{subject}}</span></li>
    </ul>`);
  await tick();
  $.scope.perms.push({id: '1', subject: 'alice'}, {id: '2', subject: 'bob'});
  await tick();

  const filter = app.filter.bind('perms', {fields: ['subject']});
  filter.set('search', 'alice');
  await tick(20);

  const shown = $('#list li').filter(function () {
    return window.getComputedStyle(this).display !== 'none';
  }).map(function () { return $(this).find('.h').text(); }).get();
  assert.deepStrictEqual(shown, ['alice'], 'the non-matching d-flex row is actually hidden');

  filter.clear();
  await tick(20);
  const back = $('#list li').filter(function () {
    return window.getComputedStyle(this).display !== 'none';
  }).get();
  assert.strictEqual(back.length, 2, 'clearing restores both');
  assert.strictEqual(window.getComputedStyle(back[0]).display, 'flex', 'and restores the class display, not a hardcoded one');
});
