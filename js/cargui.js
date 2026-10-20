/** 俯视车图引导式界面：延时/极性/声压 + 其余测量页共用壳；首页宫格 */
const CarGui = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&', '<': '<', '>': '>', '"': '"' }[c]));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const PINS = [
    { id: 11, n: '左前高', x: 0, y: 17, s: 'L' }, { id: 12, n: '右前高', x: 100, y: 17, s: 'R' },
    { id: 9, n: '左前中', x: 0, y: 27, s: 'L' }, { id: 10, n: '右前中', x: 100, y: 27, s: 'R' },
    { id: 5, n: '左前中低', x: 0, y: 39, s: 'L' }, { id: 6, n: '右前中低', x: 100, y: 39, s: 'R' },
    { id: 3, n: '左二排', x: 0, y: 56, s: 'L' }, { id: 4, n: '右二排', x: 100, y: 56, s: 'R' },
    { id: 1, n: '左尾门', x: 0, y: 72, s: 'L' }, { id: 2, n: '右尾门', x: 100, y: 72, s: 'R' },
    { id: 7, n: '低音炮', x: 50, y: 84, s: 'M' },
  ];
  const ORDER = PINS.map((p) => p.id);
  const REF = { L: 12, R: 11 };
  const pin = (id) => PINS.find((p) => p.id === id);
  const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? d; } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const CAR_SVG = `<svg viewBox="0 0 200 400" class="cg-car" aria-hidden="true"><defs><linearGradient id="cgG" x1="0" x2="1"><stop offset="0" stop-color="#c9daf5"/><stop offset=".5" stop-color="#e6effc"/><stop offset="1" stop-color="#c3d4f0"/></linearGradient></defs>
    <path d="M60 18 Q100 4 140 18 Q168 30 170 70 L172 330 Q170 382 140 390 L60 390 Q30 382 28 330 L30 70 Q32 30 60 18Z" fill="url(#cgG)" stroke="#0b1f6b" stroke-width="4"/>
    <path d="M24 150 L10 162 L28 168Z M176 150 L190 162 L172 168Z" fill="#c9daf5" stroke="#0b1f6b" stroke-width="3"/>
    <path d="M44 95 Q100 70 156 95 L150 135 Q100 120 50 135Z" fill="#9fb6dd" stroke="#0b1f6b" stroke-width="3"/>
    <path d="M50 300 Q100 312 150 300 L156 340 Q100 352 44 340Z" fill="#9fb6dd" stroke="#0b1f6b" stroke-width="3"/>
    <g fill="none" stroke="#6b7fa8" stroke-dasharray="3 3" stroke-width="1.2"><rect x="58" y="150" width="36" height="40" rx="6"/><rect x="106" y="150" width="36" height="40" rx="6"/><rect x="58" y="205" width="36" height="36" rx="6"/><rect x="106" y="205" width="36" height="36" rx="6"/><rect x="54" y="252" width="92" height="36" rx="6"/></g>
    <path d="M30 70 L170 70 M100 20 L100 70" stroke="#0b1f6b" stroke-width="1" opacity=".4"/></svg>`;
  const ICO = (flip) => `<svg width="22" height="18" viewBox="0 0 22 18" style="${flip ? 'transform:scaleX(-1)' : ''}"><path d="M1 6h4l5-4v14l-5-4H1z" fill="currentColor"/><path d="M14 5q3 4 0 8M17 3q5 6 0 12" stroke="currentColor" fill="none" stroke-width="1.4"/></svg>`;

  function tuck(panel) {
    const adv = document.createElement('details'); adv.className = 'cg-adv'; adv.innerHTML = '<summary>高级 / 旧版界面</summary>';
    [...panel.children].forEach((c) => { if (!c.classList.contains('role-note') && !c.classList.contains('cg')) adv.appendChild(c); });
    return adv;
  }
  function pinsHtml(active, doneMap, onClickAttr) {
    const A = new Set(Array.isArray(active) ? active : [active]);
    return PINS.map((p) => `<button type="button" class="cg-pin ${A.has(p.id) ? 'on' : ''} ${p.x === 0 ? 'l' : p.x === 100 ? 'r' : 'm'} ${doneMap && doneMap[p.id] ? 'done' : ''}" data-id="${p.id}" style="top:${p.y}%;${p.x === 0 ? 'left:0' : p.x === 100 ? 'right:0' : 'left:50%'}" ${onClickAttr || ''}>
      <span class="cg-name">${p.n}</span><span class="cg-ico">${ICO(p.x === 100)}</span><span class="cg-val">${doneMap && doneMap[p.id] ? doneMap[p.id] : ''}</span></button>`).join('');
  }

  // ---------- 延时 / 极性 / 声压（完整交互） ----------
  function make(mode) {
    const isDelay = mode === 'delay', isSpl = mode === 'spl';
    let multi = false;
    const P = isDelay ? 'cgd' : isSpl ? 'cgs' : 'cgp';
    const KEY = isDelay ? 'cat-cg-delay-v1' : isSpl ? 'cat-cg-spl-v1' : 'cat-cg-pol-v1';
    let hist = LS.get(KEY, {}), cur = LS.get(KEY + '-cur', 11), unit = 'ms', busy = false;
    const panel = $('panel-' + mode); if (!panel || $(P)) return;
    const adv = tuck(panel);
    const box = document.createElement('div'); box.className = 'cg'; box.id = P;
    box.innerHTML = `
      <div class="cg-top"><button type="button" class="cg-back" id="${P}Back" aria-label="返回">‹</button><h2>${isDelay ? '单喇叭延时校准' : isSpl ? '声压测试' : '单喇叭极性检测'}</h2><button type="button" class="cg-hist" id="${P}HistBtn">⇅${isSpl ? '重置' : '历史'}</button></div>
      ${isSpl ? `<div class="cg-seg"><button type="button" class="on" data-m="0">单喇叭</button><button type="button" data-m="1">多喇叭</button></div>` : ''}
      <div class="cg-tip" id="${P}Tip"></div>
      <div class="cg-stage${isSpl ? ' small' : ''}">${CAR_SVG}<div class="cg-pins" id="${P}Pins"></div></div>
      <div class="cg-res" id="${P}Res" hidden></div>
      ${isSpl ? `<div class="cg-cards" id="${P}Cards"></div>` : ''}
      <div class="cg-histbox" id="${P}Hist" hidden></div>
      <div class="cg-status" id="${P}Status"></div>
      <div class="cg-bottom">${isSpl
        ? `<button type="button" class="cg-unit ghost" id="${P}Again">重新测量</button><button type="button" class="cg-go ghost" id="${P}Stop" disabled>停止播放</button><button type="button" class="cg-go" id="${P}Go">开始测量</button>`
        : isDelay
          ? `<button type="button" class="cg-unit" id="${P}Unit">毫秒</button><button type="button" class="cg-go" id="${P}Go">开始测量</button>`
          : `<button type="button" class="cg-unit" id="${P}Next">下一个喇叭</button><button type="button" class="cg-go" id="${P}Go">开始测量</button>`}</div>
      <div class="cg-foot"><button type="button" class="btn btn-ghost btn-sm" id="${P}Next2">下一个喇叭 ›</button><button type="button" class="btn btn-accent btn-sm" id="${P}Write">写入通道表</button><span id="${P}Cue" class="cg-cue"></span></div>`;
    panel.appendChild(box); panel.appendChild(adv);

    function rel() {
      const D = hist[11] ? hist[11].d : hist[12] ? hist[12].d : null, out = {};
      Object.keys(hist).forEach((k) => { const id = +k, h = hist[k], p = pin(id); if (!p || h.d == null) return; if (id === 11) out[id] = 0; else if (p.s === 'R') out[id] = h.d; else if (D != null) out[id] = D - h.d; });
      return out;
    }
    function lvRel() { const ids = Object.keys(hist).map(Number).filter((id) => hist[id].db != null && id !== 7); const ref = ids.length ? Math.min(...ids.map((id) => hist[id].db)) : 0; const o = {}; Object.keys(hist).forEach((k) => { if (hist[k].db != null) o[k] = hist[k].db - ref; }); return o; }
    const fmt = (ms) => unit === 'ms' ? `${r3(ms)} ms` : `${Math.round(ms * 34.3)} cm`;
    function pinVal(id) {
      const h = hist[id]; if (!h) return '';
      if (isSpl) return `${h.db.toFixed(1)} dB`;
      if (!isDelay) return h.pol === '正' ? '正相' : h.pol === '反' ? '<b class="bad">反相</b>' : h.pol;
      const R = rel(); return R[id] != null ? fmt(R[id]) : '待测左前高';
    }
    function tip() {
      const p = pin(cur), c = Channels.get(cur), nm = `<b class="red">${p.n}</b>`;
      if (isSpl) return `请在 DSP 只打开 ${nm}（CH${cur}）后，逐一点击喇叭逐个测量声压。`;
      if (isDelay && p.s === 'M') return `低音炮延时请用「分频衔接」或「正反相 → 超低音 vs 门板」对齐，这里不测。`;
      if (isDelay) return `请在DSP打开 ${nm}（CH${cur}）和基准 <b>${pin(REF[p.s]).n}</b>（CH${REF[p.s]}），并关闭其它所有喇叭。`;
      return `请在DSP打开 ${nm}（CH${cur}${c && c.invert ? '，DSP 里当前设为反相' : ''}），并关闭其它所有喇叭。`;
    }
    function render() {
      const doneMap = {}; Object.keys(hist).forEach((k) => { doneMap[k] = pinVal(+k); });
      $(P + 'Pins').innerHTML = pinsHtml(cur, doneMap);
      $(P + 'Pins').querySelectorAll('.cg-pin').forEach((b) => { b.onclick = () => { cur = +b.dataset.id; LS.set(KEY + '-cur', cur); $(P + 'Res').hidden = true; render(); }; });
      $(P + 'Tip').innerHTML = tip();
      if (isSpl) {
        const L = lvRel();
        $(P + 'Cards').innerHTML = PINS.map((p) => `<div class="cg-card ${p.id === cur ? 'on' : ''}"><span>${p.n}</span><b>${hist[p.id] ? `${L[p.id] >= 0 ? '+' : ''}${L[p.id].toFixed(1)}` : '—'}</b><button type="button" data-ce="${p.id}">测</button></div>`).join('');
        $(P + 'Cards').querySelectorAll('[data-ce]').forEach((b) => { b.onclick = () => { cur = +b.dataset.ce; render(); go.click(); }; });
      }
      const rec = Role.get() === 'recorder', go = $(P + 'Go');
      if (!busy) go.textContent = rec ? '● 开始测量（录音）' : '▶ 开始测量（播放）';
      go.disabled = isDelay && pin(cur).s === 'M';
      $(P + 'Status').textContent = busy ? $(P + 'Status').textContent : rec ? '先在这部手机点「开始测量」，再去播放端点「开始测量」' : '录音端先点开始，再在这部手机点「开始测量」（约 15 秒）';
    }
    function showHist() {
      const el = $(P + 'Hist');
      if (isSpl) { el.hidden = true; if (confirm('清空所有声压测量？')) { hist = {}; LS.set(KEY, hist); render(); } return; }
      const R = rel(), ids = ORDER.filter((id) => hist[id]);
      el.hidden = !el.hidden;
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
    const go = $(P + 'Go'), status = $(P + 'Status'), cue = $(P + 'Cue');
    const pb = document.createElement('button'), rb = document.createElement('button'); pb.hidden = rb.hidden = true; box.appendChild(pb); box.appendChild(rb);
    Duo.player({ btn: pb, cue, count: null, track: () => TestTrack.buildTrack('polExt'), cues: [[0, '准备…'], [1, '同步咔嗒'], [2.5, '左声道'], [7.5, '右声道'], [12.5, '完成 ✓']] });
    Duo.recorder({ btn: rb, status, kind: 'polExt', maxSec: 40,
      isDone: (x, sr) => { const d = TestTrack.detect(x, sr); return { heard: !!(d && d.type === 'polExt'), done: !!(d && d.type === 'polExt' && d.complete) }; },
      onDone: (x, sr) => { busy = false; onRec(x, sr); } });
    const sync = () => { const b = Role.get() === 'recorder' ? rb : pb; busy = /停止/.test(b.textContent); go.textContent = busy ? '■ 停止' : (Role.get() === 'recorder' ? '● 开始测量（录音）' : '▶ 开始测量（播放）'); go.classList.toggle('busy', busy); if (isSpl) $(P + 'Stop').disabled = !/停止/.test(pb.textContent); };
    new MutationObserver(sync).observe(pb, { childList: true, characterData: true, subtree: true });
    new MutationObserver(sync).observe(rb, { childList: true, characterData: true, subtree: true });
    go.onclick = () => { $(P + 'Res').hidden = true; (Role.get() === 'recorder' ? rb : pb).click(); };
    if (isSpl) {
      box.querySelectorAll('.cg-seg button').forEach((b) => { b.onclick = () => { multi = b.dataset.m === '1'; box.querySelectorAll('.cg-seg button').forEach((x) => x.classList.toggle('on', x === b)); }; });
      $(P + 'Again').onclick = () => { delete hist[cur]; LS.set(KEY, hist); go.click(); };
      $(P + 'Stop').onclick = () => { if (/停止/.test(pb.textContent)) pb.click(); };
    } else if (isDelay) $(P + 'Unit').onclick = () => { unit = unit === 'ms' ? 'cm' : 'ms'; $(P + 'Unit').textContent = unit === 'ms' ? '毫秒' : '厘米'; render(); };
    else $(P + 'Next').onclick = next;
    $(P + 'Next2').onclick = next;
    $(P + 'HistBtn').onclick = showHist;
    $(P + 'Back').onclick = () => App.switchTab('home');
    $(P + 'Write').onclick = () => {
      if (typeof History !== 'undefined') History.push(isDelay ? '单喇叭延时写入前' : isSpl ? '声压写入前' : '单喇叭极性写入前');
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

  // ---------- 通用引导壳：挂到已有播放/录音按钮上 ----------
  /** opts: { title, tip, active, seg, playId, recId, statusId?, histLabel?, extra?, micDots?, allOn?, size? } */
  function wrap(id, opts) {
    const panel = $('panel-' + id); if (!panel || $('cgw-' + id)) return;
    const adv = tuck(panel);
    const P = 'cgw-' + id;
    const box = document.createElement('div'); box.className = 'cg'; box.id = P;
    const segs = (opts.seg || []).map((s, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-seg="${s.v}">${s.t}</button>`).join('');
    box.innerHTML = `
      <div class="cg-top"><button type="button" class="cg-back" data-back aria-label="返回">‹</button><h2>${opts.title}</h2><button type="button" class="cg-hist" data-hist>⇅${opts.histLabel || '历史'}</button></div>
      ${segs ? `<div class="cg-seg">${segs}</div>` : ''}
      <div class="cg-tip" data-tip>${opts.tip}</div>
      ${opts.extra || ''}
      <div class="cg-stage ${opts.size || ''}">${CAR_SVG}<div class="cg-pins" data-pins></div>${opts.micDots || ''}</div>
      <div class="cg-res" data-res hidden></div>
      <div class="cg-status" data-status></div>
      <div class="cg-bottom"><button type="button" class="cg-go" data-go>开始测量</button></div>
      <div class="cg-foot"><span class="cg-cue" data-cue></span></div>`;
    panel.prepend(box); panel.appendChild(adv);
    box.querySelector('[data-back]').onclick = () => App.switchTab('home');
    const paint = (active, done) => { box.querySelector('[data-pins]').innerHTML = pinsHtml(opts.allOn ? PINS.map((p) => p.id) : (active || opts.active || []), done); };
    paint(opts.active);
    const go = box.querySelector('[data-go]'), status = box.querySelector('[data-status]');
    const syncRole = () => {
      const rec = Role.get() === 'recorder';
      if (opts.playerOnly && rec) { go.textContent = '请切换到播放端'; go.disabled = true; status.textContent = '这部是录音端：请在连蓝牙的播放端做'; return; }
      if (opts.recorderOnly && !rec) { go.textContent = '请切换到录音端'; go.disabled = true; status.textContent = '这部是播放端：请在录音端做'; return; }
      go.disabled = false;
      const pb = opts.playId && $(opts.playId), rb = opts.recId && $(opts.recId);
      const b = rec ? rb : pb;
      const busy = b && /停止/.test(b.textContent);
      go.textContent = busy ? '■ 停止' : (rec ? '● 开始测量（录音）' : '▶ 开始测量（播放）');
      go.classList.toggle('busy', !!busy);
      status.textContent = busy ? (status.textContent || '') : (rec ? '先在这部手机点开始，再去播放端点开始' : '录音端先点开始，再在这部手机点开始');
      if (opts.statusId && $(opts.statusId)) status.textContent = $(opts.statusId).textContent || status.textContent;
    };
    go.onclick = () => {
      const rec = Role.get() === 'recorder';
      if (opts.playerOnly && rec) return Role.ask();
      if (opts.recorderOnly && !rec) return Role.ask();
      const b = rec ? $(opts.recId) : $(opts.playId);
      if (b) b.click(); else alert('页面控件未就绪，请刷新');
    };
    // 同步旧按钮文案
    [opts.playId, opts.recId, opts.statusId].filter(Boolean).forEach((id) => {
      const el = $(id); if (!el) return;
      new MutationObserver(syncRole).observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    });
    if (typeof Role !== 'undefined') Role.onChange(syncRole);
    syncRole();
    return { box, paint, syncRole, setTip: (h) => { box.querySelector('[data-tip]').innerHTML = h; }, setRes: (h) => { const r = box.querySelector('[data-res]'); if (!h) { r.hidden = true; return; } r.innerHTML = h; r.hidden = false; } };
  }

  // ---------- 正反相 ----------
  function simplePage() {
    const PAIRS = {
      lr: { t: '左右整体', tip: '请在 DSP <b class="red">打开所有喇叭</b>（正常出声），测左右整体相位。', active: ORDER },
      sub: { t: '超低音 vs 门板', tip: '请在 DSP 只打开 <b class="red">低音炮 CH7</b> 和 <b class="red">左/右前门中低 CH5/6</b>，关闭其它。', active: [7, 5, 6] },
      tw: { t: '高音 vs 中音', tip: '请在 DSP 只打开 <b class="red">左/右高音 CH11/12</b> 和 <b class="red">左/右中音 CH9/10</b>，关闭其它。', active: [11, 12, 9, 10] },
    };
    let mode = 'pair', pair = 'lr', ch = 11;
    const extra = `<div class="cg-seg cg-pairseg" data-pairs>
      <button type="button" class="on" data-p="lr">左右整体</button>
      <button type="button" data-p="sub">超低音vs门板</button>
      <button type="button" data-p="tw">高音vs中音</button></div>`;
    const ui = wrap('simple', {
      title: '正反相', tip: PAIRS.lr.tip, active: PAIRS.lr.active, histLabel: '重置',
      seg: [{ v: 'pair', t: '两个一起' }, { v: 'single', t: '单个喇叭' }],
      playId: 'spPlay', recId: 'spRec', statusId: 'spRecStatus', extra,
    });
    if (!ui) return;
    const paint = () => {
      if (mode === 'pair') { const p = PAIRS[pair]; ui.setTip(p.tip); ui.paint(p.active); ui.box.querySelector('[data-pairs]').hidden = false; }
      else { ui.setTip(`请在 DSP 打开 <b class="red">${pin(ch).n}</b>（CH${ch}），并关闭其它所有喇叭。`); ui.paint([ch]); ui.box.querySelector('[data-pairs]').hidden = true; }
      // 同步旧版 Simple 状态
      const mb = document.querySelector(`[data-spmode="${mode}"]`); if (mb) mb.click();
      if (mode === 'pair') { const sel = $('spPair'); if (sel) { sel.value = pair; sel.dispatchEvent(new Event('change')); } }
      else { const b = document.querySelector(`[data-spch="${ch}"]`); if (b) b.click(); }
    };
    ui.box.querySelectorAll('[data-seg]').forEach((b) => { b.onclick = () => { mode = b.dataset.seg; ui.box.querySelectorAll('[data-seg]').forEach((x) => x.classList.toggle('on', x === b)); paint(); }; });
    ui.box.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { pair = b.dataset.p; ui.box.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b)); paint(); }; });
    ui.box.querySelector('[data-pins]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]'); if (!b || mode !== 'single') return;
      ch = +b.dataset.id; paint();
    });
    ui.box.querySelector('[data-hist]').onclick = () => { const r = $('spReset'); if (r) r.click(); };
    // 结果卡片出现时抄到引导区
    const obs = new MutationObserver(() => {
      const card = $('spResult'); if (card && !card.hidden) ui.setRes(`<b>${$('spVerdict').textContent}</b><p>${esc($('spReason').textContent)}</p>`);
    });
    if ($('spResult')) obs.observe($('spResult'), { attributes: true, childList: true, subtree: true });
    paint();
  }

  // ---------- 相位（双设备，全车） ----------
  function phasePage() {
    const ui = wrap('phase', {
      title: '相位测试', tip: '请在 DSP <b class="red">打开所有喇叭</b>，录音手机放主驾头部。全程约 85 秒。',
      allOn: true, playId: 'phDuoPlay', recId: 'phDuoRec', statusId: 'phDuoRecStatus',
    });
    if (!ui) return;
    const obs = new MutationObserver(() => { const r = $('phDuoRes'); if (r && !r.hidden) ui.setRes(r.innerHTML); });
    if ($('phDuoRes')) obs.observe($('phDuoRes'), { attributes: true, childList: true, subtree: true });
  }

  // ---------- 分频衔接 ----------
  const XO = {
    xo300: { t: '300 Hz', tip: '请在 DSP 只打开 <b class="red">前门中低 CH5/6</b> 和 <b class="red">仪表台中音 CH9/10</b>，关闭其它。', active: [5, 6, 9, 10] },
    xo4k: { t: '4 kHz', tip: '请在 DSP 只打开 <b class="red">仪表台中音 CH9/10</b> 和 <b class="red">高音 CH11/12</b>，关闭其它。', active: [9, 10, 11, 12] },
  };
  function xcheckPage() {
    let band = 'xo300';
    const ui = wrap('xcheck', {
      title: '分频衔接', tip: XO.xo300.tip, active: XO.xo300.active,
      seg: [{ v: 'xo300', t: '300 Hz' }, { v: 'xo4k', t: '4 kHz' }],
      playId: 'xcPlay', recId: 'xcRec', statusId: 'xcRecStatus',
    });
    if (!ui) return;
    ui.box.querySelectorAll('[data-seg]').forEach((b) => {
      b.onclick = () => {
        band = b.dataset.seg; ui.box.querySelectorAll('[data-seg]').forEach((x) => x.classList.toggle('on', x === b));
        ui.setTip(XO[band].tip); ui.paint(XO[band].active);
        // 触发旧版选频
        const sel = document.querySelector(`[data-xcband="${band}"]`) || document.querySelector(`#xcBand [value="${band}"]`);
        const j = band === 'xo4k' ? 'B' : 'A';
        const jb = document.querySelector(`[data-xoj="${j}"]`); if (jb) jb.click();
      };
    });
    const obs = new MutationObserver(() => { const r = $('xcResult'); if (r && !r.hidden) ui.setRes(`<b>${$('xcVerdict')?$('xcVerdict').textContent:''}</b>`+(($('xcSummary')&&$('xcSummary').innerHTML)||'')); });
    if ($('xcResult')) obs.observe($('xcResult'), { attributes: true, childList: true, subtree: true });
  }

  // ---------- 声像居中 ----------
  function imagePage() {
    const ui = wrap('image', {
      title: '声像居中', tip: '请在 DSP <b class="red">打开前声场</b>（CH5/6/9/10/11/12），录音手机放主驾两耳中间。',
      active: [5, 6, 9, 10, 11, 12], playId: 'imPlay', recId: 'imRec', statusId: 'imRecStatus',
    });
    if (!ui) return;
    const obs = new MutationObserver(() => { const r = $('imResult'); if (r && !r.hidden) ui.setRes(`<b>${$('imVerdict')?$('imVerdict').textContent:''}</b>`+(($('imSummary')&&$('imSummary').innerHTML)||'')); });
    if ($('imResult')) obs.observe($('imResult'), { attributes: true, childList: true, subtree: true });
  }

  // ---------- 整车识别 ----------
  function caridPage() {
    const ui = wrap('carid', {
      title: '整车识别', tip: '请在 DSP <b class="red">打开所有喇叭</b>，录音手机放主驾头部。约 45 秒。',
      allOn: true, playId: 'ciPlay', recId: 'ciRec', statusId: 'ciRecStatus',
    });
    if (!ui) return;
    const obs = new MutationObserver(() => { const r = $('ciResult'); if (r && !r.hidden) ui.setRes(`<b>${$('ciScore')?$('ciScore').textContent:''}</b>`+(($('ciSummary')&&$('ciSummary').innerHTML)||'')); });
    if ($('ciResult')) obs.observe($('ciResult'), { attributes: true, childList: true, subtree: true });
  }

  // ---------- 多点测量（麦位点） ----------
  function multiPage() {
    const POS = [
      { id: 1, n: '正中', x: 50, y: 28 }, { id: 2, n: '偏左', x: 32, y: 28 }, { id: 3, n: '偏右', x: 68, y: 28 },
      { id: 4, n: '靠前', x: 50, y: 20 }, { id: 5, n: '靠后', x: 50, y: 38 },
      { id: 6, n: '上', x: 50, y: 16 }, { id: 7, n: '下', x: 50, y: 44 },
      { id: 8, n: '左前', x: 28, y: 22 }, { id: 9, n: '右前', x: 72, y: 22 },
    ];
    let cur = 1, done = {};
    const panel = $('panel-multi'); if (!panel || $('cgw-multi')) return;
    const adv = tuck(panel);
    const box = document.createElement('div'); box.className = 'cg'; box.id = 'cgw-multi';
    box.innerHTML = `
      <div class="cg-top"><button type="button" class="cg-back" aria-label="返回">‹</button><h2>多点测量</h2><button type="button" class="cg-hist">⇅重置</button></div>
      <div class="cg-tip">请在 DSP <b class="red">打开所有喇叭</b>。录音手机按图挪到绿点位置，每点录一次后取平均。</div>
      <div class="cg-stage">${CAR_SVG}<div class="cg-mics" data-mics></div></div>
      <div class="cg-status" data-status></div>
      <div class="cg-bottom"><button type="button" class="cg-unit" data-next>下一个点</button><button type="button" class="cg-go" data-go>开始测量</button></div>`;
    panel.prepend(box); panel.appendChild(adv);
    box.querySelector('.cg-back').onclick = () => App.switchTab('home');
    const paint = () => {
      box.querySelector('[data-mics]').innerHTML = POS.map((p) => `<button type="button" class="cg-mic ${p.id === cur ? 'on' : ''} ${done[p.id] ? 'done' : ''}" data-mid="${p.id}" style="left:${p.x}%;top:${p.y}%"><i></i><span>${p.n}</span></button>`).join('');
      box.querySelectorAll('[data-mid]').forEach((b) => { b.onclick = () => { cur = +b.dataset.mid; paint(); const sel = $('mpPos'); if (sel) { sel.value = String(cur); sel.dispatchEvent(new Event('change')); } }; });
      box.querySelector('[data-status]').textContent = `当前：${POS.find((p) => p.id === cur).n}（${Object.keys(done).length}/${POS.length}）`;
    };
    paint();
    const go = box.querySelector('[data-go]');
    const sync = () => {
      const rec = Role.get() === 'recorder', b = rec ? $('mpRec') : $('mpPlay');
      const busy = b && /停止/.test(b.textContent);
      go.textContent = busy ? '■ 停止' : (rec ? '● 开始测量（录音）' : '▶ 开始测量（播放）');
      go.classList.toggle('busy', !!busy);
    };
    go.onclick = () => { (Role.get() === 'recorder' ? $('mpRec') : $('mpPlay')).click(); };
    box.querySelector('[data-next]').onclick = () => { cur = cur % POS.length + 1; paint(); };
    box.querySelector('.cg-hist').onclick = () => { done = {}; paint(); const r = $('mpReset'); if (r) r.click(); };
    [$('mpPlay'), $('mpRec'), $('mpRecStatus')].filter(Boolean).forEach((el) => new MutationObserver(sync).observe(el, { childList: true, characterData: true, subtree: true }));
    // 录完打点
    const resObs = new MutationObserver(() => {
      const r = $('mpResult'); if (r && !r.hidden) { done[cur] = true; paint(); }
    });
    if ($('mpResult')) resObs.observe($('mpResult'), { attributes: true, childList: true, subtree: true });
    if (typeof Role !== 'undefined') Role.onChange(sync);
    sync();
  }

  // ---------- RTA ----------
  function rtaPage() {
    const ui = wrap('rta', {
      title: '频谱 RTA', tip: '请在 DSP <b class="red">打开要看的喇叭</b>（或全部）。录音端看实时频谱；播放端可放粉噪。',
      allOn: true, playId: 'rtaPink', recId: 'rtaStart', histLabel: '清空', size: 'small',
    });
    if (!ui) return;
    const chart = document.querySelector('#panel-rta .chart-card') || $('rtaCanvas');
    if (chart) ui.box.appendChild(chart.parentElement && chart.parentElement.classList.contains('chart-card') ? chart.parentElement : chart);
    const go = ui.box.querySelector('[data-go]');
    go.onclick = () => {
      if (Role.get() === 'recorder') { const b = $('rtaStart'); if (b) b.click(); }
      else { const b = $('rtaPink'); if (b) b.click(); }
    };
    const sync = () => {
      const rec = Role.get() === 'recorder';
      const b = rec ? $('rtaStart') : $('rtaPink');
      const busy = b && (b.classList.contains('busy') || /停止|关/.test(b.textContent));
      go.textContent = busy ? '■ 停止' : (rec ? '● 开始分析' : '▶ 播放粉噪');
      go.classList.toggle('busy', !!busy); go.disabled = false;
    };
    [$('rtaStart'), $('rtaPink')].filter(Boolean).forEach((el) => new MutationObserver(sync).observe(el, { childList: true, characterData: true, subtree: true, attributes: true }));
    if (typeof Role !== 'undefined') Role.onChange(sync); sync();
  }

  // ---------- 听感评分（仅播放端） ----------
  function listenPage() {
    if (!$('lsPlay')) {
      const b = document.createElement('button'); b.id = 'lsPlay'; b.hidden = true;
      b.onclick = () => { const c = document.querySelector('[data-lsclip]'); if (c) c.click(); };
      ($('panel-listen') || document.body).appendChild(b);
    }
    const ui = wrap('listen', {
      title: '听感评分', tip: '请在 DSP <b class="red">打开所有喇叭</b>。在<b>播放端</b>放内置测试音，听完在下方打分。',
      allOn: true, playId: 'lsPlay', playerOnly: true, histLabel: '清空',
    });
    if (!ui) return;
    // 把评分区提到引导壳下面（仍可用）
    const sl = $('lsSliders'), clips = $('lsClips');
    if (clips) ui.box.appendChild(clips);
    if (sl) ui.box.appendChild(sl);
    if ($('lsOut')) ui.box.appendChild($('lsOut').parentElement);
  }

  // ---------- 发生器：点喇叭选 L/R ----------
  function genPage() {
    const panel = $('panel-gen'); if (!panel || $('cgw-gen')) return;
    const adv = tuck(panel);
    let side = 'L', sig = 'pink';
    const box = document.createElement('div'); box.className = 'cg'; box.id = 'cgw-gen';
    box.innerHTML = `
      <div class="cg-top"><button type="button" class="cg-back" aria-label="返回">‹</button><h2>信号发生器</h2><button type="button" class="cg-hist">⇅停止</button></div>
      <div class="cg-tip">点喇叭选输出侧：绿=当前。请在 DSP 打开对应喇叭后点「开始播放」。</div>
      <div class="cg-seg"><button type="button" class="on" data-sig="pink">粉噪</button><button type="button" data-sig="tone">正弦</button><button type="button" data-sig="sweep">扫频</button><button type="button" data-sig="chirp">Chirp</button></div>
      <div class="cg-stage small">${CAR_SVG}<div class="cg-pins" data-pins></div></div>
      <div class="cg-status" data-status></div>
      <div class="cg-bottom"><button type="button" class="cg-go" data-go>▶ 开始播放</button></div>`;
    panel.prepend(box); panel.appendChild(adv);
    box.querySelector('.cg-back').onclick = () => App.switchTab('home');
    const paint = () => {
      const act = PINS.filter((p) => (side === 'L' ? p.s === 'L' : side === 'R' ? p.s === 'R' : true)).map((p) => p.id);
      if (side === 'M') act.push(7);
      box.querySelector('[data-pins]').innerHTML = pinsHtml(side === 'stereo' ? ORDER : act);
      box.querySelectorAll('.cg-pin').forEach((b) => {
        b.onclick = () => {
          const p = pin(+b.dataset.id); side = p.s === 'M' ? 'M' : p.s;
          const out = $('genOut') || $('delayOut');
          if ($('genRoute')) { $('genRoute').value = side === 'L' ? 'l' : side === 'R' ? 'r' : 'stereo'; $('genRoute').dispatchEvent(new Event('change')); }
          paint();
          box.querySelector('[data-status]').textContent = `输出：${side === 'L' ? '左' : side === 'R' ? '右' : '中/低音'} · ${p.n}`;
        };
      });
    };
    paint();
    box.querySelectorAll('[data-sig]').forEach((b) => {
      b.onclick = () => {
        sig = b.dataset.sig; box.querySelectorAll('[data-sig]').forEach((x) => x.classList.toggle('on', x === b));
        const sel = $('genType') || $('genSig'); if (sel) { sel.value = sig; sel.dispatchEvent(new Event('change')); }
      };
    });
    const go = box.querySelector('[data-go]');
    go.onclick = () => {
      if (Role.get() === 'recorder') return alert('发生器请在播放端使用');
      const b = $('genPlay') || $('genStart'); if (b) b.click();
      else if (typeof Generator !== 'undefined' && Generator.play) Generator.play();
    };
    box.querySelector('.cg-hist').onclick = () => { if (typeof Generator !== 'undefined' && Generator.stop) Generator.stop(); const s = $('genStop'); if (s) s.click(); };
  }

  // ---------- 首页 ----------
  const TILES = [
    ['simple', '±', '正反相'], ['delay', '⏱', '单喇叭延时'], ['spl', '📶', '声压测试'],
    ['polarity', '⊕', '极性检测'], ['phase', 'φ', '相位测试'], ['carid', '🚗', '整车识别'],
    ['multi', '🎯', '多点测量'], ['image', '🎙', '声像居中'], ['xcheck', '🔗', '分频衔接'],
    ['rta', '〰', '频谱 RTA'], ['gen', '∿', '信号发生器'], ['listen', '🎧', '听感评分'],
    ['cal', '🎤', '麦克风校准'], ['plan', '🎛', '12 通道方案'], ['plans', '🗂', '方案管理'],
    ['dsp', '📋', 'DSP 参数表'], ['analyze', '📂', '录音分析'], ['xover', '✂', '分频辅助'],
    ['log', '📝', '测量记录'], ['help', '❓', '使用说明'],
  ];
  function home() {
    const main = document.querySelector('main.panels'); if (!main || $('panel-home')) return;
    const sec = document.createElement('section'); sec.id = 'panel-home'; sec.className = 'panel'; sec.setAttribute('role', 'tabpanel'); sec.hidden = true;
    sec.innerHTML = `<div class="hm"><h2>汽车音响调音</h2><p class="hm-sub">两部手机：一部连车载蓝牙播放，一部放主驾头部录音</p><button type="button" class="hm-role" onclick="Role.ask()">切换本机身份</button><div class="hm-grid">${TILES.map(([t, i, n]) => `<button type="button" class="hm-tile" data-go="${t}"><span>${i}</span>${n}</button>`).join('')}</div></div>`;
    main.prepend(sec);
    sec.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => App.switchTab(b.dataset.go); });
    const nav = document.querySelector('.bottom-nav');
    if (nav && !document.querySelector('.bnav[data-tab="home"]')) {
      const h = document.createElement('button'); h.type = 'button'; h.className = 'bnav'; h.dataset.tab = 'home';
      h.innerHTML = '<span class="bnav-ico">⌂</span><span>首页</span>';
      h.onclick = () => App.switchTab('home');
      nav.prepend(h);
    }
  }

  function patchApp() {
    // 修底部「更多」高亮 + 首页为主页
    const _sw = App.switchTab;
    App.switchTab = function (name) {
      _sw(name);
      const primary = new Set(['home', 'simple', 'gen', 'rta', 'phase']);
      document.querySelectorAll('.bnav').forEach((b) => {
        if (b.dataset.tab === 'more') b.classList.toggle('active', !primary.has(name) && name !== 'home');
        else b.classList.toggle('active', b.dataset.tab === name);
      });
      document.body.classList.toggle('cg-on', true); // 全局隐藏顶栏
      document.body.classList.toggle('cg-home', name === 'home');
      document.body.classList.toggle('cg-guide', /^(delay|polarity|spl|simple|phase|xcheck|image|carid|multi|rta|listen|gen)$/.test(name));
    };
  }

  function stickyRole() {
    document.querySelectorAll('.header').forEach((h) => h.classList.add('cg-sticky-head'));
  }

  function init() {
    home();
    patchApp();
    stickyRole();
    make('delay'); make('polarity'); make('spl');
    // 等其它模块 init 完再挂壳（按钮已存在）
    setTimeout(() => {
      try { simplePage(); } catch (e) { console.error(e); }
      try { phasePage(); } catch (e) { console.error(e); }
      try { xcheckPage(); } catch (e) { console.error(e); }
      try { imagePage(); } catch (e) { console.error(e); }
      try { caridPage(); } catch (e) { console.error(e); }
      try { multiPage(); } catch (e) { console.error(e); }
      try { rtaPage(); } catch (e) { console.error(e); }
      try { listenPage(); } catch (e) { console.error(e); }
      try { genPage(); } catch (e) { console.error(e); }
      App.switchTab('home');
    }, 120);
  }
  return { init };
})();
