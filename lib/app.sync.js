/* SimpleWorkJS frontend sync layer.
 *
 * Two things live here:
 *
 *   app.sync.init()  — the legacy whole-list path. Listens to model:* events
 *                      and republishes model:local:* events that app.render's
 *                      generated views reload from.
 *
 *   app.sync.bind()  — bind a hand-written jq-repeat scope to a model so it
 *                      patches the single changed row in place. Works in any
 *                      app that has *some* pubsub bus and a jq-repeat scope;
 *                      it does not require app.render, app.model, or the
 *                      generated REST routes.
 *
 * bind() exists because a page should not have to be framework-generated to
 * stay live. Most real apps hand-write their tables, and before this the only
 * way to get live updates was to re-implement the whole listen/parse/patch
 * dance per view.
 */

(function($){
  'use strict';

  window.app = window.app || {};

  // ── event normalization ────────────────────────────────────────────────
  // Two pubsub dialects are in the wild and both are load-bearing:
  //
  //   framework  topic `model:<Model>:<action>`
  //              payload {model, action, pk, data}
  //              bus     app.pubsub.subscribe(patternString, fn) -> {remove}
  //
  //   app-base   topic `model:<Model>:<action>:<pk>`
  //              payload is the record itself
  //              bus     app.subscribe(RegExp, fn) -> undefined (no handle)
  //
  // Rather than force either side to migrate, normalize both into one shape.
  // Everything below this point deals only in {model, action, pk, record}.

  // Mutation verbs differ per dialect ('remove' vs 'delete', 'add' vs
  // 'create'). Collapse them to the three the DOM actually cares about.
  const ACTIONS = {
    add: 'create',
    create: 'create',
    update: 'update',
    save: 'update',
    remove: 'delete',
    delete: 'delete',
  };

  function normalizeEvent(topic, data){
    const parts = String(topic || '').split(':');

    // Framework payloads are self-describing, so trust them over the topic.
    if (data && data.model && data.action) {
      return {
        model: data.model,
        action: ACTIONS[data.action] || data.action,
        pk: data.pk,
        record: data.data,
      };
    }

    // app-base dialect: everything after the action is the pk. A pk may
    // legitimately contain ':' (LDAP DNs, IPv6 literals), so rejoin the tail
    // instead of taking parts[3].
    const pk = parts.length > 3 ? parts.slice(3).join(':') : undefined;
    return {
      model: parts[1],
      action: ACTIONS[parts[2]] || parts[2],
      pk: pk,
      record: data,
    };
  }

  // ── bus adapter ────────────────────────────────────────────────────────
  // Subscribe to every model event on whichever bus this app happens to have,
  // and hand the listener normalized events. Returns an unsubscribe function.
  function subscribeAll(listener){
    // Framework bus: patterns are strings compiled to RegExp, and subscribe
    // hands back a removal handle.
    if (app.pubsub && typeof app.pubsub.subscribe === 'function') {
      const sub = app.pubsub.subscribe('^model:', function(data, topic){
        listener(normalizeEvent(topic, data));
      });
      return function(){ if (sub && sub.remove) sub.remove(); };
    }

    // app-base bus: takes a real RegExp and offers no way to unsubscribe, so
    // the handle we return has to gate the listener itself.
    if (typeof app.subscribe === 'function') {
      let stopped = false;
      app.subscribe(/^model:/, function(data, topic){
        if (stopped) return;
        listener(normalizeEvent(topic, data));
      });
      return function(){ stopped = true; };
    }

    // No bus (e.g. sockets disabled). bind() still returns a working handle so
    // callers don't need to branch; the view simply never updates itself.
    return function(){};
  }

  // ── scope helpers ──────────────────────────────────────────────────────
  function resolveScope(scope){
    if (typeof scope === 'string') return $.scope && $.scope[scope];
    return scope;
  }

  // jq-repeat's single-argument lookups (`indexOf(5)`, `update(5, row)`) treat
  // a *number* as a positional index, not as a key value — so a model with a
  // numeric pk would silently patch row 5 instead of the record with id 5.
  // Always use the explicit two/three-argument key form with a stringified
  // value; jq-repeat compares those with String() coercion, so it still
  // matches a numeric field.
  function keyOf(scope, options){
    return options.key || scope.__jqIndexKey;
  }

  app.sync = {
    onAny: function(listener){
      return app.pubsub.subscribe('model:any', listener);
    },

    on: function(modelName, action, listener){
      return app.pubsub.subscribe('model:' + modelName + ':' + action, listener);
    },

    /**
     * Keep a jq-repeat scope in sync with a model's live events.
     *
     *   app.sync.bind('hosts', 'Host', {
     *     parse: hostParseRow,      // server record -> row object
     *     key: 'host',              // pk field; defaults to jq-index-key
     *     filter: fn(row),          // does this row belong in this list?
     *     fetch: fn(pk) -> promise, // re-fetch when the event carries no body
     *     reveal: true,             // scroll to + flash the changed row
     *   });
     *
     * Returns {unbind()}.
     *
     * Patches one row rather than reloading the list: a live table that
     * re-fetches everything on every event loses scroll position, selection,
     * and open dropdowns, and turns one user's edit into an O(n) refetch for
     * every other viewer.
     */
    bind: function(scopeName, modelName, options){
      // Single-object form: bind({scope, model, ...}).
      if (scopeName && typeof scopeName === 'object') {
        options = scopeName;
        modelName = options.model;
        scopeName = options.scope;
      }
      options = options || {};

      const parse = options.parse || function(record){ return record; };
      const reveal = options.reveal !== false;

      const unsubscribe = subscribeAll(function(event){
        if (event.model !== modelName) return;

        const scope = resolveScope(scopeName);
        // The view may not be built yet (or may have been torn down). A
        // missing scope is normal, not an error — the next full populate
        // picks up whatever was missed.
        if (!scope || typeof scope.indexOf !== 'function') return;

        const key = keyOf(scope, options);
        if (!key) {
          console.warn('app.sync: scope "' + scopeName + '" has no jq-index-key and no key option; cannot patch rows.');
          return;
        }

        // Deletes carry no body — the pk from the topic is all there is.
        if (event.action === 'delete') {
          if (event.pk !== undefined) {
            scope.remove(key, String(event.pk));
            changed();
          }
          return;
        }

        // Some publishers emit only a pk (or a bare `true`) for create/update.
        // Re-fetch the row when there's nothing renderable in the payload.
        const hasBody = event.record && typeof event.record === 'object';
        if (!hasBody) {
          if (typeof options.fetch === 'function' && event.pk !== undefined) {
            $.when(options.fetch(event.pk)).done(function(fetched){
              applyRow(scope, key, event.pk, fetched);
            });
          }
          return;
        }

        applyRow(scope, key, event.pk, event.record);
      });

      // Notify whoever cares that the scope's contents moved. app.filter uses
      // this to re-apply the active filter to a row that arrived live — a new
      // row must not appear in a filtered list it doesn't belong to.
      function changed(){
        if (typeof options.onChange === 'function') options.onChange();
      }

      function applyRow(scope, key, pk, record){
        const row = parse(record);
        if (!row || typeof row !== 'object') return;

        // Fall back to the row's own key when the topic carried no pk (the
        // framework dialect omits it on some adapters).
        const id = pk !== undefined ? pk : row[key];
        if (id === undefined) return;

        const index = scope.indexOf(key, String(id));

        // A row that no longer passes the view's filter must leave the list,
        // not sit there stale — an edit can move a record out of the filtered
        // set just as easily as a delete can.
        if (typeof options.filter === 'function' && !options.filter(row)) {
          if (index >= 0) {
            scope.remove(key, String(id));
            changed();
          }
          return;
        }

        if (index >= 0) {
          scope.update(key, String(id), row);
        } else {
          // New rows go to the top so an insert is visible without scrolling.
          // On a sorted scope jq-repeat ignores the position and inserts in
          // sort order, which is what that view asked for.
          scope.unshift(row);
        }
        changed();

        if (reveal && app.util && typeof app.util.revealItem === 'function') {
          // Let jq-repeat attach the element before drawing attention to it.
          setTimeout(function(){
            const item = scope.getByKey ? scope.getByKey(key, String(id)) : null;
            if (item && item.__jq_$el) app.util.revealItem(item.__jq_$el);
          }, 0);
        }
      }

      return {unbind: unsubscribe};
    },

    init: function(){
      // When any model changes, refresh all bound scopes for that model.
      this.onAny(function(data){
        const modelName = data.model;
        const pk = data.pk;

        // Re-fetch the changed record and notify renderers.
        app.model.get(modelName, pk).done(function(resp){
          app.pubsub.publish('model:local:' + modelName + ':refresh', {
            model: modelName,
            pk: pk,
            data: resp.data,
          });
        }).fail(function(){
          // Record may have been deleted; signal removal.
          app.pubsub.publish('model:local:' + modelName + ':remove', {
            model: modelName,
            pk: pk,
          });
        });
      });
    }
  };

  // app.ready() comes from app.js, which app-base apps do not load — they get
  // this file for bind() alone. Fall back to jQuery's ready so the file is
  // safe to drop into either stack.
  const onReady = typeof app.ready === 'function' ? app.ready : $;
  onReady(function(){
    // Only the framework bus drives init()'s republish path; app-base apps
    // have no app.pubsub/app.model for it to call.
    if (app.pubsub && typeof app.pubsub.subscribe === 'function' && app.model) {
      app.sync.init();
    }
  });

})(jQuery);
