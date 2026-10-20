const assert = require('assert');
const path = require('path');
const root = process.env.ROOT || path.join(__dirname, '..');
global.TestTrack = require(root + '/js/testtrack.js');
const Simple = require(root + '/js/simple.js');
const TT = global.TestTrack;
function sim(id, opt, { dL = 2, dR = 2.6, gL = 1, gR = 0.9, invL = false, invR = false, gain = 0.5, noise = 0.003, lead = 2.3, sr = 48000, lp = 9000, hp = 120, cut = 0 } = {}) {
  const t = TT.buildTrack(id, opt), src = TT.SR, n = Math.round((t.L.length / src + lead + 1) * sr) - Math.round(cut * sr), y = new Float32Array(Math.max(n, sr));
  const rd = (a, p) => { const i = Math.floor(p), f = p - i; return i < 0 || i + 1 >= a.length ? 0 : a[i] * (1 - f) + a[i + 1] * f; };
  const k = src * (1 + 30e-6);
  for (let i = 0; i < y.length; i++) y[i] = gL * (invL ? -1 : 1) * rd(t.L, (i / sr - lead - dL / 1000) * k) + gR * (invR ? -1 : 1) * rd(t.R, (i / sr - lead - dR / 1000) * k);
  let h = 0, xp = 0, l = 0; const ah = 1 / (1 + 2 * Math.PI * hp / sr), al = 1 - Math.exp(-2 * Math.PI * lp / sr);
  let s = 9; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; };
  for (let i = 0; i < y.length; i++) { h = ah * (h + y[i] - xp); xp = y[i]; l += al * (h - l); y[i] = l * gain + noise * r(); }
  return y;
}
const J = (y, mode, pair, type) => Simple.judge(y, 48000, mode, pair, type);
const cases = [
  ['两个一起·左右整体·正常', J(sim('simple', 'lr'), 'pair', 'lr'), 'ok'],
  ['两个一起·左右整体·右反', J(sim('simple', 'lr', { invR: true }), 'pair', 'lr'), 'inverted'],
  ['两个一起·超低vs门板·正常', J(sim('simple', 'sub', { hp: 30 }), 'pair', 'sub'), 'ok'],
  ['两个一起·超低vs门板·反', J(sim('simple', 'sub', { hp: 30, invR: true }), 'pair', 'sub'), 'inverted'],
  ['两个一起·声音太小', J(sim('simple', 'lr', { gain: 0.002 }), 'pair', 'lr'), 'unknown'],
  ['两个一起·太吵', J(sim('simple', 'lr', { gain: 0.05, noise: 0.3 }), 'pair', 'lr'), 'unknown'],
  ['两个一起·只有一路在响', J(sim('simple', 'lr', { gR: 0 }), 'pair', 'lr'), 'unknown'],
  ['没有测试音（普通噪声）', J(Float32Array.from({ length: 48000 * 20 }, (_, i) => Math.sin(i * 1.3) * 0.05 + Math.sin(i * 0.0071) * 0.1), 'pair', 'lr'), 'unknown'],
  ['录到一半就停', J(sim('simple', 'lr', { cut: 15 }), 'pair', 'lr'), 'unknown'],
  ['模式不一致（放极性 录相位）', J(sim('polExt'), 'pair', 'lr'), 'unknown'],
  ['单个喇叭·左高音·正常', J(sim('polExt', null, { gR: 0, hp: 2000 }), 'single', 'lr', 'tweeter'), 'ok'],
  ['单个喇叭·右中音·接反', J(sim('polExt', null, { gL: 0, invR: true, hp: 250, lp: 6000 }), 'single', 'lr', 'mid'), 'inverted'],
  ['单个喇叭·左门板低音·正常', J(sim('polExt', null, { gR: 0, hp: 50, lp: 1500 }), 'single', 'lr', 'woofer'), 'ok'],
  ['单个喇叭·声音太小', J(sim('polExt', null, { gR: 0, gain: 0.0005 }), 'single', 'lr', 'tweeter'), 'unknown'],
];
let fail = 0;
cases.forEach(([n, r, exp]) => { const ok = r.verdict === exp; if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${n}: ${r.verdict}${r.reason ? '（' + r.reason + '）' : ''}${r.diffDb != null ? ' Δ=' + r.diffDb + 'dB' : ''}`); });
const sub = J(sim('polExt', null, { gR: 0, hp: 25, lp: 100 }), 'single', 'lr', 'sub');
console.log(`· 超低音单元（仅参考）: ${sub.verdict} ${sub.reason || ''}${sub.lowNote ? '（标注仅供参考）' : ''}`);
assert(sub.verdict === 'unknown' || sub.lowNote, 'sub must be flagged');
assert.strictEqual(fail, 0);
