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
        const mode = $el.data('sw-mode') || 'table';
        const pk = $el.data('sw-pk');
        const schema = app.model.schema(modelName);
        if (!schema) return console.warn('No schema for model', modelName);

        if (mode === 'table') app.render.table($el, modelName, schema);
        else if (mode === 'card') app.render.cards($el, modelName, schema);
        else if (mode === 'form') app.render.form($el, modelName, schema, pk);
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

    form: function($el, modelName, schema, pk){
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
      html += '<a class="btn btn-outline-secondary" href="/' + modelName + '/list">Cancel</a>';
      html += '</div>';
      html += '</form>';

      $el.html(html);

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

        const promise = isCreate
          ? app.model.create(modelName, data)
          : app.model.update(modelName, pk, data);

        promise.done(function(){
          app.messages.toast('Saved successfully.', 'success');
          window.location.href = '/' + modelName + '/list';
        }).fail(function(xhr){
          const resp = xhr.responseJSON || {};
          const errMsg = resp.error && resp.error.message ? resp.error.message : xhr.statusText;
          app.messages.toast('Save failed: ' + app.util.escapeHtml(errMsg), 'danger');
        });
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
