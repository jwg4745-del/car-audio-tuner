/** 第一批专业功能：多点平均测量、麦克风校准页、声像居中检查 */
const POS9 = ['头部正中（两耳中间）', '往左 15 cm（左耳外）', '往右 15 cm（右耳外）', '往前 10 cm', '往后 10 cm', '往上 10 cm', '往下 10 cm', '左前斜 10 cm', '右前斜 10 cm'];

const MultiPoint = (() => {
  const { r1, mean, thirdOct, MP, LS, esc, fmtF } = Duo;
  const KEY = 'cat-mp-v1';
  let st = { n: 5, pts: [], curve: 'car' }, last = null;
  const tgt = (f, c) => (typeof CarId !== 'undefined' ? CarId.targetDb(f, c) : 0);
  /** 单点：粉红噪声段 1/3 倍频程 + 噪底 */
  function analyzeOne(x, sr, t0) {
    const T = (s) => t0 + Math.round(s * sr);
    const sig = thirdOct(x.subarray(T(MP.s + 0.3), T(MP.s + MP.seg - 0.3)), sr, 25, 16000);
    const nz = thirdOct(x.subarray(T(1.15), T(1.95)), sr, 25, 16000);
    return sig.map((b, i) => ({ fc: b.fc, level: r1(b.level), valid: b.level - (nz[i] ? nz[i].level : -200) > 6 }));
  }
  /** 空间平均（能量平均），返回相对目标的偏差、各频段位置差异 */
  function average(list, curve = 'car') {
    if (!list.length) return { ok: false, reason: '还没有录任何点' };
    const fcs = list[0].map((b) => b.fc);
    const bands = fcs.map((fc, i) => {
      const lv = list.map((p) => p[i].level), pw = mean(lv.map((v) => Math.pow(10, v / 10)));
      return { fc, avg: 10 * Math.log10(pw), spread: r1(Math.max(...lv) - Math.min(...lv)), valid: list.every((p) => p[i].valid) };
    });
    const mid = bands.filter((b) => b.fc >= 250 && b.fc <= 2000);
    const ref = mean(mid.map((b) => b.avg - tgt(b.fc, curve)));
    bands.forEach((b) => { b.level = r1(b.avg - ref); b.target = r1(tgt(b.fc, curve)); b.dev = r1(b.level - b.target); b.stable = b.spread <= 6; delete b.avg; });
    const use = bands.filter((b) => b.valid && b.stable && b.fc >= 40 && b.fc <= 12500);
    const out = {
      ok: true, n: list.length, curve, bands,
      peaks: use.filter((b) => b.dev >= 3).sort((a, b) => b.dev - a.dev).slice(0, 4),
      dips: use.filter((b) => b.dev <= -4).sort((a, b) => a.dev - b.dev).slice(0, 4),
      unstable: bands.filter((b) => b.valid && !b.stable && b.fc >= 40).map((b) => b.fc),
      flatnessDb: r1(mean(use.map((b) => Math.abs(b.dev)))),
    };
    out.confident = list.length >= 5 && bands.filter((b) => b.valid).length >= bands.length * 0.7;
    return out;
  }
  /** 写入方案：只把「位置稳定」的频段交给 EQ（位置敏感的峰谷不要 EQ 硬补） */
  function toAll(r) {
    return { bands: r.bands.filter((b) => b.valid && b.stable).map((b) => ({ fc: b.fc, level: b.level, target: b.target, dev: b.dev })), targetCurve: r.curve, multipoint: { n: r.n, unstable: r.unstable } };
  }
  // ---------- UI ----------
  const $ = Duo.$;
  const save = () => LS.set(KEY, st);
  function renderRec() {
    const n = st.n, k = st.pts.length;
    $('mpN').value = String(n);
    $('mpPos').innerHTML = k >= n ? `✅ ${n} 个点都录好了` : `第 <b>${k + 1}</b> / ${n} 个点：<br><b>${POS9[k]}</b>`;
    $('mpDots').innerHTML = POS9.slice(0, n).map((p, i) => `<span class="mp-dot ${i < k ? 'done' : i === k ? 'now' : ''}" title="${p}">${i + 1}</span>`).join('');
    $('mpCalc').hidden = k < 3; $('mpUndo').hidden = !k; $('mpClear').hidden = !k;
    $('mpCalc').textContent = k >= n ? '算平均结果' : `先用 ${k} 个点算（⚠️ 点数少）`;
  }
  function onRec(x, sr) {
    const loc = Duo.locate(x, sr, 'mp');
    if (!loc.ok) { $('mpRecStatus').textContent = '⚠️ ' + loc.reason; return; }
    const b = analyzeOne(x, sr, loc.t0);
    if (b.filter((y) => y.valid).length < b.length * 0.5) { $('mpRecStatus').textContent = '⚠️ 这个点声音太小或太吵，没算进去：调大音量再录一次'; return; }
    st.pts.push(b); save(); renderRec();
    $('mpRecStatus').textContent = st.pts.length >= st.n ? '全部录完 ✓ 点「算平均结果」' : `第 ${st.pts.length} 个点 ✓ 把手机移到下一个位置，再点录`;
    if (st.pts.length >= st.n) calc();
  }
  function calc() {
    const r = average(st.pts, st.curve); last = r; const card = $('mpResult'); card.hidden = false;
    if (!r.ok) { card.className = 'sp-result unknown'; $('mpVerdict').textContent = '⚠️ ' + r.reason; return; }
    card.className = 'sp-result ' + (r.confident ? (r.flatnessDb <= 3 ? 'ok' : 'unknown') : 'unknown');
    $('mpVerdict').textContent = `${r.confident ? '' : '⚠️ '}${r.n} 点平均 · 平均偏差 ±${r.flatnessDb} dB`;
    const L = [];
    L.push(['偏高', r.peaks.map((p) => `${fmtF(p.fc)} +${p.dev}`).join('，') || '没有明显偏高 ✓']);
    L.push(['偏低', r.dips.map((p) => `${fmtF(p.fc)} ${p.dev}`).join('，') || '没有明显偏低 ✓']);
    L.push(['位置敏感', r.unstable.length ? r.unstable.map(fmtF).join('、') + '（换个位置差 6 dB 以上，不建议用 EQ 补）' : '无 ✓']);
    $('mpSummary').innerHTML = `<table class="ci-tab">${L.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table><canvas id="mpCanvas" class="pro-canvas" width="640" height="260"></canvas>`
      + `<p class="ci-warn">${r.n < 5 ? '⚠️ 少于 5 个点，平均效果有限<br>' : ''}${esc(Cal.note())}</p>`;
    Plot.curves($('mpCanvas'), [{ name: '平均', color: '#2fd3a5', pts: r.bands.filter((b) => b.valid).map((b) => [b.fc, b.level]) }, { name: '目标', color: '#888', dash: true, pts: r.bands.map((b) => [b.fc, b.target]) }]);
    $('mpDetail').textContent = r.bands.map((b) => `${b.fc}Hz ${b.level} dB 偏差 ${b.dev} 位置差 ${b.spread}${b.valid ? '' : ' 噪声内'}${b.stable ? '' : ' 不稳定'}`).join('\n');
  }
  function write() {
    if (!last || !last.ok) return;
    if (typeof History !== 'undefined') History.push('写入多点平均前');
    Duo.mergeAll(toAll(last));
    TunePlan.show(); App.switchTab('plan');
  }
  function init() {
    if (!$('panel-multi')) return;
    st = Object.assign(st, LS.get(KEY, {}));
    Duo.roles('data-mprole', 'cat-mp-role', (r) => { $('mpPlayer').hidden = r !== 'player'; $('mpRecorder').hidden = r !== 'recorder'; });
    Duo.player({ btn: $('mpPlay'), cue: $('mpCue'), count: $('mpCount'), kind: 'mp', cues: [[0, '准备…'], [1, '同步咔嗒'], [4, '粉红噪声（别动手机）'], [12, '完成 ✓']] });
    Duo.recorder({ btn: $('mpRec'), status: $('mpRecStatus'), kind: 'mp', maxSec: 40, onDone: onRec });
    $('mpN').onchange = () => { st.n = +$('mpN').value; save(); renderRec(); };
    $('mpTarget').value = st.curve; $('mpTarget').onchange = () => { st.curve = $('mpTarget').value; save(); if (last) calc(); };
    $('mpUndo').onclick = () => { st.pts.pop(); save(); renderRec(); $('mpRecStatus').textContent = '已删掉最后一个点，重新录这个位置'; };
    $('mpClear').onclick = () => { if (!confirm('清空已录的所有点？')) return; st.pts = []; save(); renderRec(); $('mpResult').hidden = true; };
    $('mpCalc').onclick = calc; $('mpWrite').onclick = write;
    renderRec();
  }
  return { init, analyzeOne, average, toAll, POS9 };
})();

const ImageCheck = (() => {
  const { r1, r2, mean, IMG, esc } = Duo;
  const $ = Duo.$;
  let last = null;
  /** 纯函数：声像居中（左右到达时间 + 人声频段电平） */
  function analyze(x, sr, t0) {
    const TT = TestTrack, T = (s) => t0 + Math.round(s * sr), ch = TT.chirpTemplate(sr), arr = { L: [], R: [] };
    for (let k = 0; k < IMG.nChirp; k++) { const r = TT.xcorrPeak(x, ch, T(IMG.chirp0 + k * IMG.chirpGap), Math.round(0.03 * sr)); (k % 2 ? arr.R : arr.L).push(r.lag / sr * 1000); }
    const bp = (a, b) => { const y = TT.biquad(TT.biquad(x.subarray(T(a), T(b)), 'hp', 300, 0.707, sr), 'lp', 4000, 0.707, sr); return Duo.dB(Duo.rms(y, Math.floor(0.1 * sr), y.length)); };
    const nz = bp(1.15, 1.95), Ldb = bp(IMG.L + 0.3, IMG.L + IMG.seg - 0.3), Rdb = bp(IMG.R + 0.3, IMG.R + IMG.seg - 0.3);
    if (Math.max(Ldb, Rdb) - nz < 8) return { ok: false, reason: '声音太小或太吵：调大音量、关空调后再测' };
    if (Math.min(Ldb, Rdb) - nz < 8) return { ok: false, reason: `${Ldb < Rdb ? '左' : '右'}边几乎没声音：检查前${Ldb < Rdb ? '左' : '右'}喇叭是否静音` };
    const spread = (a) => Math.max(...a) - Math.min(...a);
    const dt = mean(arr.R) - mean(arr.L);           // >0：左先到
    const dl = Ldb - Rdb;                             // >0：左响
    const tOk = spread(arr.L) < 0.25 && spread(arr.R) < 0.25;
    const out = { ok: true, dtMs: r2(dt), dLdb: r1(dl), timeReliable: tOk, snrDb: r1(Math.min(Ldb, Rdb) - nz), arrivals: { L: arr.L.map(r2), R: arr.R.map(r2) } };
    const tSide = Math.abs(dt) < 0.08 ? null : dt > 0 ? 'L' : 'R', lSide = Math.abs(dl) < 0.8 ? null : dl > 0 ? 'L' : 'R';
    out.timeSide = tSide; out.levelSide = lSide;
    out.centered = !tSide && !lSide;
    out.direction = out.centered ? 'C' : tSide && lSide && tSide !== lSide ? 'mixed' : (tSide || lSide);
    out.fix = [];
    if (tSide && tOk) out.fix.push({ side: tSide, kind: 'delay', value: r2(Math.abs(dt)), text: `${tSide === 'L' ? '左' : '右'}前声场（${grp(tSide)}）延时各加 ${r2(Math.abs(dt))} ms` });
    if (lSide) out.fix.push({ side: lSide, kind: 'gain', value: r1(-Math.abs(dl)), text: `${lSide === 'L' ? '左' : '右'}前声场（${grp(lSide)}）增益各降 ${r1(Math.abs(dl))} dB` });
    out.confident = tOk && out.snrDb >= 12;
    return out;
  }
  function frontIds(side) {
    const all = typeof Channels !== 'undefined' ? Channels.getAll() : [{ id: 5, side: 'L', type: 'woofer' }, { id: 6, side: 'R', type: 'woofer' }, { id: 9, side: 'L', type: 'mid' }, { id: 10, side: 'R', type: 'mid' }, { id: 11, side: 'L', type: 'tweeter' }, { id: 12, side: 'R', type: 'tweeter' }];
    return all.filter((c) => c.side === side && !c.mute && ['woofer', 'mid', 'tweeter'].includes(c.type)).map((c) => c.id);
  }
  const grp = (s) => frontIds(s).map((i) => 'CH' + i).join('/');
  function show(r) {
    last = r; const card = $('imResult'); card.hidden = false;
    if (!r.ok) { card.className = 'sp-result unknown'; $('imVerdict').textContent = '⚠️ 测不出'; $('imSummary').innerHTML = `<p class="sp-reason">${esc(r.reason)}</p>`; $('imApply').hidden = true; return; }
    const dir = { C: '✅ 声像基本居中', L: '❌ 声像偏左', R: '❌ 声像偏右', mixed: '⚠️ 时间和音量往两边拉' }[r.direction];
    card.className = 'sp-result ' + (r.centered ? 'ok' : r.direction === 'mixed' ? 'unknown' : 'inverted');
    $('imVerdict').textContent = (r.confident ? '' : '⚠️ ') + dir;
    const rows = [
      ['先到达', r.timeSide ? `${r.timeSide === 'L' ? '左' : '右'}边早 ${Math.abs(r.dtMs)} ms${r.timeReliable ? '' : ' ⚠️ 不稳定'}` : '左右同时到 ✓'],
      ['人声频段音量', r.levelSide ? `${r.levelSide === 'L' ? '左' : '右'}边响 ${Math.abs(r.dLdb)} dB` : '左右一样 ✓'],
      ['建议', r.fix.length ? r.fix.map((f) => f.text).join('；') : '保持不变'],
    ];
    $('imSummary').innerHTML = `<table class="ci-tab">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>`
      + `<p class="ci-warn">${r.timeReliable ? '' : '⚠️ 多次测量时间不一致（反射太强），延时建议没给出<br>'}⚠️ 手机放在两耳中间测；改完再测一次，最后用「听感确认」定</p>`;
    $('imApply').hidden = !r.fix.length;
  }
  /** 把建议记到通道表（只改软件里的记录，DSP 要你手动改） */
  function applyFix(fix, chs) {
    const out = [];
    fix.forEach((f) => frontIds(f.side).forEach((id) => {
      const c = chs.find((y) => y.id === id); if (!c) return;
      if (f.kind === 'delay') c.delaySetMs = r2((c.delaySetMs || 0) + f.value);
      if (f.kind === 'gain') c.gainSetDb = r1((c.gainSetDb || 0) + f.value);
      out.push(id);
    }));
    return out;
  }
  function apply() {
    if (!last || !last.ok || !last.fix.length) return;
    if (typeof History !== 'undefined') History.push('声像居中前');
    const chs = Channels.getAll(); applyFix(last.fix, chs); Channels.setAll(chs);
    $('imApplied').textContent = '已记到通道表 ✓ 在 DSP 里照着改，然后再测一次（可在「方案管理」撤销）';
  }
  function nudge(dir) {
    // 听感：偏左 → 左前加 0.05 ms；偏右 → 右前加 0.05 ms
    if (dir === 'C') { $('imApplied').textContent = '好，声像居中 ✓'; return; }
    if (typeof History !== 'undefined') History.push('听感微调前');
    const chs = Channels.getAll(); applyFix([{ side: dir, kind: 'delay', value: 0.05 }], chs); Channels.setAll(chs);
    $('imApplied').textContent = `听着偏${dir === 'L' ? '左' : '右'}：已记录 ${grp(dir)} 延时各 +0.05 ms，DSP 照改后再听`;
  }
  function init() {
    if (!$('panel-image')) return;
    Duo.roles('data-imrole', 'cat-im-role', (r) => { $('imPlayer').hidden = r !== 'player'; $('imRecorder').hidden = r !== 'recorder'; });
    Duo.player({ btn: $('imPlay'), cue: $('imCue'), count: $('imCount'), kind: 'img', cues: [[0, '准备…'], [1, '同步咔嗒'], [4, '左右交替滴声'], [9.5, '只有左边'], [14, '只有右边'], [18.5, '中间人声区（听听在不在正中）'], [25, '完成 ✓']] });
    Duo.recorder({ btn: $('imRec'), status: $('imRecStatus'), kind: 'img', maxSec: 50, onDone: (x, sr) => { const l = Duo.locate(x, sr, 'img'); show(l.ok ? analyze(x, sr, l.t0) : l); } });
    $('imApply').onclick = apply; $('imAgain').onclick = () => { $('imResult').hidden = true; };
    document.querySelectorAll('[data-imear]').forEach((b) => { b.onclick = () => nudge(b.dataset.imear); });
  }
  return { init, analyze, applyFix, frontIds };
})();

const CalUI = (() => {
  const $ = Duo.$;
  function render() {
    const g = Cal.get();
    document.querySelectorAll('[data-calmode]').forEach((b) => b.classList.toggle('on', b.dataset.calmode === g.mode));
    $('calNow').innerHTML = `当前：<b>${Duo.esc(g.label)}</b>${Cal.estimated() ? ' ⚠️ 估计' : ''}`;
    const pts = g.mode === 'file' ? g.pts : (Cal.PRESETS[g.mode] || Cal.PRESETS.none).pts;
    Plot.curves($('calCanvas'), [{ name: '修正量', color: '#7fe3ff', pts: [20, 31.5, 50, 80, 125, 200, 500, 1000, 2000, 4000, 8000, 10000, 12500, 16000, 20000].map((f) => [f, pts.length ? Cal.corr(f) : 0]) }], { lo: -15, hi: 15 });
  }
  function init() {
    if (!$('panel-cal')) return;
    document.querySelectorAll('[data-calmode]').forEach((b) => { b.onclick = () => { if (b.dataset.calmode === 'file') { $('calFile').click(); return; } Cal.set(b.dataset.calmode); render(); }; });
    $('calFile').onchange = async () => {
      const f = $('calFile').files[0]; if (!f) return;
      const pts = Cal.parse(await f.text());
      if (pts.length < 5) { alert('没读到校准数据：文件应是每行「频率 dB」的 .txt/.cal'); return; }
      Cal.set('file', f.name, pts); render(); $('calMsg').textContent = `已导入 ${pts.length} 个点 ✓ 所有频谱和分析都会自动修正`;
    };
    render();
  }
  return { init };
})();

/** 极简曲线画图（对数频率轴） */
const Plot = (() => {
  function curves(cv, list, o = {}) {
    if (!cv || !cv.getContext) return;
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, lo = o.lo ?? -15, hi = o.hi ?? 15;
    const X = (f) => 30 + Math.log10(f / 20) / 3 * (W - 40), Y = (d) => 10 + (hi - Math.max(lo, Math.min(hi, d))) / (hi - lo) * (H - 30);
    g.clearRect(0, 0, W, H); g.font = '12px sans-serif'; g.fillStyle = '#888'; g.strokeStyle = 'rgba(255,255,255,.1)';
    [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach((f) => { g.beginPath(); g.moveTo(X(f), 10); g.lineTo(X(f), H - 20); g.stroke(); g.fillText(f >= 1000 ? f / 1000 + 'k' : f, X(f) - 8, H - 5); });
    for (let d = lo; d <= hi; d += 5) { g.beginPath(); g.moveTo(30, Y(d)); g.lineTo(W - 10, Y(d)); g.stroke(); g.fillText(d, 2, Y(d) + 4); }
    list.forEach((c, k) => {
      g.strokeStyle = c.color; g.lineWidth = 2.5; g.setLineDash(c.dash ? [6, 5] : []); g.beginPath();
      c.pts.forEach(([f, d], i) => (i ? g.lineTo(X(f), Y(d)) : g.moveTo(X(f), Y(d)))); g.stroke(); g.setLineDash([]);
      g.fillStyle = c.color; g.fillText('— ' + c.name, W - 140, 22 + k * 16);
    });
  }
  return { curves };
})();
if (typeof module !== 'undefined') module.exports = { MultiPoint, ImageCheck, Plot };
