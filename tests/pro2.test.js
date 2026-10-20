const assert = require('assert');
const root = require('path').join(__dirname, '..');
global.TestTrack = require(root + '/js/testtrack.js');
const { Cal, Duo } = require(root + '/js/duo.js'); global.Cal = Cal; global.Duo = Duo; global.Plot = { curves() {} };
const { XoverCheck, DspExport, Listen } = require(root + '/js/pro2.js');
const TT = global.TestTrack;
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('✓', name); } catch (e) { fail++; console.log('✗', name, e.message); } };
// 模拟分频：LR4（两级 Butterworth）低通/高通 → 各组可反相/延时 → 相加
function rec(j, { low = true, high = true, invHigh = false, delayHigh = 0, gHigh = 1 } = {}) {
  const tr = Duo.build(j), sr = 48000, fc = XoverCheck.J[j].fc, lead = 1.3, n = Math.round((tr.L.length / TT.SR + lead) * sr);
  const x = new Float32Array(n), rd = (a, p) => { const i = Math.floor(p), f = p - i; return i < 0 || i + 1 >= a.length ? 0 : a[i] * (1 - f) + a[i + 1] * f; };
  for (let i = 0; i < n; i++) x[i] = rd(tr.L, (i / sr - lead) * TT.SR);
  const lp = TT.biquad(TT.biquad(x, 'lp', fc, 0.7071, sr), 'lp', fc, 0.7071, sr), hp = TT.biquad(TT.biquad(x, 'hp', fc, 0.7071, sr), 'hp', fc, 0.7071, sr);
  // 同步咔嗒在 3 kHz：两组都关时也保留一条宽带直达路径的咔嗒（实车中咔嗒由其它在响的单元发出，这里只为对齐）
  const ck = TT.biquad(x, 'bp', 3000, 2, sr), d = Math.round(delayHigh / 1000 * sr);
  const y = new Float32Array(n); let s = 3; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; };
  for (let i = 0; i < n; i++) { const h = i - d >= 0 ? hp[i - d] : 0; y[i] = 0.4 * ((low ? lp[i] : 0) + (high ? (invHigh ? -1 : 1) * gHigh * h : 0)) + (i / sr < lead + 3.95 ? 0.4 * ck[i] : 0) + 0.0005 * r(); }
  const l = Duo.locate(y, sr, j); assert(l.ok, l.reason);
  return XoverCheck.bandsOf(y, sr, l.t0, j);
}
const set = (j, o = {}) => ({ A: rec(j, { ...o, high: false }), B: rec(j, { ...o, low: false }), C: rec(j, o), D: rec(j, { ...o, invHigh: !o.invHigh }) });
['xo300', 'xo4k'].forEach((j) => {
  const ok = XoverCheck.judge(set(j), j);
  t(`${j}：LR4 正确接法 → 衔接正常`, () => assert.strictEqual(ok.verdict, 'ok', JSON.stringify(ok)));
  const bad = XoverCheck.judge(set(j, { invHigh: true }), j);
  t(`${j}：高组接反 → 建议翻转高组极性`, () => { assert.strictEqual(bad.verdict, 'flip', JSON.stringify(bad)); assert(bad.fixes.some((f) => f.kind === 'invert')); });
  const loud = XoverCheck.judge(set(j, { gHigh: 2.5 }), j);
  t(`${j}：高组响 8 dB → 建议降高组增益`, () => assert(loud.fixes.some((f) => f.kind === 'gain' && f.ids[0] === XoverCheck.J[j].high[0]), JSON.stringify(loud.fixes)));
});
t('缺第 3 步 → 提示还差', () => { const r = XoverCheck.judge({ A: [], B: [] }, 'xo300'); assert(!r.ok && /3/.test(r.reason)); });
t('没录第 4 步也能出结果', () => { const s = set('xo4k'); delete s.D; const r = XoverCheck.judge(s, 'xo4k'); assert(r.ok && r.invGainDb == null); });

// DSP 导出（直接构造 rows）
const rows = [{ id: 1, name: '左尾门', mute: false, gain: -14.5, delay: 11.604, invert: false, hpf: 100, lpf: 6500, slope: 24, eq: [{ freq: 160, gain: -1.5, q: 1 }] }, { id: 8, name: '中置', mute: true, eq: [] }, { id: 11, name: '高音', mute: false, gain: -7.5, delay: 6.708, invert: true, hpf: 4000, lpf: null, slope: 24, eq: [] }];
const csv = DspExport.csv(rows);
t('CSV：带 BOM，Excel 中文不乱码', () => assert(csv.charCodeAt(0) === 0xfeff));
t('CSV：表头 9 列 + 10 段 EQ×3', () => assert.strictEqual(csv.split('\r\n')[0].split(',').length, 39));
t('CSV：CH11 反相、EQ1 160Hz', () => { const L = csv.split('\r\n'); assert(/"反相"/.test(L[3])); assert(/"160","-1.5","1"/.test(L[1])); });
t('CSV：静音通道不写增益', () => assert(/"CH8","中置","是","",""/.test(csv)));

// 听感
t('低频太少 → 超低 +2 dB', () => { const T = Listen.tweaks({ bass: 1, vocal: 4, image: 0, harsh: 2, layer: 4 }); assert(T.length === 1 && T[0].ids[0] === 7 && T[0].value === 2); });
t('全部合适 → 不改', () => assert.strictEqual(Listen.tweaks({ bass: 3, vocal: 4, image: 0, harsh: 2, layer: 4 }).length, 0));
t('偏左 → 左前 CH5/9/11 延时 +0.05', () => { const T = Listen.tweaks({ bass: 3, vocal: 4, image: -1, harsh: 2, layer: 4 }); assert.deepStrictEqual(T[0].ids, [5, 9, 11]); assert.strictEqual(T[0].value, 0.05); });
t('刺耳 5 → 高音 6.3k EQ + 增益 −1；应用后合并到已有 6.3k EQ', () => {
  const chs = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, gainSetDb: -7.5, delaySetMs: 1, eq: i === 10 ? [{ freq: 6300, gain: -1.2, q: 1 }] : [] }));
  Listen.applyTo(chs, Listen.tweaks({ bass: 3, vocal: 4, image: 0, harsh: 5, layer: 4 }));
  assert.strictEqual(chs[10].eq.length, 1); assert.strictEqual(chs[10].eq[0].gain, -2.7); assert.strictEqual(chs[11].eq[0].gain, -1.5); assert.strictEqual(chs[10].gainSetDb, -8.5);
});
t('测试片段都能合成（无外部音频）', () => Object.values(Listen.CLIPS).forEach((c) => { const b = c.make(); assert(b.L.length > 44100 && isFinite(b.L[1000])); }));
console.log(`\n${pass} 通过，${fail} 失败`); process.exit(fail ? 1 : 0);
