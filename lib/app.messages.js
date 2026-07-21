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
        renderActionHtml(html, $target, type, null, function(){
          console.warn('app.messages.confirm: target has no .actionMessage element to render into');
        });

        $('body').one('click', '.confirm-' + id, function(){
          renderActionHtml('', $target, type);
          resolve(!!$(this).data('confirm'));
        });
      });
    }

    function toast(message, type){
      type = type || 'info';
      const $container = ensureToastContainer();
      const id = 'sw-toast-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
      const $toast = $(`
        <div id="${id}" class="toast align-items-center text-bg-${type} border-0" role="alert" aria-live="assertive" aria-atomic="true">
          <div class="d-flex">
            <div class="toast-body">${app.util.escapeHtml(message)}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
          </div>
        </div>
      `);
      $container.append($toast);
      const bsToast = new bootstrap.Toast($toast[0]);
      bsToast.show();
      $toast.on('hidden.bs.toast', function(){ $toast.remove(); });
    }

    return {action: action, confirm: confirm, toast: toast};
  })();

  $(document).on('click', '.actionMessage .action-close', function(){
    app.messages.action('', $(this).closest('.actionMessage'));
  });

})(jQuery);
