# Changelog

## 0.4.2

### Added

- **`app.notify` rich model icons & live foreground toasts**:
  - Automatically renders FontAwesome category icons in notification rows (`User`, `Group`, `Host`, `Resource`, `Service`, `Cert`, `ApiToken`, `MeshSite`, `MeshClient`, `AccessRequest`, etc.). Configurable per-app with `app.notify.configure({icons: {...}})`.
  - Added live foreground toast popup support (`config.toast: true`), seamlessly invoking `app.messages.toast` when an authorized event arrives while the tab is active.
  - Added `app.notify.clear()` to empty client event history and advance the watermark.
  - Bound `#notify-mark-read` and `#notify-clear` buttons for interactive dropdown control.

## 0.4.1

### Fixed

- **`app.messages.confirm(message, null, type)` threw instead of showing a
  dialog.** `renderActionHtml` called `.closest()` directly on whatever
  `$target` it was passed, so a page that calls `confirm()` with no inline
  `.actionMessage` target (a documented, commonly-used form — the caller
  passes `null` when it wants the toast fallback) crashed with `Cannot read
  properties of null (reading 'closest')` before the Confirm/Cancel buttons
  were ever wired up. `$targetPassed` is now normalized to an empty jQuery
  object when it isn't one already.
- **`confirm()` had no toast fallback at all** — unlike `action()`, the
  "no `.actionMessage` on this page" path just logged a console warning and
  left the returned promise pending forever, so a confirm button on a page
  with no inline target looked like it silently did nothing (worse than the
  crash above once that was fixed on its own). `confirm()` now renders its
  dialog into a non-autohiding, non-dismissable toast in that case — same
  escalation `action()` already used for a plain message, extended to host
  interactive buttons.

## 0.4.0

### Added

- **`app.notify`**: a notification bell, feed and desktop notifications, driven
  by the model events the framework already publishes. There is no separate
  notification stream and no recipient resolution — a notification system's hard
  problem is "who should see this", and the server's socket read gate already
  answers it live, per row. A notification is an event that reached you, and
  history is those events replayed through the same gate.
  - Configurable per app via `app.notify.configure({links, endpoint,
    collapseWindowMs, maxRows})`. `links` maps a model to a URL builder so
    clicking a notification lands on the record that changed.
  - Collapses same-model+action events inside a time window. This is not
    cosmetic: one user action commonly writes several records — creating a
    resource in a directory app emits eleven events, a bulk import emits
    hundreds — so an uncollapsed feed is unusable. History keeps every row.
  - Reads both event dialects, like `app.sync`: the framework's self-describing
    `{model, action, pk, data}` and the topic-carried
    `model:<Model>:<action>:<pk>` with a bare record. Written for one alone, the
    feed is silently dead in an app using the other — the socket delivers events
    and the badge never moves.
  - Desktop notifications via the Web Notifications API: permission is only ever
    requested from a click, nothing fires while the tab is focused, and repeats
    of the same model+action reuse the `tag` so a burst replaces rather than
    stacks.
  - The bell reveals itself once the feed loads, rather than depending on an
    app-specific "logged in" CSS class — those have a habit of diverging between
    apps, and the bell then silently never appears.
  - `init()` is idempotent: a shell may call it after `configure()`, and it also
    runs on ready. Subscribing twice would count every event twice and fire two
    desktop notifications for one change.
  - Placeholder actors (`__NONE__`, written by a record created and never
    updated) are not reported as the person who did it.
  - A UUID primary key is left out of the wording, since it reads as noise, but
    the row keeps its link to the record.

## 0.3.1

Three fixes, all found by driving 0.3.0 in a real browser rather than a test DOM.

### Fixed

- **Filtered rows carrying a Bootstrap display utility were never actually
  hidden.** `app.filter` used jQuery's `.hide()`, which writes a plain inline
  `display: none` — and that loses to `.d-flex` / `.d-block` / `.d-grid`,
  declared `!important` in Bootstrap's stylesheet. Any list-group row, card
  grid cell or flex row stayed on screen while the filter's own count
  correctly reported it as filtered out. Hiding now writes an `!important`
  inline rule and restores the element's previous inline display on the way
  back, so it falls back to its class exactly as before.
- **The count denominator went stale.** A view that reports its server total
  via `setTotal()` kept that number as the denominator forever, so a row
  arriving live (or being deleted) produced readouts like "6 of 4 shown". In
  client mode the browser holds the whole set, so the scope length is the
  total; `setTotal` now only fixes the denominator in server mode, where the
  browser really does hold just one page.
- **A wrong pk in an event topic could duplicate a row.** `app.sync.bind()`
  trusted the topic's pk over the record's own key. Publishers get this wrong:
  theta42's `ModelPs` published the *class* name as the pk for every model
  keyed on `name`, because a class always has a built-in `.name`. The lookup
  then matched nothing and appended a second copy of the record on every
  update. The record is now authoritative about its own identity, with the
  topic pk as the fallback (still used for deletes, which carry no body).

## 0.3.0

### Added

- **`app.sync.bind(scope, model, options)`**: live updates for a table you
  wrote yourself. Previously the only way to get a self-updating list was to
  build it with `app.render`; any hand-written `jq-repeat` view had to
  re-implement the listen/parse/patch dance per page, so in practice most
  pages simply never updated. `bind()` needs nothing but a `jq-repeat` scope
  and a pubsub bus — no `app.render`, no `app.model`, no generated REST
  routes. Options: `key`, `parse`, `filter`, `fetch`, `reveal`, `onChange`.
  Returns `{unbind()}`.
  - Patches the one changed row instead of reloading the list, so scroll
    position, checkbox selection and open dropdowns survive another user's
    edit — and one person's change doesn't cost every other viewer a full
    refetch.
  - Normalizes both event dialects in circulation: the framework's
    `model:<Model>:<action>` with a `{model, action, pk, data}` payload, and
    the `model:<Model>:<action>:<pk>` form carrying a bare record. Works on
    either an `app.pubsub` bus or a plain `app.subscribe` one, so the same
    file drops into apps that load only part of this package.
  - Always looks rows up by explicit key. `jq-repeat` reads a lone numeric
    argument as a *positional index*, so any model with an integer primary key
    would otherwise patch row 5 rather than the record with id 5.
  - A pk containing `:` (LDAP DNs, IPv6 literals) is rejoined rather than
    truncated at the first colon.

- **`app.filter`**: search and facet filtering for a `jq-repeat` scope, with
  `bind(scope, options)` and `live(scope, model, options)`.
  - Chooses client- or server-side from the data rather than per-view config:
    a list filters in the browser until it outgrows `threshold`, then queries
    the server (debounced, discarding out-of-order responses). The same view
    is a 12-row table on one install and a 12,000-row table on another, and
    neither should need a code change. With no `fetch` it stays client-side at
    any size rather than silently filtering nothing.
  - Client mode hides non-matching rows instead of removing them, so clearing
    the search restores them instantly with no refetch and no DOM rebuild.
  - Search spans several fields, including nested paths (`domain.provider`),
    case-insensitively; `facets` add named predicates that AND with it.
    Optional `count` element renders a "3 of 40 shown" readout.
  - `live()` wires filtering and live sync together: a row arriving over the
    socket appears only if it matches the filter that's currently active, and
    is still present — ready to show — once that filter is cleared.

### Testing

- Integration tests run against the real `jq-repeat` (added as a
  devDependency) rather than a scope stand-in. A stub can agree with a wrong
  assumption; the library cannot — this is what caught the numeric-primary-key
  bug above.
- `npm test` now runs the whole `test/` directory (it previously matched
  nothing and exited non-zero).

## 0.2.7

### Added

- **`app.util.revealItem(el)`**: scrolls a just-added/-edited element into
  view (`scrollIntoView({behavior: 'smooth', block: 'center'})`) and flashes
  its background using a Bootstrap 5 CSS variable, fading back to normal.
  Accepts a jQuery object or a raw DOM node (e.g. `jq-repeat`'s
  `item.__jq_$el`) — the standard "show the user where their change landed"
  behavior for post-create/edit list refreshes.

## 0.2.6

### Added

- **`app.modal` standardized entity-modal support**: optional `tabs` (nav-tabs
  + tab-content, matching the pattern already used for proxy's host modal),
  optional `footer` (`metaHtml` left / `buttonsHtml` right — the footer
  element is entirely absent when omitted, and any stale footer from a
  previous `open()` call is removed so it can't leak into a later bare
  caller), and optional `url` (pushes a linkable path on open, restores the
  prior path on close, and closes the modal on browser Back/Forward via
  `popstate` instead of re-pushing history). All three are opt-in — existing
  `{title, bodyHtml, size, onShown}` callers are unaffected.
- **`app.modal.showTab(id)`**, **`app.modal.on(event, selector, handler)`**
  (a delegated binding that survives `open()`'s per-call DOM rebuild — the one
  pattern callers should reach for instead of binding directly to inner
  elements, which silently stop firing after the first open),
  **`app.modal.deepLinkSlug(basePath)`** (slug from `location.pathname` for a
  `url`-tracked modal's deep-link open-on-load), **`app.modal.formatAudit(record, {formatDate})`**
  (standard "Created by X on Y · Updated by X on Y" footer text for the
  `created_by`/`created_on`/`updated_by`/`updated_on` convention already used
  by several models across the theta42 apps), and **`app.modal.footerButtons({onSave, saveLabel, closeLabel, extraHtml})`**
  (the standard Close+Save button pair).

## 0.2.5

### Added

- **`lib/app.validate.js`** — `[validate]` attribute-driven client-side form
  validation (`$.fn.validate`, `$.fn.validateField`, `$.validateSettings`,
  `$.validateInit`), upstreamed from the theta42 apps' identical vendored
  `val.js`. Standalone (no `app.*` namespace, no dependency on `app.js`).
  Ships with generic rules only (`eq`, `user`, `password`, `ip`); app-specific
  rules (e.g. hostname/wildcard validation) stay app-side via
  `$.validateSettings`. Fixed a latent bug in the ported `validateInit`: its
  submit handler called `.validate(settingsObj, event)`, but `validate()` only
  ever took one argument (`event`), so the second argument was always silently
  dropped.

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
