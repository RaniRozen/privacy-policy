// חסימת זום מלאה (צביטה, לחיצה כפולה, Ctrl+גלגלת) + החזרה אוטומטית לגודל רגיל אם בכל זאת קרה.
(() => {
  const opts = { passive: false, capture: true };
  const stop = (e) => { if (e.cancelable) e.preventDefault(); };

  // Safari / WebView באייפון: אירועי מחוות הצביטה
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => {
    document.addEventListener(t, stop, opts);
    window.addEventListener(t, stop, opts);
  });
  // כל מגע בשתי אצבעות ומעלה
  ['touchstart', 'touchmove'].forEach((t) => {
    document.addEventListener(t, (e) => { if (e.touches && e.touches.length > 1) stop(e); }, opts);
    window.addEventListener(t, (e) => { if (e.touches && e.touches.length > 1) stop(e); }, opts);
  });
  // לחיצה כפולה מהירה
  let last = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - last < 350 && !e.target.closest('input, textarea, select, button, a, label')) stop(e); // לחיצות מהירות על כפתורים חייבות לעבוד
    last = now;
  }, opts);
  // זום במחשב: Ctrl + גלגלת
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) stop(e); }, opts);

  // רשת ביטחון: אם הדף הוגדל/הוקטן בכל זאת – מחזירים לגודל 1 באמצעות איפוס ה-viewport
  const vv = window.visualViewport;
  const meta = document.querySelector('meta[name="viewport"]');
  if (vv && meta) {
    const NORMAL = meta.getAttribute('content');
    const RESET = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no';
    let busy = false;
    const check = () => {
      if (busy || Math.abs(vv.scale - 1) < 0.02) return;
      busy = true;
      meta.setAttribute('content', RESET);
      setTimeout(() => { meta.setAttribute('content', NORMAL); busy = false; }, 250);
    };
    vv.addEventListener('resize', check);
    window.addEventListener('touchend', () => setTimeout(check, 80), { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(check, 400));
  }
})();
