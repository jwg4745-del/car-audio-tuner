/** 外录模式：生成测试音轨（WAV 44.1k/16bit + ZIP），并在录音中识别同步咔嗒声做「按音轨」分析 */
const TestTrack = (() => {
  const SR = 44100;
  const LEAD = 1.0;                     // 文件开头静音（秒）
  const SYNC = [0, 0.5, 1.0];           // 同步咔嗒（相对 T0）
  const SEG = { L: [2, 8], R: [9, 15], B: [16, 22] };   // 粉红噪声段
  const CHIRPS = [['L', 23], ['R', 24], ['L', 25], ['R', 26]];
  const PULSES = [['L', 27.5], ['R', 28.5], ['L', 29.5], ['R', 30.5]];
  const AUTO_LEN = 32;
  // 相位测试轨：第 4 声咔嗒在 +1.5 s；每对 = 8 s 同相 + 2 s 静音 + 8 s 右声道反相 + 2 s 静音
  const PHASE_MARK = 1.5, POL_MARK = 1.75;
  const PHASE_PAIRS = [
    { id: 'full', name: '全频', band: null, start: 3 },
    { id: 'bass', name: '低频 40–200 Hz', band: [40, 200], start: 23 },
    { id: 'x80', name: '80 Hz 分频区（超低/中低）', band: [50, 130], start: 43 },
    { id: 'x3k5', name: '3.5 kHz 分频区（高音/中音）', band: [2500, 5000], start: 63 },
  ];
  const PH_SEG = 8, PH_GAP = 2, PHASE_LEN = 83;
  // 单元极性外录轨：第 4 声咔嗒在 +1.75 s；左 Chirp 2.5 s + 8 个脉冲 3.0–6.5 s；右 Chirp 7.5 s + 脉冲 8.0–11.5 s
  const POLX = { L: { chirp: 2.5, p0: 3.0 }, R: { chirp: 7.5, p0: 8.0 } }, POLX_N = 8, POLX_LEN = 12.5;
  const OCT = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const CHIRP_DUR = 0.15, CHIRP_F0 = 300, CHIRP_F1 = 6000;

  // ---------- 信号 ----------
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; }; }
  function pinkInto(out, start, n, amp, seed) {
    const r = rng(seed); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    const fade = Math.min(n / 4, Math.floor(0.03 * SR));
    for (let i = 0; i < n; i++) {
      const w = r();
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      const p = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      const e = i < fade ? i / fade : i > n - fade ? (n - i) / fade : 1;
      out[start + i] += p * amp * e;
    }
  }
  function clickTemplate(sr) {
    const n = Math.round(0.004 * sr), t = new Float32Array(n);
    for (let i = 0; i < n; i++) t[i] = Math.sin(2 * Math.PI * 3000 * i / sr) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
    return t;
  }
  function chirpTemplate(sr) {
    const n = Math.round(CHIRP_DUR * sr), t = new Float32Array(n), k = (CHIRP_F1 - CHIRP_F0) / CHIRP_DUR;
    for (let i = 0; i < n; i++) { const x = i / sr; const e = Math.min(1, i / (0.005 * sr), (n - i) / (0.005 * sr)); t[i] = Math.sin(2 * Math.PI * (CHIRP_F0 * x + k * x * x / 2)) * e; }
    return t;
  }
  function pulseTemplate(sr) {
    // 正向半正弦脉冲（约 0.6 ms），扬声器振膜先外推
    const n = Math.max(3, Math.round(0.0006 * sr)), t = new Float32Array(n);
    for (let i = 0; i < n; i++) t[i] = Math.sin(Math.PI * (i + 0.5) / n);
    return t;
  }
  function biquad(x, type, f, Q, sr) {
    const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * Q), c = Math.cos(w), a0 = 1 + al;
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; } else { b0 = al; b1 = 0; b2 = -al; }
    b0 /= a0; b1 /= a0; b2 /= a0; const a1 = -2 * c / a0, a2 = (1 - al) / a0;
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  function bandPink(n, band, seed) {
    const tmp = new Float32Array(n); pinkInto(tmp, 0, n, 1, seed);
    let y = tmp;
    if (band) { for (let k = 0; k < 2; k++) { y = biquad(y, 'hp', band[0], 0.707, SR); y = biquad(y, 'lp', band[1], 0.707, SR); } }
    let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
    const g = 0.45 / (pk || 1), fade = Math.floor(0.05 * SR);   // 峰值 −7 dBFS，同相相加也不削波
    for (let i = 0; i < n; i++) y[i] *= g * Math.min(1, i / fade, (n - 1 - i) / fade);
    return y;
  }
  function addAt(out, tpl, at, amp) { for (let i = 0; i < tpl.length && at + i < out.length; i++) if (at + i >= 0) out[at + i] += tpl[i] * amp; }

  /** 返回 { name, file, desc, L, R } */
  function buildTrack(id) {
    const S = (sec) => Math.round(sec * SR);
    const mk = (sec) => [new Float32Array(S(sec)), new Float32Array(S(sec))];
    if (id === 'auto') {
      const [L, R] = mk(LEAD + AUTO_LEN + 1);
      const T0 = S(LEAD), click = clickTemplate(SR), ch = chirpTemplate(SR), pu = pulseTemplate(SR);
      SYNC.forEach((t) => { addAt(L, click, T0 + S(t), 0.9); addAt(R, click, T0 + S(t), 0.9); });
      pinkInto(L, T0 + S(SEG.L[0]), S(SEG.L[1] - SEG.L[0]), 0.9, 11);
      pinkInto(R, T0 + S(SEG.R[0]), S(SEG.R[1] - SEG.R[0]), 0.9, 12);
      pinkInto(L, T0 + S(SEG.B[0]), S(SEG.B[1] - SEG.B[0]), 0.9, 13);
      pinkInto(R, T0 + S(SEG.B[0]), S(SEG.B[1] - SEG.B[0]), 0.9, 13);
      CHIRPS.forEach(([s, t]) => addAt(s === 'L' ? L : R, ch, T0 + S(t), 0.7));
      PULSES.forEach(([s, t]) => addAt(s === 'L' ? L : R, pu, T0 + S(t), 0.9));
      return { file: '01_AUTO_TEST.wav', name: '自动测试轨（推荐）', desc: '同步咔嗒 + 左/右/双声道粉红噪声 + 延时 Chirp + 极性脉冲，约 34 秒；录下来即可自动分析', L, R };
    }
    if (id === 'phase') {
      const [L, R] = mk(LEAD + PHASE_LEN + 1);
      const T0 = S(LEAD), click = clickTemplate(SR);
      [...SYNC, PHASE_MARK].forEach((t) => { addAt(L, click, T0 + S(t), 0.9); addAt(R, click, T0 + S(t), 0.9); });
      PHASE_PAIRS.forEach((pp, k) => {
        const sig = bandPink(S(PH_SEG), pp.band, 31 + k);
        const a = T0 + S(pp.start), b = T0 + S(pp.start + PH_SEG + PH_GAP);
        for (let i = 0; i < sig.length; i++) { L[a + i] += sig[i]; R[a + i] += sig[i]; L[b + i] += sig[i]; R[b + i] -= sig[i]; }
      });
      return { file: '09_PHASE_TEST.wav', name: '相位测试轨', desc: '同步咔嗒 + 4 组「同相 8 秒 / 右反相 8 秒」（全频、40–200 Hz、80 Hz 区、3.5 kHz 区），约 85 秒', L, R };
    }
    if (id === 'polExt') {
      const [L, R] = mk(LEAD + POLX_LEN + 1);
      const T0 = S(LEAD), click = clickTemplate(SR), ch = chirpTemplate(SR), pu = pulseTemplate(SR);
      [...SYNC, POL_MARK].forEach((t) => { addAt(L, click, T0 + S(t), 0.9); addAt(R, click, T0 + S(t), 0.9); });
      ['L', 'R'].forEach((s) => { const o = s === 'L' ? L : R; addAt(o, ch, T0 + S(POLX[s].chirp), 0.7); for (let k = 0; k < POLX_N; k++) addAt(o, pu, T0 + S(POLX[s].p0 + k * 0.5), 0.9); });
      return { file: '10_POLARITY_EXT.wav', name: '单元极性外录轨', desc: '同步咔嗒 + 左 8 个、右 8 个正极性脉冲；DSP 里只开一个单元来录，逐个测极性', L, R };
    }
    if (id === 'pink') { const [L, R] = mk(60); pinkInto(L, 0, L.length, 0.9, 21); pinkInto(R, 0, R.length, 0.9, 21); return { file: '02_PINK_STEREO_60S.wav', name: '粉红噪声 立体声 60 秒', desc: 'RTA / EQ 观察', L, R }; }
    if (id === 'pinkL') { const [L, R] = mk(30); pinkInto(L, 0, L.length, 0.9, 22); return { file: '03_PINK_LEFT_30S.wav', name: '粉红噪声 仅左 30 秒', desc: '左侧电平 / 频响', L, R }; }
    if (id === 'pinkR') { const [L, R] = mk(30); pinkInto(R, 0, R.length, 0.9, 23); return { file: '04_PINK_RIGHT_30S.wav', name: '粉红噪声 仅右 30 秒', desc: '右侧电平 / 频响', L, R }; }
    if (id === 'sweep') {
      const [L, R] = mk(21), n = S(20), f0 = 20, f1 = 20000, ln = Math.log(f1 / f0);
      for (let i = 0; i < n; i++) { const t = i / SR; const v = Math.sin(2 * Math.PI * f0 * 20 / ln * (Math.exp(t / 20 * ln) - 1)) * 0.5 * Math.min(1, t / 0.05, (20 - t) / 0.05); L[i + S(0.5)] = v; R[i + S(0.5)] = v; }
      return { file: '05_SWEEP_20-20K.wav', name: '对数扫频 20 Hz–20 kHz', desc: '听共振、异响', L, R };
    }
    if (id === 'tone') { const [L, R] = mk(30); for (let i = 0; i < L.length; i++) { const v = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.25 * Math.min(1, i / 2205, (L.length - i) / 2205); L[i] = v; R[i] = v; } return { file: '06_1KHZ_-12DB_30S.wav', name: '1 kHz −12 dBFS 30 秒', desc: '增益 / 电平校对', L, R }; }
    if (id === 'polL' || id === 'polR') {
      const [L, R] = mk(10), pu = pulseTemplate(SR), tgt = id === 'polL' ? L : R;
      for (let k = 0; k < 18; k++) addAt(tgt, pu, S(0.5 + k * 0.5), 0.9);
      return { file: id === 'polL' ? '07_POLARITY_LEFT.wav' : '08_POLARITY_RIGHT.wav', name: '极性脉冲 ' + (id === 'polL' ? '左' : '右'), desc: '配合「极性检测」听感/外录', L, R };
    }
    throw new Error('unknown track ' + id);
  }
  const TRACK_IDS = ['auto', 'phase', 'polExt', 'pink', 'pinkL', 'pinkR', 'sweep', 'tone', 'polL', 'polR'];

  // ---------- WAV / ZIP ----------
  function wavBytes(L, R, sr = SR) {
    const n = L.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 4, true);
    const q = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
    for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, q(L[i]), true); v.setInt16(46 + i * 4, q(R[i]), true); }
    return new Uint8Array(buf);
  }
  let CRC = null;
  function crc32(u8) {
    if (!CRC) { CRC = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[i] = c >>> 0; } }
    let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
  }
  /** 无压缩 ZIP（store），文件名纯 ASCII 以兼容车机 */
  function zipBytes(entries) {
    const parts = [], central = []; let off = 0;
    const enc = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0x7f);
    entries.forEach(({ name, data }) => {
      const nm = enc(name), crc = crc32(data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + data.length;
    });
    const csize = central.reduce((a, p) => a + p.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return [...parts, ...central, new Uint8Array(e.buffer)];
  }

  // ---------- 录音识别 ----------
  function bandEnv(x, sr) {
    // 3 kHz 带通（RBJ, Q≈4）→ 整流 → 1 ms 平滑
    const f = 3000, Q = 4, w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * Q), a0 = 1 + al;
    const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
    const env = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0, e = 0; const k = 1 / (0.001 * sr);
    for (let i = 0; i < x.length; i++) { const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; e += (Math.abs(y) - e) * k; env[i] = e; }
    return env;
  }
  function xcorrPeak(x, tpl, center, maxLag) {
    let best = 0, bl = 0;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const o = center + lag; if (o < 0 || o + tpl.length > x.length) continue;
      let s = 0; for (let i = 0; i < tpl.length; i++) s += x[o + i] * tpl[i];
      if (Math.abs(s) > Math.abs(best)) { best = s; bl = lag; }
    }
    return { lag: bl, val: best };
  }
  /** 在单声道录音中寻找 3 个间隔 0.5 s 的同步咔嗒；返回 T0 样本位置或 null */
  function detect(x, sr) {
    const lim = Math.min(x.length, Math.round(sr * 90));
    const env = bandEnv(x.subarray(0, lim), sr);
    // 噪底：中位数
    const step = Math.max(1, Math.floor(lim / 20000)), samp = [];
    for (let i = 0; i < lim; i += step) samp.push(env[i]);
    samp.sort((a, b) => a - b);
    const floor = samp[Math.floor(samp.length * 0.5)] + 1e-9;
    const peaks = []; const gap = Math.round(0.1 * sr);
    for (let i = 1; i < lim - 1; i++) {
      if (env[i] > floor * 8 && env[i] >= env[i - 1] && env[i] > env[i + 1]) {
        if (peaks.length && i - peaks[peaks.length - 1].i < gap) { if (env[i] > peaks[peaks.length - 1].v) peaks[peaks.length - 1] = { i, v: env[i] }; }
        else peaks.push({ i, v: env[i] });
      }
    }
    const half = 0.5 * sr, tol = 0.012 * sr;
    for (let a = 0; a < peaks.length; a++) {
      for (let b = a + 1; b < peaks.length && peaks[b].i - peaks[a].i < half + tol; b++) {
        if (Math.abs(peaks[b].i - peaks[a].i - half) > tol) continue;
        for (let c = b + 1; c < peaks.length && peaks[c].i - peaks[a].i < 2 * half + tol; c++) {
          if (Math.abs(peaks[c].i - peaks[b].i - half) > tol) continue;
          // 精确对齐：与咔嗒模板互相关
          const tpl = clickTemplate(sr);
          const est = Math.round((peaks[a].i + peaks[b].i - half + peaks[c].i - 2 * half) / 3 - tpl.length * 0.6);
          const r = xcorrPeak(x, tpl, est, Math.round(0.004 * sr));
          const t0 = est + r.lag;
          const near = (sec) => peaks.some((p) => Math.abs(p.i - peaks[a].i - sec * sr) <= tol);
          const type = near(PHASE_MARK) ? 'phase' : near(POL_MARK) ? 'polExt' : 'auto';
          const len = type === 'phase' ? PHASE_LEN - 1.5 : type === 'polExt' ? POLX_LEN - 0.5 : AUTO_LEN - 1.2;
          return { t0, type, complete: t0 + Math.round(len * sr) <= x.length, snr: peaks[a].v / floor };
        }
      }
    }
    return null;
  }
  const dB = (v) => (v > 1e-12 ? 20 * Math.log10(v) : -240);
  function rms(x, a, b) { let s = 0; a = Math.max(0, a); b = Math.min(x.length, b); for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }

  /** 按音轨时间表分析：左右电平、L/R 时间差、左右极性 */
  function analyzeTrack(x, sr, det) {
    const T = (sec) => det.t0 + Math.round(sec * sr);
    const trim = 0.3; // 去掉段首尾
    const lv = {};
    ['L', 'R', 'B'].forEach((k) => { lv[k] = dB(rms(x, T(SEG[k][0] + trim), T(SEG[k][1] - trim))); });
    const noise = dB(rms(x, T(1.2), T(1.9)));
    const ch = chirpTemplate(sr), maxLag = Math.round(0.03 * sr);
    const arr = { L: [], R: [] }, chirpQ = [];
    CHIRPS.forEach(([s, t]) => { const r = xcorrPeak(x, ch, T(t), maxLag); arr[s].push(r.lag / sr * 1000); chirpQ.push(Math.abs(r.val)); });
    const mean = (a) => a.reduce((p, v) => p + v, 0) / (a.length || 1);
    const dL = mean(arr.L), dR = mean(arr.R);
    const pu = pulseTemplate(sr), pol = { L: [], R: [] };
    PULSES.forEach(([s, t]) => {
      // 用到达时间对齐（同侧 chirp 估计）后，在 ±3 ms 内找最大绝对值互相关的符号
      const center = T(t) + Math.round((s === 'L' ? dL : dR) / 1000 * sr);
      const r = xcorrPeak(x, pu, center, Math.round(0.003 * sr));
      pol[s].push(Math.sign(r.val));
    });
    const sgn = (a) => (a.reduce((p, v) => p + v, 0) >= 0 ? 1 : -1);
    const polL = sgn(pol.L), polR = sgn(pol.R);
    const spread = Math.max(...arr.L, ...arr.R) - Math.min(...arr.L, ...arr.R);
    const delayMs = dR - dL;
    return {
      t0Sec: det.t0 / sr, levels: { L: +lv.L.toFixed(1), R: +lv.R.toFixed(1), B: +lv.B.toFixed(1), noise: +noise.toFixed(1) },
      snrDb: +(lv.B - noise).toFixed(1), lrDiffDb: +(lv.L - lv.R).toFixed(2),
      arrivalMs: { L: arr.L.map((v) => +v.toFixed(3)), R: arr.R.map((v) => +v.toFixed(3)) },
      delayMs: +delayMs.toFixed(3), delayCm: +(delayMs / 1000 * 34300).toFixed(1), delayConsistent: spread < 1.5 + Math.abs(delayMs),
      polarity: { L: polL > 0 ? '正' : '反', R: polR > 0 ? '正' : '反', mismatch: polL !== polR },
      segments: { L: [T(SEG.L[0] + trim), T(SEG.L[1] - trim)], R: [T(SEG.R[0] + trim), T(SEG.R[1] - trim)], B: [T(SEG.B[0] + trim), T(SEG.B[1] - trim)] },
    };
  }

  /** 相位测试轨：每组比较同相段与反相段的倍频程电平。同相应更响（尤其低频）；反相段更响 = 相位相反 */
  function analyzePhase(x, sr, det) {
    const T = (sec) => det.t0 + Math.round(sec * sr);
    const noise = dB(rms(x, T(2.2), T(2.9)));
    const pairs = PHASE_PAIRS.map((pp) => {
      const A = x.subarray(T(pp.start + 0.5), T(pp.start + PH_SEG - 0.5));
      const B = x.subarray(T(pp.start + PH_SEG + PH_GAP + 0.5), T(pp.start + 2 * PH_SEG + PH_GAP - 0.5));
      const oct = OCT.filter((f) => f < sr / 2.3 && (!pp.band || (f >= pp.band[0] * 0.7 && f <= pp.band[1] * 1.4))).map((f) => {
        const lin = (s) => { const y = biquad(biquad(s, 'bp', f, 1.41, sr), 'bp', f, 1.41, sr); return dB(rms(y, Math.floor(0.1 * sr), y.length)); };
        const a = lin(A), b = lin(B);
        return { f, inDb: +a.toFixed(1), invDb: +b.toFixed(1), diffDb: +(a - b).toFixed(1), valid: a - noise > 6 || b - noise > 6 };
      });
      const use = oct.filter((o) => o.valid && (pp.band || o.f <= 250));
      const d = use.length ? use.reduce((s, o) => s + o.diffDb, 0) / use.length : 0;
      const verdict = !use.length ? '信号太弱' : d >= 1.5 ? '同相（正常）' : d <= -1.5 ? '相位相反' : '差异不明显';
      return { id: pp.id, name: pp.name, diffDb: +d.toFixed(1), inDb: +dB(rms(A, 0, A.length)).toFixed(1), invDb: +dB(rms(B, 0, B.length)).toFixed(1), verdict, octaves: oct };
    });
    return { type: 'phase', t0Sec: det.t0 / sr, noiseDb: +noise.toFixed(1), pairs, anyInverted: pairs.some((p) => p.verdict === '相位相反') };
  }
  /** 单元极性外录轨：左右各 8 个脉冲，取互相关符号多数表决 */
  function analyzePolExt(x, sr, det) {
    const T = (sec) => det.t0 + Math.round(sec * sr);
    const noise = dB(rms(x, T(2.0), T(2.4)));
    const ch = chirpTemplate(sr), pu = pulseTemplate(sr), out = {};
    ['L', 'R'].forEach((s) => {
      const c = xcorrPeak(x, ch, T(POLX[s].chirp), Math.round(0.03 * sr));
      const lv = dB(rms(x, T(POLX[s].p0 - 0.05), T(POLX[s].p0 + POLX_N * 0.5)));
      const chirpOk = Math.abs(c.val) > 1e-6 && dB(rms(x, T(POLX[s].chirp), T(POLX[s].chirp + 0.15))) - noise > 10;
      const lag = chirpOk ? c.lag : 0, win = Math.round((chirpOk ? 0.003 : 0.012) * sr);
      let pos = 0, neg = 0;
      for (let k = 0; k < POLX_N; k++) {
        // 低通后的振膜位移：取窗口内绝对值最大处的符号（对超低音也有效）
        const c0 = T(POLX[s].p0 + k * 0.5) + lag;
        const r = xcorrPeak(x, pu, c0, win);
        if (r.val > 0) pos++; else if (r.val < 0) neg++;
      }
      const present = lv - noise > 8;
      out[s] = { present, levelDb: +lv.toFixed(1), pos, neg, polarity: !present ? '无声' : pos >= 6 ? '正' : neg >= 6 ? '反' : '不确定', arrivalMs: chirpOk ? +(c.lag / sr * 1000).toFixed(2) : null };
    });
    return { type: 'polExt', t0Sec: det.t0 / sr, noiseDb: +noise.toFixed(1), L: out.L, R: out.R };
  }

  // ---------- 浏览器 UI ----------
  /** 电脑/本机直接播放（不申请麦克风，蓝牙保持 A2DP 媒体模式），并按时间表显示大字提示 */
  function cues(id) {
    const L0 = LEAD;
    if (id === 'auto') return [[0, '准备…（录音手机请先开始录音）'], [L0, '同步咔嗒 ×3'], [L0 + 2, '现在放：左声道 粉红噪声'], [L0 + 9, '现在放：右声道 粉红噪声'], [L0 + 16, '现在放：左右同时 粉红噪声'], [L0 + 23, '延时测试：左 / 右 Chirp'], [L0 + 27.3, '极性脉冲：左 / 右'], [L0 + 31.5, '完成 ✓ 可以停止录音']];
    if (id === 'phase') { const c = [[0, '准备…（录音手机请先开始录音，录 90 秒）'], [L0, '同步咔嗒 ×4']]; PHASE_PAIRS.forEach((p) => { c.push([L0 + p.start, `${p.name}：左右 同相`]); c.push([L0 + p.start + PH_SEG, '（静音）']); c.push([L0 + p.start + PH_SEG + PH_GAP, `${p.name}：右声道 反相`]); c.push([L0 + p.start + 2 * PH_SEG + PH_GAP, '（静音）']); }); c.push([L0 + PHASE_LEN - 0.5, '完成 ✓ 可以停止录音']); return c; }
    if (id === 'polExt') return [[0, '准备…（DSP 只开一个单元）'], [L0, '同步咔嗒 ×4'], [L0 + POLX.L.chirp, '现在放：左声道 极性脉冲'], [L0 + POLX.R.chirp, '现在放：右声道 极性脉冲'], [L0 + POLX_LEN, '完成 ✓']];
    const nm = { pink: '左右同时 粉红噪声', pinkL: '现在放：左声道 粉红噪声', pinkR: '现在放：右声道 粉红噪声', sweep: '扫频 20 Hz → 20 kHz', tone: '1 kHz 校准音', polL: '左声道 极性脉冲', polR: '右声道 极性脉冲' }[id];
    return [[0, nm]];
  }
  let player = null;
  function stopPlay() {
    if (!player) return;
    try { player.src.onended = null; player.src.stop(); } catch (_) {}
    cancelAnimationFrame(player.raf); player = null;
    const ov = document.getElementById('ttPlayer'); if (ov) ov.hidden = true;
  }
  async function play(id) {
    stopPlay();
    const t = buildTrack(id);
    await AudioEngine.resume(true);
    const ctx = AudioEngine.getCtx();
    const buf = ctx.createBuffer(2, t.L.length, SR); buf.copyToChannel(t.L, 0); buf.copyToChannel(t.R, 1);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    const ov = document.getElementById('ttPlayer'), cue = document.getElementById('ttCue'), bar = document.getElementById('ttProg'), nm = document.getElementById('ttNow');
    nm.textContent = t.file; ov.hidden = false;
    const cs = cues(id), dur = buf.duration, t0 = ctx.currentTime + 0.1;
    src.start(t0);
    player = { src, raf: 0 };
    const tick = () => {
      if (!player) return;
      const el = Math.max(0, ctx.currentTime - t0);
      let c = cs[0][1]; for (const [at, s] of cs) if (el >= at) c = s;
      cue.textContent = c; bar.style.width = Math.min(100, el / dur * 100) + '%';
      document.getElementById('ttTime').textContent = `${el.toFixed(0)} / ${dur.toFixed(0)} 秒`;
      player.raf = requestAnimationFrame(tick);
    };
    tick();
    src.onended = () => { cue.textContent = '完成 ✓'; setTimeout(stopPlay, 1500); };
  }

  function dl(parts, name, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(parts, { type: mime }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const wait = () => new Promise((r) => setTimeout(r, 0));
  function init() {
    const list = document.getElementById('ttList');
    if (!list) return;
    const meta = TRACK_IDS.map((id) => ({ id, ...({ auto: ['01_AUTO_TEST.wav', '自动测试轨（推荐）', '约 34 秒：同步咔嗒 + 左/右/双声道粉红噪声 + 延时 Chirp + 极性脉冲'], phase: ['09_PHASE_TEST.wav', '相位测试轨', '约 85 秒：同相 / 右反相 对比 ×4（全频、低频、80 Hz 区、3.5 kHz 区），录 90 秒'], polExt: ['10_POLARITY_EXT.wav', '单元极性外录轨', '约 14 秒：DSP 只开一个单元，逐个录，测极性'], pink: ['02_PINK_STEREO_60S.wav', '粉红噪声 立体声 60 秒', 'RTA / EQ'], pinkL: ['03_PINK_LEFT_30S.wav', '粉红噪声 仅左', '左侧电平'], pinkR: ['04_PINK_RIGHT_30S.wav', '粉红噪声 仅右', '右侧电平'], sweep: ['05_SWEEP_20-20K.wav', '对数扫频 20–20k', '听共振异响'], tone: ['06_1KHZ_-12DB_30S.wav', '1 kHz −12 dBFS', '增益校对'], polL: ['07_POLARITY_LEFT.wav', '极性脉冲 左', '极性听感'], polR: ['08_POLARITY_RIGHT.wav', '极性脉冲 右', '极性听感'] }[id]) }));
    list.innerHTML = meta.map((m) => `<li><div><b>${m[1]}</b><small>${m[0]} · ${m[2]}</small></div><span class="tt-btns"><button type="button" class="btn btn-accent btn-sm" data-ttplay="${m.id}">▶ 播放</button><button type="button" class="btn btn-ghost btn-sm" data-tt="${m.id}">下载 WAV</button></span></li>`).join('');
    list.querySelectorAll('[data-tt]').forEach((b) => {
      b.onclick = async () => { b.disabled = true; b.textContent = '生成中…'; await wait(); const t = buildTrack(b.dataset.tt); dl([wavBytes(t.L, t.R)], t.file, 'audio/wav'); b.disabled = false; b.textContent = '下载 WAV'; };
    });
    list.querySelectorAll('[data-ttplay]').forEach((b) => { b.onclick = () => play(b.dataset.ttplay); });
    const sb = document.getElementById('ttStop'); if (sb) sb.onclick = stopPlay;
    const zb = document.getElementById('ttZip');
    zb.onclick = async () => {
      zb.disabled = true; const st = document.getElementById('ttStatus'); const entries = [];
      for (let k = 0; k < TRACK_IDS.length; k++) { st.textContent = `生成 ${k + 1}/${TRACK_IDS.length}…`; await wait(); const t = buildTrack(TRACK_IDS[k]); entries.push({ name: 'CAR_TUNE/' + t.file, data: wavBytes(t.L, t.R) }); }
      entries.push({ name: 'CAR_TUNE/README.txt', data: Uint8Array.from('Car audio tuner test tracks. WAV 44.1kHz 16-bit stereo. Play 01_AUTO_TEST.wav from USB while the phone app records (Recording Analysis, 45s).\r\n', (c) => c.charCodeAt(0)) });
      dl(zipBytes(entries), 'CAR_TUNE_TRACKS.zip', 'application/zip');
      st.textContent = '已生成 ZIP（约 60 MB）。解压后把 CAR_TUNE 文件夹复制到 U 盘。'; zb.disabled = false;
    };
    document.querySelectorAll('#ttRecord,[data-ttrec]').forEach((b) => {
      b.onclick = () => {
        App.switchTab('analyze');
        document.getElementById('anRecSec').value = b.dataset.ttrec || b.dataset.sec || '45';
        if (!b.dataset.keepch) document.getElementById('anChan').value = '';
        setTimeout(() => document.getElementById('anRec').click(), 50);
      };
    });
  }

  return { SR, SEG, CHIRPS, PULSES, PHASE_PAIRS, TRACK_IDS, buildTrack, wavBytes, zipBytes, crc32, detect, analyzeTrack, analyzePhase, analyzePolExt, play, stopPlay, init };
})();
if (typeof module !== 'undefined') module.exports = TestTrack;
