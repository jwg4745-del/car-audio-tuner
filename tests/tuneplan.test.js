const assert = require('assert');
const TP = require('../js/tuneplan.js');
const DEF = [['前左高音','L','tweeter',3500,null],['前左中音','L','mid',300,3500],['前左低音','L','woofer',40,300],['前右高音','R','tweeter',3500,null],['前右中音','R','mid',300,3500],['前右低音','R','woofer',40,300],['中置','C','center',250,null],['后左','L','rear',80,null],['后右','R','rear',80,null],['超低音左','L','sub',20,80],['超低音右','R','sub',20,80],['备用/环绕','M','full',null,null]];
const chans = (patch = {}) => DEF.map(([name, side, type, hpf, lpf], i) => Object.assign({ id: i + 1, name, side, type, mute: false, hpf, lpf, slope: 24, polarity: '未测', levelDb: null, delayMs: null, distCm: null }, patch[i + 1] || {}));
const FC = []; for (let i = -17; i <= 13; i++) { const f = 1000 * 2 ** (i / 3); if (f >= 20 && f <= 20000) FC.push(f); }
const bands = (fn) => FC.map((fc) => ({ fc: Math.round(fc), level: 0, target: 0, dev: fn(fc) }));
const step = (p, t) => p.steps.find((s) => s.title.startsWith(t));
const txt = (s) => s.items.map((i) => `${i.ch}:${i.value}`).join(' | ');

// 1) 无数据 → 全部给待测 + 默认值，不编数字
let p = TP.generate({ channels: chans(), analyses: {}, target: 'house' });
assert(p.missing >= 4, 'missing todos');
assert(step(p, 'EQ').items[0].value.includes('默认值'));
assert(Object.values(p.perChannel).every((c) => !c.id || (c.gainDb === 0 && c.delayMs === 0 && c.eq.length === 0)));
console.log('✓ 无数据：给出待测项', p.missing, '项，数值全为默认值');

// 2) 低音偏重 + 高音刺耳（整车录音）
const sysBH = { bands: bands((f) => (f < 160 ? 7 : f >= 2000 && f <= 5000 ? 5 : 0)), balance: { bass: 6.5, mid: 0.5, treble: 1, harsh2to5k: 5, sibilance5to9k: 1, lowRolloffHz: 31 }, stereo: null };
p = TP.generate({ channels: chans(), analyses: { all: sysBH }, target: 'house' });
const xo = txt(step(p, '分频'));
assert(/CH1.*HPF 3500 → 4400/.test(xo), 'tweeter HPF up');
assert(/CH3.*HPF 40 → 80/.test(xo), 'woofer HPF to sub LPF');
assert(/CH10.*LPF 80 → 63/.test(xo), 'sub LPF down');
const sysEq = p.perChannel.system;
assert(sysEq.length && sysEq.length <= 8);
assert(sysEq.every((e) => e.gain >= -6 && e.gain <= 3));
assert(sysEq.some((e) => e.freq < 160 && e.gain <= -5), 'bass cut');
assert(sysEq.some((e) => e.freq >= 2000 && e.freq <= 5000 && e.gain < -4), 'harsh cut');
console.log('✓ 低音重+刺耳：', xo.split(' | ').slice(0, 3).join(' | '), '\n  整车EQ:', sysEq.map((e) => `${e.freq}Hz ${e.gain}dB Q${e.q}`).join(', '));

// 3) 左右延时 + 电平差（只有整车立体声录音）
const sysLR = { bands: bands(() => 0), balance: { bass: 0, mid: 0, treble: 0, harsh2to5k: 0, sibilance5to9k: 0 }, stereo: { lrDiffDb: 2.4, correlation: 0.5, peakCorrelation: 0.7, delayMs: 0.8, delayCm: 27.4 } };
p = TP.generate({ channels: chans(), analyses: { all: sysLR }, target: 'flat' });
assert.strictEqual(p.perChannel[1].delayMs, 0.8); assert.strictEqual(p.perChannel[4].delayMs, 0);
assert.strictEqual(p.perChannel[1].gainDb, -2.4); assert.strictEqual(p.perChannel[4].gainDb, 0);
assert(p.perChannel.system.length === 0);
console.log('✓ L/R 延时 0.8ms + 左响 2.4dB：左侧通道 延时', p.perChannel[1].delayMs, 'ms，增益', p.perChannel[1].gainDb, 'dB；平直频响无 EQ');

// 4) 反相通道 + 实测电平/距离 + 分频点凹陷 + 单通道录音
const ch = chans({ 1: { distCm: 95, levelDb: -18, polarity: '正 +' }, 2: { distCm: 100, levelDb: -21 }, 4: { distCm: 120, levelDb: -20, polarity: '正 +' }, 5: { distCm: 125, levelDb: -22, polarity: '反 −' }, 10: { distCm: 180, levelDb: -19 } });
const an4 = { bands: bands((f) => (Math.abs(Math.log2(f / 3500)) < 0.2 ? -9 : f > 800 && f < 1300 ? 4 : 0)), balance: { bass: 0, mid: 0, treble: 0, harsh2to5k: 0, sibilance5to9k: 0, lowRolloffHz: null } };
p = TP.generate({ channels: ch, analyses: { 4: an4 }, target: 'house' });
assert(p.perChannel[5].invert, 'CH5 invert');
assert(/CH5.*反相/.test(txt(step(p, '极性'))));
assert(/CH4.*试反相/.test(txt(step(p, '极性'))), 'crossover dip → try invert tweeter');
assert.strictEqual(p.perChannel[10].delayMs, 0); assert(Math.abs(p.perChannel[1].delayMs - 2.48) < 0.02);
assert.strictEqual(p.perChannel[5].gainDb, 0); assert.strictEqual(p.perChannel[1].gainDb, -4);
assert(p.perChannel[4].eq.every((e) => e.freq >= 3500), 'EQ limited to passband');
console.log('✓ CH5 反相 / CH4 分频点凹陷→试反相 / 延时 CH1', p.perChannel[1].delayMs, 'ms / 增益 CH1', p.perChannel[1].gainDb, 'dB');

// 5) 窄深谷不提升
const r = TP.eqFromBands(bands((f) => (Math.abs(f - 400) < 30 ? -12 : 0)));
assert(r.bands.length === 0 && r.notes.length === 1);
console.log('✓ 400Hz 窄深谷 -12dB：不提升 →', r.notes[0].reason);

console.log('\n===== 示例方案（场景：低音重 + 刺耳 + 左右延时 + CH5 反相 + 实测距离/电平）=====');
const all = Object.assign({}, sysBH, { stereo: sysLR.stereo });
console.log(TP.toText(TP.generate({ channels: ch, analyses: { all }, target: 'house' })));
