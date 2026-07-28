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
  ]);
}

test('backward compat: bare open/close touches no footer, no history', function() {
  const {window, $, app} = setup();
  const before = window.location.pathname;
  const $body = app.modal.open({title: 'Hello', bodyHtml: '<p id="x">hi</p>'});
  const $m = $('#sw-modal');
  assert.strictEqual($body.find('#x').length, 1, 'body html injected');
  assert.strictEqual($m.find('.modal-footer').length, 0, 'no footer created');
  assert.strictEqual(window.location.pathname, before, 'no navigation');

  app.modal.close();
  assert.ok(!$m[0].classList.contains('show'), 'hidden');
  assert.strictEqual(window.location.pathname, before, 'no navigation on close either');
});

test('tabs: renders nav + panes, first tab active by default', function() {
  const {$, app} = setup();
  app.modal.open({
    title: 'Entity',
    tabs: [
      {id: 'general', label: 'General', bodyHtml: '<p id="g">general</p>'},
      {id: 'details', label: 'Details', bodyHtml: '<p id="d">details</p>'},
    ],
  });
  assert.strictEqual($('#sw-modal-tab-general').hasClass('show active'), true);
  assert.strictEqual($('#sw-modal-tab-details').hasClass('active'), false);
  assert.strictEqual($('#sw-modal-tab-general-btn').hasClass('active'), true);
  assert.strictEqual($('#g').length, 1);
  assert.strictEqual($('#d').length, 1);
});

test('tabs: explicit active override wins over first-tab default', function() {
  const {$, app} = setup();
  app.modal.open({
    tabs: [
      {id: 'general', label: 'General', bodyHtml: 'g'},
      {id: 'details', label: 'Details', bodyHtml: 'd', active: true},
    ],
  });
  assert.strictEqual($('#sw-modal-tab-general').hasClass('active'), false);
  assert.strictEqual($('#sw-modal-tab-details').hasClass('active'), true);
  assert.strictEqual($('#sw-modal-tab-details-btn').hasClass('active'), true);
});

test('showTab switches the active pane/button', function() {
  const {$, app} = setup();
  app.modal.open({
    tabs: [
      {id: 'general', label: 'General', bodyHtml: 'g'},
      {id: 'details', label: 'Details', bodyHtml: 'd'},
    ],
  });
  app.modal.showTab('details');
  assert.strictEqual($('#sw-modal-tab-general').hasClass('active'), false);
  assert.strictEqual($('#sw-modal-tab-details').hasClass('active'), true);
});

test('footer: renders metaHtml + buttonsHtml, removed by a later bare open()', function() {
  const {$, app} = setup();
  app.modal.open({
    bodyHtml: 'x',
    footer: {metaHtml: '<span id="meta">meta</span>', buttonsHtml: '<button id="save">Save</button>'},
  });
  assert.strictEqual($('.modal-footer #meta').length, 1);
  assert.strictEqual($('.modal-footer #save').length, 1);

  // A later caller that doesn't ask for a footer must not inherit this one
  // (e.g. the OAuth-secret popup that opens right after the resource modal).
  app.modal.open({bodyHtml: 'y'});
  assert.strictEqual($('.modal-footer').length, 0, 'stale footer removed');
});

test('url: pushes on open, restores prior path on close', function() {
  const {window, app} = setup();
  const prior = window.location.pathname;
  app.modal.open({bodyHtml: 'x', url: {path: '/directory/some-slug'}});
  assert.strictEqual(window.location.pathname, '/directory/some-slug');

  app.modal.close();
  assert.strictEqual(window.location.pathname, prior, 'restored on close');
});

test('url: popstate while a url-tracked modal is open closes it without re-pushing', function() {
  const {window, $, app} = setup();
  const prior = window.location.pathname;
  app.modal.open({bodyHtml: 'x', url: {path: '/directory/some-slug'}});
  const $m = $('#sw-modal');
  assert.ok($m[0].classList.contains('show'));

  // Simulate the browser having already moved history back (Back button);
  // the handler should just hide the modal, not push anything new.
  window.history.pushState(null, '', prior);
  window.dispatchEvent(new window.PopStateEvent('popstate'));

  assert.ok(!$m[0].classList.contains('show'), 'modal closed on popstate');
  assert.strictEqual(window.location.pathname, prior, 'path left exactly where popstate put it');
});

test('deepLinkSlug extracts a slug under a base path, null otherwise', function() {
  const {window, app} = setup();
  window.history.pushState(null, '', '/directory/my-host');
  assert.strictEqual(app.modal.deepLinkSlug('/directory'), 'my-host');

  window.history.pushState(null, '', '/directory');
  assert.strictEqual(app.modal.deepLinkSlug('/directory'), null);

  window.history.pushState(null, '', '/users/bob');
  assert.strictEqual(app.modal.deepLinkSlug('/directory'), null);
});

test('formatAudit renders both lines, falls back to em-dash when fields are missing', function() {
  const {app} = setup();
  const full = app.modal.formatAudit(
    {created_by: 'alice', created_on: 1000, updated_by: 'bob', updated_on: 2000},
    {formatDate: (ms) => 't' + ms}
  );
  assert.match(full, /Created by alice on t1000/);
  assert.match(full, /Updated by bob on t2000/);

  const empty = app.modal.formatAudit(null);
  assert.match(empty, /Created by —/);
  assert.match(empty, /Updated by —/);
});

test('footerButtons renders Close + Save by default, extraHtml appended', function() {
  const {$, app} = setup();
  const html = app.modal.footerButtons({onSave: 'doSave()', saveLabel: 'Save Resource', extraHtml: '<button id="extra">X</button>'});
  const $wrap = $('<div>').html(html);
  const buttons = $wrap.find('button').toArray().map((b) => b.textContent);
  assert.ok(buttons.includes('Close'));
  assert.ok(buttons.includes('Save Resource'));
  assert.strictEqual($wrap.find('button[onclick="doSave()"]').length, 1);
  assert.strictEqual($wrap.find('#extra').length, 1);
});

test('on() binds a delegated handler that survives a body rebuild', function() {
  const {$, app} = setup();
  let clicks = 0;
  app.modal.on('click', '#target', function(){ clicks++; });

  app.modal.open({bodyHtml: '<button id="target">go</button>'});
  $('#target').trigger('click');
  assert.strictEqual(clicks, 1);

  // Rebuild the body (as any open() call does) — a directly-bound handler
  // would be gone now; the delegated one must still fire.
  app.modal.open({bodyHtml: '<button id="target">go again</button>'});
  $('#target').trigger('click');
  assert.strictEqual(clicks, 2, 'delegated handler survives the rebuild');
});
