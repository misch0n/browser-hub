// Runs before first paint (classic, render-blocking, tiny) so the saved theme
// and panel state apply without a flash. Read-only: this is only a paint hint;
// the app proper reads settings through the store once it starts.
(function () {
  var root = document.documentElement;
  try {
    var s = JSON.parse(localStorage.getItem('cc:settings') || 'null');
    if (s && typeof s.theme === 'string' && /^[a-z-]{1,24}$/.test(s.theme)) root.setAttribute('data-theme', s.theme);
    if (s && s.panel === false) root.setAttribute('data-panel', 'hidden');
    // Text size is per device (a phone and a desktop want different ones).
    var f = Number(JSON.parse(localStorage.getItem('cc-device:fontScale') || 'null'));
    if (f >= 0.5 && f <= 2) root.style.setProperty('--scale', String(f));
  } catch (e) { /* storage unavailable: defaults */ }
})();
