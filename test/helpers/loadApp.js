'use strict';

const fs = require('fs');
const {JSDOM} = require('jsdom');
const jqueryPath = require.resolve('jquery');

// These lib/ files are plain browser IIFEs (not CommonJS modules) meant to be
// served as static assets and loaded via <script> tags — see index.js. To
// unit test them under Node, build a real DOM with jsdom, attach jQuery to
// it the same way a browser would, and eval the source files into that
// window so they attach to `window.app` exactly as they would in a browser.
function loadApp(files) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const {window} = dom;

  // jQuery's UMD bundle only auto-detects a `window` via the Node global,
  // not via a factory argument, so it must be required with `global.window`
  // pointing at this jsdom window. Bust the require cache around it so each
  // loadApp() call gets a jQuery bound to its own window, not a stale one
  // bound to a previous test's window.
  const prevWindow = global.window;
  const prevDocument = global.document;
  global.window = window;
  global.document = window.document;
  delete require.cache[jqueryPath];
  window.jQuery = window.$ = require('jquery');
  delete require.cache[jqueryPath];
  global.window = prevWindow;
  global.document = prevDocument;
  // jsdom already implements window.crypto.randomUUID; nothing to stub there.
  // Minimal Bootstrap Toast stub — app.messages.js only calls `new
  // bootstrap.Toast(el)` and `.show()`.
  window.bootstrap = {
    Toast: function ToastStub(el) {
      this.el = el;
      this.show = function () { el.classList.add('show'); };
    },
  };

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    window.eval(code);
  }

  return {dom, window, $: window.$, app: window.app};
}

module.exports = {loadApp};
