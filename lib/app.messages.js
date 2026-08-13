/* SimpleWorkJS frontend messages and confirmations.
 *
 * Exposes:
 *   app.messages.action  — inline action message inside a card/form
 *   app.messages.confirm — promise-based confirmation dialog
 *   app.messages.toast   — page-wide toast notification
 */

(function($){
  'use strict';

  window.app = window.app || {};

  app.messages = (function(){
    const TOAST_CONTAINER_ID = 'sw-toast-container';

    function ensureToastContainer(){
      let $container = $('#' + TOAST_CONTAINER_ID);
      if (!$container.length){
        $container = $(`
          <div id="${TOAST_CONTAINER_ID}" class="toast-container position-fixed top-0 end-0 p-3">
          </div>
        `);
        $('body').append($container);
      }
      return $container;
    }

    // Slides safe, already-finalized `html` into the nearest `.actionMessage`
    // target (or invokes `onNoTarget` if none exists). Only ever called with
    // markup this module built itself — `action()` escapes its caller-supplied
    // message before it reaches here, and `confirm()`'s own template embeds
    // an already-escaped message. Never pass raw caller input to this function.
    function renderActionHtml(html, $targetPassed, type, callback, onNoTarget){
      callback = callback || function(){};

      // action()/confirm() are both routinely called with no target (or an
      // explicit null) when the caller has no inline .actionMessage to render
      // into and wants the toast fallback -- `.jquery` is jQuery's own "is
      // this actually a jQuery object" check, so this only normalizes the
      // missing/wrong-type case, never a legitimate (possibly empty, e.g.
      // `$('.nonexistent')`) selection. An empty jQuery object's .closest()/
      // .find() safely return empty collections, which the no-target branch
      // below already handles.
      $targetPassed = ($targetPassed && $targetPassed.jquery) ? $targetPassed : $();

      let $target = $targetPassed.closest('div.card').find('.actionMessage');
      if (!$target.length) $target = $($targetPassed.find('.actionMessage')[0]);
      if (!$target.length){
        if (onNoTarget) onNoTarget();
        return setTimeout(callback, 10);
      }

      if ($target.data('sw-content') === html) return setTimeout(callback, 10);

      if ($target.html()){
        $target.slideUp('fast', function(){
          $target.html('');
          $target.removeData('sw-content');
          $target.removeClass(function(index, className){
            return (className.match(/(^|\s)bg-\S+/g) || []).join(' ');
          });
          if (html) return renderActionHtml(html, $target, type, callback, onNoTarget);
          $target.hide();
        });
      } else {
        if (type) $target.addClass('bg-' + type);

        const withClose = html
          ? html + `
            <button class="action-close btn btn-sm btn-outline-dark float-end">
              <i class="fa-solid fa-xmark"></i>
            </button>
          `
          : html;
        $target.data('sw-content', html);
        $target.html(withClose).slideDown('fast');
        setTimeout(callback, 10);
      }
    }

    function action(message, $target, type, callback){
      type = type || 'info';
      const escaped = app.util.escapeHtml(message || '');
      renderActionHtml(escaped, $target, type, callback, function(){
        // No inline target on the page: fall back to a toast. `toast()`
        // does its own escaping, so pass the original raw message, not the
        // already-escaped copy (double-escaping would show literal `&amp;`).
        toast(message, type);
      });
    }

    // Builds and shows a toast from already-finalized `html` (same
    // "caller-built, already-safe markup" contract as renderActionHtml — see
    // its comment). Unlike toast() below, this does not escape its input and
    // supports options: {autohide, delay} passed straight to bootstrap.Toast,
    // and {dismissible: false} to omit the close button — used by confirm()'s
    // no-target fallback, where the toast must stay up and uninterruptible
    // until the user actually picks Confirm or Cancel, not disappear on its
    // own or be dismissable without answering.
    function toastHtml(html, type, options){
      type = type || 'info';
      options = options || {};
      const $container = ensureToastContainer();
      const id = 'sw-toast-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
      const closeBtn = options.dismissible === false ? '' : `
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>`;
      const $toast = $(`
        <div id="${id}" class="toast align-items-center text-bg-${type} border-0" role="alert" aria-live="assertive" aria-atomic="true">
          <div class="d-flex">
            <div class="toast-body">${html}</div>${closeBtn}
          </div>
        </div>
      `);
      $container.append($toast);
      const bsToast = new bootstrap.Toast($toast[0], {
        autohide: options.autohide !== undefined ? options.autohide : true,
        delay: options.delay || 5000,
      });
      bsToast.show();
      $toast.on('hidden.bs.toast', function(){ $toast.remove(); });
      return $toast;
    }

    function confirm(message, $target, type){
      type = type || 'warning';
      return new Promise(function(resolve){
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);

        const html = `
          <h4 class="align-middle">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <b>${app.util.escapeHtml(message)}</b>
            <span class="float-end">
              <button type="button" class="btn btn-success confirm-${id}" data-confirm="true">
                <i class="fa-solid fa-circle-check"></i> Confirm
              </button>
              <button type="button" class="btn btn-danger confirm-${id}">
                <i class="fa-solid fa-circle-stop"></i> Cancel
              </button>
            </span>
          </h4>
        `;
        let $fallbackToast = null;
        renderActionHtml(html, $target, type, null, function(){
          // No inline .actionMessage on the page (e.g. a plain admin-action
          // page with no card layout): the dialog still has to go SOMEWHERE
          // for the promise below to ever resolve, so fall back to an
          // interactive, non-autohiding, non-dismissable toast hosting the
          // same Confirm/Cancel buttons -- previously this just logged a
          // warning and left the promise pending forever, so the caller's
          // button looked like it silently did nothing.
          $fallbackToast = toastHtml(html, type, {autohide: false, dismissible: false});
        });

        $('body').one('click', '.confirm-' + id, function(){
          renderActionHtml('', $target, type);
          if ($fallbackToast){
            const inst = bootstrap.Toast.getInstance($fallbackToast[0]);
            if (inst) inst.hide(); else $fallbackToast.remove();
          }
          resolve(!!$(this).data('confirm'));
        });
      });
    }

    function toast(message, type){
      toastHtml(app.util.escapeHtml(message || ''), type || 'info');
    }

    return {action: action, confirm: confirm, toast: toast};
  })();

  $(document).on('click', '.actionMessage .action-close', function(){
    app.messages.action('', $(this).closest('.actionMessage'));
  });

})(jQuery);
