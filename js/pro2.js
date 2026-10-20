/** 第二批专业功能：分频点衔接检查、方案对比和撤销、DSP 参数表导出、听感测试与评分 */
const r1x = (v) => Math.round(v * 10) / 10, r2x = (v) => Math.round(v * 100) / 100;

const XoverCheck = (() => {
  const { thirdOct, XO, esc, LS } = Duo;
  const $ = Duo.$;
  const J = {
    xo300: { fc: 300, low: [5, 6], high: [9, 10], lowName: '前门中低音', highName: '仪表台中音', keep: '；高音 CH11/12 也保持打开（发同步咔嗒用，不影响结果）' },
    xo4k: { fc: 4000, low: [9, 10], high: [11, 12], lowName: '仪表台中音', highName: '高音', keep: '' },
  };
  const STEPS = [
    { k: 'A', t: (j) => `只开 ${j.lowName}（${ids(j.low)}），其它全部静音${j.keep}` },
    { k: 'B', t: (j) => `只开 ${j.highName}（${ids(j.high)}），其它全部静音${j.keep}` },
    { k: 'C', t: (j) => `两组都开（${ids(j.low)} + ${ids(j.high)}），其它静音${j.keep}` },
    { k: 'D', t: (j) => `两组都开，并把 ${j.highName}（${ids(j.high)}）极性临时翻转，测完记得改回${j.keep}`, opt: true },
  ];
  const ids = (a) => a.map((i) => 'CH' + i).join('/');
  let st = { j: 'xo300', rec: {} }, last = null;
  /** 单次录音 → 分频点附近 1/3 倍频程 */
  function bandsOf(x, sr, t0, j) {
    const T = (s) => t0 + Math.round(s * sr), fc = J[j].fc;
    const b = thirdOct(x.subarray(T(XO.s + 0.3), T(XO.s + XO.seg - 0.3)), sr, fc / 3.2, fc * 3.2);
    const nz = thirdOct(x.subarray(T(1.15), T(1.95)), sr, fc / 3.2, fc * 3.2);
    return b.map((y, i) => ({ fc: y.fc, level: r1x(y.level), snr: r1x(y.level - nz[i].level) }));
  }
  /** 纯函数：衔接判断 */
  function judge(R, j) {
    const fc = J[j].fc, jj = J[j];
    const need = ['A', 'B', 'C'].filter((k) => !R[k]); if (need.length) return { ok: false, reason: `还差第 ${need.map((k) => 'ABCD'.indexOf(k) + 1).join('、')} 步没录` };
    const at = (k, f) => { const b = R[k]; let best = b[0]; b.forEach((y) => { if (Math.abs(Math.log2(y.fc / f)) < Math.abs(Math.log2(best.fc / f))) best = y; }); return best; };
    const lv = (k, f) => at(k, f).level;
    const lowSnr = ['A', 'B', 'C'].some((k) => at(k, fc).snr < 6);
    if (lowSnr) return { ok: false, reason: '分频点附近声音太小或太吵：调大音量、确认对应喇叭在响再测' };
    const psum = (f) => 10 * Math.log10(Math.pow(10, lv('A', f) / 10) + Math.pow(10, lv('B', f) / 10));
    const avgAround = (k, fn) => (fn(k, fc / 1.26) + fn(k, fc) + fn(k, fc * 1.26)) / 3;
    const gC = avgAround('C', (k, f) => lv(k, f) - psum(f));
    const gD = R.D ? avgAround('D', (k, f) => lv(k, f) - psum(f)) : null;
    const levelDiff = lv('A', fc) - lv('B', fc);  // >0 低组更响
    const shape = lv('C', fc) - (lv('C', fc / 2) + lv('C', fc * 2)) / 2;
    const out = { ok: true, fc, sumGainDb: r1x(gC), invGainDb: gD == null ? null : r1x(gD), levelDiffDb: r1x(levelDiff), shapeDb: r1x(shape), fixes: [] };
    if (gD != null && gD - gC > 2) { out.verdict = 'flip'; out.fixes.push({ kind: 'invert', ids: jj.high, text: `${jj.highName}（${ids(jj.high)}）极性翻转：翻转后分频点叠加多 ${r1x(gD - gC)} dB` }); }
    else if (gC >= 0.5 && shape > -3 && shape < 3.5) out.verdict = 'ok';
    else if (gC < -1) { out.verdict = 'time'; const q = r2x(1000 / (4 * fc)); out.fixes.push({ kind: 'delayTry', ids: jj.high, value: q, text: `两组在 ${fc} Hz 互相抵消：${jj.highName}（${ids(jj.high)}）延时先 +${q} ms 再 −${q} ms 各测一次第 3 步，选更响的` }); }
    else out.verdict = 'shape';
    if (Math.abs(levelDiff) > 3) { const g = levelDiff > 0 ? jj.low : jj.high; out.fixes.push({ kind: 'gain', ids: g, value: r1x(-Math.abs(levelDiff) / 2), text: `分频点处${levelDiff > 0 ? jj.lowName : jj.highName}比另一组响 ${r1x(Math.abs(levelDiff))} dB：它的增益降 ${r1x(Math.abs(levelDiff) / 2)} dB` }); }
    if (shape >= 3.5) out.fixes.push({ kind: 'text', text: `${fc} Hz 叠加后鼓起 ${r1x(shape)} dB（两组重叠太多）：把两组分频点拉开一点，或斜率改陡（24→48 dB/oct）` });
    if (shape <= -4 && out.verdict !== 'flip') out.fixes.push({ kind: 'text', text: `${fc} Hz 有 ${r1x(-shape)} dB 凹陷：两组分频点靠近一点，或斜率改缓（48→24）` });
    out.confident = ['A', 'B', 'C'].every((k) => at(k, fc).snr >= 12);
    return out;
  }
  function render() {
    const jj = J[st.j], rec = st.rec[st.j] || {};
    document.querySelectorAll('[data-xoj]').forEach((b) => b.classList.toggle('on', b.dataset.xoj === st.j));
    $('xcSteps').innerHTML = STEPS.map((s, i) => `<li class="${rec[s.k] ? 'done' : ''}">${rec[s.k] ? '✅' : i + 1 + '.'} ${esc(s.t(jj))}${s.opt ? '（可选，推荐）' : ''}</li>`).join('');
    const next = STEPS.find((s) => !rec[s.k]);
    $('xcNow').textContent = next ? `现在：${next.t(jj)}` : '4 步都录完了 ✓';
    $('xcCalc').hidden = !(rec.A && rec.B && rec.C);
  }
  function onRec(x, sr) {
    const l = Duo.locate(x, sr, st.j); if (!l.ok) { $('xcRecStatus').textContent = '⚠️ ' + l.reason; return; }
    const rec = st.rec[st.j] = st.rec[st.j] || {}, next = STEPS.find((s) => !rec[s.k]) || STEPS[3];
    rec[next.k] = bandsOf(x, sr, l.t0, st.j); LS.set('cat-xc-v1', st); render();
    $('xcRecStatus').textContent = `第 ${'ABCD'.indexOf(next.k) + 1} 步 ✓`;
    if (rec.A && rec.B && rec.C && (rec.D || next.k === 'D')) show();
  }
  function show() {
    const r = judge(st.rec[st.j] || {}, st.j); last = r; const card = $('xcResult'); card.hidden = false;
    if (!r.ok) { card.className = 'sp-result unknown'; $('xcVerdict').textContent = '⚠️ ' + r.reason; $('xcSummary').innerHTML = ''; return; }
    const V = { ok: '✅ 衔接正常', flip: '❌ 高组极性该翻转', time: '❌ 分频点互相抵消', shape: '⚠️ 叠加不够理想' }[r.verdict];
    card.className = 'sp-result ' + (r.verdict === 'ok' && !r.fixes.length ? 'ok' : r.verdict === 'shape' ? 'unknown' : 'inverted');
    $('xcVerdict').textContent = (r.confident ? '' : '⚠️ ') + V;
    $('xcSummary').innerHTML = `<table class="ci-tab"><tr><th>两组相加</th><td>${r.sumGainDb > 0 ? '+' : ''}${r.sumGainDb} dB（理想 +2～+3）</td></tr>${r.invGainDb != null ? `<tr><th>翻转后相加</th><td>${r.invGainDb > 0 ? '+' : ''}${r.invGainDb} dB</td></tr>` : ''}<tr><th>两组音量差</th><td>${Math.abs(r.levelDiffDb)} dB</td></tr></table>`
      + (r.fixes.length ? `<div class="ci-iss"><b>建议</b><ol>${r.fixes.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ol></div>` : '<p class="sp-reason">保持现在的分频设置</p>')
      + `<p class="ci-warn">${r.invGainDb == null ? '⚠️ 没录第 4 步，极性只能粗判<br>' : ''}⚠️ 左右两侧一起测的；改完再录第 3 步确认</p>`;
    $('xcApply').hidden = !r.fixes.some((f) => f.kind === 'invert' || f.kind === 'gain');
  }
  function apply() {
    if (!last || !last.ok) return;
    History.push('分频衔接修改前');
    const chs = Channels.getAll();
    last.fixes.forEach((f) => (f.ids || []).forEach((id) => { const c = chs[id - 1]; if (f.kind === 'invert') { c.invert = !c.invert; c.polarity = c.invert ? '反 −（分频衔接）' : '正 +（分频衔接）'; } if (f.kind === 'gain') c.gainSetDb = r1x((c.gainSetDb || 0) + f.value); }));
    Channels.setAll(chs); $('xcApplied').textContent = '已记到通道表 ✓ DSP 照着改（可在「方案管理」撤销）';
  }
  function init() {
    if (!$('panel-xcheck')) return;
    st = Object.assign(st, LS.get('cat-xc-v1', {}));
    Duo.roles('data-xcrole', 'cat-xc-role', (r) => { $('xcPlayer').hidden = r !== 'player'; $('xcRecorder').hidden = r !== 'recorder'; });
    document.querySelectorAll('[data-xoj]').forEach((b) => { b.onclick = () => { st.j = b.dataset.xoj; LS.set('cat-xc-v1', st); render(); $('xcResult').hidden = true; }; });
    Duo.player({ btn: $('xcPlay'), cue: $('xcCue'), count: $('xcCount'), kind: () => st.j, cues: [[0, '准备…'], [1, '同步咔嗒'], [4, '分频区噪声'], [10, '完成 ✓']] });
    Duo.recorder({ btn: $('xcRec'), status: $('xcRecStatus'), kind: () => st.j, maxSec: 35, onDone: onRec });
    $('xcCalc').onclick = show; $('xcApply').onclick = apply;
    $('xcReset').onclick = () => { st.rec[st.j] = {}; LS.set('cat-xc-v1', st); render(); $('xcResult').hidden = true; };
    render();
  }
  return { init, judge, bandsOf, J };
})();

/** 撤销历史：通道表 + 分析数据的快照 */
const History = (() => {
  const KEY = 'cat-hist-v1', MAX = 30, { LS } = Duo;
  let lastState = null, restoring = false, timer = null;
  const snap = () => ({ chs: Channels.getAll(), an: LS.get('cat-analyses-v1', {}) });
  const same = (a, b) => a && b && JSON.stringify(a.chs) === JSON.stringify(b.chs) && JSON.stringify(a.an) === JSON.stringify(b.an);
  function list() { return LS.get(KEY, []); }
  function add(state, label) { const h = list(); if (h.length && same(h[h.length - 1], state)) return; h.push(Object.assign({ at: new Date().toISOString(), label }, state)); while (h.length > MAX) h.shift(); LS.set(KEY, h); }
  /** 在改动之前调用：记录当前状态 */
  function push(label) { const s = snap(); add(s, label); lastState = s; renderUI(); }
  const note = push;
  function undo() {
    const h = list(); if (!h.length) return false;
    const s = h.pop(); LS.set(KEY, h); restoring = true;
    Channels.setAll(s.chs); LS.set('cat-analyses-v1', s.an); lastState = snap(); restoring = false; renderUI(); return s.label || true;
  }
  function onChannelChange() {
    if (restoring) return; clearTimeout(timer);
    timer = setTimeout(() => { const now = snap(); if (lastState && !same(lastState, now)) add(lastState, '手动修改前'); lastState = now; renderUI(); }, 800);
  }
  function renderUI() { const b = Duo.$('plUndo'); if (b) { const n = list().length; b.disabled = !n; b.textContent = n ? `↶ 撤销（${n}）` : '↶ 没有可撤销的'; } }
  function init() { lastState = snap(); Channels.onChange(onChannelChange); renderUI(); }
  return { push, note, undo, list, init, renderUI };
})();

const Plans = (() => {
  const KEY = 'cat-plans-v1', { LS, esc } = Duo, $ = Duo.$;
  const COLORS = ['#2fd3a5', '#ff9f43', '#7fe3ff', '#ff4d5e'];
  let sel = new Set(['__now']);
  const curveOf = (an) => ((an && an.all && an.all.bands) || []).map((b) => [b.fc, b.level]);
  function all() { return LS.get(KEY, []); }
  function saveAs(name) {
    name = String(name || '').trim(); if (!name) return false;
    const p = all().filter((x) => x.name !== name);
    p.push({ name, at: new Date().toISOString(), chs: Channels.getAll(), an: LS.get('cat-analyses-v1', {}) }); LS.set(KEY, p); return true;
  }
  function load(name) { const p = all().find((x) => x.name === name); if (!p) return; History.push(`载入「${name}」前`); Channels.setAll(p.chs); LS.set('cat-analyses-v1', p.an); render(); }
  function del(name) { LS.set(KEY, all().filter((x) => x.name !== name)); sel.delete(name); render(); }
  function render() {
    const ps = all(), t = (s) => new Date(s).toLocaleString('zh-CN', { hour12: false });
    $('plList').innerHTML = ps.length ? ps.map((p) => `<div class="pl-row"><label><input type="checkbox" data-plsel="${esc(p.name)}" ${sel.has(p.name) ? 'checked' : ''}> <b>${esc(p.name)}</b><small>${t(p.at)}${curveOf(p.an).length ? '' : ' · 无频响'}</small></label><span><button class="btn" data-plload="${esc(p.name)}">载入</button><button class="btn" data-pldel="${esc(p.name)}">删除</button></span></div>`).join('') : '<p class="sp-hint">还没保存方案</p>';
    $('plNowSel').checked = sel.has('__now');
    document.querySelectorAll('[data-plsel]').forEach((c) => { c.onchange = () => { c.checked ? sel.add(c.dataset.plsel) : sel.delete(c.dataset.plsel); draw(); }; });
    document.querySelectorAll('[data-plload]').forEach((b) => { b.onclick = () => { if (confirm(`载入「${b.dataset.plload}」？现在的通道表会被替换（可撤销）`)) load(b.dataset.plload); }; });
    document.querySelectorAll('[data-pldel]').forEach((b) => { b.onclick = () => { if (confirm(`删除「${b.dataset.pldel}」？`)) del(b.dataset.pldel); }; });
    draw(); History.renderUI();
  }
  function draw() {
    const cs = []; let k = 0;
    if (sel.has('__now')) cs.push({ name: '当前', color: COLORS[k++], pts: curveOf(LS.get('cat-analyses-v1', {})) });
    all().filter((p) => sel.has(p.name)).forEach((p) => cs.push({ name: p.name, color: COLORS[k++ % 4], pts: curveOf(p.an), dash: k > 1 }));
    Plot.curves($('plCanvas'), cs.filter((c) => c.pts.length));
    $('plNoCurve').hidden = cs.some((c) => c.pts.length);
    $('plDiff').innerHTML = diffTable();
  }
  /** 选中两套方案时列出通道差异 */
  function diffTable() {
    const names = [...sel].filter((n) => n !== '__now'), ps = all();
    const A = sel.has('__now') ? { name: '当前', chs: Channels.getAll() } : ps.find((p) => p.name === names[0]);
    const B = ps.find((p) => p.name === (sel.has('__now') ? names[0] : names[1]));
    if (!A || !B) return '';
    const rows = [];
    A.chs.forEach((a, i) => { const b = B.chs[i], d = []; if (a.gainSetDb !== b.gainSetDb) d.push(`增益 ${b.gainSetDb}→${a.gainSetDb}`); if (a.delaySetMs !== b.delaySetMs) d.push(`延时 ${b.delaySetMs}→${a.delaySetMs}`); if (!!a.invert !== !!b.invert) d.push(`极性 ${b.invert ? '反' : '正'}→${a.invert ? '反' : '正'}`); if (a.hpf !== b.hpf || a.lpf !== b.lpf) d.push(`分频 ${b.hpf || '-'}/${b.lpf || '-'}→${a.hpf || '-'}/${a.lpf || '-'}`); if (JSON.stringify(a.eq) !== JSON.stringify(b.eq)) d.push('EQ 不同'); if (d.length) rows.push(`<tr><th>CH${a.id}</th><td>${esc(d.join('；'))}</td></tr>`); });
    return `<p class="sp-hint">「${esc(B.name)}」→「${esc(A.name)}」的改动</p>` + (rows.length ? `<table class="ci-tab">${rows.join('')}</table>` : '<p class="sp-hint">通道设置完全一样</p>');
  }
  function init() {
    if (!$('panel-plans')) return;
    History.init();
    document.querySelectorAll('[data-plname]').forEach((b) => { b.onclick = () => { const n = b.dataset.plname; if (all().some((p) => p.name === n) && !confirm(`覆盖已有的「${n}」？`)) return; saveAs(n); sel.add(n); render(); $('plMsg').textContent = `已保存「${n}」✓`; }; });
    $('plSave').onclick = () => { const n = $('plName').value.trim(); if (!n) { alert('先输入名字'); return; } saveAs(n); sel.add(n); render(); $('plMsg').textContent = `已保存「${n}」✓`; $('plName').value = ''; };
    $('plUndo').onclick = () => { const l = History.undo(); $('plMsg').textContent = l ? `已撤销 ✓（回到：${l}）` : '没有可撤销的'; render(); };
    $('plNowSel').onchange = () => { $('plNowSel').checked ? sel.add('__now') : sel.delete('__now'); draw(); };
    render();
  }
  return { init, saveAs, all, render };
})();

const DspExport = (() => {
  const { esc, LS } = Duo, $ = Duo.$, MAXEQ = 10;
  /** 统一成一行一路：{id,name,mute,gain,delay,invert,hpf,lpf,slope,eq[]} */
  function rows(src) {
    if (src === 'plan' && typeof TunePlan !== 'undefined') {
      const p = TunePlan.generate({ channels: Channels.getAll(), analyses: LS.get('cat-analyses-v1', {}) });
      return Channels.getAll().map((c) => { const q = p.perChannel[c.id]; return q ? { id: c.id, name: c.name, mute: false, gain: q.gainDb, delay: q.delayMs, invert: q.invert, hpf: q.hpf, lpf: q.lpf, slope: q.slope, eq: q.eq } : { id: c.id, name: c.name, mute: true, eq: [] }; });
    }
    return Channels.getAll().map((c) => ({ id: c.id, name: c.name, mute: !!c.mute, gain: c.gainSetDb, delay: c.delaySetMs, invert: !!c.invert, hpf: c.hpf, lpf: c.lpf, slope: c.slope || 24, eq: c.eq || [] }));
  }
  const v = (x) => (x == null || x === '' ? '' : x);
  function csv(rs) {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const head = ['通道', '名称', '静音', '增益dB', '延时ms', '极性', 'HPF Hz', 'LPF Hz', '斜率dB/oct'];
    for (let i = 1; i <= MAXEQ; i++) head.push(`EQ${i}频率Hz`, `EQ${i}增益dB`, `EQ${i}Q`);
    const L = [head.map(q).join(',')];
    rs.forEach((r) => { const a = ['CH' + r.id, r.name, r.mute ? '是' : '否', r.mute ? '' : v(r.gain), r.mute ? '' : v(r.delay), r.mute ? '' : r.invert ? '反相' : '正相', v(r.hpf), v(r.lpf), r.hpf || r.lpf ? r.slope : '']; for (let i = 0; i < MAXEQ; i++) { const e = r.eq[i]; a.push(e ? e.freq : '', e ? e.gain : '', e ? e.q : ''); } L.push(a.map(q).join(',')); });
    return '\ufeff' + L.join('\r\n');
  }
  function html(rs, title) {
    const tr = rs.map((r) => `<tr class="${r.mute ? 'mute' : ''}"><td>CH${r.id}</td><td>${esc(r.name)}</td><td>${r.mute ? '静音' : (r.gain > 0 ? '+' : '') + v(r.gain)}</td><td>${r.mute ? '' : v(r.delay)}</td><td>${r.mute ? '' : r.invert ? '<b>反相</b>' : '正相'}</td><td>${v(r.hpf)}</td><td>${v(r.lpf)}</td><td>${r.hpf || r.lpf ? r.slope : ''}</td><td>${r.eq.map((e) => `${e.freq}Hz ${e.gain > 0 ? '+' : ''}${e.gain}dB Q${e.q}`).join('<br>')}</td></tr>`).join('');
    return `<table class="dsp-tab"><thead><tr><th>通道</th><th>名称</th><th>增益 dB</th><th>延时 ms</th><th>极性</th><th>HPF</th><th>LPF</th><th>斜率</th><th>EQ</th></tr></thead><tbody>${tr}</tbody></table>`;
  }
  const srcName = () => ($('dxSrc').value === 'plan' ? '调音方案建议值' : '当前通道表');
  function render() { $('dxTable').innerHTML = html(rows($('dxSrc').value)); }
  function download() {
    const blob = new Blob([csv(rows($('dxSrc').value))], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `DSP参数表_${srcName()}_${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function print() {
    const w = window.open('', '_blank'); if (!w) { alert('浏览器拦截了新窗口，允许弹窗后再试'); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>DSP 参数表</title><style>body{font-family:sans-serif;padding:16px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #999;padding:4px 6px;text-align:left}tr.mute{color:#999}</style><h2>DSP 参数表（${srcName()}）</h2><p>${new Date().toLocaleString('zh-CN', { hour12: false })} · 赛那 12 路</p>${html(rows($('dxSrc').value))}<p>⚠️ 软件建议值仅供参考，输入 DSP 后先小音量确认。</p>`);
    w.document.close(); setTimeout(() => w.print(), 300);
  }
  function init() { if (!$('panel-dsp')) return; $('dxSrc').onchange = render; $('dxCsv').onclick = download; $('dxPrint').onclick = print; Channels.onChange(() => { if (!$('panel-dsp').hidden) render(); }); render(); document.querySelectorAll('[data-tab="dsp"]').forEach((b) => b.addEventListener('click', render)); }
  return { init, rows, csv, html };
})();

const Listen = (() => {
  const SR = 44100, $ = Duo.$, { esc } = Duo;
  let cur = null;
  function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; }; }
  function norm(L, R, pk = 0.6) { let m = 0; for (let i = 0; i < L.length; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i])); const g = pk / (m || 1); for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; } return { L, R }; }
  /** 合成测试片段（全部程序生成，无版权音频） */
  const CLIPS = {
    vocal: { name: '人声', desc: '类人声元音滑音，居中', make() { const n = SR * 6, y = new Float32Array(n); const F = [[730, 1090, 2440], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]]; let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR, f0 = 150 + 60 * Math.sin(t * 0.8) + 3 * Math.sin(2 * Math.PI * 5.5 * t); ph += f0 / SR; y[i] = 2 * (ph % 1) - 1; } let out = new Float32Array(n); const seg = n / 4; for (let k = 0; k < 4; k++) { const s = y.subarray(k * seg, (k + 1) * seg); F[k].forEach((f, j) => { const b = TestTrack.biquad(TestTrack.biquad(s, 'bp', f, 8, SR), 'bp', f, 8, SR); for (let i = 0; i < b.length; i++) out[k * seg + i] += b[i] * [1, 0.6, 0.3][j] * Math.min(1, i / 2000, (seg - i) / 2000); }); } return norm(out, Float32Array.from(out)); } },
    kick: { name: '鼓点', desc: '底鼓 8 下，听冲击和收得干不干净', make() { const n = SR * 4, y = new Float32Array(n); for (let k = 0; k < 8; k++) { let ph = 0; const s = k * SR * 0.5; for (let i = 0; i < SR * 0.4; i++) { const t = i / SR, f = 45 + 75 * Math.exp(-t * 30); ph += 2 * Math.PI * f / SR; y[s + i] += Math.sin(ph) * Math.exp(-t * 9) + (i < 300 ? 0.3 * Math.exp(-i / 60) : 0); } } return norm(y, Float32Array.from(y)); } },
    bass: { name: '低音线', desc: '41–110 Hz 每个音是否一样响（有无轰头/缺音）', make() { const notes = [41.2, 49, 55, 61.7, 73.4, 82.4, 98, 110], n = SR * 4, y = new Float32Array(n); notes.forEach((f, k) => { const s = k * SR * 0.5; for (let i = 0; i < SR * 0.48; i++) { const t = i / SR, e = Math.min(1, t / 0.01) * Math.exp(-t * 2); y[s + i] += (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * e; } }); return norm(y, Float32Array.from(y)); } },
    sib: { name: '齿音', desc: '“嘶”声和镲片，听刺不刺耳', make() { const n = SR * 4, r = rng(7), w = new Float32Array(n); for (let k = 0; k < 8; k++) { const s = Math.floor(k * SR * 0.5), len = k % 2 ? SR * 0.06 : SR * 0.25; for (let i = 0; i < len; i++) w[s + i] = r() * Math.sin(Math.PI * i / len) * (k % 2 ? Math.exp(-i / 800) : 1); } let y = TestTrack.biquad(TestTrack.biquad(w, 'hp', 5000, 0.7, SR), 'hp', 5000, 0.7, SR); return norm(y, Float32Array.from(y), 0.4); } },
    image: { name: '声像扫动', desc: '声音从左慢慢移到右，再停在正中', make() { const n = SR * 8, r = rng(9), w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = r(); const y = TestTrack.biquad(TestTrack.biquad(w, 'hp', 300, 0.7, SR), 'lp', 5000, 0.7, SR), L = new Float32Array(n), R = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR, p = t < 5 ? t / 5 : 0.5, a = p * Math.PI / 2, e = Math.abs(Math.sin(Math.PI * 4 * t)) * 0.7 + 0.3; L[i] = y[i] * Math.cos(a) * e; R[i] = y[i] * Math.sin(a) * e; } return norm(L, R, 0.5); } },
  };
  const Q = [
    { k: 'bass', name: '低频量感', lo: '太少', hi: '太多', min: 1, max: 5, def: 3 },
    { k: 'vocal', name: '人声清晰', lo: '闷/糊', hi: '很清楚', min: 1, max: 5, def: 4 },
    { k: 'image', name: '声像居中', lo: '偏左', hi: '偏右', min: -2, max: 2, def: 0 },
    { k: 'harsh', name: '高音刺耳', lo: '不刺', hi: '很刺', min: 1, max: 5, def: 2 },
    { k: 'layer', name: '层次', lo: '扁/乱', hi: '有层次', min: 1, max: 5, def: 4 },
  ];
  /** 纯函数：评分 → 小幅调整（每次最多 ±2 dB / 0.1 ms） */
  function tweaks(s) {
    const T = [];
    if (s.bass <= 2) T.push({ kind: 'gain', ids: [7], value: s.bass === 1 ? 2 : 1, text: `超低音 CH7 增益 +${s.bass === 1 ? 2 : 1} dB` });
    if (s.bass >= 4) T.push({ kind: 'gain', ids: [7], value: s.bass === 5 ? -2 : -1, text: `超低音 CH7 增益 ${s.bass === 5 ? -2 : -1} dB` });
    if (s.vocal <= 2) { const g = s.vocal === 1 ? 1.5 : 1; T.push({ kind: 'eq', ids: [9, 10], freq: 2500, gain: g, q: 1, text: `仪表台中音 CH9/10 在 2.5 kHz +${g} dB（人声更清楚）` }); T.push({ kind: 'eq', ids: [5, 6], freq: 250, gain: -g, q: 1, text: `前门中低音 CH5/6 在 250 Hz −${g} dB（减轻发闷）` }); }
    if (s.image) { const side = s.image < 0 ? 'L' : 'R', v = r2x(0.05 * Math.abs(s.image)); T.push({ kind: 'delay', ids: side === 'L' ? [5, 9, 11] : [6, 10, 12], value: v, text: `听着偏${side === 'L' ? '左' : '右'}：${side === 'L' ? 'CH5/9/11' : 'CH6/10/12'} 延时各 +${v} ms` }); }
    if (s.harsh >= 4) { T.push({ kind: 'eq', ids: [11, 12], freq: 6300, gain: -1.5, q: 1.2, text: '高音 CH11/12 在 6.3 kHz −1.5 dB' }); if (s.harsh === 5) T.push({ kind: 'gain', ids: [11, 12], value: -1, text: '高音 CH11/12 增益 −1 dB' }); }
    if (s.layer <= 2) T.push({ kind: 'gain', ids: [1, 2, 3, 4], value: -1, text: '后场 CH1–4 增益 −1 dB（减少后面声音抢前面）；如果还乱，先做「声像居中」和「整车识别」查延时' });
    return T;
  }
  function applyTo(chs, T) {
    T.forEach((t) => t.ids.forEach((id) => {
      const c = chs[id - 1]; if (!c || c.mute) return;
      if (t.kind === 'gain') c.gainSetDb = r1x((c.gainSetDb || 0) + t.value);
      if (t.kind === 'delay') c.delaySetMs = Math.round(((c.delaySetMs || 0) + t.value) * 1000) / 1000;
      if (t.kind === 'eq') { c.eq = c.eq || []; const e = c.eq.find((x) => Math.abs(Math.log2(x.freq / t.freq)) < 0.17); if (e) e.gain = r1x(e.gain + t.gain); else { c.eq.push({ freq: t.freq, gain: t.gain, q: t.q }); c.eq.sort((a, b) => a.freq - b.freq); } }
    }));
    return chs;
  }
  async function play(k) {
    if (cur) { try { cur.src.stop(); } catch (_) {} const was = cur.k; cur = null; renderBtns(); if (was === k) return; }
    const c = CLIPS[k], b = c.make(); await AudioEngine.resume(true);
    const ctx = AudioEngine.getCtx(), buf = ctx.createBuffer(2, b.L.length, SR); buf.copyToChannel(b.L, 0); buf.copyToChannel(b.R, 1);
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = $('lsLoop').checked; src.connect(ctx.destination); src.start();
    cur = { src, k }; src.onended = () => { if (cur && cur.src === src) { cur = null; renderBtns(); } }; renderBtns();
  }
  function renderBtns() { document.querySelectorAll('[data-lsclip]').forEach((b) => { const on = cur && cur.k === b.dataset.lsclip; b.classList.toggle('on', !!on); b.firstChild.textContent = (on ? '■ ' : '▶ ') + CLIPS[b.dataset.lsclip].name; }); }
  const scores = () => Object.fromEntries(Q.map((q) => [q.k, +$('ls_' + q.k).value]));
  function update() { Q.forEach((q) => { $('lsv_' + q.k).textContent = q.k === 'image' ? ['偏左多', '偏左', '正中', '偏右', '偏右多'][+$('ls_' + q.k).value + 2] : $('ls_' + q.k).value; }); const T = tweaks(scores()); $('lsOut').innerHTML = T.length ? `<ol>${T.map((t) => `<li>${esc(t.text)}</li>`).join('')}</ol>` : '<p>听感都不错，不用改 ✓</p>'; $('lsApply').hidden = !T.length; }
  function init() {
    if (!$('panel-listen')) return;
    $('lsClips').innerHTML = Object.entries(CLIPS).map(([k, c]) => `<button type="button" data-lsclip="${k}">▶ ${c.name}<small>${c.desc}</small></button>`).join('');
    $('lsSliders').innerHTML = Q.map((q) => `<div class="ls-q"><div><b>${q.name}</b> <span id="lsv_${q.k}"></span></div><div class="ls-row"><small>${q.lo}</small><input type="range" id="ls_${q.k}" min="${q.min}" max="${q.max}" step="1" value="${q.def}"><small>${q.hi}</small></div></div>`).join('');
    document.querySelectorAll('[data-lsclip]').forEach((b) => { b.onclick = () => play(b.dataset.lsclip); });
    Q.forEach((q) => { $('ls_' + q.k).oninput = update; });
    $('lsApply').onclick = () => { History.push('听感微调前'); Channels.setAll(applyTo(Channels.getAll(), tweaks(scores()))); $('lsMsg').textContent = '已记到通道表 ✓ 在 DSP 里照改后再听一遍（可在「方案管理」撤销）'; };
    update();
  }
  return { init, tweaks, applyTo, CLIPS };
})();
if (typeof module !== 'undefined') module.exports = { XoverCheck, History, Plans, DspExport, Listen };
