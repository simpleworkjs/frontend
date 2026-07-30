'use strict';

const {test} = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {loadApp} = require('./helpers/loadApp');

function setup() {
  return loadApp([path.join(__dirname, '..', 'lib', 'app.js')]);
}

test('escapeHtml escapes the five HTML-significant characters', function() {
  const {app} = setup();
  assert.strictEqual(
    app.util.escapeHtml(`<script>alert('x')&"y"</script>`),
    '&lt;script&gt;alert(&#39;x&#39;)&amp;&quot;y&quot;&lt;/script&gt;'
  );
});

test('escapeHtml treats null/undefined as empty string', function() {
  const {app} = setup();
  assert.strictEqual(app.util.escapeHtml(null), '');
  assert.strictEqual(app.util.escapeHtml(undefined), '');
});

test('escapeHtml coerces non-string values', function() {
  const {app} = setup();
  assert.strictEqual(app.util.escapeHtml(42), '42');
});

test('revealItem scrolls the element into view and flashes then clears its background', function() {
  const {app, window} = setup();
  const node = window.document.createElement('div');
  window.document.body.appendChild(node);
  let scrolledWith = null;
  node.scrollIntoView = function(opts){ scrolledWith = opts; };

  app.util.revealItem(node);

  assert.strictEqual(scrolledWith.behavior, 'smooth');
  assert.strictEqual(scrolledWith.block, 'center');
  assert.strictEqual(node.style.backgroundColor, 'var(--bs-success-bg-subtle, #d1e7dd)');
});

test('revealItem accepts a jQuery-wrapped element', function() {
  const {app, window, $} = setup();
  const node = window.document.createElement('div');
  window.document.body.appendChild(node);
  node.scrollIntoView = function(){};

  app.util.revealItem($(node));

  assert.strictEqual(node.style.backgroundColor, 'var(--bs-success-bg-subtle, #d1e7dd)');
});

test('revealItem is a no-op when given null/undefined', function() {
  const {app} = setup();
  assert.doesNotThrow(function(){ app.util.revealItem(null); });
  assert.doesNotThrow(function(){ app.util.revealItem(undefined); });
});
