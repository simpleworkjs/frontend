'use strict';

/**
 * @simpleworkjs/frontend
 *
 * Browser-side JavaScript modules for SimpleWorkJS apps.
 *
 * These files are intended to be served as static assets by
 * @simpleworkjs/backend or bundled into your own frontend build.
 *
 * Modules:
 *   lib/app.js          — base: api, pubsub, socket, util, ready
 *   lib/app.model.js    — model schema cache and CRUD helpers
 *   lib/app.render.js   — auto-build tables/cards/forms from OPTIONS schema
 *   lib/app.sync.js     — live sync over Socket.IO
 *   lib/app.custom.js   — named custom initializer registry
 *   lib/app.messages.js — action messages, confirmations, page-wide toasts
 */

const path = require('path');

function assetPath(filename) {
  return path.join(__dirname, 'lib', filename);
}

module.exports = {
  assetPath,
  assets: {
    app: assetPath('app.js'),
    model: assetPath('app.model.js'),
    render: assetPath('app.render.js'),
    sync: assetPath('app.sync.js'),
    custom: assetPath('app.custom.js'),
    messages: assetPath('app.messages.js'),
  },
};
