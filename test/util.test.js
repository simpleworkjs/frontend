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
