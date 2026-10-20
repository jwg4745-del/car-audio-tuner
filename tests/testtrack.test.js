const assert = require('assert');
const TT = require(process.env.TT || '../js/testtrack.js');
function sim({ dL = 2.0, dR = 3.2, gL = 1, gR = 0.7, invR = false, invL = false, lead = 3.2, ppm = 30, sr = 48000, noise = 0.003, seed = 7 }) {
  const t = TT.buildTrack('auto'), src = TT.SR;
  const n = Math.round((t.L.length / src + lead + 1) * sr), y = new Float32Array(n);
  const ratio = (src / sr) * (1 + ppm * 1e-6);
  const read = (a, pos) => { const i = Math.floor(pos), f = pos - i; return i < 0 || i + 1 >= a.length ? 0 : a[i] * (1 - f) + a[i + 1] * f; };
  for (let k = 0; k < n; k++) {
    const tl = (k / sr - lead - dL / 1000) * src * (1 + ppm * 1e-6), tr = (k / sr - lead - dR / 1000) * src * (1 + ppm * 1e-6);
    y[k] = gL * (invL ? -1 : 1) * read(t.L, tl) + gR * (invR ? -1 : 1) * read(t.R, tr);
  }
  // speaker+mic: HPF 120 Hz, LPF 9 kHz (one-pole), noise
  let h = 0, xp = 0, l = 0; const ah = 1 / (1 + 2 * Math.PI * 120 / sr), al = 1 - Math.exp(-2 * Math.PI * 9000 / sr);
  let s = seed; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; };
  for (let k = 0; k < n; k++) { h = ah * (h + y[k] - xp); xp = y[k]; l += al * (h - l); y[k] = l * 0.5 + noise * r(); }
  return { y, sr };
}
// track sanity
const a = TT.buildTrack('auto');
assert.strictEqual(a.L.length, Math.round(34 * 44100));
let peak = 0; for (const v of a.L) peak = Math.max(peak, Math.abs(v)); assert(peak < 1 && peak > 0.5, 'auto peak ' + peak);
TT.TRACK_IDS.forEach((id) => { const t = TT.buildTrack(id); let p = 0; for (const v of t.L) p = Math.max(p, Math.abs(v)); for (const v of t.R) p = Math.max(p, Math.abs(v)); assert(p <= 1, id + ' clips ' + p); });
const w = TT.wavBytes(a.L, a.R); assert.strictEqual(String.fromCharCode(...w.slice(0, 4)), 'RIFF'); assert.strictEqual(new DataView(w.buffer).getUint32(24, true), 44100); assert.strictEqual(new DataView(w.buffer).getUint16(34, true), 16);
assert.strictEqual(TT.crc32(Uint8Array.from('123456789', (c) => c.charCodeAt(0))), 0xCBF43926);
console.log('✓ 8 条音轨无削波；WAV 44.1k/16bit 头正确；CRC32 正确');

const cases = [
  ['正常：R 晚 1.2 ms、R 小 3.1 dB', { dL: 2.0, dR: 3.2, gL: 1, gR: 0.7 }, { delay: 1.2, lr: 3.1, mismatch: false }],
  ['R 反相', { dL: 2.0, dR: 3.2, gL: 1, gR: 0.7, invR: true }, { delay: 1.2, lr: 3.1, mismatch: true, R: '反' }],
  ['L 晚 0.8 ms、左右等响', { dL: 3.0, dR: 2.2, gL: 0.8, gR: 0.8 }, { delay: -0.8, lr: 0, mismatch: false }],
  ['噪声大（SNR 低）', { dL: 2.0, dR: 2.5, noise: 0.03 }, { delay: 0.5, lr: 3.1, mismatch: false }],
];
cases.forEach(([name, p, exp]) => {
  const { y, sr } = sim(p);
  const d = TT.detect(y, sr);
  assert(d, name + ': not detected');
  const expT0 = (p.lead ?? 3.2) * sr + 1.0 * sr * (1 + 30e-6) + (p.dL ?? 2) / 1000 * sr; // first click (file lead 1s) arrives via L path (approx)
  const r = TT.analyzeTrack(y, sr, d);
  assert(Math.abs(r.delayMs - exp.delay) < 0.1, name + ' delay ' + r.delayMs);
  assert(Math.abs(r.lrDiffDb - exp.lr) < 0.6, name + ' lr ' + r.lrDiffDb);
  assert.strictEqual(r.polarity.mismatch, exp.mismatch, name + ' pol ' + JSON.stringify(r.polarity));
  if (exp.R) assert.strictEqual(r.polarity.R, exp.R);
  console.log(`✓ ${name}: T0=${(d.t0 / sr).toFixed(3)}s(期望≈${(expT0 / sr).toFixed(3)}) 延时 ${r.delayMs} ms / ${r.delayCm} cm · 左右差 ${r.lrDiffDb} dB · 极性 L${r.polarity.L}/R${r.polarity.R} · SNR ${r.snrDb} dB`);
});
// no track → null
{ const n = 48000 * 20, y = new Float32Array(n); let s = 1; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; y[i] = (s / 0x7fffffff - 0.5) * 0.2; }
  assert.strictEqual(TT.detect(y, 48000), null); console.log('✓ 普通噪声录音：不误判为测试轨'); }
// ---- 相位测试轨 ----
function simT(id, p) { const t = TT.buildTrack(id); const orig = TT.buildTrack; TT.buildTrack = () => t; const r = sim(p); TT.buildTrack = orig; return r; }
[['相位正常', {}, false], ['右侧反相', { invR: true }, true]].forEach(([name, extra, inv]) => {
  const { y, sr } = simT('phase', { dL: 2.0, dR: 2.6, gL: 1, gR: 0.9, ...extra });
  const d = TT.detect(y, sr); assert(d && d.type === 'phase' && d.complete, name + ' detect ' + JSON.stringify(d));
  const r = TT.analyzePhase(y, sr, d);
  r.pairs.forEach((p) => { if (p.id !== 'x3k5') assert.strictEqual(p.verdict, inv ? '相位相反' : '同相（正常）', name + ' ' + p.id + ' ' + p.diffDb); });
  assert.strictEqual(r.anyInverted, inv);
  console.log(`✓ 相位轨·${name}: ` + r.pairs.map((p) => `${p.name}=${p.verdict}(${p.diffDb})`).join('；'));
});
// ---- 单元极性外录轨 ----
[['左正 右反', { invR: true }, '正', '反'], ['仅左单元 反相', { invL: true, gR: 0 }, '反', '无声']].forEach(([name, extra, eL, eR]) => {
  const { y, sr } = simT('polExt', { dL: 1.5, dR: 2.3, ...extra });
  const d = TT.detect(y, sr); assert(d && d.type === 'polExt' && d.complete, name + ' detect');
  const r = TT.analyzePolExt(y, sr, d);
  assert.strictEqual(r.L.polarity, eL, name + ' L ' + JSON.stringify(r.L)); assert.strictEqual(r.R.polarity, eR, name + ' R ' + JSON.stringify(r.R));
  console.log(`✓ 极性轨·${name}: L=${r.L.polarity}(${r.L.pos}/${r.L.neg}) R=${r.R.polarity}(${r.R.pos}/${r.R.neg})`);
});
{ const { y, sr } = sim({}); assert.strictEqual(TT.detect(y, sr).type, 'auto'); console.log('✓ 自动测试轨类型识别为 auto'); }
