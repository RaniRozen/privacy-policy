// Safari באייפון מתעלם מ-minimum-scale. כשהדף מוקטן (צביטה החוצה) מחזירים אותו אוטומטית לגודל הרגיל.
// הגדלה (zoom in) נשארת אפשרית כרגיל.
(() => {
  const vv = window.visualViewport;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!vv || !meta) return;
  const NORMAL = meta.getAttribute('content');
  const LOCK = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1';
  let timer = null;
  let locked = false;

  function snapBack() {
    if (locked) return;
    locked = true;
    meta.setAttribute('content', LOCK);
    clearTimeout(timer);
    timer = setTimeout(() => { meta.setAttribute('content', NORMAL); locked = false; }, 350);
  }
  function check() { if (vv.scale < 0.97) snapBack(); }

  vv.addEventListener('resize', check);
  // גם כשהאצבעות עוזבות את המסך
  window.addEventListener('touchend', () => setTimeout(check, 50), { passive: true });
})();
