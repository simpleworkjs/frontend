# @simpleworkjs/frontend

Browser-side JavaScript package for [SimpleWorkJS](https://github.com/simpleworkjs) apps.

## What it provides

- `app.api` — jQuery AJAX wrapper for the auto-generated REST API.
- `app.pubsub` — in-browser publish/subscribe bus.
- `app.socket` — Socket.IO client wired into the pubsub bus for live model sync.
- `app.render` — build tables and cards from the `OPTIONS` schema endpoints.
- `app.model` — model helpers and ready queue.
- `app.messages` — action messages, confirmation dialogs, and page-wide notifications.
- `app.util` — form serialization and small helpers.

## Usage

Include after jQuery, Mustache, and the Socket.IO client:

```html
<script src="/socket.io/socket.io.js"></script>
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://unpkg.com/mustache@4.2.0/mustache.min.js"></script>
<script src="/lib/js/simpleworkjs-frontend.min.js"></script>
```

Or load individual modules from the package:

```html
<script src="/lib/js/app.js"></script>
<script src="/lib/js/app.render.js"></script>
<script src="/lib/js/app.model.js"></script>
<script src="/lib/js/app.sync.js"></script>
<script src="/lib/js/app.messages.js"></script>
```

## Messages and confirmations

Show a contextual action message:

```js
app.messages.action('Saved successfully', $form, 'success');
```

Ask the user to confirm a destructive action:

```js
const ok = await app.messages.confirm('Delete this record?', $target, 'danger');
if (ok) {
  await app.api.delete('Task/' + id);
}
```

Show a page-wide toast:

```js
app.messages.toast('Welcome back, admin.', 'info');
```

## License

MIT
