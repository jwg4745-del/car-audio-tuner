const assert = require('assert');
const path = require('path');
const root = process.env.ROOT || path.join(__dirname, '..');
global.TestTrack = require(root + '/js/testtrack.js');
const TunePlan = require(root + '/js/tuneplan.js');
const CarId = require(root + '/js/carid.js');
const TT = global.TestTrack;
function sim({ dL = 2, dR = 2.6, gL = 1, gR = 0.9, invR = false, gain = 0.5, noise = 0.003, lead = 2.3, sr = 48000, lp = 12000, hp = 45, cut = 0, track = 'car', room = false } = {}) {
  const t = TT.buildTrack(track), src = TT.SR, n = Math.round((t.L.length / src + lead + 1) * sr) - Math.round(cut * sr), y = new Float32Array(Math.max(n, sr));
  const rd = (a, p) => { const i = Math.floor(p), f = p - i; return i < 0 || i + 1 >= a.length ? 0 : a[i] * (1 - f) + a[i + 1] * f; };
  const k = src * (1 + 30e-6);
  for (let i = 0; i < y.length; i++) y[i] = gL * rd(t.L, (i / sr - lead - dL / 1000) * k) + gR * (invR ? -1 : 1) * rd(t.R, (i / sr - lead - dR / 1000) * k);
  if (room) { const y2 = TT.biquad(y, 'bp', 160, 3, sr); for (let i = 0; i < y.length; i++) y[i] += 1.5 * y2[i]; }
  let h = 0, xp = 0, l = 0; const ah = 1 / (1 + 2 * Math.PI * hp / sr), al = 1 - Math.exp(-2 * Math.PI * lp / sr);
  let s = 9; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; };
  for (let i = 0; i < y.length; i++) { h = ah * (h + y[i] - xp); xp = y[i]; l += al * (h - l); y[i] = l * gain + noise * r(); }
  return y;
}
const J = (o) => CarId.judge(sim(o), 48000, 'flat');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('✓', name); } catch (e) { fail++; console.log('✗', name, e.message); } };
const base = J({});
t('正常车：识别成功', () => assert(base.ok));
t('左右电平差 ≈ +0.9 dB 左响', () => { assert(Math.abs(base.level.diffDb - 0.92) < 0.4, base.level.diffDb); assert.strictEqual(base.level.louder, 'L'); });
t('延时 0.6 ms 左先到', () => { assert(base.delay.reliable); assert(Math.abs(base.delay.diffMs - 0.6) < 0.08, base.delay.diffMs); assert.strictEqual(base.delay.early, 'L'); });
t('相位正常', () => assert.strictEqual(base.phase.verdict, 'ok'));
t('低音下潜 −6 dB 点在 30–63 Hz（模拟 45 Hz 高通）', () => assert(base.bass.minus6Hz >= 25 && base.bass.minus6Hz <= 63, base.bass.minus6Hz));
t('高频延伸 ≥ 8 kHz', () => assert(base.treble.minus10Hz >= 8000, base.treble.minus10Hz));
t('评分 0–100', () => assert(base.score >= 0 && base.score <= 100));
const inv = J({ invR: true });
t('右反相 → 相位接反', () => assert.strictEqual(inv.phase.verdict, 'inverted'));
t('右反相 → 评分更低', () => assert(inv.score < base.score));
const loud = J({ gR: 0.5 });
t('右边小 5 dB → 左响 ~5 dB', () => assert(loud.level.louder === 'L' && Math.abs(loud.level.diffDb - 6) < 1, loud.level.diffDb));
const lateL = J({ dL: 4, dR: 2.5 });
t('右先到 1.5 ms', () => assert(lateL.delay.early === 'R' && Math.abs(lateL.delay.diffMs + 1.5) < 0.1, lateL.delay.diffMs));
const boom = J({ room: true });
t('160 Hz 共振 → 峰值被找出', () => assert(boom.peaks.some((p) => p.fc >= 125 && p.fc <= 200), JSON.stringify(boom.peaks)));
const shallow = J({ hp: 200 });
t('低音浅（200 Hz 高通）→ 下潜 明显变浅', () => assert(shallow.bass.minus6Hz >= 63 && shallow.bass.minus6Hz > base.bass.minus6Hz, shallow.bass.minus6Hz + ' vs ' + base.bass.minus6Hz));
const noR = J({ gR: 0 });
t('右边没声 → ⚠️ 且相位不硬判', () => { assert(noR.ok && noR.level.missing === 'R'); assert.strictEqual(noR.phase.verdict, 'unknown'); assert(!noR.confident); });
t('太小声 → 不出结果', () => assert(!J({ gain: 0.001 }).ok));
t('太吵 → 不出结果或标 ⚠️', () => { const r = J({ gain: 0.05, noise: 0.3 }); assert(!r.ok || !r.confident); });
t('录一半 → 不出结果', () => assert(!J({ cut: 20 }).ok));
t('放的是正反相轨 → 提示模式不对', () => { const r = CarId.judge(sim({ track: 'simple' }), 48000); assert(!r.ok && /整车识别/.test(r.reason)); });
t('44.1k 录音也能识别', () => assert(CarId.judge(sim({ sr: 44100 }), 44100, 'flat').ok));
t('原有轨仍识别为原类型', () => { ['simple', 'polExt', 'phase', 'auto'].forEach((id) => { const d = TT.detect(sim({ track: id }), 48000); assert(d && d.type === id, id + '→' + (d && d.type)); }); });
// 写入方案
const chs = [1, 2, 3].map((id) => ({ id, name: '前左' + id, side: 'L', type: ['tweeter', 'mid', 'woofer'][id - 1], hpf: 300, lpf: null, slope: 24 })).concat([4, 5, 6].map((id) => ({ id, name: '前右' + id, side: 'R', type: ['tweeter', 'mid', 'woofer'][id - 4], hpf: 300, lpf: null, slope: 24 })));
t('写入方案：左侧降增益 + 延时 + 反相提示 + EQ', () => {
  const r = J({ gR: 0.5, invR: true, room: true });
  const p = TunePlan.generate({ channels: chs, analyses: CarId.toAnalyses(r, {}), target: 'flat' });
  const txt = TunePlan.toText(p);
  assert(p.perChannel[1].gainDb < -4 && p.perChannel[4].gainDb === 0, 'gain');
  assert(p.perChannel[1].delayMs > 0.4 && p.perChannel[4].delayMs === 0, 'delay');
  assert(/右侧.*试整体反相/.test(txt), 'phase');
  assert(p.perChannel.system && p.perChannel.system.length, 'eq');
});
t('不可靠结果不写入延时', () => { const r = J({ gR: 0 }); const a = CarId.toAnalyses(r, {}); assert.strictEqual(a.all.stereo.delayMs, 0); assert(!a.phase); });
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
