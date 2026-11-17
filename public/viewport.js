// חסימת זום (צביטה והגדלה בלחיצה כפולה) – כדי שהדף תמיד יוצג בגודל הנכון.
(() => {
  const stop = (e) => e.preventDefault();
  // Safari באייפון: אירועי מחוות הצביטה
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, stop, { passive: false }));
  // צביטה בשתי אצבעות בדפדפנים אחרים
  document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  // לחיצה כפולה מהירה (מונעת הגדלה)
  let last = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - last < 300 && !e.target.closest('input, textarea, a, button')) e.preventDefault();
    last = now;
  }, { passive: false });
})();
