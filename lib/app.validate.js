/* SimpleWorkJS frontend form validation.
 *
 * A small jQuery plugin for client-side validation driven by a `validate`
 * attribute on form fields (mirrored, not replacing, server-side checks).
 *
 * Exposes:
 *   $(form).validate(event)      — validate every [validate] field inside;
 *                                  call from a submit handler, or it's wired
 *                                  automatically for forms via validateInit()
 *   $.validateSettings({rule:{}}) — register additional named rules
 *   $.validateInit()             — auto-validate every <form> with an
 *                                  `action` attribute on submit
 *
 * Usage: <input name="email" validate="required">
 *        <input name="confirm" validate="eq:password">
 *
 * Built-in rules: eq, user, password, ip. Register app-specific rules with
 * $.validateSettings({rule: {myRule: function(value, options){ ... }}}) —
 * return a falsy value (or nothing) when valid, a message string when not.
 */

(function($){
  'use strict';

  var settings = {
    rule: {
      eq: function(value, options){
        var compare = $('[name=' + options + ']').val();

        if ( value != compare ) {
          return "Miss-match";
        }
      },

      // uid-style identifier: lowercase letters, digits, and _ - @ .
      user: function(value){
        var reg = /^[a-z0-9\_\-\@\.]{1,32}$/;
        if ( reg.test( value ) === false ) {
          return "Invalid";
        }
      },

      // >= 8 chars, and either 12+ chars or at least 3 of
      // {lowercase, uppercase, number, symbol}.
      password: function(value){
        if ( typeof value !== 'string' || value.length < 8 ) {
          return "Password must be at least 8 characters";
        }
        if ( value.length >= 12 ) return;

        var classes = 0;
        if ( /[a-z]/.test( value ) ) classes++;
        if ( /[A-Z]/.test( value ) ) classes++;
        if ( /[0-9]/.test( value ) ) classes++;
        if ( /[^A-Za-z0-9]/.test( value ) ) classes++;

        if ( classes < 3 ) {
          return "Use 3 of: lowercase, uppercase, number, symbol (or 12+ chars)";
        }
      },

      ip: function(value){
        var parts = String(value).split( '.' );

        if ( parts.length != 4 ) {
          return "Malformed IP";
        }

        var bad = false;
        $.each( parts, function( key, part ) {
          if ( part > 255 || part < 0 ) bad = true;
        });
        if (bad) return "Malformed IP";
      }
    },
  };

  $.fn.validate = function(event) {
    var hasErrors = false;

    if(this.is('[validate]')) return this.validateField(event);

    if(!this.attr('isValid')){
      this.on('reset', function(){
        $(this).attr('isValid', false);
        $(this).validateClear();
      })
    }

    this.find('[validate]').each(function(){
      if(!$(this).validateField()) hasErrors = true;
    });

    this.attr('isValid', !hasErrors);

    if(hasErrors && event) event.preventDefault();

    return !hasErrors;
  };

  $.fn.validateClear = function(){
    $(this).find('input').each(function(){
      $(this).removeClass('is-invalid');
      $(this).removeClass('is-valid');
    })
  }

  $.fn.validateField = function(){
    var attr = this.attr('validate').split(':'); //array of params
    var	rule = attr[0];
    var	options = attr[1];
    var	value = this.val(); //link to input value
    var message;

    if(this.prop('disabled')) return true;

    //checks if field is required, and length
    if(!isNaN(options) && value.length < options){
      message = `Must be ${options} characters`;
    }

    //checks if empty to stop processing
    if(!isNaN(options) && value.length === 0) {
    }else if(rule in settings.rule){
      message = settings.rule[rule].apply(this, [value, options]);
    }

    this.validateMessage(message)
    return !message;
  }

  $.fn.validateMessage = function(message){
    if(message && message !== true){
      this.closest('.form-group').find('b.invalid-feedback').html(message);
      this.addClass('is-invalid');
    }else{
      this.removeClass('is-invalid');
      this.addClass('is-valid');
    }
    return this;
  };

  jQuery.extend({
    validateSettings: function( settingsObj ) {
      $.extend( true, settings, settingsObj );
    },

    validateInit: function( settingsObj ) {
      $( '[action]' ).on( 'submit', function ( event ){
        $( this ).validate( event );
      });
    }
  });

})(jQuery);
