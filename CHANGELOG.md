# Changelog

## Unreleased

### Added

- First test suite for this package (`test/`), using `jsdom` + `jquery` as
  new devDependencies. These `lib/*.js` files are plain browser IIFEs (not
  CommonJS modules) served as static assets, so `test/helpers/loadApp.js`
  builds a real jsdom window, attaches jQuery to it, and `eval`s the source
  files into that window the same way a `<script>` tag would.

### Fixed

- **Systemic XSS via unescaped string-built HTML** (`lib/app.render.js`,
  `lib/app.messages.js`): table/card/form builders and the toast/action/confirm
  message helpers all interpolated server/record data directly into HTML
  strings with no escaping. Added `app.util.escapeHtml()` (`lib/app.js`) and
  applied it everywhere untrusted text reaches the DOM:
  - table header labels, card field labels, and form field labels
    (`f.display.name || f.name`)
  - the related-record `<option>` dropdown in `form()` — the most directly
    exploitable path, since it wrote a real record's primary key and title
    field into `value="..."` and element text with zero escaping
  - delete/save failure messages passed to `app.messages.toast()`
  - `app.messages.toast()`, `action()`, and `confirm()` now escape their
    `message` argument before interpolating it into their templates.
    `confirm()`'s own dialog chrome (Confirm/Cancel buttons) is built
    separately from the escaped message and is not affected.
- **Duplicate pubsub subscriptions and click handlers on re-render**
  (`lib/app.render.js`): calling `app.render.build()` again on the same
  element (e.g. after a schema change) re-subscribed to
  `model:local:*:refresh`/`remove` and re-bound the `.sw-delete` click
  handler without removing the previous ones, so each stacked build()
  call multiplied `scope.update()`/`scope.remove()` invocations and delete
  requests per click. `table()`/`cards()` now record their subscriptions via
  a new `app.render._teardown($el)` helper (invoked before creating new
  ones) and namespace the delete click handler (`click.swRender`) so
  `.off()` only removes this module's own handler.

### Investigated, no fix needed

- The client-side `app.pubsub` in `lib/app.js` uses the same
  `String(pattern)` → `new RegExp(key)` round-trip as the bug found and
  fixed in `@simpleworkjs/backend`'s `lib/pubsub.js`. It isn't actually
  broken here because every caller in this package passes a plain string
  pattern (e.g. `'^model:local:' + modelName + ':refresh$'`), never a
  `RegExp` object, so the round-trip is a no-op. Worth keeping in mind if a
  future caller ever subscribes with a real `RegExp`.
