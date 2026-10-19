/** 车用通道选择 FL/FR/RL/RR/C/SUB — 支持长按独奏（手机） */
const Channels = (() => {
  const ALL = ['FL', 'FR', 'RL', 'RR', 'C', 'SUB'];
  let active = new Set(['FL', 'FR']);

  function init() {
    const root = document.getElementById('channelButtons');
    root.querySelectorAll('.ch').forEach((btn) => {
      let pressTimer = null;
      let longPressed = false;

      const clearPress = () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      };

      btn.addEventListener('pointerdown', (e) => {
        longPressed = false;
        clearPress();
        pressTimer = setTimeout(() => {
          longPressed = true;
          active = new Set([btn.dataset.ch]);
          render();
          btn.classList.add('solo');
        }, 450);
      });
      btn.addEventListener('pointerup', (e) => {
        clearPress();
        if (longPressed) {
          e.preventDefault();
          return;
        }
        const ch = btn.dataset.ch;
        if (e.shiftKey) {
          active = new Set([ch]);
        } else {
          if (active.has(ch)) active.delete(ch);
          else active.add(ch);
        }
        render();
      });
      btn.addEventListener('pointerleave', clearPress);
      btn.addEventListener('pointercancel', clearPress);
      // Prevent context menu on long-press (mobile)
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    document.getElementById('chAll').onclick = () => { active = new Set(ALL); render(); };
    document.getElementById('chFront').onclick = () => { active = new Set(['FL', 'FR']); render(); };
    document.getElementById('chNone').onclick = () => { active = new Set(); render(); };
    render();
  }

  function render() {
    document.querySelectorAll('#channelButtons .ch').forEach((btn) => {
      const on = active.has(btn.dataset.ch);
      btn.classList.toggle('active', on);
      btn.classList.toggle('solo', on && active.size === 1);
    });
  }

  function getActive() { return [...active]; }
  function isActive(ch) { return active.has(ch); }

  function suggestRoute() {
    const a = getActive();
    const left = a.some((c) => c.endsWith('L') || c === 'C' || c === 'SUB');
    const right = a.some((c) => c.endsWith('R') || c === 'C' || c === 'SUB');
    if (left && right) return 'stereo';
    if (left) return 'l';
    if (right) return 'r';
    return 'stereo';
  }

  return { init, getActive, isActive, suggestRoute, ALL };
})();
