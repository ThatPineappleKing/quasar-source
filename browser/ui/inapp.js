// Close button for pages shown inside Quasar's window (Library, Passwords).
// Clicking any tab in the sidebar also closes them, like Arc.
(() => {
  const b = document.createElement('button');
  b.className = 'inapp-close';
  b.title = 'Close (Ctrl+W)';
  b.setAttribute('aria-label', 'Close');
  b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  b.onclick = () => window.arch.act(document.body.dataset.close);
  document.body.append(b);
})();
