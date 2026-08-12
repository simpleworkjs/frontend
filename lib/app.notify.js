/* SimpleWorkJS notifications: the bell, the feed, and desktop notifications.
 *
 * There is no separate notification stream, and no recipient resolution. A
 * notification system's hard problem is "who should see this", and the server's
 * socket read gate already answers it — live, per row, every time an event goes
 * out. So a notification is simply an event that reached you, and history is
 * those same events replayed through the same gate.
 *
 * This half is the browser: it listens to the events the views already react
 * to, renders them into a bell and a feed, and raises a desktop notification
 * when the tab is not in front of you. The server half needs to expose:
 *
 *   GET  <endpoint>        -> {results: [{model, action, target, actor, created_on}], unread, seen_at}
 *   PUT  <endpoint>/seen   <- {seen_at}
 *
 * "Unread" is one watermark per user rather than a read flag per item, so
 * opening the bell on one device clears the badge on all of them.
 *
 * Markup it binds to (id-based, so the shell owns the styling):
 *
 *   #notify-bell            container, revealed once the feed loads
 *   #notify-badge           unread count
 *   #notify-list            <ul> the feed renders into
 *   #notify-desktop-toggle  optional link to request desktop permission
 */

(function($){
	'use strict';

	window.app = window.app || {};

	// Defaults, overridable via app.notify.configure().
	const DEFAULTS = {
		// Where the feed and the watermark live, relative to app.api's base.
		endpoint: 'activity',
		// How long two events of the same model+action stay collapsed together.
		// One user action commonly writes several records — creating a resource
		// in theta-directory emits eleven events — and a bulk import emits
		// hundreds. The feed should say "203 resources updated", not scroll.
		collapseWindowMs: 60 * 1000,
		// model -> (pk) => url. Clicking a notification should land on the thing
		// that changed; without an entry the row renders unlinked. A collapsed
		// group has no single target, so it links to the same builder called
		// with an empty pk, trimmed to the list page.
		links: {},
		// Cap on rendered rows. History keeps everything the server returns.
		maxRows: 30,
	};

	// Where a notification takes you. The stored event is shape only —
	// model + pk — which is exactly enough to build a link, provided the target
	// page can open a record from its pk.

	let config = Object.assign({}, DEFAULTS);

	// Subscribe to every model event on whichever bus this app has. Same two
	// dialects app.sync deals with: the framework's app.pubsub (string patterns
	// compiled to RegExp, returns a removal handle) and app-base's
	// app.subscribe (real RegExp, no handle). Returns an unsubscribe function.
	function subscribeAll(listener){
		if (app.pubsub && typeof app.pubsub.subscribe === 'function') {
			const sub = app.pubsub.subscribe('^model:', listener);
			return function(){ if (sub && sub.remove) sub.remove(); };
		}
		if (typeof app.subscribe === 'function') {
			let stopped = false;
			app.subscribe(/^model:/, function(data, topic){
				if (!stopped) listener(data, topic);
			});
			return function(){ stopped = true; };
		}
		// No bus (sockets disabled): the feed still loads from history, it just
		// does not grow while the page is open.
		return function(){};
	}

	// Human wording. "Something was added over here" is the whole brief, so a
	// generic sentence built from model + action covers every model, including
	// ones added later that nobody remembered to write copy for.
	const VERBS = {create: 'added', update: 'updated', delete: 'removed'};

	function label(model){
		// CamelCase -> spaced words, lowercased: MeshExitGrant -> mesh exit grant
		return String(model).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
	}

	// A pk is only worth showing when it means something to a person. Host and
	// User are keyed on the hostname and the uid, which read well; Resource and
	// friends are keyed on a UUID, which is pure noise in a sentence. Shape-only
	// history has no display name to fall back on, so say nothing rather than
	// show a UUID — the link still takes you to the record.
	function readableTarget(target){
		if (!target) return '';
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) return '';
		if (/^[0-9a-f]{16,}$/i.test(target)) return '';
		return target;
	}

	function describe(group){
		const verb = VERBS[group.action] || group.action;
		if (group.count > 1) return group.count + ' ' + label(group.model) + 's ' + verb;
		const target = readableTarget(group.target);
		return label(group.model) + ' ' + verb + (target ? ': ' + target : '');
	}

	function linkFor(group){
		const build = config.links[group.model];
		if (!build) return null;
		// A collapsed group has no single target, so it links to the list the
		// records live on. Trim the empty trailing segment that leaves behind:
		// '/hosts/' would 404 where '/hosts' is the page you want.
		if (group.count > 1) return build('').replace(/\/+$/, '') || '/';
		return build(group.target);
	}

	// Collapse a time-ordered (newest first) event list into display groups.
	function collapse(events){
		const groups = [];
		for (const e of events) {
			const last = groups[groups.length - 1];
			const sameKind = last && last.model === e.model && last.action === e.action;
			const closeInTime = last && Math.abs(Number(last.oldest) - Number(e.created_on)) < config.collapseWindowMs;
			if (sameKind && closeInTime) {
				last.count++;
				last.oldest = e.created_on;
				continue;
			}
			groups.push({
				model: e.model,
				action: e.action,
				target: e.target,
				actor: e.actor,
				count: 1,
				created_on: e.created_on,
				oldest: e.created_on,
			});
		}
		return groups;
	}

	app.notify = {
		events: [],
		unread: 0,
		seenAt: 0,
		started: false,

		/**
		 * Per-app configuration. Call before ready, e.g. in the page shell:
		 *
		 *   app.notify.configure({
		 *     links: {
		 *       Host: (pk) => '/hosts/' + encodeURIComponent(pk),
		 *       Permission: () => '/permissions',
		 *     },
		 *   });
		 *
		 * Everything is optional; see DEFAULTS.
		 */
		configure: function(options){
			config = Object.assign({}, config, options || {});
			if (options && options.links) config.links = Object.assign({}, options.links);
			return config;
		},

		// Exposed for tests and for a shell that wants to re-render itself.
		config: function(){ return config; },

		// ── desktop notifications ────────────────────────────────────────────
		// Permission is only ever requested from a click (browsers ignore or
		// penalise unprompted requests, and a permission bubble on page load is
		// hostile). Nothing here fires while the tab is focused — you are
		// already looking at the page that just updated itself.
		desktopAvailable: function(){
			return typeof window.Notification !== 'undefined';
		},

		desktopEnabled: function(){
			return this.desktopAvailable() && window.Notification.permission === 'granted';
		},

		requestDesktop: function(){
			if (!this.desktopAvailable()) return Promise.resolve('unsupported');
			if (window.Notification.permission !== 'default') {
				return Promise.resolve(window.Notification.permission);
			}
			return window.Notification.requestPermission();
		},

		showDesktop: function(group){
			if (!this.desktopEnabled()) return;
			if (!document.hidden) return;
			try {
				const url = linkFor(group);
				const note = new window.Notification(describe(group), {
					body: group.actor ? 'by ' + group.actor : undefined,
					// Same tag replaces rather than stacks, so a burst of one
					// kind shows as a single desktop notification.
					tag: 'theta-' + group.model + ':' + group.action,
					renotify: false,
				});
				note.onclick = function(){
					window.focus();
					if (url) window.location.href = url;
					note.close();
				};
			} catch (error) {
				// Never let a notification break the page.
				console.error('desktop notification failed', error);
			}
		},

		// ── feed ─────────────────────────────────────────────────────────────
		load: function(){
			return $.when(app.api.get(config.endpoint)).done(function(data){
				app.notify.events = (data && data.results) || [];
				app.notify.unread = (data && data.unread) || 0;
				app.notify.seenAt = (data && data.seen_at) || 0;
				// Reveal only once the feed has actually loaded: that proves a
				// session AND the endpoint. Deliberately not keyed off
				// app-base's group CSS — the three apps' copies of app-base
				// have diverged, and proxy's has no synthetic 'login' group at
				// all, so the bell would silently never appear there.
				$('#notify-bell').show();
				app.notify.render();
			});
		},

		// An event arrived over the socket: it is, by definition, one you may
		// see — the server already applied the gate to send it.
		//
		// Two dialects reach here, as everywhere else in these apps. The ORM
		// publishes a self-describing {model, action, pk, data}; ModelPs puts
		// model/action/pk in the TOPIC and sends the bare record as the
		// payload. Normalize both, or the feed is silently dead in whichever
		// app uses the other one.
		push: function(payload, topic){
			const parts = String(topic || '').split(':');
			const fromTopic = parts[0] === 'model' && parts.length >= 3;
			const model  = (payload && payload.model)  || (fromTopic ? parts[1] : null);
			const action = (payload && payload.action) || (fromTopic ? parts[2] : null);
			if (!model || !action) return;

			// The record is the payload itself in the ModelPs dialect, and
			// payload.data in the ORM one.
			const record = (payload && payload.data) || payload || {};
			const pk = (payload && payload.pk !== undefined && payload.pk !== null)
				? payload.pk
				: (fromTopic && parts.length > 3 ? parts.slice(3).join(':') : '');

			const actor = record.updated_by || record.created_by || '';
			const event = {
				model: model,
				action: action,
				target: pk === undefined || pk === null ? '' : String(pk),
				actor: actor === '__NONE__' ? (record.created_by === '__NONE__' ? '' : record.created_by || '') : actor,
				created_on: Date.now(),
			};
			this.events.unshift(event);
			this.unread++;
			this.render();
			this.showDesktop(collapse([event])[0]);
		},

		markSeen: function(){
			const seen_at = Date.now();
			this.seenAt = seen_at;
			this.unread = 0;
			this.render();
			app.api.put(config.endpoint + '/seen', {seen_at});
		},

		render: function(){
			const $badge = $('#notify-badge');
			if ($badge.length) {
				$badge.text(this.unread > 99 ? '99+' : this.unread).toggle(this.unread > 0);
			}

			const $list = $('#notify-list');
			if (!$list.length) return;

			const groups = collapse(this.events).slice(0, config.maxRows);
			if (!groups.length) {
				$list.html('<li class="px-3 py-4 text-center text-muted small">Nothing yet.</li>');
				return;
			}

			$list.empty();
			groups.forEach(function(group){
				const url = linkFor(group);
				const unread = Number(group.created_on) > app.notify.seenAt;
				const when = window.moment ? moment(Number(group.created_on)).fromNow() : '';
				const $item = $('<li>').append(
					$('<a>')
						.addClass('dropdown-item d-flex align-items-start gap-2 py-2')
						.toggleClass('fw-semibold', unread)
						.attr('href', url || '#')
						.append(
							$('<span>').addClass('small').text(describe(group)),
							$('<span>').addClass('ms-auto text-muted small text-nowrap').text(when)
						)
				);
				$list.append($item);
			});
		},

		init: function(){
			if (!$('#notify-bell').length) return;
			// Idempotent: the shell may call this itself after configure(), and
			// it also runs on ready. Subscribing twice would count every event
			// twice and fire two desktop notifications for one change.
			if (this.started) return;
			this.started = true;

			this.load();

			// The same events the views react to. No separate stream.
			this.unsubscribe = subscribeAll(function(data, topic){
				app.notify.push(data, topic);
			});

			$('#notify-bell').on('show.bs.dropdown', function(){
				app.notify.markSeen();
			});

			$('#notify-desktop-toggle').on('click', function(e){
				e.preventDefault();
				e.stopPropagation();
				app.notify.requestDesktop().then(function(state){
					app.notify.renderDesktopToggle(state);
				});
			});

			this.renderDesktopToggle(this.desktopAvailable() ? window.Notification.permission : 'unsupported');
		},

		renderDesktopToggle: function(state){
			const $t = $('#notify-desktop-toggle');
			if (!$t.length) return;
			if (state === 'granted') $t.text('Desktop notifications on').addClass('text-success');
			else if (state === 'denied') $t.text('Desktop notifications blocked').addClass('text-muted');
			else if (state === 'unsupported') $t.hide();
			else $t.text('Enable desktop notifications');
		},
	};

	// app.ready() comes from app.js, which app-base apps do not load. Fall back
	// to jQuery ready so this file is safe to drop into either stack.
	const onReady = typeof app.ready === 'function' ? app.ready : $;
	onReady(function(){ app.notify.init(); });

})(jQuery);
