/* SimpleWorkJS frontend render layer.
 *
 * Replaces elements like:
 *   <div data-sw-model="Task" data-sw-mode="table">
 * with generated Bootstrap UI bound to jq-repeat scopes.
 */

(function($){
  'use strict';

  window.app = window.app || {};

  app.render = {
    build: function(selector){
      $(selector).each(function(){
        const $el = $(this);
        const modelName = $el.data('sw-model');
        // The collection card (header actions + list body + paginated footer)
        // is the default view for every model now.
        const mode = $el.data('sw-mode') || 'collection';
        const pk = $el.data('sw-pk');
        const schema = app.model.schema(modelName);
        if (!schema) return console.warn('No schema for model', modelName);

        if (mode === 'collection') app.render.collection($el, modelName, schema);
        else if (mode === 'table') app.render.table($el, modelName, schema);
        else if (mode === 'card') app.render.cards($el, modelName, schema);
        else if (mode === 'form') app.render.form($el, modelName, schema, pk);
      });
    },

    // The default view: one Bootstrap card per collection.
    //   header — title on the left; Debug, Permissions, and New actions on the right
    //   body   — a jq-repeat list of rows, each with Edit/Delete
    //   footer — "Showing X–Y of N" + Prev/Next pagination
    collection: function($el, modelName, schema){
      const fields = Object.values(schema.fields).filter(function(f){ return !f.isPrivate && !f.references; });
      const scopeName = modelName + '-collection';
      const pageSize = (schema.display && schema.display.pageSize) || 20;
      const esc = app.util.escapeHtml;

      let html = '<div class="card sw-collection">';

      // Header: title + actions.
      html += '<div class="card-header d-flex justify-content-between align-items-center">';
      html += '<h5 class="mb-0">' + esc(schema.display.name || modelName) + '</h5>';
      html += '<div class="btn-group btn-group-sm">';
      html += '<button type="button" class="btn btn-outline-secondary sw-debug" title="Debug info"><i class="bi bi-bug"></i></button>';
      html += '<button type="button" class="btn btn-outline-secondary sw-perms" title="Permissions"><i class="bi bi-shield-lock"></i></button>';
      html += '<button type="button" class="btn btn-primary sw-new" title="New item"><i class="bi bi-plus-lg"></i> New</button>';
      html += '</div></div>';

      // Inline slot for confirm dialogs / action messages (app.messages renders
      // into the nearest .card .actionMessage — e.g. the delete confirmation).
      html += '<div class="actionMessage px-3"></div>';

      // Body: list of rows.
      html += '<div class="card-body p-0"><div class="table-responsive">';
      html += '<table class="table table-hover align-middle mb-0 sw-collection-table"><thead><tr>';
      fields.forEach(function(f){ html += '<th>' + esc(f.display.name || f.name) + '</th>'; });
      html += '<th class="text-end">Actions</th></tr></thead>';
      html += '<tbody jq-repeat="' + scopeName + '" jq-index-key="' + schema.pk + '"><tr>';
      fields.forEach(function(f){ html += '<td>{{' + f.name + '}}</td>'; });
      html += '<td class="text-end text-nowrap">';
      html += '<a class="btn btn-sm btn-outline-secondary me-1" href="/' + modelName + '/{{' + schema.pk + '}}" title="View"><i class="bi bi-eye"></i></a>';
      html += '<button type="button" class="btn btn-sm btn-outline-primary me-1 sw-edit" data-pk="{{' + schema.pk + '}}" title="Edit"><i class="bi bi-pencil"></i></button>';
      html += '<button type="button" class="btn btn-sm btn-outline-danger sw-delete" data-pk="{{' + schema.pk + '}}" title="Delete"><i class="bi bi-trash"></i></button>';
      html += '</td></tr></tbody></table></div></div>';

      // Footer: pagination.
      html += '<div class="card-footer d-flex justify-content-between align-items-center">';
      html += '<small class="text-muted sw-page-info">—</small>';
      html += '<div class="btn-group btn-group-sm">';
      html += '<button type="button" class="btn btn-outline-secondary sw-prev" disabled><i class="bi bi-chevron-left"></i></button>';
      html += '<button type="button" class="btn btn-outline-secondary sw-next" disabled><i class="bi bi-chevron-right"></i></button>';
      html += '</div></div>';

      html += '</div>';

      $el.html(html);
      $el.data('sw-page', 1);
      $el.data('sw-pagesize', pageSize);

      const reload = function(){ app.render._loadPage($el, modelName, scopeName); };

      // jq-repeat discovers the template on the next tick, then we load data.
      setTimeout(reload, 0);

      // Live sync: reload the current page on any change to this model.
      app.render._teardown($el);
      const subs = [
        app.pubsub.subscribe('^model:local:' + modelName + ':refresh$', reload),
        app.pubsub.subscribe('^model:local:' + modelName + ':remove$', reload),
      ];
      $el.data('sw-subs', subs);

      // Delegated handlers (namespaced so re-building tears them down cleanly).
      $el.off('.swCollection');
      $el.on('click.swCollection', '.sw-new', function(){
        app.render._openForm(modelName, null, reload);
      });
      $el.on('click.swCollection', '.sw-edit', function(){
        app.render._openForm(modelName, $(this).data('pk'), reload);
      });
      $el.on('click.swCollection', '.sw-debug', function(){ app.render._openDebug(modelName); });
      $el.on('click.swCollection', '.sw-perms', function(){ app.render._openPermissions(modelName); });
      $el.on('click.swCollection', '.sw-prev', function(){ app.render._changePage($el, modelName, scopeName, -1); });
      $el.on('click.swCollection', '.sw-next', function(){ app.render._changePage($el, modelName, scopeName, 1); });
      $el.on('click.swCollection', '.sw-delete', async function(){
        const pk = $(this).data('pk');
        const ok = await app.messages.confirm('Delete this record?', $el, 'danger');
        if (!ok) return;
        app.model.remove(modelName, pk).done(function(){
          app.messages.toast('Record deleted.', 'success');
          reload();
        }).fail(function(xhr){
          const resp = xhr.responseJSON || {};
          const errMsg = resp.error && resp.error.message ? resp.error.message : xhr.statusText;
          app.messages.toast('Delete failed: ' + app.util.escapeHtml(errMsg), 'danger');
        });
      });
    },

    table: function($el, modelName, schema){
      const fields = Object.values(schema.fields).filter(function(f){ return !f.isPrivate && !f.references; });

      let html = '<div class="table-responsive"><table class="table table-striped sw-table"><thead><tr>';
      fields.forEach(function(f){ html += '<th>' + app.util.escapeHtml(f.display.name || f.name) + '</th>'; });
      html += '<th>Actions</th></tr></thead>';
      html += '<tbody jq-repeat="' + modelName + '" jq-index-key="' + schema.pk + '">';
      html += '<tr>';
      fields.forEach(function(f){ html += '<td>{{' + f.name + '}}</td>'; });
      html += '<td>';
      html += '<a class="btn btn-sm btn-primary me-1" href="/' + modelName + '/{{' + schema.pk + '}}">View</a>';
      html += '<a class="btn btn-sm btn-outline-primary me-1" href="/' + modelName + '/{{' + schema.pk + '}}/edit">Edit</a>';
      html += '<button class="btn btn-sm btn-danger sw-delete" data-pk="{{' + schema.pk + '}}">Delete</button>';
      html += '</td>';
      html += '</tr>';
      html += '</tbody></table></div>';

      $el.html(html);

      // jq-repeat discovers the template on the next tick, then we load data.
      setTimeout(function(){ app.render._reload(modelName, modelName); }, 0);

      // Re-running build() on the same element (e.g. after a schema change)
      // used to stack a new pubsub subscription and a new delegated click
      // handler on top of the old ones every time, since $el.html() only
      // replaces the children, not $el itself. Tear down what the previous
      // build() attached before attaching the new one.
      app.render._teardown($el);
      // On any live change to this model, reload the full list and replace the
      // scope. See _reload for why we reload wholesale instead of patching
      // individual rows.
      const reload = function(){ app.render._reload(modelName, modelName); };
      const subs = [
        app.pubsub.subscribe('^model:local:' + modelName + ':refresh$', reload),
        app.pubsub.subscribe('^model:local:' + modelName + ':remove$', reload),
      ];
      $el.data('sw-subs', subs);

      // Delete handler.
      $el.off('click.swRender', '.sw-delete').on('click.swRender', '.sw-delete', async function(){
        const pk = $(this).data('pk');
        const ok = await app.messages.confirm('Delete this record?', $el, 'danger');
        if (!ok) return;

        app.model.remove(modelName, pk).done(function(){
          app.messages.toast('Record deleted.', 'success');
        }).fail(function(xhr){
          const resp = xhr.responseJSON || {};
          const errMsg = resp.error && resp.error.message ? resp.error.message : xhr.statusText;
          app.messages.toast('Delete failed: ' + app.util.escapeHtml(errMsg), 'danger');
        });
      });
    },

    cards: function($el, modelName, schema){
      const fields = Object.values(schema.fields).filter(function(f){ return !f.isPrivate && !f.references && f.name !== schema.display.titleField; });
      const scopeName = modelName + '-cards';

      let html = '<div class="row">';
      html += '<div class="col-md-4 mb-3" jq-repeat="' + scopeName + '" jq-index-key="' + schema.pk + '">';
      html += '<div class="card sw-card h-100">';
      html += '<div class="card-body">';
      html += '<h5 class="card-title">{{' + (schema.display.titleField || schema.pk) + '}}</h5>';
      fields.forEach(function(f){
        html += '<p class="card-text mb-1"><small class="text-muted">' + app.util.escapeHtml(f.display.name || f.name) + ':</small> {{' + f.name + '}}</p>';
      });
      html += '<a href="/' + modelName + '/{{' + schema.pk + '}}" class="btn btn-sm btn-primary">View</a>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
      html += '</div>';

      $el.html(html);

      setTimeout(function(){ app.render._reload(modelName, scopeName); }, 0);

      app.render._teardown($el);
      const reload = function(){ app.render._reload(modelName, scopeName); };
      const subs = [
        app.pubsub.subscribe('^model:local:' + modelName + ':refresh$', reload),
        app.pubsub.subscribe('^model:local:' + modelName + ':remove$', reload),
      ];
      $el.data('sw-subs', subs);
    },

    // options: {modal: true, onSuccess: fn}. In modal mode the form does not
    // redirect on save — it calls onSuccess (which closes the modal) — and its
    // Cancel button closes the modal instead of linking to the list page.
    form: function($el, modelName, schema, pk, options){
      options = options || {};
      // Write-only fields (e.g. password) are private on output but must still
      // appear on the form so they can be set — otherwise there's no password
      // field when creating/editing a user.
      const fields = Object.values(schema.fields).filter(function(f){ return (!f.isPrivate || f.writeOnly) && !f.primaryKey; });
      const isCreate = !pk;

      let html = '<form class="sw-form row g-3" data-sw-form="' + modelName + '" novalidate>';
      fields.forEach(function(f){
        html += '<div class="col-md-6">';
        html += '<label class="form-label" for="' + f.name + '" data-field="' + f.name + '">' + app.util.escapeHtml(f.display.name || f.name) + '</label>';

        const inputName = (f.references && f.references.type === 'hasOne') ? f.foreignKey : f.name;
        if (f.references && f.references.type === 'hasOne'){
          html += '<select class="form-select" id="' + inputName + '" name="' + inputName + '" data-references="' + f.references.model + '">';
          html += '<option value="">— Select —</option>';
          html += '</select>';
        } else if (f.htmlType === 'checkbox'){
          html += '<div class="form-check">';
          html += '<input class="form-check-input" type="checkbox" id="' + f.name + '" name="' + f.name + '" value="true">';
          html += '</div>';
        } else if (f.htmlType === 'textarea'){
          html += '<textarea class="form-control" id="' + f.name + '" name="' + f.name + '" rows="3"></textarea>';
        } else {
          html += '<input class="form-control" type="' + f.htmlType + '" id="' + f.name + '" name="' + f.name + '"';
          // A write-only value (password) is never sent back on edit, so it
          // renders blank; requiring it there would force re-entry on every
          // save. Only require it when creating. Leaving it blank on edit means
          // "keep the current value" (empty write-only fields are dropped on
          // submit).
          if (f.isRequired && (isCreate || !f.writeOnly)) html += ' required';
          if (f.writeOnly && !isCreate) html += ' placeholder="Leave blank to keep current"';
          html += '>';
        }

        html += '</div>';
      });

      html += '<div class="col-12">';
      html += '<button type="submit" class="btn btn-primary">' + (isCreate ? 'Create' : 'Save') + '</button> ';
      html += options.modal
        ? '<button type="button" class="btn btn-outline-secondary sw-cancel">Cancel</button>'
        : '<a class="btn btn-outline-secondary" href="/' + modelName + '/list">Cancel</a>';
      html += '</div>';
      html += '</form>';

      $el.html(html);

      if (options.modal){
        $el.find('.sw-cancel').on('click', function(){ app.modal.close(); });
      }

      // Load related options for hasOne fields.
      $el.find('[data-references]').each(function(){
        const $sel = $(this);
        const refModel = $sel.data('references');
        app.model.list(refModel).done(function(resp){
          const refSchema = app.model.schema(refModel);
          const titleField = refSchema.display.titleField || refSchema.pk;
          (resp.results || []).forEach(function(row){
            $sel.append(
              '<option value="' + app.util.escapeHtml(row[refSchema.pk]) + '">' +
              app.util.escapeHtml(row[titleField]) + '</option>'
            );
          });
        });
      });

      // If editing, load current values.
      if (pk){
        app.model.get(modelName, pk).done(function(resp){
          const data = resp.data;
          Object.keys(data).forEach(function(key){
            const $input = $el.find('[name="' + key + '"]');
            if (!$input.length) return;
            if ($input.attr('type') === 'checkbox'){
              $input.prop('checked', !!data[key]);
            } else {
              $input.val(data[key]);
            }
          });
        });
      }

      // Submit handler.
      $el.find('form').on('submit', function(ev){
        ev.preventDefault();
        const data = app.util.formToObject($(this));
        // Coerce booleans.
        $el.find('input[type="checkbox"]').each(function(){
          data[this.name] = $(this).is(':checked');
        });

        // Drop empty write-only fields so a blank password on edit doesn't
        // overwrite the stored value with an empty string.
        Object.values(schema.fields).forEach(function(f){
          if (f.writeOnly && (data[f.name] === '' || data[f.name] === undefined || data[f.name] === null)){
            delete data[f.name];
          }
        });

        // Omit empty inputs entirely. An unselected foreign-key dropdown or a
        // blank number field serializes to "", which fails FK/number validation
        // server-side; sending nothing lets the column default/null apply.
        // Required fields left blank are still rejected by the server (with a
        // message). Also drops the foreign-key column names for hasOne fields.
        Object.keys(data).forEach(function(key){
          if (data[key] === '') delete data[key];
        });

        const promise = isCreate
          ? app.model.create(modelName, data)
          : app.model.update(modelName, pk, data);

        promise.done(function(){
          app.messages.toast('Saved successfully.', 'success');
          if (options.modal){
            if (options.onSuccess) options.onSuccess();
          } else {
            window.location.href = '/' + modelName + '/list';
          }
        }).fail(function(xhr){
          const resp = xhr.responseJSON || {};
          const errMsg = resp.error && resp.error.message ? resp.error.message : xhr.statusText;
          app.messages.toast('Save failed: ' + app.util.escapeHtml(errMsg), 'danger');
        });
      });
    },

    // Load the collection element's current page and refresh its footer.
    _loadPage: function($el, modelName, scopeName){
      const page = $el.data('sw-page') || 1;
      const pageSize = $el.data('sw-pagesize') || 20;
      app.model.list(modelName, {page: page, pageSize: pageSize}).done(function(resp){
        const scope = $.scope[scopeName];
        if (scope) scope.replace(resp.results || []);
        app.render._updateFooter($el, resp);
      });
    },

    // Step the collection's page and reload. Guards the lower bound; the upper
    // bound is enforced by disabling the Next button from _updateFooter.
    _changePage: function($el, modelName, scopeName, delta){
      const next = Math.max(1, (($el.data('sw-page') || 1) + delta));
      $el.data('sw-page', next);
      app.render._loadPage($el, modelName, scopeName);
    },

    _updateFooter: function($el, resp){
      const page = resp.page || 1;
      const pageSize = resp.pageSize || 20;
      const total = resp.total || 0;
      const pageCount = resp.pageCount || 1;
      const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
      const to = Math.min(total, page * pageSize);
      $el.find('.sw-page-info').text('Showing ' + from + '–' + to + ' of ' + total);
      $el.find('.sw-prev').prop('disabled', page <= 1);
      $el.find('.sw-next').prop('disabled', page >= pageCount);
    },

    // Open the new/edit form in a modal. On success it closes and calls
    // onDone (the collection's reload); live sync also refreshes the list.
    _openForm: function(modelName, pk, onDone){
      const schema = app.model.schema(modelName);
      const title = (pk ? 'Edit ' : 'New ') + (schema.display.name || modelName);
      const $body = app.modal.open({title: title, bodyHtml: '<div class="sw-modal-form"></div>'});
      app.render.form($body.find('.sw-modal-form'), modelName, schema, pk, {
        modal: true,
        onSuccess: function(){
          app.modal.close();
          // The list refreshes on its own via live sync (the save broadcasts a
          // model event). Also reload as a fallback, but deferred — running the
          // list re-render synchronously here races Bootstrap's modal-hide
          // transition and leaves the modal stuck open.
          if (onDone) setTimeout(onDone, 300);
        }
      });
    },

    // Read-only debug panel: endpoints, permissions, field schema, last WS update.
    _openDebug: function(modelName){
      const schema = app.model.schema(modelName);
      const esc = app.util.escapeHtml;
      const last = app.model.lastEvent && app.model.lastEvent[modelName];
      let html = '';
      html += '<h6>Endpoints</h6><pre class="small border rounded p-2 bg-body-tertiary">' + esc(JSON.stringify(schema.paths || {}, null, 2)) + '</pre>';
      html += '<h6>Permissions</h6><pre class="small border rounded p-2 bg-body-tertiary">' + esc(JSON.stringify(schema.permissions || {}, null, 2)) + '</pre>';
      html += '<h6>Schema</h6><pre class="small border rounded p-2 bg-body-tertiary" style="max-height:16rem;overflow:auto">' + esc(JSON.stringify(schema.fields || {}, null, 2)) + '</pre>';
      html += '<h6>Last WebSocket update</h6><p class="small mb-0">' + (last ? esc(new Date(last).toLocaleString()) : '<em>none this session</em>') + '</p>';
      app.modal.open({title: modelName + ' — debug', bodyHtml: html, size: 'lg'});
    },

    // Permission editor: a {owner, group, everyone} × {create, read, update,
    // delete} grid backed by the model's DB access rule. Editable for admins
    // (saved via PUT /api/_access/:model), read-only otherwise.
    _openPermissions: function(modelName){
      const esc = app.util.escapeHtml;
      const TIERS = ['owner', 'group', 'everyone'];
      const ACTIONS = ['create', 'read', 'update', 'delete'];
      const isAdmin = !!(app.currentUser && app.currentUser.isAdmin);

      // Fetch the live grants (fresh even after another admin edited them).
      app.api.get('/api/_access/' + modelName).done(function(resp){
        const access = resp.access || {};

        let html = '<p class="text-muted small">';
        html += isAdmin
          ? 'Grant actions per tier, then Save. <code>owner</code> = the record’s creator; <code>everyone</code> = any signed-in user; <code>group</code> is reserved. Admins always have full access.'
          : 'Read-only — ask an admin to change access.';
        html += '</p>';

        html += '<table class="table table-sm sw-access-grid"><thead><tr><th></th>';
        ACTIONS.forEach(function(a){ html += '<th class="text-center text-capitalize">' + a + '</th>'; });
        html += '</tr></thead><tbody>';
        TIERS.forEach(function(tier){
          html += '<tr><th class="text-capitalize">' + tier + '</th>';
          ACTIONS.forEach(function(action){
            const on = access[tier] && access[tier][action] ? ' checked' : '';
            html += '<td class="text-center"><input type="checkbox" class="form-check-input" ' +
              'data-tier="' + tier + '" data-action="' + action + '"' + on + (isAdmin ? '' : ' disabled') + '></td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table>';
        if (isAdmin) html += '<div class="text-end"><button type="button" class="btn btn-primary btn-sm sw-access-save">Save</button></div>';

        const $body = app.modal.open({title: modelName + ' — permissions', bodyHtml: html});

        if (isAdmin){
          $body.find('.sw-access-save').on('click', function(){
            const grants = {owner: {}, group: {}, everyone: {}};
            $body.find('input[type="checkbox"]').each(function(){
              grants[$(this).data('tier')][$(this).data('action')] = $(this).is(':checked');
            });
            app.api.put('/api/_access/' + modelName, grants).done(function(saved){
              app.messages.toast('Permissions updated.', 'success');
              // Keep the cached schema in step so Debug / API docs reflect it.
              const s = app.model.schema(modelName);
              if (s) s.access = (saved && saved.access) || grants;
              app.modal.close();
            }).fail(function(xhr){
              const r = xhr.responseJSON || {};
              app.messages.toast('Save failed: ' + esc((r.error && r.error.message) || xhr.statusText), 'danger');
            });
          });
        }
      }).fail(function(){
        app.messages.toast('Could not load permissions.', 'danger');
      });
    },

    // Re-fetch a model's full list and replace the bound jq-repeat scope with
    // it. Used for both the initial load and every live change (create/update/
    // delete). We reload wholesale rather than patching individual rows because
    // jq-repeat's per-item scope.update()/push() proved unreliable for live
    // rows (an updated row would not always re-render), whereas replace() with
    // the fresh list reliably renders adds, edits, and removals. Reading the
    // scope inside the callback (after the request) also avoids racing
    // jq-repeat's asynchronous template discovery on first paint.
    _reload: function(modelName, scopeName){
      app.model.list(modelName).done(function(resp){
        const scope = $.scope[scopeName];
        if (scope) scope.replace(resp.results || []);
      });
    },

    // Removes the pubsub subscriptions a previous build() call attached to
    // this element, so re-running build() on the same node doesn't stack
    // duplicate "model:local:*" listeners (each of which would call
    // scope.update()/scope.remove() once per stacked copy).
    _teardown: function($el){
      const subs = $el.data('sw-subs');
      if (subs) subs.forEach(function(sub){ sub.remove(); });
      $el.removeData('sw-subs');
    }
  };

})(jQuery);
