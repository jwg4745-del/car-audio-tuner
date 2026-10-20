/** 俯视车图引导式单喇叭测量：延时 / 极性（双设备，跟随全局播放端/录音端） */
const CarGui = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  // 喇叭在车图上的位置（%）与短名
  const PINS = [
    { id: 11, n: '左前高', x: 0, y: 17, s: 'L' }, { id: 12, n: '右前高', x: 100, y: 17, s: 'R' },
    { id: 9, n: '左前中', x: 0, y: 27, s: 'L' }, { id: 10, n: '右前中', x: 100, y: 27, s: 'R' },
    { id: 5, n: '左前中低', x: 0, y: 39, s: 'L' }, { id: 6, n: '右前中低', x: 100, y: 39, s: 'R' },
    { id: 3, n: '左二排', x: 0, y: 56, s: 'L' }, { id: 4, n: '右二排', x: 100, y: 56, s: 'R' },
    { id: 1, n: '左尾门', x: 0, y: 72, s: 'L' }, { id: 2, n: '右尾门', x: 100, y: 72, s: 'R' },
    { id: 7, n: '低音炮', x: 50, y: 84, s: 'M' },
  ];
  const ORDER = PINS.map((p) => p.id);
  const REF = { L: 12, R: 11 }; // 延时基准：左侧喇叭配右前高，右侧喇叭配左前高
  const pin = (id) => PINS.find((p) => p.id === id);
  const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? d; } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const CAR_SVG = `<svg viewBox="0 0 200 400" class="cg-car" aria-hidden="true"><defs><linearGradient id="cgG" x1="0" x2="1"><stop offset="0" stop-color="#c9daf5"/><stop offset=".5" stop-color="#e6effc"/><stop offset="1" stop-color="#c3d4f0"/></linearGradient></defs>
    <path d="M60 18 Q100 4 140 18 Q168 30 170 70 L172 330 Q170 382 140 390 L60 390 Q30 382 28 330 L30 70 Q32 30 60 18Z" fill="url(#cgG)" stroke="#0b1f6b" stroke-width="4"/>
    <path d="M24 150 L10 162 L28 168Z M176 150 L190 162 L172 168Z" fill="#c9daf5" stroke="#0b1f6b" stroke-width="3"/>
    <path d="M44 95 Q100 70 156 95 L150 135 Q100 120 50 135Z" fill="#9fb6dd" stroke="#0b1f6b" stroke-width="3"/>
    <path d="M50 300 Q100 312 150 300 L156 340 Q100 352 44 340Z" fill="#9fb6dd" stroke="#0b1f6b" stroke-width="3"/>
    <g fill="none" stroke="#6b7fa8" stroke-dasharray="3 3" stroke-width="1.2"><rect x="58" y="150" width="36" height="40" rx="6"/><rect x="106" y="150" width="36" height="40" rx="6"/><rect x="58" y="205" width="36" height="36" rx="6"/><rect x="106" y="205" width="36" height="36" rx="6"/><rect x="54" y="252" width="92" height="36" rx="6"/></g>
    <path d="M30 70 L170 70 M100 20 L100 70" stroke="#0b1f6b" stroke-width="1" opacity=".4"/></svg>`;

  function make(mode) {
    const isDelay = mode === 'delay', isSpl = mode === 'spl';
    let multi = false;
    const P = isDelay ? 'cgd' : isSpl ? 'cgs' : 'cgp';
    const KEY = isDelay ? 'cat-cg-delay-v1' : isSpl ? 'cat-cg-spl-v1' : 'cat-cg-pol-v1';
    let hist = LS.get(KEY, {}), cur = LS.get(KEY + '-cur', 11), unit = 'ms';
    const panel = $('panel-' + mode); if (!panel) return;
    // 旧内容收进「高级」
    const adv = document.createElement('details'); adv.className = 'cg-adv'; adv.innerHTML = '<summary>高级 / 旧版界面</summary>';
    [...panel.children].forEach((c) => { if (!c.classList.contains('role-note')) adv.appendChild(c); });
    const box = document.createElement('div'); box.className = 'cg'; box.id = P;
    box.innerHTML = `
      <div class="cg-top"><button type="button" class="cg-back" id="${P}Back" aria-label="返回">‹</button><h2>${isDelay ? '单喇叭延时校准' : isSpl ? '声压测试' : '单喇叭极性检测'}</h2><button type="button" class="cg-hist" id="${P}HistBtn">⇅${isSpl ? '重置' : '历史'}</button></div>
      ${isSpl ? `<div class="cg-seg"><button type="button" class="on" data-m="0">单喇叭</button><button type="button" data-m="1">多喇叭</button></div>` : ''}
      <div class="cg-tip" id="${P}Tip"></div>
      <div class="cg-stage${isSpl ? ' small' : ''}">${CAR_SVG}<div class="cg-pins" id="${P}Pins"></div></div>
      <div class="cg-res" id="${P}Res" hidden></div>${isSpl ? `<div class="cg-cards" id="${P}Cards"></div>` : ''}
      <div class="cg-histbox" id="${P}Hist" hidden></div>
      <div class="cg-status" id="${P}Status"></div>
      <div class="cg-bottom">${isSpl ? `<button type="button" class="cg-unit ghost" id="${P}Again">重新测量</button><button type="button" class="cg-go ghost" id="${P}Stop" disabled>停止播放</button><button type="button" class="cg-go" id="${P}Go">开始测量</button>` : isDelay ? `<button type="button" class="cg-unit" id="${P}Unit">毫秒</button>` : `<button type="button" class="cg-unit" id="${P}Next">下一个喇叭</button>`}
        ${isSpl ? '' : `<button type="button" class="cg-go" id="${P}Go">开始测量</button>`}</div>
      <div class="cg-foot"><button type="button" class="btn btn-ghost btn-sm" id="${P}Next2">下一个喇叭 ›</button><button type="button" class="btn btn-accent btn-sm" id="${P}Write">写入通道表</button><span id="${P}Cue" class="cg-cue"></span></div>`;
    panel.appendChild(box); panel.appendChild(adv);

    // 相对左前高的到达时间（ms）
    function rel() {
      const D = hist[11] ? hist[11].d : hist[12] ? hist[12].d : null, out = {};
      Object.keys(hist).forEach((k) => { const id = +k, h = hist[k], p = pin(id); if (!p || h.d == null) return; if (id === 11) out[id] = 0; else if (p.s === 'R') out[id] = h.d; else if (D != null) out[id] = D - h.d; });
      return out;
    }
    function lvRel() { const ids = Object.keys(hist).map(Number).filter((id) => hist[id].db != null && id !== 7); const ref = ids.length ? Math.min(...ids.map((id) => hist[id].db)) : 0; const o = {}; Object.keys(hist).forEach((k) => { if (hist[k].db != null) o[k] = hist[k].db - ref; }); return o; }
    const fmt = (ms) => unit === 'ms' ? `${r3(ms)} ms` : `${Math.round(ms * 34.3)} cm`;
    function pinVal(id) {
      const h = hist[id]; if (!h) return '';
      if (isSpl) return `${hist[id].db.toFixed(1)} dB`;
      if (!isDelay) return h.pol === '正' ? '正相' : h.pol === '反' ? '<b class="bad">反相</b>' : h.pol;
      const R = rel(); return R[id] != null ? fmt(R[id]) : '待测左前高';
    }
    function tip() {
      const p = pin(cur), c = Channels.get(cur), nm = `<b class="red">${p.n}</b>`;
      if (isDelay && p.s === 'M') return `低音炮延时请用「分频衔接」或「正反相 → 超低音 vs 门板」对齐，这里不测。`;
      if (isSpl) return `请在 DSP 只打开 ${nm}（CH${cur}）后，逐一点击喇叭逐个测量声压。`;
      if (isDelay) return `请在DSP打开 ${nm}（CH${cur}）和基准 <b>${pin(REF[p.s]).n}</b>（CH${REF[p.s]}），并关闭其它所有喇叭。`;
      return `请在DSP打开 ${nm}（CH${cur}${c && c.invert ? '，DSP 里当前设为反相' : ''}），并关闭其它所有喇叭。`;
    }
    function render() {
      $(P + 'Pins').innerHTML = PINS.map((p) => `<button type="button" class="cg-pin ${p.id === cur ? 'on' : ''} ${p.x === 0 ? 'l' : p.x === 100 ? 'r' : 'm'} ${hist[p.id] ? 'done' : ''}" data-id="${p.id}" style="top:${p.y}%;${p.x === 0 ? 'left:0' : p.x === 100 ? 'right:0' : 'left:50%'}">
        <span class="cg-name">${p.n}</span><span class="cg-ico"><svg width="22" height="18" viewBox="0 0 22 18" style="${p.x === 100 ? 'transform:scaleX(-1)' : ''}"><path d="M1 6h4l5-4v14l-5-4H1z" fill="currentColor"/><path d="M14 5q3 4 0 8M17 3q5 6 0 12" stroke="currentColor" fill="none" stroke-width="1.4"/></svg></span><span class="cg-val">${pinVal(p.id)}</span></button>`).join('');
      $(P + 'Pins').querySelectorAll('.cg-pin').forEach((b) => { b.onclick = () => { cur = +b.dataset.id; LS.set(KEY + '-cur', cur); $(P + 'Res').hidden = true; render(); }; });
      $(P + 'Tip').innerHTML = tip();
      if (isSpl) { const L = lvRel(); $(P + 'Cards').innerHTML = PINS.map((p) => `<div class="cg-card ${p.id === cur ? 'on' : ''}"><span>${p.n}</span><b>${hist[p.id] ? `${L[p.id] >= 0 ? '+' : ''}${L[p.id].toFixed(1)}` : '—'}</b><button type="button" data-ce="${p.id}">测</button></div>`).join('');
        $(P + 'Cards').querySelectorAll('[data-ce]').forEach((b) => { b.onclick = () => { cur = +b.dataset.ce; render(); go.click(); }; }); }
      const rec = Role.get() === 'recorder', go = $(P + 'Go');
      if (!busy) go.textContent = rec ? '● 开始测量（录音）' : '▶ 开始测量（播放）';
      go.disabled = isDelay && pin(cur).s === 'M';
      $(P + 'Status').textContent = busy ? $(P + 'Status').textContent : rec ? '先在这部手机点「开始测量」，再去播放端点「开始测量」' : '录音端先点开始，再在这部手机点「开始测量」（约 15 秒）';
    }
    function showHist() {
      const R = rel(), ids = ORDER.filter((id) => hist[id]);
      const el = $(P + 'Hist'); el.hidden = !el.hidden;
      if (isSpl) { el.hidden = true; if (confirm('清空所有声压测量？')) { hist = {}; LS.set(KEY, hist); render(); } return; }
      el.innerHTML = ids.length ? `<table class="ci-tab"><tr><th>喇叭</th><th>${isDelay ? '相对左前高' : '极性'}</th><th>时间</th></tr>${ids.map((id) => `<tr><td>CH${id} ${pin(id).n}</td><td>${isDelay ? (R[id] != null ? fmt(R[id]) : `对基准 ${hist[id].d} ms`) : esc(hist[id].pol)}</td><td>${esc((hist[id].at || '').slice(5, 16).replace('T', ' '))}</td></tr>`).join('')}</table><button type="button" class="btn btn-ghost btn-sm" id="${P}Clr">清空历史</button>` : '<p class="sp-hint">还没有测量记录</p>';
      const c = $(P + 'Clr'); if (c) c.onclick = () => { hist = {}; LS.set(KEY, hist); el.hidden = true; render(); };
    }
    function next() { cur = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length]; if (isDelay && pin(cur).s === 'M') cur = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length]; LS.set(KEY + '-cur', cur); $(P + 'Res').hidden = true; render(); }
    function result(html) { const r = $(P + 'Res'); r.innerHTML = html; r.hidden = false; }
    function onRec(x, sr) {
      const d = TestTrack.detect(x, sr);
      if (!d || d.type !== 'polExt') return result(`⚠️ ${!d ? '没听到测试音：两台都打开本页再测' : '播放端要打开同一页（延时/极性）'}`);
      if (!d.complete) return result('⚠️ 没录完整，等播放端放完');
      const a = TestTrack.analyzePolExt(x, sr, d), p = pin(cur), at = new Date().toISOString();
      if (isSpl) {
        const s = p.s === 'R' ? a.R : p.s === 'L' ? a.L : (a.L.levelDb > a.R.levelDb ? a.L : a.R);
        if (!s.present) return result(`⚠️ 没听到 ${p.n}：检查 DSP 里是否只开了这一路`);
        hist[cur] = { db: s.levelDb, at }; LS.set(KEY, hist); result(`✅ ${p.n}：${s.levelDb} dB（相对值）`); render(); if (multi) next(); return;
      }
      if (isDelay) {
        if (a.L.arrivalMs == null || a.R.arrivalMs == null) return result(`⚠️ 没同时听到 ${p.n} 和基准 ${pin(REF[p.s]).n}：两个都要在 DSP 里打开`);
        const own = p.s === 'L' ? a.L.arrivalMs : a.R.arrivalMs, ref = p.s === 'L' ? a.R.arrivalMs : a.L.arrivalMs;
        hist[cur] = { d: r3(a.R.arrivalMs - a.L.arrivalMs), at }; LS.set(KEY, hist);
        const v = rel()[cur];
        result(`✅ ${p.n}：${v != null ? `比左前高${v >= 0 ? '晚' : '早'} ${fmt(Math.abs(v))}` : `比基准${own > ref ? '晚' : '早'} ${fmt(Math.abs(own - ref))}（先测左前高才能换算）`}`);
      } else {
        const s = p.s === 'R' ? a.R : p.s === 'L' ? a.L : (a.L.present ? a.L : a.R);
        if (!s.present) return result(`⚠️ 没听到 ${p.n}：检查 DSP 里是否只开了这一路`);
        hist[cur] = { pol: s.polarity, at }; LS.set(KEY, hist);
        result(s.polarity === '正' ? `✅ ${p.n} 正相` : s.polarity === '反' ? `❌ ${p.n} 反相（接线或 DSP 极性反了）` : `⚠️ ${p.n} 不确定，再测一次${p.s === 'M' ? '（超低音建议用正反相「超低音 vs 门板」）' : ''}`);
      }
      render();
    }
    let busy = false;
    const go = $(P + 'Go'), status = $(P + 'Status'), cue = $(P + 'Cue');
    // 隐藏按钮供 Duo 绑定
    const pb = document.createElement('button'), rb = document.createElement('button'); pb.hidden = rb.hidden = true; box.appendChild(pb); box.appendChild(rb);
    Duo.player({ btn: pb, cue, count: null, track: () => TestTrack.buildTrack('polExt'), cues: [[0, '准备…'], [1, '同步咔嗒'], [2.5, '左声道'], [7.5, '右声道'], [12.5, '完成 ✓']] });
    Duo.recorder({ btn: rb, status, kind: 'polExt', maxSec: 40,
      isDone: (x, sr) => { const d = TestTrack.detect(x, sr); return { heard: !!(d && d.type === 'polExt'), done: !!(d && d.type === 'polExt' && d.complete) }; },
      onDone: (x, sr) => { busy = false; onRec(x, sr); } });
    const sync = () => { const b = Role.get() === 'recorder' ? rb : pb; busy = /停止/.test(b.textContent); go.textContent = busy ? '■ 停止' : (Role.get() === 'recorder' ? '● 开始测量（录音）' : '▶ 开始测量（播放）'); go.classList.toggle('busy', busy); };
    new MutationObserver(sync).observe(pb, { childList: true, characterData: true, subtree: true });
    new MutationObserver(sync).observe(rb, { childList: true, characterData: true, subtree: true });
    go.onclick = () => { $(P + 'Res').hidden = true; (Role.get() === 'recorder' ? rb : pb).click(); };
    if (isSpl) {
      box.querySelectorAll('.cg-seg button').forEach((b) => { b.onclick = () => { multi = b.dataset.m === '1'; box.querySelectorAll('.cg-seg button').forEach((x) => x.classList.toggle('on', x === b)); }; });
      $(P + 'Again').onclick = () => { delete hist[cur]; LS.set(KEY, hist); go.click(); };
      new MutationObserver(() => { $(P + 'Stop').disabled = !/停止/.test(pb.textContent); }).observe(pb, { childList: true, subtree: true });
      $(P + 'Stop').onclick = () => { if (/停止/.test(pb.textContent)) pb.click(); };
    } else if (isDelay) $(P + 'Unit').onclick = () => { unit = unit === 'ms' ? 'cm' : 'ms'; $(P + 'Unit').textContent = unit === 'ms' ? '毫秒' : '厘米'; render(); };
    else $(P + 'Next').onclick = next;
    $(P + 'Next2').onclick = next;
    $(P + 'HistBtn').onclick = showHist;
    $(P + 'Back').onclick = () => App.switchTab('home');
    $(P + 'Write').onclick = () => {
      if (typeof History !== 'undefined') History.push(isDelay ? '单喇叭延时写入前' : '单喇叭极性写入前');
      const chs = Channels.getAll();
      if (isSpl) {
        const L = lvRel(), ids = Object.keys(L).map(Number).filter((id) => id !== 7); if (!ids.length) return alert('还没有测量');
        ids.forEach((id) => { const c = chs[id - 1]; c.gainSetDb = Math.round(((c.gainSetDb || 0) - L[id]) * 2) / 2; });
        Channels.setAll(chs); alert(`已按最小声压对齐 ${ids.length} 路增益（低音炮不改，按听感定）。抄进 DSP 后再测一遍。`); return;
      }
      if (isDelay) {
        const R = rel(), ids = Object.keys(R).map(Number); if (ids.length < 2) return alert('至少测两个喇叭（含左前高）才能算补偿');
        const mx = Math.max(...ids.map((id) => R[id]));
        const nv = ids.map((id) => ({ id, v: (chs[id - 1].delaySetMs || 0) + (mx - R[id]) })), mn = Math.min(...nv.map((o) => o.v));
        nv.forEach((o) => { chs[o.id - 1].delaySetMs = r3(o.v - mn); });
        Channels.setAll(chs); alert(`已写入 ${ids.length} 路延时（最晚到的不加，其余补齐）。记得抄进 DSP 后再测一遍。`);
      } else {
        let n = 0; Object.keys(hist).forEach((k) => { const h = hist[k], c = chs[+k - 1]; if (c && h.pol === '反') { c.invert = !c.invert; n++; } });
        Channels.setAll(chs); alert(n ? `已把 ${n} 路测出反相的通道翻转极性。抄进 DSP 后再测一遍确认。` : '没有测出反相的喇叭，通道表不变');
      }
    };
    if (typeof Role !== 'undefined') Role.onChange(() => { sync(); render(); });
    render();
  }
  const TILES = [['simple','±','正反相'],['delay','⏱','单喇叭延时'],['spl','📶','声压测试'],['polarity','⊕','极性检测'],['phase','φ','相位测试'],['carid','🚗','整车识别'],['multi','🎯','多点测量'],['image','🎙','声像居中'],['xcheck','🔗','分频衔接'],['rta','〰','频谱 RTA'],['gen','∿','信号发生器'],['listen','🎧','听感评分'],['cal','🎤','麦克风校准'],['plan','🎛','12 通道方案'],['plans','🗂','方案管理'],['dsp','📋','DSP 参数表'],['analyze','📂','录音分析'],['xover','✂','分频辅助'],['log','📝','测量记录'],['help','❓','使用说明']];
  function home() {
    const main = document.querySelector('main.panels'); if (!main || $('panel-home')) return;
    const sec = document.createElement('section'); sec.id = 'panel-home'; sec.className = 'panel'; sec.setAttribute('role', 'tabpanel'); sec.hidden = true;
    sec.innerHTML = `<div class="hm"><h2>汽车音响调音</h2><p class="hm-sub">两部手机：一部连车载蓝牙播放，一部放主驾头部录音</p><button type="button" class="hm-role" onclick="Role.ask()">切换本机身份</button><div class="hm-grid">${TILES.map(([t, i, n]) => `<button type="button" class="hm-tile" data-go="${t}"><span>${i}</span>${n}</button>`).join('')}</div></div>`;
    main.prepend(sec);
    sec.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => App.switchTab(b.dataset.go); });
    const nav = document.querySelector('.bnav'); if (nav && !document.querySelector('.bnav[data-tab="home"]')) { const h = nav.cloneNode(false); h.dataset.tab = 'home'; h.classList.remove('active'); h.innerHTML = '<span class="bnav-ico">⌂</span><span>首页</span>'; h.onclick = () => App.switchTab('home'); nav.parentNode.prepend(h); }
    App.switchTab('home');
  }
  function init() {
    home();
    make('delay'); make('polarity'); make('spl');
    const upd = () => { const a = document.querySelector('.panel.active'); document.body.classList.toggle('cg-on', !!(a && /^panel-(delay|polarity|spl|home)$/.test(a.id))); document.body.classList.toggle('cg-home', !!(a && a.id === 'panel-home')); };
    new MutationObserver(upd).observe(document.querySelector('main') || document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
    upd();
  }
  return { init };
})();
