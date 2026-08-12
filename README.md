# @simpleworkjs/frontend

Browser-side JavaScript for [SimpleWorkJS](https://github.com/simpleworkjs) apps. It turns the backend's auto-generated REST API and `OPTIONS` schema endpoints into live, rendered UI with almost no per-page code.

> **Full API reference:** [`docs/app.md`](./docs/app.md) documents the entire
> `app` object — every namespace, method, property, event topic, and
> `data-sw-*` attribute. This README is the quick tour.

## What it provides

Everything hangs off a global `app` object:

| Namespace | Purpose |
|-----------|---------|
| `app.api` | jQuery AJAX wrapper for the REST API. |
| `app.model` | Schema-aware model client (list/get/create/update/remove) with a schema cache. |
| `app.pubsub` | In-browser publish/subscribe bus (regex topic matching). |
| `app.socket` | Socket.IO client, wired into `app.pubsub` for live model events. |
| `app.sync` | Live updates: bridges incoming `model:*` events into refresh events, and binds a jq-repeat scope to a model with `app.sync.bind()`. |
| `app.filter` | Search/facet filtering for a jq-repeat scope, client-side or server-side. |
| `app.render` | Builds Bootstrap tables, cards, and forms from the schema. |
| `app.messages` | Contextual action messages, confirm dialogs, and toasts. |
| `app.util` | Small helpers (`escapeHtml`, `formToObject`, `capitalize`, `uuid`). |
| `app.ready(cb)` | Run a callback once the DOM and socket are ready. |
| `$.fn.validate` / `$.validateSettings` | `[validate]` attribute-driven client-side form validation (mirrors, doesn't replace, server-side checks). |

## Loading the assets

When you use [`@simpleworkjs/backend`](https://github.com/simpleworkjs/backend), these files are served for you at `/lib/js/`, so include them directly:

```html
<script src="/socket.io/socket.io.js"></script>
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://unpkg.com/mustache@4.2.0/mustache.min.js"></script>
<script src="/lib/js/app.js"></script>
<script src="/lib/js/app.model.js"></script>
<script src="/lib/js/app.sync.js"></script>
<script src="/lib/js/app.filter.js"></script>
<script src="/lib/js/app.render.js"></script>
<script src="/lib/js/app.custom.js"></script>
<script src="/lib/js/app.validate.js"></script>
```

You can also resolve asset paths from Node (e.g. to bundle them yourself):

```js
const frontend = require('@simpleworkjs/frontend');
console.log(frontend.assets.app); // .../@simpleworkjs/frontend/lib/app.js
```

## `app.api`

A thin promise-returning ($.ajax) wrapper. Paths are whatever your API mounts (e.g. `/api/Task`).

```js
app.api.get('/api/Task', {done: false});     // GET, query params
app.api.options('/api/Task');                 // OPTIONS -> schema
app.api.post('/api/Task', {title: 'Buy milk'});
app.api.put('/api/Task/' + id, {done: true});
app.api.del('/api/Task/' + id);               // DELETE  (note: del, not delete)
```

> The delete method is `app.api.del` — `delete` is a reserved word, so it is not used as a method name.

## `app.model`

A higher-level client that fetches every model's schema on startup (via the API root + `OPTIONS`) and caches it. Prefer this over raw `app.api` when you want schema-aware helpers.

```js
app.model.ready(function () {          // fires once all schemas are loaded
  const schema = app.model.schema('Task');   // cached OPTIONS response

  app.model.list('Task', {done: false});     // -> {results: [...]}
  app.model.get('Task', id);                  // -> {data: {...}}
  app.model.create('Task', {title: 'New'});
  app.model.update('Task', id, {done: true});
  app.model.remove('Task', id);
  app.model.relatedList('Project', id, 'tasks'); // hasMany association
});
```

### Schema shape

The `OPTIONS` response cached by `app.model` (and returned by the backend) looks like:

```js
{
  name: 'Task',        // model name
  pk: 'id',            // primary-key field name
  display: {...},      // model-level display hints (name, titleField, ...)
  fields: {            // per-field metadata (this is the field map)
    title: {name: 'title', type: 'string', htmlType: 'text', display: {...}, ...},
    // ...
  },
  paths: {...},        // REST paths
}
```

## `app.render`

Declaratively render a model into an element with `data-sw-*` attributes, then call `app.render.build()`:

```html
<div data-sw-model="Task" data-sw-mode="table"></div>
<div data-sw-model="Task" data-sw-mode="card"></div>
<div data-sw-model="Task" data-sw-mode="form" data-sw-pk="..."></div>
```

```js
app.model.ready(function () {
  app.render.build('[data-sw-model]');
});
```

- `data-sw-mode="table"` — a Bootstrap table with View/Edit/Delete actions.
- `data-sw-mode="card"` — a card grid.
- `data-sw-mode="form"` — a create/edit form; supply `data-sw-pk` to edit an existing record.

Rendered tables and forms are bound to live scopes, so they update automatically when [`app.sync`](#appsync) reports a change. All rendered values are HTML-escaped.

## `app.pubsub` and `app.socket`

`app.socket` is a Socket.IO client. When the backend emits a model event it is republished onto the pubsub bus under two topics:

- `model:<Model>:<action>` — e.g. `model:Task:create`.
- `model:any` — every model event.

Topic patterns are matched as regular expressions:

```js
const sub = app.pubsub.subscribe('model:Task:.*', function (data, topic) {
  console.log(topic, data);
});
sub.remove(); // unsubscribe
```

## `app.sync`

The sync layer is what makes a page update by itself when anyone — another
user, a background job, or this tab — changes a record.

### Listening

```js
app.sync.on('Task', 'update', function (data) { /* ... */ });
app.sync.onAny(function (data) { /* every model change */ });
```

### `app.sync.bind()` — live updates for a hand-written table

`app.render`'s generated views are live automatically. `bind()` gives the same
behaviour to a table you wrote yourself, without adopting the renderer:

```js
app.sync.bind('hosts', 'Host', {
  key: 'host',            // pk field; defaults to the scope's jq-index-key
  parse: hostParseRow,    // server record -> row object
  filter: fn(row),        // optional: drop rows that don't belong in this list
  fetch: fn(pk),          // optional: re-fetch when an event carries no body
  reveal: true,           // scroll to + flash the changed row (default)
  onChange: fn(),         // called after the scope changes
});
```

It patches the single changed row rather than reloading the list, so scroll
position, checkbox selection and open dropdowns survive someone else's edit.

`bind()` normalizes both event dialects in use — the framework's
`model:<Model>:<action>` with a `{model, action, pk, data}` payload, and the
`model:<Model>:<action>:<pk>` form with a bare record — and works on either
`app.pubsub` or a plain `app.subscribe` bus. Returns `{unbind()}`.

## `app.filter`

Search and facet filtering for a jq-repeat scope.

```js
const filter = app.filter.bind('hosts', {
  input: '#hostSearch',              // search box
  fields: ['host', 'ip', 'domain.provider'],  // nested paths allowed
  facets: {
    ssl: function (row, value) { return value === 'any' || row.is_wildcard === (value === 'wildcard'); },
  },
  count: '#hostCount',               // optional "3 of 40 shown" readout
  threshold: 500,                    // switch to server mode above this
  fetch: function (state) { ... },   // required for server mode
});

filter.set('ssl', 'wildcard');
filter.clear();
```

The mode is chosen from the data rather than configured per view: a list
filters in the browser until it outgrows `threshold`, then queries the server
(debounced, with out-of-order responses discarded). Without a `fetch` it stays
client-side at any size rather than silently filtering nothing.

In client mode non-matching rows are hidden, not removed — clearing the search
brings them straight back with no re-fetch.

### `app.filter.live()` — filtering and live updates together

```js
const {filter, sync} = app.filter.live('hosts', 'Host', {
  input: '#hostSearch',
  fields: ['host', 'ip'],
  parse: hostParseRow,
});
```

Wires the two together so a row arriving over the socket is shown only if it
matches the filter that's active right now — and is still there, ready to
appear, when the filter is cleared.

## `app.messages`

Contextual UI feedback.

```js
// Contextual action message anchored to an element:
app.messages.action('Saved successfully', $form, 'success');

// Confirm a destructive action (resolves to a boolean):
const ok = await app.messages.confirm('Delete this record?', $target, 'danger');
if (ok) await app.api.del('/api/Task/' + id);

// Page-wide toast:
app.messages.toast('Welcome back, admin.', 'info');
```

## `app.util`

```js
app.util.escapeHtml(userInput);   // always escape before injecting into HTML
app.util.formToObject($form);     // serialize a form to a plain object
app.util.capitalize('task');      // 'Task'
app.util.uuid();                  // v4 UUID
```

## `$.fn.validate`

Attribute-driven client-side form validation, mirroring (not replacing) your
server-side checks:

```html
<form>
  <div class="form-group">
    <input name="password" validate="password">
    <b class="invalid-feedback"></b>
  </div>
  <div class="form-group">
    <input name="confirm" validate="eq:password">
    <b class="invalid-feedback"></b>
  </div>
</form>
```

```js
$('form').on('submit', function(event){
  if (!$(this).validate(event)) return; // event.preventDefault() already called
});
// or: $.validateInit(); // auto-wires every <form action="..."> on submit
```

Built-in rules: `eq:<fieldName>` (must match another field), `user` (uid-style
identifier), `password` (length/character-class policy), `ip` (dotted-quad).
Register your own with `$.validateSettings`:

```js
$.validateSettings({
  rule: {
    hostname: function(value){
      if (!/^[a-z0-9.-]+$/i.test(value)) return 'Enter a valid hostname';
    }
  }
});
```

A rule function returns a falsy value when the field is valid, or a message
string when it isn't; the message is written into the nearest
`b.invalid-feedback` and the field gets `is-invalid`/`is-valid`.

## License

MIT
