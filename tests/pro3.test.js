const assert = require('assert');
const root = require('path').join(__dirname, '..');
global.TestTrack = require(root + '/js/testtrack.js');
const { Cal, Duo } = require(root + '/js/duo.js'); global.Cal = Cal; global.Duo = Duo;
const TT = global.TestTrack;
function sim(id, { dL = 2, dR = 2.5, gL = 1, gR = 1, invR = false, gain = 0.5, noise = 0.002, lead = 2.2 } = {}) {
  const t = TT.buildTrack(id), src = TT.SR, sr = 48000, n = Math.round((t.L.length / src + lead + 0.8) * sr), y = new Float32Array(n);
  const rd = (a, p) => { const i = Math.floor(p), f = p - i; return i < 0 || i + 1 >= a.length ? 0 : a[i] * (1 - f) + a[i + 1] * f; };
  const k = src * (1 + 20e-6);
  for (let i = 0; i < n; i++) y[i] = gL * rd(t.L, (i / sr - lead - dL / 1000) * k) + gR * (invR ? -1 : 1) * rd(t.R, (i / sr - lead - dR / 1000) * k);
  let s = 7; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; };
  for (let i = 0; i < n; i++) y[i] = y[i] * gain + noise * r();
  return { x: y, sr };
}
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('✓', name); } catch (e) { fail++; console.log('✗', name, e.message); } };
const det = (id, o) => { const s = sim(id, o); const d = TT.detect(s.x, s.sr); assert(d && d.type === (id === 'auto' ? 'auto' : id === 'phase' ? 'phase' : 'polExt') && d.complete, JSON.stringify(d)); return { s, d }; };

t('相位轨识别', () => det('phase'));
t('相位正常 → 全频同相', () => { const { s, d } = det('phase'); const r = TT.analyzePhase(s.x, s.sr, d); assert(r.pairs.some((p) => p.id === 'full' && p.verdict === '同相（正常）'), JSON.stringify(r.pairs.map((p) => p.verdict))); });
t('右反相 → 全频相位相反', () => { const { s, d } = det('phase', { invR: true }); const r = TT.analyzePhase(s.x, s.sr, d); assert(r.anyInverted); assert(r.pairs.find((p) => p.id === 'full').verdict === '相位相反'); });
t('极性轨识别', () => det('polExt'));
t('极性正相 → L/R 正', () => { const { s, d } = det('polExt'); const r = TT.analyzePolExt(s.x, s.sr, d); assert.strictEqual(r.L.polarity, '正'); assert.strictEqual(r.R.polarity, '正'); });
t('自动轨：延时 0.5 ms 右先到', () => { const { s, d } = det('auto', { dL: 3, dR: 2.5 }); const r = TT.analyzeTrack(s.x, s.sr, d); assert(Math.abs(r.delayMs + 0.5) < 0.12, r.delayMs); });
t('自动轨：左响 → lrDiffDb > 0', () => { const { s, d } = det('auto', { gR: 0.5 }); const r = TT.analyzeTrack(s.x, s.sr, d); assert(r.lrDiffDb > 3, r.lrDiffDb); });

console.log(`\n${pass} 通过，${fail} 失败`); process.exit(fail ? 1 : 0);
