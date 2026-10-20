/** 全局角色：本机是「播放端」还是「录音端」，每台设备单独保存，所有双设备页面跟随 */
const Role = (() => {
  const KEY = 'cat-role-v1', ATTRS = ['data-sprole', 'data-cirole', 'data-mprole', 'data-imrole', 'data-xcrole'];
  const MIC_PAGES = ['analyze'];
  let role = null; try { role = localStorage.getItem(KEY); } catch (_) {}
  const listeners = [];
  const onChange = (f) => listeners.push(f);
  const $ = (id) => document.getElementById(id);
  const get = () => role || 'player';
  function set(r) {
    role = r; try { localStorage.setItem(KEY, r); } catch (_) {}
    ATTRS.forEach((a) => { const b = document.querySelector(`[${a}="${r}"]`); if (b && !b.classList.contains('on')) b.click(); });
    listeners.forEach((f) => { try { f(r); } catch (e) { console.error(e); } });
    document.body.classList.toggle('role-player', r === 'player');
    document.body.classList.toggle('role-recorder', r === 'recorder');
    const btn = $('roleBtn'); if (btn) { btn.className = 'role-pill ' + r; btn.innerHTML = r === 'player' ? '🔊 本机：播放端 <small>点此切换</small>' : '🎙 本机：录音端 <small>点此切换</small>'; }
    const ov = $('roleOverlay'); if (ov) ov.hidden = true;
  }
  function ask() { $('roleOverlay').hidden = false; }
  function init() {
    // 头部切换按钮 + 首次选择大弹窗
    const h = document.querySelector('.header-controls');
    if (h && !$('roleBtn')) { const b = document.createElement('button'); b.type = 'button'; b.id = 'roleBtn'; b.onclick = ask; h.prepend(b); }
    if (!$('roleOverlay')) {
      const o = document.createElement('div'); o.id = 'roleOverlay'; o.className = 'role-overlay'; o.hidden = true;
      o.innerHTML = '<div class="role-box"><h2>这部手机用来做什么？</h2><p>两部设备配合：一部连车载蓝牙放声音，一部用麦克风录</p><button type="button" class="role-big player" data-setrole="player">🔊 播放端<small>连车载蓝牙，不开麦克风</small></button><button type="button" class="role-big recorder" data-setrole="recorder">🎙 录音端<small>放在主驾头部，用麦克风录</small></button><p class="sp-hint">以后可点右上角随时切换</p></div>';
      document.body.appendChild(o);
      o.querySelectorAll('[data-setrole]').forEach((b) => { b.onclick = () => set(b.dataset.setrole); });
    }
    // 页面提示
    const note = (id, html) => { const p = $('panel-' + id); if (p && !p.querySelector('.role-note')) { const d = document.createElement('div'); d.className = 'role-note'; d.innerHTML = html; p.prepend(d); } };
    const sw = '<button type="button" class="btn btn-touch" onclick="Role.ask()">切换角色</button>';
    MIC_PAGES.forEach((id) => note(id, `<div class="rn-player">🔊 这是播放端，录音请用另一部手机（本页的麦克风测量在播放端不可用）${sw}</div>`));
    note('cal', `<div class="rn-player">🔊 这是播放端：麦克风校准请在<b>录音端</b>那部手机上设置 ${sw}</div>`);
    note('listen', `<div class="rn-recorder">🎙 这是录音端：听感评分请在<b>播放端</b>（连蓝牙的手机）上做 ${sw}</div>`);
    // 播放端绝不开麦克风
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia && !md.__roleWrapped) {
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = (c) => { if (get() === 'player' && c && c.audio) { alert('这是播放端，不会打开麦克风。录音请用另一部手机，或点右上角切换为录音端。'); return Promise.reject(new Error('播放端不开麦克风')); } return orig(c); };
      md.__roleWrapped = true;
    }
    if (role) set(role); else { set('player'); role = null; try { localStorage.removeItem(KEY); } catch (_) {} ask(); }
  }
  return { init, set, get, ask, onChange };
})();
