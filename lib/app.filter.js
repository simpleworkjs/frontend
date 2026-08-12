/* SimpleWorkJS frontend filter layer.
 *
 * Filtering for jq-repeat scopes, in two modes behind one API:
 *
 *   client mode — the whole set is already loaded and small enough that
 *                 matching in the browser is instant. Non-matching rows are
 *                 hidden, not removed, so nothing is re-fetched and nothing
 *                 is re-rendered.
 *
 *   server mode — the set is too big to ship to the browser. Filter state is
 *                 sent to the API (debounced) and the scope is replaced with
 *                 the page of results that comes back.
 *
 * The mode is chosen from the data, not configured per view: a list stays
 * client-side until it outgrows `threshold`, then switches by itself. That
 * matters because the same view is a 12-row table on one install and a
 * 12,000-row table on another, and neither should need a code change.
 *
 * Pairs with app.sync.bind(): pass the filter's `matches` to bind()'s
 * `filter` option (or use app.filter.live() to wire both at once) so a row
 * that arrives over the socket lands in the list only if it belongs there.
 */

(function($){
  'use strict';

  window.app = window.app || {};

  const DEFAULT_THRESHOLD = 500;
  const DEFAULT_DEBOUNCE = 250;

  function resolveScope(scope){
    if (typeof scope === 'string') return $.scope && $.scope[scope];
    return scope;
  }

  // Read a possibly-nested field ('domain.provider') off a row.
  function valueAt(row, path){
    if (!row) return undefined;
    if (path.indexOf('.') === -1) return row[path];
    return path.split('.').reduce(function(acc, part){
      return acc == null ? acc : acc[part];
    }, row);
  }

  // Substring match, case-insensitive, over the configured fields. Values are
  // stringified so numbers and booleans are searchable too.
  function textMatches(row, fields, needle){
    if (!needle) return true;
    const q = String(needle).toLowerCase();
    for (const field of fields) {
      const value = valueAt(row, field);
      if (value == null) continue;
      if (String(value).toLowerCase().indexOf(q) !== -1) return true;
    }
    return false;
  }

  app.filter = {
    /**
     * Build a filter bound to a jq-repeat scope.
     *
     *   const filter = app.filter.bind('hosts', {
     *     input: '#hostSearch',       // search box (selector or element)
     *     fields: ['host', 'ip'],     // fields the search box matches against
     *     facets: {                   // named extra predicates
     *       ssl: function(row, value){ return value === 'any' || row.ssl === value; },
     *     },
     *     count: '#hostCount',        // optional "showing X of Y" target
     *     threshold: 500,             // switch to server mode above this
     *     fetch: function(state){ ... },  // required for server mode
     *     parse: hostParseRow,
     *   });
     *
     * Returns the filter: {state, matches(row), set(name, value), clear(),
     * refresh(), mode(), destroy()}.
     */
    bind: function(scopeName, options){
      options = options || {};

      const fields = options.fields || [];
      const facets = options.facets || {};
      const threshold = options.threshold == null ? DEFAULT_THRESHOLD : options.threshold;
      const debounceMs = options.debounce == null ? DEFAULT_DEBOUNCE : options.debounce;
      const parse = options.parse || function(record){ return record; };

      const state = {search: '', facets: {}};
      let serverMode = false;
      let total = null;       // server-reported total, when known
      let debounceTimer = null;
      let reapplyTimer = null;
      let pending = null;     // in-flight server request, for out-of-order guarding
      let destroyed = false;

      const filter = {
        state: state,

        // The predicate. Exported so app.sync.bind() can use the very same
        // decision for rows that arrive over the socket — otherwise a live
        // insert would bypass the filter and show a row the user filtered out.
        matches: function(row){
          if (!textMatches(row, fields, state.search)) return false;
          for (const name of Object.keys(facets)) {
            const value = state.facets[name];
            if (value === undefined) continue;
            try {
              if (!facets[name](row, value)) return false;
            } catch (error) {
              console.error('app.filter: facet "' + name + '" threw', error);
            }
          }
          return true;
        },

        mode: function(){ return serverMode ? 'server' : 'client'; },

        set: function(name, value){
          if (name === 'search') state.search = value;
          else state.facets[name] = value;
          schedule();
          return filter;
        },

        clear: function(){
          state.search = '';
          state.facets = {};
          if (options.input) $(options.input).val('');
          schedule();
          return filter;
        },

        // Re-apply the current filter without re-querying. Called after the
        // scope changes underneath us (a live insert, a manual populate).
        //
        // Runs twice: now, and again on the next tick. A row inserted by a
        // live event may not have its element attached yet at the moment we
        // are called, and a row we cannot see we cannot hide — without the
        // second pass a socket insert would stay visible in a filtered list.
        refresh: function(){
          if (!serverMode) applyClient();
          updateCount();
          if (serverMode || reapplyTimer) return;
          reapplyTimer = setTimeout(function(){
            reapplyTimer = null;
            if (destroyed || serverMode) return;
            applyClient();
            updateCount();
          }, 0);
        },

        // Tell the filter how big the underlying set really is. A view that
        // knows the server's total (from a list response) should pass it, so
        // mode selection reflects the whole set rather than the first page.
        setTotal: function(n){
          total = n;
          chooseMode();
          return filter;
        },

        destroy: function(){
          destroyed = true;
          clearTimeout(debounceTimer);
          clearTimeout(reapplyTimer);
          if (options.input) $(options.input).off('.swFilter');
        },
      };

      // ── mode selection ───────────────────────────────────────────────────
      function chooseMode(){
        // Without a fetch() there is nothing to switch to; stay client-side
        // however big the list gets rather than silently filtering nothing.
        if (typeof options.fetch !== 'function') { serverMode = false; return; }
        const scope = resolveScope(scopeName);
        const known = total != null ? total : (scope ? scope.length : 0);
        serverMode = known > threshold;
      }

      // ── client mode ──────────────────────────────────────────────────────
      // Hide/show rather than rebuild: a filtered table keeps its DOM, so
      // scroll position, checkbox selection and open dropdowns all survive
      // typing in the search box.
      function applyClient(){
        const scope = resolveScope(scopeName);
        if (!scope) return 0;
        let shown = 0;
        for (const row of scope) {
          const visible = filter.matches(row);
          if (visible) shown++;
          const $el = row && row.__jq_$el ? $(row.__jq_$el) : null;
          if ($el && $el.length) {
            // Deliberately no $el.stop() here. Cancelling in-flight
            // animations would also jump a view's `take` hook (commonly
            // fadeOut(500, remove)) straight to its completion callback,
            // removing a row early, on any unrelated refresh. jQuery sets
            // `display` once when a fade starts and animates only opacity
            // afterwards, so show()/hide() is not fighting the animation.
            if (visible) $el.show(); else $el.hide();
          }
        }
        return shown;
      }

      // ── server mode ──────────────────────────────────────────────────────
      function applyServer(){
        const request = {
          search: state.search,
          facets: $.extend({}, state.facets),
          page: 1,
          pageSize: options.pageSize || threshold,
        };
        pending = request;

        $.when(options.fetch(request)).done(function(resp){
          // Ignore a response that a later keystroke has already superseded,
          // or the list flickers back to stale results.
          if (destroyed || pending !== request) return;

          const rows = (resp && resp.results ? resp.results : resp || []).map(parse);
          const scope = resolveScope(scopeName);
          if (scope && typeof scope.replace === 'function') scope.replace(rows);

          if (resp && typeof resp.total === 'number') total = resp.total;
          updateCount(rows.length);
        });
      }

      function schedule(){
        chooseMode();
        if (!serverMode) { filter.refresh(); return; }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(applyServer, debounceMs);
      }

      // ── count readout ────────────────────────────────────────────────────
      function updateCount(shownOverride){
        if (!options.count) return;
        const scope = resolveScope(scopeName);
        const shown = shownOverride != null ? shownOverride
          : serverMode ? (scope ? scope.length : 0)
            : applyClientCount();
        const of = total != null ? total : (scope ? scope.length : 0);
        const text = shown === of ? String(of) + ' shown' : String(shown) + ' of ' + String(of) + ' shown';
        $(options.count).text(text);
      }

      function applyClientCount(){
        const scope = resolveScope(scopeName);
        if (!scope) return 0;
        let n = 0;
        for (const row of scope) if (filter.matches(row)) n++;
        return n;
      }

      // ── input wiring ─────────────────────────────────────────────────────
      if (options.input) {
        $(options.input).on('input.swFilter', function(){
          state.search = $(this).val() || '';
          schedule();
        });
      }

      chooseMode();
      return filter;
    },

    /**
     * Filter + live sync in one call, wired to each other.
     *
     *   app.filter.live('hosts', 'Host', {input: '#search', fields: ['host']});
     *
     * Returns {filter, sync} so either half can be driven or torn down.
     */
    live: function(scopeName, modelName, options){
      options = options || {};
      const filter = app.filter.bind(scopeName, options);

      const sync = app.sync.bind(scopeName, modelName, {
        key: options.key,
        parse: options.parse,
        fetch: options.fetchOne,
        reveal: options.reveal,
        // Deliberately no `filter` here. bind()'s filter *evicts* a row from
        // the scope, which is the wrong half of the contract for a search box:
        // a row hidden by the current search must stay in the scope so that
        // clearing the search brings it straight back, with no re-fetch. Every
        // live row is admitted and refresh() decides whether it is visible.
        onChange: function(){ filter.refresh(); },
      });

      return {filter: filter, sync: sync};
    },
  };

})(jQuery);
