const assert = require('assert');
const root = require('path').join(__dirname, '..');
global.TestTrack = require(root + '/js/testtrack.js');
const { Cal, Duo } = require(root + '/js/duo.js'); global.Cal = Cal; global.Duo = Duo;
global.CarId = require(root + '/js/carid.js');
const { MultiPoint, ImageCheck } = require(root + '/js/pro1.js');
const TT = global.TestTrack;
// 模拟录音：双声道音轨 → 每侧延时/增益/极性 → 可选共振峰 → 噪声；采样率 48k，时钟漂移 30 ppm
function sim(kind, { dL = 2, dR = 2.5, gL = 1, gR = 1, peak = null, gain = 0.5, noise = 0.002, lead = 1.7, seed = 5, filt = null } = {}) {
  const t = Duo.build(kind), src = TT.SR, sr = 48000, n = Math.round((t.L.length / src + lead + 0.5) * sr), y = new Float32Array(n);
  const rd = (a, p) => { const i = Math.floor(p), f = p - i; return i < 0 || i + 1 >= a.length ? 0 : a[i] * (1 - f) + a[i + 1] * f; };
  const k = src * (1 + 30e-6);
  for (let i = 0; i < n; i++) y[i] = gL * rd(t.L, (i / sr - lead - dL / 1000) * k) + gR * rd(t.R, (i / sr - lead - dR / 1000) * k);
  let z = y;
  if (peak) { const b = TT.biquad(y, 'bp', peak.f, 4, sr); z = y.map((v, i) => v + peak.g * b[i]); }
  if (filt) z = filt(z, sr);
  let s = seed; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; };
  for (let i = 0; i < n; i++) z[i] = z[i] * gain + noise * r();
  return { x: z, sr };
}
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('✓', name); } catch (e) { fail++; console.log('✗', name, e.message); } };

// 麦克风校准
t('校准文件解析（UMIK 格式，带表头）', () => { const p = Cal.parse('"Sens Factor =-1.2dB, SERNO: 7000000"\n10.0 -5.1 0\n20 -2.0\n1000 0\n10000 1.5\n20000 -3\n'); assert.strictEqual(p.length, 5); assert.deepStrictEqual(p[1], [20, -2]); });
t('插值：对数频率', () => { const v = Cal.interp([[100, 0], [1000, -10]], 316.2); assert(Math.abs(v + 5) < 0.05, v); });
t('不校准 → 修正 0', () => { Cal.set('none'); assert.strictEqual(Cal.corr(30), 0); });
t('iPhone 估计 → 30 Hz 补约 +8 dB，并标注估计', () => { Cal.set('iphone'); assert(Cal.corr(31.5) > 7); assert(Cal.estimated()); assert(/估计/.test(Cal.note())); Cal.set('none'); });

// 识别测试音类型
t('识别「多点测量」测试音', () => { const s = sim('mp'); const d = Duo.detect(s.x, s.sr); assert(d && d.kind === 'mp' && d.complete, JSON.stringify(d)); });
t('放错页面 → 提示两台打开同一页', () => { const s = sim('img', { dR: 3 }); const l = Duo.locate(s.x, s.sr, 'mp'); assert(!l.ok && /同一/.test(l.reason), l.reason); });
t('静音录音 → 声音太小', () => { const l = Duo.locate(new Float32Array(48000 * 20), 48000, 'mp'); assert(!l.ok && /太小/.test(l.reason)); });

// 多点平均
const pt = (o) => { const s = sim('mp', o); const l = Duo.locate(s.x, s.sr, 'mp'); return MultiPoint.analyzeOne(s.x, s.sr, l.t0); };
const pts = [0, 1, 2, 3, 4].map((i) => pt({ seed: i + 3, peak: { f: 160, g: 2 }, dR: 2.5 + i * 0.05 }));
const avg = MultiPoint.average(pts, 'flat');
t('5 点平均：160 Hz 共振在各点都有 → 找出峰值', () => assert(avg.ok && avg.peaks.some((p) => p.fc >= 125 && p.fc <= 200), JSON.stringify(avg.peaks)));
t('5 点 → 可信', () => assert(avg.confident));
// 只在一个点出现的深谷（位置相关）→ 标为位置敏感、不进 EQ
const notch = (f) => (z, sr) => { const b = TT.biquad(z, 'bp', f, 3, sr); return z.map((v, i) => v - 0.97 * b[i]); };
const pts2 = [pt({ seed: 21, filt: notch(1000) }), pt({ seed: 22 }), pt({ seed: 23 }), pt({ seed: 24 }), pt({ seed: 25 })];
const avg2 = MultiPoint.average(pts2, 'flat');
t('单点 1 kHz 深谷 → 平均后变浅（< 单点）', () => { const one = MultiPoint.average([pts2[0]], 'flat').bands.find((b) => b.fc === 1000).dev, a = avg2.bands.find((b) => b.fc === 1000).dev; assert(a > one + 4, `${a} vs ${one}`); });
t('单点深谷 → 标为位置敏感，不写进 EQ', () => { assert(avg2.unstable.includes(1000), avg2.unstable); assert(!MultiPoint.toAll(avg2).bands.some((b) => b.fc === 1000)); });
t('2 点 → 不可信 ⚠️', () => assert(!MultiPoint.average(pts.slice(0, 2), 'flat').confident));

// 声像居中
const im = (o) => { const s = sim('img', o); const l = Duo.locate(s.x, s.sr, 'img'); assert(l.ok, l.reason); return ImageCheck.analyze(s.x, s.sr, l.t0); };
t('左右同时、同响 → 居中', () => { const r = im({ dL: 3, dR: 3 }); assert(r.centered, JSON.stringify(r)); });
t('左早 1.2 ms → 偏左，建议左前加 1.2 ms', () => { const r = im({ dL: 2, dR: 3.2 }); assert.strictEqual(r.direction, 'L'); assert(Math.abs(r.dtMs - 1.2) < 0.08, r.dtMs); const f = r.fix.find((x) => x.kind === 'delay'); assert(f && f.side === 'L'); });
t('右响 3 dB（同时到）→ 偏右，建议右前降 ~3 dB', () => { const r = im({ dL: 3, dR: 3, gR: 1.41 }); assert.strictEqual(r.direction, 'R'); const f = r.fix.find((x) => x.kind === 'gain'); assert(f && f.side === 'R' && Math.abs(f.value + 3) < 0.6, JSON.stringify(f)); });
t('左早但右响 → ⚠️ 两边拉', () => assert.strictEqual(im({ dL: 2, dR: 3, gR: 1.6 }).direction, 'mixed'));
t('应用建议：CH5/9/11 延时 +0.5', () => { const chs = [5, 6, 9, 10, 11, 12].map((id) => ({ id, delaySetMs: 1, gainSetDb: 0 })); ImageCheck.applyFix([{ side: 'L', kind: 'delay', value: 0.5 }], chs); assert.deepStrictEqual(chs.map((c) => c.delaySetMs), [1.5, 1, 1.5, 1, 1.5, 1]); });
t('右边没声音 → 测不出并说明', () => { const s = sim('img', { gR: 0.001 }); const l = Duo.locate(s.x, s.sr, 'img'); const r = ImageCheck.analyze(s.x, s.sr, l.t0); assert(!r.ok && /右边/.test(r.reason), r.reason); });
console.log(`\n${pass} 通过，${fail} 失败`); process.exit(fail ? 1 : 0);
