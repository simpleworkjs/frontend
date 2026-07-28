/* SimpleWorkJS frontend modal helper.
 *
 * A tiny wrapper over Bootstrap's modal for the generated UI (new/edit forms,
 * debug panel, permission viewer). One reusable modal element is appended to
 * <body> and reused for every open() call.
 *
 *   app.modal.open({title, bodyHtml, size, onShown});  // returns the $body
 *   app.modal.close();
 *
 * Standardized entity-modal extensions (all optional, all backward
 * compatible with the bare form above):
 *
 *   app.modal.open({
 *     title,
 *     tabs: [{id, label, bodyHtml, active}],  // wins over bodyHtml when given
 *     footer: {metaHtml, buttonsHtml},        // no .modal-footer at all if omitted
 *     url: {path},                            // pushes/pops a linkable URL
 *   });
 *   app.modal.showTab(id);
 *   app.modal.on(event, selector, handler);   // delegated binding that
 *                                              // survives open()'s DOM rebuild
 *   app.modal.deepLinkSlug(basePath);         // slug from location.pathname
 *   app.modal.formatAudit(record, {formatDate});
 *   app.modal.footerButtons({onSave, saveLabel, closeLabel, extraHtml});
 */

(function($){
  'use strict';

  window.app = window.app || {};

  const MODAL_ID = 'sw-modal';
  let _urlState = null; // {priorUrl} while a url-tracked modal is open
  let _popstateBound = false;

  function ensureModal(){
    let $m = $('#' + MODAL_ID);
    if (!$m.length){
      $m = $(
        '<div class="modal fade" id="' + MODAL_ID + '" tabindex="-1" aria-hidden="true">' +
          '<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">' +
            '<div class="modal-content">' +
              '<div class="modal-header">' +
                '<h5 class="modal-title"></h5>' +
                '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>' +
              '</div>' +
              '<div class="modal-body"></div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
      $('body').append($m);
    }
    return $m;
  }

  function buildTabsMarkup(tabs){
    let activeSet = tabs.some(function(t){ return t.active; });
    const navItems = tabs.map(function(t, i){
      const isActive = t.active || (!activeSet && i === 0);
      return '<li class="nav-item" role="presentation">' +
        '<button class="nav-link' + (isActive ? ' active' : '') + '" ' +
        'id="sw-modal-tab-' + t.id + '-btn" data-bs-toggle="tab" ' +
        'data-bs-target="#sw-modal-tab-' + t.id + '" type="button" role="tab">' +
        t.label + '</button></li>';
    }).join('');
    const panes = tabs.map(function(t, i){
      const isActive = t.active || (!activeSet && i === 0);
      return '<div class="tab-pane fade' + (isActive ? ' show active' : '') + '" ' +
        'id="sw-modal-tab-' + t.id + '" role="tabpanel">' + (t.bodyHtml || '') + '</div>';
    }).join('');
    return '<ul class="nav nav-tabs flex-nowrap overflow-x-auto" role="tablist">' + navItems + '</ul>' +
      '<div class="tab-content pt-3">' + panes + '</div>';
  }

  function ensurePopstateHandler(){
    if (_popstateBound) return;
    _popstateBound = true;
    window.addEventListener('popstate', function(){
      if (!_urlState) return;
      _urlState = null;
      const $m = $('#' + MODAL_ID);
      if ($m.length) bootstrap.Modal.getOrCreateInstance($m[0]).hide();
    });
  }

  app.modal = {
    open: function(opts){
      opts = opts || {};
      const $m = ensureModal();
      $m.find('.modal-title').text(opts.title || '');
      $m.find('.modal-dialog')
        .removeClass('modal-sm modal-lg modal-xl')
        .addClass(opts.size ? 'modal-' + opts.size : '');

      const $body = $m.find('.modal-body');
      // Callers pass markup this module or app.render built; app.render escapes
      // any record/schema values it interpolates.
      if (opts.tabs && opts.tabs.length){
        $body.html(buildTabsMarkup(opts.tabs));
      } else {
        $body.html(opts.bodyHtml || '');
      }

      // The modal is a reused singleton — always start from "no footer" and
      // only add one back when this call asks for it, or a stale footer from
      // a previous open() (e.g. the resource modal) would leak into a later
      // bare caller (e.g. the OAuth-secret popup that opens right after).
      $m.find('.modal-footer').remove();
      if (opts.footer){
        $m.find('.modal-content').append(
          '<div class="modal-footer">' +
            '<div class="me-auto small text-muted">' + (opts.footer.metaHtml || '') + '</div>' +
            (opts.footer.buttonsHtml || '') +
          '</div>'
        );
      }

      if (opts.url && opts.url.path){
        ensurePopstateHandler();
        if (!_urlState){
          _urlState = {priorUrl: location.pathname + location.search + location.hash};
        }
        history.pushState(null, '', opts.url.path);
      }

      const instance = bootstrap.Modal.getOrCreateInstance($m[0]);
      if (opts.onShown){
        $m.one('shown.bs.modal', function(){ opts.onShown($body); });
      }
      instance.show();
      return $body;
    },

    close: function(){
      const $m = $('#' + MODAL_ID);
      if (!$m.length) return;
      if (_urlState){
        history.pushState(null, '', _urlState.priorUrl);
        _urlState = null;
      }
      bootstrap.Modal.getOrCreateInstance($m[0]).hide();
      // Bootstrap ignores hide() while it thinks a show/hide transition is in
      // flight, and in some environments (reduced motion, a backgrounded tab)
      // the fade `transitionend` never fires — leaving the modal stuck open.
      // Force it hidden if it's still showing shortly after.
      setTimeout(function(){
        if ($m.hasClass('show') || $m[0].style.display === 'block'){
          $m.removeClass('show').css('display', 'none').attr('aria-hidden', 'true');
          $('.modal-backdrop').remove();
          $('body').removeClass('modal-open').css({overflow: '', paddingRight: ''});
        }
      }, 350);
    },

    body: function(){
      return $('#' + MODAL_ID).find('.modal-body');
    },

    showTab: function(id){
      const el = document.getElementById('sw-modal-tab-' + id + '-btn');
      if (el) bootstrap.Tab.getOrCreateInstance(el).show();
    },

    // Delegated binding from the modal root. open() rebuilds .modal-body from
    // scratch every call, so a handler bound directly to an inner element
    // silently stops firing after the first open — this is the one pattern
    // that survives every rebuild.
    on: function(event, selector, handler){
      ensureModal().on(event, selector, handler);
    },

    // Slug from a deep-linked URL, e.g. deepLinkSlug('/directory') against
    // location.pathname '/directory/some-slug' -> 'some-slug'; null if the
    // current path doesn't match basePath.
    deepLinkSlug: function(basePath){
      if (location.pathname.indexOf(basePath + '/') !== 0) return null;
      return decodeURIComponent(location.pathname.slice(basePath.length + 1));
    },

    // Standard "Created by X on Y · Updated by X on Y" footer-meta markup for
    // the created_by/created_on/updated_by/updated_on convention already used
    // by several models across the theta42 apps. formatDate defaults to
    // toLocaleString since this package has no moment dependency of its own;
    // pass one in if the app already mounts moment.
    formatAudit: function(record, options){
      options = options || {};
      const formatDate = options.formatDate || function(ms){ return new Date(ms).toLocaleString(); };
      record = record || {};
      const created = record.created_by ? (record.created_by + ' on ' + (record.created_on ? formatDate(record.created_on) : '—')) : '—';
      const updated = record.updated_by ? (record.updated_by + ' on ' + (record.updated_on ? formatDate(record.updated_on) : '—')) : '—';
      return 'Created by ' + created + ' &middot; Updated by ' + updated;
    },

    // Standard Close + Save button pair for a modal footer's right side.
    // onSave is a JS expression string (as used by every existing onclick=
    // handler in these apps' generated markup), not a function reference.
    footerButtons: function(options){
      options = options || {};
      const closeLabel = options.closeLabel || 'Close';
      const saveLabel = options.saveLabel || 'Save';
      return '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">' + closeLabel + '</button>' +
        (options.onSave ? '<button type="button" class="btn btn-primary" onclick="' + options.onSave + '">' + saveLabel + '</button>' : '') +
        (options.extraHtml || '');
    }
  };

})(jQuery);
