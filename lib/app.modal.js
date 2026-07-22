/* SimpleWorkJS frontend modal helper.
 *
 * A tiny wrapper over Bootstrap's modal for the generated UI (new/edit forms,
 * debug panel, permission viewer). One reusable modal element is appended to
 * <body> and reused for every open() call.
 *
 *   app.modal.open({title, bodyHtml, size, onShown});  // returns the $body
 *   app.modal.close();
 */

(function($){
  'use strict';

  window.app = window.app || {};

  const MODAL_ID = 'sw-modal';

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
      $body.html(opts.bodyHtml || '');
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
    }
  };

})(jQuery);
