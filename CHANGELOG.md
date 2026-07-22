# Changelog

## 0.2.4

### Changed

- Republish to keep the frontend version aligned with the rest of the 0.2.x
  permission-stack release (backend 0.2.5 requires `frontend ^0.2.3`; this is a
  no-op bump so the shipped stack advertises a single, current set of versions).
  No code changes from 0.2.3.

## 0.2.3

### Changed

- **The collection Permissions modal is now an editable grid** (was read-only).
  It shows the model's `{owner, group, everyone} × {create, read, update, delete}`
  access grants; admins (per `app.currentUser.isAdmin`) can toggle and **Save**
  (PUT `/api/_access/:model`), others see it read-only. Grants are fetched live
  from the server so concurrent edits are reflected.

## 0.2.2

### Added

- **Collection card view (`app.render.collection`), now the default render mode.**
  One card per collection: header with a title and Debug / Permissions / New
  actions; a list body with View/Edit/Delete per row; a paginated footer
  ("Showing X–Y of N" + Prev/Next). Page size comes from the model
  (`display.pageSize`, default 20).
- **`app.modal`** — a small Bootstrap-modal helper (`open`/`close`/`body`) used
  for the New/Edit forms, the Debug panel, and the (read-only) Permissions
  viewer. `close()` force-hides as a fallback so the modal can't get stuck open
  when the fade `transitionend` doesn't fire (reduced motion / backgrounded tab).
- **`app.render.form` modal mode** (`{modal, onSuccess}`): saves without a
  full-page redirect, closing the modal and letting live sync refresh the list.
- **`app.model.lastEvent`** — timestamp of the last WebSocket event per model,
  shown in the Debug panel. `app.model.list` forwards `{page, pageSize}`.

### Fixed

- **Forms submitted empty strings for unset fields** (an unselected foreign-key
  dropdown or a blank number field), which failed server-side FK/number
  validation. Empty inputs are now omitted from the payload.

## 0.2.1

### Fixed

- **Live updates now work for creates, edits, and deletes** (`lib/app.render.js`):
  the table/card renderers patched individual rows via jq-repeat's
  `scope.update()`/`scope.remove()`, which did not reliably re-render live rows —
  a record created in another session didn't appear, and edits to a live row
  weren't reflected. On any live change the renderer now re-fetches the model's
  list and hands it to jq-repeat's `replace()` (the reliable render path). New
  `_reload()` helper; verified end-to-end in a browser (create/update/delete).
- **Password (and other write-only) fields now appear on create/edit forms**
  (`lib/app.render.js`): the form builder filtered out every private field, so a
  `password-bcrypt` field (private) had no input — you couldn't set a password
  when creating or editing a user. It now includes `writeOnly` fields (see
  `@simpleworkjs/orm` ≥ 0.2.2), marks them required only on create, and drops an
  empty value on edit (blank = keep current).

## 0.2.0

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
