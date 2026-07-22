# The `app` object — complete frontend reference

`@simpleworkjs/frontend` attaches a single global, `window.app`, assembled from
the files under `lib/`. Each file adds one namespace and is safe to load in any
order (every file starts with `window.app = window.app || {}`). This document
covers the entire public surface.

## Contents

- [Loading and dependencies](#loading-and-dependencies)
- [Lifecycle: `app.ready` / `app.isReady`](#lifecycle)
- [`app.api`](#appapi) — REST wrapper
- [`app.model`](#appmodel) — schema-aware model client
- [`app.pubsub`](#apppubsub) — in-browser event bus
- [`app.socket`](#appsocket) — Socket.IO client
- [`app.sync`](#appsync) — server events → local refresh events
- [`app.render`](#apprender) — schema-driven Bootstrap UI (collection cards, forms)
- [`app.modal`](#appmodal) — reusable Bootstrap modal
- [`app.messages`](#appmessages) — action messages, confirms, toasts
- [`app.util`](#apputil) — helpers
- [`app.custom`](#appcustom) — per-page initializer registry
- [Event topics](#event-topics)
- [`data-sw-*` attributes](#data-sw-attributes)
- [Schema and field shape](#schema-and-field-shape)

---

## Loading and dependencies

The scripts are served by `@simpleworkjs/backend` at `/lib/js/`. Load them after
their third-party dependencies:

```html
<!-- dependencies -->
<script src="/socket.io/socket.io.js"></script>              <!-- app.socket -->
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script> <!-- everything -->
<script src="https://unpkg.com/mustache@4.2.0/mustache.min.js"></script> <!-- jq-repeat templating -->
<!-- Bootstrap 5 JS is required by app.messages.toast (bootstrap.Toast) -->

<!-- @simpleworkjs/frontend -->
<script src="/lib/js/app.js"></script>          <!-- api, pubsub, socket, util, ready -->
<script src="/lib/js/app.model.js"></script>    <!-- model -->
<script src="/lib/js/app.sync.js"></script>     <!-- sync -->
<script src="/lib/js/app.render.js"></script>   <!-- render -->
<script src="/lib/js/app.messages.js"></script> <!-- messages -->
<script src="/lib/js/app.custom.js"></script>   <!-- custom -->
```

| Dependency | Required by | Notes |
|------------|-------------|-------|
| **jQuery** | all modules | The whole library is an IIFE over `jQuery`. |
| **Socket.IO client** | `app.socket` | If `io` is undefined, `app.socket` stays `null` and live sync is disabled — everything else still works. |
| **jq-repeat + Mustache** | `app.render` tables/cards | `app.render` emits `jq-repeat` templates using `{{field}}` placeholders and drives them through `$.scope[name]`. |
| **Bootstrap 5 JS** | `app.messages.toast` | Uses `new bootstrap.Toast(...)`. |
| **Font Awesome** | `app.messages` | Confirm/close buttons use `fa-solid` icons (cosmetic). |

## Lifecycle

`app.ready(callback)` runs `callback` once the DOM is ready and the socket has
been wired up. If that has already happened it runs immediately.

```js
app.ready(function () {
  // DOM ready, app.socket connected (if Socket.IO is present)
});
```

- `app.isReady` — `boolean`, `true` after the ready phase has run.
- `app.onReady` — internal queue of pending callbacks (do not use directly).

`app.model` and `app.sync` register their own `app.ready` hooks: on ready,
`app.model.init()` loads all schemas and `app.sync.init()` starts bridging
server events. To run code after **schemas** are loaded, use
[`app.model.ready`](#appmodel), which is a distinct, later signal.

Ordering of readiness signals:

```
DOM ready ──▶ app.ready callbacks ──▶ app.model.init() ──▶ app.model.ready callbacks
             (socket wired)            (schemas fetched)
```

---

## `app.api`

Thin promise-returning wrapper over `$.ajax`; every method returns a jqXHR
(thenable / `.done()` / `.fail()`). All responses are parsed as JSON. Paths are
passed through verbatim (e.g. `/api/Task`).

| Method | Signature | HTTP |
|--------|-----------|------|
| `get` | `app.api.get(path, data?)` | `GET` (`data` → query string) |
| `options` | `app.api.options(path)` | `OPTIONS` (schema) |
| `post` | `app.api.post(path, data)` | `POST` (JSON body) |
| `put` | `app.api.put(path, data)` | `PUT` (JSON body) |
| `del` | `app.api.del(path)` | `DELETE` |

```js
app.api.get('/api/Task', {done: false});
app.api.post('/api/Task', {title: 'Buy milk'});
app.api.put('/api/Task/' + id, {done: true});
app.api.del('/api/Task/' + id);
```

> The delete method is **`del`**, not `delete` (`delete` is a reserved word).

---

## `app.model`

A schema-aware client layered on `app.api`. On startup it reads the API root
(`GET /api/`), then fetches every model's `OPTIONS` schema and caches it.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `schemas` | `object` | `{[modelName]: schemaResponse}` — cached `OPTIONS` responses. |
| `cache` | `object` | `{[modelName]: {}}` — per-model record cache (reserved for future use). |
| `isReady` | `boolean` | `true` once all schemas have loaded. |
| `lastEvent` | `object` | `{[modelName]: ms}` — timestamp of the last WebSocket event per model (shown in the Debug panel). |
| `readyCallbacks` | `array` | Internal queue for `ready()`. |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `ready(cb)` | — | Run `cb` once schemas are loaded (immediately if already ready). |
| `init()` | jQuery promise | Load the API root + all schemas. Called automatically on `app.ready`. |
| `schema(name)` | schema \| `undefined` | The cached `OPTIONS` response for a model. |
| `list(name, params?)` | promise → `{results, page, pageSize, total, pageCount}` | List a page; `params` (e.g. `{page, pageSize, where}`) become query args. |
| `get(name, pk)` | promise → `{data: {...}}` | Fetch one record. |
| `create(name, data)` | promise → `{data: {...}}` | Create. |
| `update(name, pk, data)` | promise → `{data: {...}}` | Update. |
| `remove(name, pk)` | promise → `{data: {...}}` | Delete. |
| `relatedList(name, pk, association)` | promise → `{results: [...]}` | `GET /api/:name/:pk/:association` for a `hasMany`. |

```js
app.model.ready(function () {
  const schema = app.model.schema('Task');   // see "Schema and field shape"
  app.model.list('Task', {done: false}).done(function (resp) {
    console.log(resp.results);
  });
});
```

---

## `app.pubsub`

A synchronous in-browser event bus. **Topic patterns are matched as regular
expressions** (`new RegExp(pattern).test(topic)`), so anchor them (`^…$`) when
you need an exact match.

| Member | Description |
|--------|-------------|
| `subscribe(pattern, listener)` | Returns `{remove()}`. `listener(data, topic)` is called for every published topic matching `pattern` as a regex. |
| `publish(topic, data)` | Invoke every listener whose pattern matches `topic`. A throwing listener is caught and logged; it does not stop the others. |
| `listeners` | Internal `{[pattern]: listener[]}` map. |

```js
const sub = app.pubsub.subscribe('^model:Task:(create|update)$', function (data, topic) {
  console.log(topic, data);
});
sub.remove();
```

---

## `app.socket`

The Socket.IO client instance (`io()`), or `null` when Socket.IO is not loaded.
It is created during the `app.ready` phase and bridges the server's
`model:event` channel onto `app.pubsub`:

```js
// internal wiring (app.js):
app.socket.on('model:event', function (data) {
  app.pubsub.publish('model:' + data.model + ':' + data.action, data);
  app.pubsub.publish('model:any', data);
});
```

You can use `app.socket` directly for custom events, but for model changes
prefer `app.sync` / `app.pubsub`.

---

## `app.sync`

Bridges *incoming* server model events into *local* refresh events that the
renderers consume. On `app.ready`, `app.sync.init()` subscribes to `model:any`;
for each change it re-fetches the record and republishes:

- `model:local:<Model>:refresh` → `{model, pk, data}` when the record still exists.
- `model:local:<Model>:remove` → `{model, pk}` when the fetch 404s (deleted).

| Method | Description |
|--------|-------------|
| `onAny(listener)` | Subscribe to every model event (`model:any`). Returns `{remove()}`. |
| `on(modelName, action, listener)` | Subscribe to `model:<modelName>:<action>` (e.g. `on('Task', 'update', fn)`). Returns `{remove()}`. |
| `init()` | Start the bridge. Called automatically. |

```js
app.sync.on('Task', 'create', function (data) { /* {model, action, pk, data} */ });
app.sync.onAny(function (data) { /* any model changed */ });
```

---

## `app.render`

Generates Bootstrap UI from a model's schema and binds it to live `jq-repeat`
scopes so it updates as `app.sync` reports changes. All interpolated values are
HTML-escaped.

| Method | Description |
|--------|-------------|
| `build(selector)` | For each matched element, read its `data-sw-*` attributes and render the requested mode. **Default mode is `collection`.** |
| `collection($el, name, schema)` | **The default view.** One card per collection (below). |
| `table($el, name, schema)` | Render a Bootstrap table with View/Edit/Delete actions. |
| `cards($el, name, schema)` | Render a responsive card grid. |
| `form($el, name, schema, pk?, options?)` | Render a create form, or an edit form when `pk` is given. `options` = `{modal, onSuccess}` (below). |
| `_reload(name, scopeName)` | Internal: re-fetch a model's list and `replace()` the bound jq-repeat scope. |
| `_teardown($el)` | Internal: remove the pubsub subscriptions a previous `build()` attached to `$el` (idempotent re-builds). |

### The `collection` view

The default. Renders one Bootstrap card per collection:

- **Header** — the collection title, plus **Debug**, **Permissions**, and **New**
  action buttons.
- **Body** — a paginated jq-repeat list of rows, each with **View**, **Edit**
  (modal), and **Delete** (confirm) actions.
- **Footer** — "Showing X–Y of N" and Prev/Next. Page size comes from
  `schema.display.pageSize` (default 20). The list re-fetches the current page on
  every live change.
- **Debug** button → a modal with the model's endpoints, permissions, field
  schema, and the last WebSocket update time (`app.model.lastEvent`).
- **Permissions** button → a read-only modal listing the required token(s) per
  action (from OPTIONS `permissions`) with a legend. (Editing arrives when
  permissions become DB-backed and runtime-configurable.)

Typical usage is fully declarative — mark up an element and call `build()`:

```html
<div data-sw-model="Task"></div>            <!-- defaults to the collection view -->
<div data-sw-model="Task" data-sw-mode="table"></div>
```

```js
app.model.ready(function () {
  app.render.build('[data-sw-model]');
});
```

Behavior notes:

- **Table** hides private fields and relationship (`references`) columns, adds
  View/Edit/Delete actions, and wires the Delete button through
  `app.messages.confirm` + `app.model.remove` + a toast.
- **Cards** use the model's `display.titleField` as the card title.
- **Form** renders one input per settable field (private-but-`writeOnly` fields
  like `password` are included), chooses the control from the field's `htmlType`
  (`checkbox`, `textarea`, otherwise a typed `<input>`), and for `hasOne` fields
  renders a `<select>` populated from the referenced model's records. Empty
  inputs are omitted from the payload. On submit it calls `create`/`update` and
  toasts the result. By default it redirects to the model's list page; in
  **modal mode** (`form($el, name, schema, pk, {modal: true, onSuccess})`) it
  instead calls `onSuccess` (the collection view uses this to close the modal —
  live sync refreshes the list).
- Re-running `build()` on the same element is safe — it tears down the previous
  subscriptions first.

---

## `app.modal`

A thin wrapper over Bootstrap's modal, reused for the New/Edit forms, the Debug
panel, and the Permissions viewer. One modal element is appended to `<body>`.

| Method | Description |
|--------|-------------|
| `open({title, bodyHtml, size, onShown})` | Show the modal with the given content; returns the `$body` jQuery element. `size` is `'sm'`/`'lg'`/`'xl'`. |
| `close()` | Hide the modal. Force-hides as a fallback if Bootstrap's fade `transitionend` never fires (reduced motion / a backgrounded tab), so it can't get stuck open. |
| `body()` | The current modal `$body`. |

---

## `app.messages`

User-facing feedback. `action` and `confirm` render into the nearest
`.actionMessage` element inside the target's `.card` (falling back to a toast
when there is none); `toast` is always page-wide. All messages are HTML-escaped.

| Method | Signature | Description |
|--------|-----------|-------------|
| `action` | `action(message, $target, type?, callback?)` | Inline, dismissible message near `$target`. `type` is a Bootstrap contextual color (default `info`). Falls back to a toast if no `.actionMessage` target exists. |
| `confirm` | `confirm(message, $target, type?)` → `Promise<boolean>` | Inline confirm with Confirm/Cancel buttons; resolves `true`/`false`. `type` default `warning`. |
| `toast` | `toast(message, type?)` | Page-wide Bootstrap toast (auto-stacked, auto-dismiss). `type` default `info`. |

```js
app.messages.action('Saved', $form, 'success');

if (await app.messages.confirm('Delete this record?', $target, 'danger')) {
  await app.api.del('/api/Task/' + id);
}

app.messages.toast('Welcome back.', 'info');
```

`type` values map to Bootstrap contextual classes: `info`, `success`, `warning`,
`danger`, `primary`, `secondary`, `dark`, `light`.

---

## `app.util`

| Method | Description |
|--------|-------------|
| `escapeHtml(s)` | Escape `& < > " '`. Returns `''` for `null`/`undefined`. Always use before injecting untrusted data into HTML. |
| `formToObject($form)` | Serialize a form to a plain object; repeated names become arrays. |
| `capitalize(s)` | Uppercase the first character. |
| `uuid()` | Generate a v4 UUID string. |

---

## `app.custom`

A registry for per-page initializers, so custom page JS stays organized and
testable instead of scattered inline.

| Member | Description |
|--------|-------------|
| `register(name, init)` | Register an initializer function under `name`. |
| `run(name)` | Run a registered initializer (warns if none registered). |
| `registry` | The `{[name]: init}` map. |

On DOM ready, if `<body data-sw-custom="name">` is present, that initializer runs
automatically.

```js
app.custom.register('dashboard', function () {
  app.render.build('[data-sw-model]');
});
```
```html
<body data-sw-custom="dashboard">
```

---

## Event topics

| Topic | Emitted by | Payload |
|-------|------------|---------|
| `model:event` (Socket.IO) | server (`@simpleworkjs/backend`) | `{model, action, pk, data}` — `action` ∈ `create`/`update`/`delete` |
| `model:<Model>:<action>` (pubsub) | `app.socket` bridge | same payload |
| `model:any` (pubsub) | `app.socket` bridge | same payload |
| `model:local:<Model>:refresh` (pubsub) | `app.sync` | `{model, pk, data}` |
| `model:local:<Model>:remove` (pubsub) | `app.sync` | `{model, pk}` |

`app.render` subscribes to the two `model:local:*` topics to update/remove rows
in its bound scopes.

## `data-sw-*` attributes

| Attribute | On | Values | Meaning |
|-----------|----|--------|---------|
| `data-sw-model` | render target | model name | Which model to render. |
| `data-sw-mode` | render target | `collection` \| `table` \| `card` \| `form` | Render style (default `collection`). |
| `data-sw-pk` | render target (form) | primary key | Edit an existing record; omit to create. |
| `data-sw-custom` | `<body>` | initializer name | Auto-run `app.custom.run(name)` on load. |

## Schema and field shape

`app.model.schema(name)` returns the model's `OPTIONS` response:

```js
{
  name: 'Task',   // model name
  pk: 'id',       // primary-key field name
  display: {name, titleField, pageSize, ...},  // pageSize: default rows per page
  fields: {       // <-- the field map (read from `.fields`)
    title: {/* field schema, below */},
    // ...
  },
  permissions: {  // per-action token summary (for the API docs / debug views)
    read: ['user'], create: ['admin'], update: ['owner'], delete: ['admin'],
  },
  access: {       // tiered grants the Permissions editor reads/writes
    owner:    {create: false, read: true, update: true, delete: true},
    group:    {create: false, read: false, update: false, delete: false},
    everyone: {create: false, read: true, update: false, delete: false},
  },
  paths: {
    base: [/* CRUD REST paths */],
    methods: [/* exposed custom methods, if any (see below) */],
  },
}
```

The **list** endpoint (`app.model.list(name, {page, pageSize, where})`) responds
with `{results, page, pageSize, total, pageCount}`.

Each entry in `fields` has this shape (from the ORM's field `toSchema()`):

| Key | Description |
|-----|-------------|
| `name` | Field name. |
| `type` | ORM type (`string`, `boolean`, `uuid`, `hasOne`, …). |
| `jsType` | JS type hint (`string`, `number`, `boolean`, `array`). |
| `htmlType` | Input type used by `app.render.form` (`text`, `textarea`, `checkbox`, `number`, `datetime-local`, `email`, `password`, `select`, `hidden`). |
| `allowNull` | `false` when the field is required. |
| `primaryKey` | `true` for the PK. |
| `defaultValue` | Column default, if any. |
| `unique` | Unique constraint flag. |
| `isPrivate` | `true` → hidden from tables/cards/forms. |
| `display` | UI hints (`name`, `searchable`, …). |
| `form` | Form-rendering hints. |
| `validate` | Validators. |
| `foreignKey` | Relationship fields only — the FK column (e.g. `ownerId`). |
| `references` | Relationship fields only — `{type: 'hasOne'\|'hasMany', model, as, localKey, remoteKey, nullable}`. |

### Exposed methods (`paths.methods`)

If a model declares custom endpoints (see the backend's "Exposed methods"),
`OPTIONS` advertises them under `paths.methods` so a client can discover and
call them. Each entry:

| Key | Description |
|-----|-------------|
| `method` | The model method name. |
| `route` | URL segment appended to the model path. |
| `verb` | HTTP verb (`get`, `post`, `put`, `delete`, …). |
| `kind` | `'instance'` (runs on one record, mounted under `/:pk`) or `'static'` (runs on the model). |
| `path` | Full URL template, e.g. `/Thread/:id/invite` or `/Thread/search`. |
| `args` | `{from: 'body'\|'params'\|'query', names?: [...]}` or `null`. |
| `permission` | Permission token required to call it. |
| `description` | Human-readable summary (`''` if none). |
