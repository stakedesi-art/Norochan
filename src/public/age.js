'use strict';
(function () {
  var ok = false;
  try { ok = localStorage.getItem('noro-age') === '18'; } catch (e) { /* storage blocked */ }
  document.documentElement.dataset.age = ok ? 'ok' : 'ask';
})();
