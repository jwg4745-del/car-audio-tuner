/** 录音分析：上传/录制音频 → 离线自动分析 */
const Analyzer = (() => {
  const MAX_SEC = 300;
  const NFFT = 8192;
  let report = null;
  let cache = null; // { wave, freqs, specDb, bands }
  let recorder = null;

  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const db = (x) => (x > 1e-12 ? 20 * Math.log10(x) : -240);
  const pdb = (p) => (p > 1e-24 ? 10 * Math.log10(p) : -240);

  function progress(pct, msg) {
    el('anProgress').style.width = Math.round(pct) + '%';
    el('anStatus').textContent = msg;
  }

  function init() {
    const input = el('anFile');
    input.onchange = (e) => { const f = e.target.files[0]; if (f) analyzeFile(f); e.target.value = ''; };
    const drop = el('anDrop');
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) analyzeFile(f); });
    el('anRec').onclick = record;
    el('anTarget').onchange = () => { if (cache) runFromCache(); };
    el('anExportJson').onclick = () => report && dl(JSON.stringify(report, null, 2), 'json', 'application/json');
    el('anExportTxt').onclick = () => report && dl(toText(report), 'txt', 'text/plain');
    el('anExportCsv').onclick = () => report && dl(toCsv(report), 'csv', 'text/csv');
  }

  function dl(text, ext, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: mime + ';charset=utf-8' }));
    a.download = 'recording-analysis-' + Date.now() + '.' + ext;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function record() {
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    if (!window.MediaRecorder) { alert('此浏览器不支持录音（MediaRecorder），请改用上传文件。'); return; }
    let stream;
    AudioEngine.stopAll();
    AudioEngine.releaseMic({ noReset: true });
    AudioEngine.setExternalMic(true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { AudioEngine.setExternalMic(false); alert('无法使用麦克风：' + e.message + '\n需要 HTTPS 并允许麦克风权限。'); return; }
    const secs = Math.max(2, Math.min(120, +el('anRecSec').value || 10));
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    if (typeof App !== 'undefined') App.setMicUI(true);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      AudioEngine.setExternalMic(false);
      if (typeof App !== 'undefined') App.setMicUI(false);
      await AudioEngine.resetOutput('mic');
      el('anRec').textContent = '🎙 录制并分析';
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      analyzeFile(blob, '麦克风录音 ' + secs + 's');
    };
    recorder.start();
    el('anRec').textContent = '■ 停止录音';
    let left = secs;
    progress(0, '录音中… ' + left + ' 秒');
    const iv = setInterval(() => {
      left--;
      if (recorder.state !== 'recording') { clearInterval(iv); return; }
      if (left <= 0) { clearInterval(iv); recorder.stop(); } else progress((1 - left / secs) * 100, '录音中… ' + left + ' 秒');
    }, 1000);
  }

  async function decode(arrayBuf) {
    const ctx = AudioEngine.getCtx();
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(arrayBuf, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  }

  async function analyzeFile(file, label) {
    el('anResults').hidden = true;
    try {
      progress(3, '读取文件…');
      const buf = await file.arrayBuffer();
      progress(8, '解码音频…');
      let audio;
      try { audio = await decode(buf); } catch (e) {
        progress(0, '解码失败');
        alert('无法解码此音频文件（格式不受当前浏览器支持或文件损坏）。\n建议使用 WAV / MP3 / M4A。\n' + (e && e.message ? e.message : ''));
        return;
      }
      await analyzeBuffer(audio, label || file.name || '录音');
    } catch (e) {
      console.error(e);
      progress(0, '分析出错：' + e.message);
    }
  }

  // ---------- DSP ----------
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  function chStats(x) {
    let peak = 0, ss = 0, clip = 0;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
      ss += x[i] * x[i];
      if (a >= 0.999) clip++;
    }
    const rms = Math.sqrt(ss / x.length);
    return { peakDb: db(peak), rmsDb: db(rms), crestDb: db(peak) - db(rms), clipSamples: clip };
  }

  async function welch(mono, sr) {
    const win = new Float32Array(NFFT);
    let wsum = 0;
    for (let i = 0; i < NFFT; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (NFFT - 1)); wsum += win[i] * win[i]; }
    const total = Math.max(1, Math.floor((mono.length - NFFT) / (NFFT / 2)) + 1);
    const maxFrames = 1200;
    const stride = Math.max(1, Math.ceil(total / maxFrames));
    const acc = new Float64Array(NFFT / 2);
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
    let frames = 0;
    for (let f = 0; f < total; f += stride) {
      const off = f * NFFT / 2;
      for (let i = 0; i < NFFT; i++) { re[i] = (mono[off + i] || 0) * win[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < NFFT / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
      if (frames % 40 === 0) { progress(20 + 55 * f / total, '频谱分析… ' + Math.round(100 * f / total) + '%'); await tick(); }
    }
    const spec = new Float64Array(NFFT / 2);
    for (let k = 0; k < NFFT / 2; k++) spec[k] = acc[k] / frames / wsum;
    const freqs = Array.from({ length: NFFT / 2 }, (_, k) => k * sr / NFFT);
    return { spec, freqs };
  }

  function thirdOct(spec, freqs) {
    const bands = [];
    for (let i = -17; i <= 13; i++) {
      const fc = 1000 * Math.pow(2, i / 3);
      if (fc < 20 || fc > 20000) continue;
      const lo = fc / Math.pow(2, 1 / 6), hi = fc * Math.pow(2, 1 / 6);
      let s = 0, n = 0;
      for (let k = 1; k < freqs.length; k++) if (freqs[k] >= lo && freqs[k] < hi) { s += spec[k]; n++; }
      if (n) bands.push({ fc, level: pdb(s / n) + (typeof Cal !== 'undefined' ? Cal.corr(fc) : 0) });
    }
    return bands;
  }

  function bandMean(bands, lo, hi) {
    const b = bands.filter((x) => x.fc >= lo && x.fc <= hi);
    return b.length ? b.reduce((a, x) => a + x.level, 0) / b.length : NaN;
  }

  function stereo(L, R, sr) {
    // correlation at zero lag (strided)
    const step = Math.max(1, Math.floor(L.length / 2e6));
    let sl = 0, sr2 = 0, slr = 0;
    for (let i = 0; i < L.length; i += step) { sl += L[i] * L[i]; sr2 += R[i] * R[i]; slr += L[i] * R[i]; }
    const corr = slr / Math.sqrt(sl * sr2 || 1);
    // loudest 1s window for delay
    const W = Math.min(L.length, sr);
    let best = 0, bestE = -1;
    for (let o = 0; o + W <= L.length; o += Math.floor(sr / 2)) {
      let e = 0;
      for (let i = o; i < o + W; i += 16) e += L[i] * L[i] + R[i] * R[i];
      if (e > bestE) { bestE = e; best = o; }
    }
    const maxLag = Math.floor(sr * 0.01);
    let bLag = 0, bVal = 0;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = best + maxLag; i < best + W - maxLag; i++) s += L[i] * R[i + lag];
      if (Math.abs(s) > Math.abs(bVal)) { bVal = s; bLag = lag; }
    }
    let el2 = 0, er = 0;
    for (let i = best + maxLag; i < best + W - maxLag; i++) { el2 += L[i] * L[i]; er += R[i] * R[i]; }
    const peakCorr = bVal / Math.sqrt(el2 * er || 1);
    const ms = bLag / sr * 1000;
    return { correlation: corr, peakCorrelation: peakCorr, delayMs: ms, delayCm: ms / 1000 * 343 * 100 };
  }

  // ---------- main ----------
  async function analyzeBuffer(audio, label) {
    const sr = audio.sampleRate;
    const nCh = audio.numberOfChannels;
    const truncated = audio.duration > MAX_SEC;
    const n = Math.min(audio.length, Math.floor(MAX_SEC * sr));
    const chans = [];
    for (let c = 0; c < Math.min(nCh, 2); c++) chans.push(audio.getChannelData(c).subarray(0, n));
    progress(12, '计算电平…');
    await tick();
    const stats = chans.map(chStats);
    const mono = new Float32Array(n);
    for (let c = 0; c < chans.length; c++) for (let i = 0; i < n; i++) mono[i] += chans[c][i] / chans.length;
    const all = chStats(mono);
    // waveform overview (1000 min/max points)
    const P = 1000, wave = new Float32Array(P * 2), per = Math.max(1, Math.floor(n / P));
    for (let p = 0; p < P; p++) {
      let mn = 0, mx = 0;
      for (let i = p * per; i < Math.min(n, (p + 1) * per); i++) { const v = mono[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      wave[2 * p] = mn; wave[2 * p + 1] = mx;
    }
    progress(18, '频谱分析…');
    // 外录：识别测试轨同步咔嗒 → 按时间表分析
    let track = null;
    if (typeof TestTrack !== 'undefined') {
      progress(15, '识别测试轨…'); await tick();
      try { const det = TestTrack.detect(mono, sr); if (det && det.complete) { progress(30, det.type === 'phase' ? '分析相位测试轨…' : '分析测试轨…'); await tick(); track = det.type === 'phase' ? TestTrack.analyzePhase(mono, sr, det) : det.type === 'polExt' ? TestTrack.analyzePolExt(mono, sr, det) : { type: 'auto', ...TestTrack.analyzeTrack(mono, sr, det) }; } else if (det) track = { incomplete: true, type: det.type, t0Sec: det.t0 / sr }; } catch (e) { console.warn(e); }
    }
    const specSrc = track && track.segments ? mono.subarray(track.segments.B[0], track.segments.B[1]) : mono;
    const { spec, freqs } = await welch(specSrc, sr);
    let st = null;
    if (track && track.segments) {
      st = { source: 'track', lrDiffDb: track.lrDiffDb, correlation: track.polarity.mismatch ? -1 : 1, peakCorrelation: track.polarity.mismatch ? -0.8 : 0.9, delayMs: track.delayMs, delayCm: track.delayCm };
    } else if (chans.length === 2) { progress(80, '立体声分析…'); await tick(); st = stereo(chans[0], chans[1], sr); }
    cache = {
      label, sr, nCh, duration: audio.duration, analyzedSec: n / sr, truncated,
      stats, all, wave, spec, freqs, stereo: st, track,
    };
    runFromCache();
    progress(100, '分析完成');
  }

  function runFromCache() {
    const c = cache;
    const curve = el('anTarget').value;
    const T = (f) => (curve === 'none' ? 0 : (RTA.targetDb(f, curve) || 0));
    const bands = thirdOct(c.spec, c.freqs);
    // normalize: align 250 Hz–2 kHz mean to target
    const mid = bands.filter((b) => b.fc >= 250 && b.fc <= 2000);
    const offset = mid.reduce((a, b) => a + b.level - T(b.fc), 0) / (mid.length || 1);
    bands.forEach((b) => { b.rel = b.level - offset; b.target = T(b.fc); b.dev = b.rel - b.target; });
    const usable = bands.filter((b) => b.fc >= 31 && b.fc <= Math.min(16000, c.sr / 2 * 0.9));

    const problems = [];
    usable.forEach((b) => {
      if (b.dev > 4) problems.push({ type: '峰', freq: b.fc, dB: +b.dev.toFixed(1), text: `${fmtF(b.fc)} 比目标高 ${b.dev.toFixed(1)} dB` });
      if (b.dev < -4) problems.push({ type: '谷', freq: b.fc, dB: +b.dev.toFixed(1), text: `${fmtF(b.fc)} 比目标低 ${(-b.dev).toFixed(1)} dB` });
    });
    // resonance: fine spectrum vs 1/3-oct smoothing
    const res = [];
    for (let k = 2; k < c.freqs.length - 2; k++) {
      const f = c.freqs[k];
      if (f < 40 || f > 5000) continue;
      const v = pdb(c.spec[k]);
      if (v < pdb(c.spec[k - 1]) || v < pdb(c.spec[k + 1])) continue;
      const lo = f / Math.pow(2, 1 / 6), hi = f * Math.pow(2, 1 / 6);
      let s = 0, m = 0;
      for (let j = Math.max(1, Math.floor(lo * NFFT / c.sr)); j <= Math.ceil(hi * NFFT / c.sr); j++) { s += c.spec[j]; m++; }
      const excess = v - pdb(s / m);
      if (excess > 6) res.push({ freq: f, excess });
    }
    res.sort((a, b) => b.excess - a.excess);
    const resonances = [];
    res.forEach((r) => { if (resonances.length < 5 && resonances.every((x) => Math.abs(Math.log2(x.freq / r.freq)) > 0.25)) resonances.push(r); });
    resonances.forEach((r) => problems.push({ type: '共振', freq: Math.round(r.freq), dB: +r.excess.toFixed(1), text: `${fmtF(r.freq)} 附近有窄带共振尖峰（+${r.excess.toFixed(1)} dB）` }));

    const relMean = (lo, hi) => {
      const b = usable.filter((x) => x.fc >= lo && x.fc <= hi);
      return b.length ? b.reduce((a, x) => a + x.dev, 0) / b.length : 0;
    };
    const balance = { bass: relMean(31, 250), mid: relMean(250, 4000), treble: relMean(4000, 16000) };
    const harsh = relMean(2000, 5000), sib = relMean(5000, 9000);
    // low-end rolloff: walk down from 100 Hz until band rel < ref - 6
    const ref = bandMean(bands.map((b) => ({ fc: b.fc, level: b.rel })), 250, 2000);
    let rolloff = null;
    bands.filter((b) => b.fc <= 125).reverse().some((b) => { if (b.rel < ref - 6) { rolloff = b.fc; return true; } return false; });

    // EQ suggestions
    const eq = [];
    const used = new Set();
    const cand = usable.map((b, i) => ({ i, b })).filter((x) => Math.abs(x.b.dev) > 2).sort((a, b) => Math.abs(b.b.dev) - Math.abs(a.b.dev));
    cand.forEach(({ i, b }) => {
      if (eq.length >= 8 || used.has(i)) return;
      const sign = Math.sign(b.dev);
      let lo = i, hi = i;
      while (lo - 1 >= 0 && !used.has(lo - 1) && Math.sign(usable[lo - 1].dev) === sign && Math.abs(usable[lo - 1].dev) > 1.5) lo--;
      while (hi + 1 < usable.length && !used.has(hi + 1) && Math.sign(usable[hi + 1].dev) === sign && Math.abs(usable[hi + 1].dev) > 1.5) hi++;
      let sum = 0;
      for (let j = lo; j <= hi; j++) { used.add(j); sum += usable[j].dev; }
      const width = hi - lo + 1;
      const fc = Math.sqrt(usable[lo].fc * usable[hi].fc);
      const gain = Math.max(-6, Math.min(6, -(sum / width)));
      eq.push({ freq: Math.round(fc), gain: +gain.toFixed(1), q: +(4.3 / width).toFixed(2) });
    });
    eq.sort((a, b) => a.freq - b.freq);

    const tips = [];
    if (c.all.clipSamples > 0) tips.push(`检测到 ${c.all.clipSamples} 个接近满幅的采样，录音可能削波；请降低音量或增益后重录。`);
    if (c.all.peakDb < -30) tips.push('录音电平偏低（峰值低于 -30 dBFS），分析结果信噪比较差，建议靠近声源或提高音量。');
    if (balance.bass > 3) tips.push('低音偏重：可降低超低音增益或在 60–150 Hz 做衰减。');
    if (balance.bass < -3) tips.push('低音不足：检查超低音相位/增益，或适度提升 40–100 Hz。');
    if (balance.treble > 3) tips.push('高音偏亮：可降低高音单元电平 1–3 dB。');
    if (balance.treble < -3) tips.push('高音偏暗：可提升高音单元电平或检查高音分频点。');
    if (harsh > 3) tips.push(`2–5 kHz 偏高 ${harsh.toFixed(1)} dB，可能刺耳，建议在此区域衰减。`);
    if (sib > 3) tips.push(`5–9 kHz 偏高 ${sib.toFixed(1)} dB，齿音可能明显。`);
    if (rolloff) tips.push(`低频约在 ${fmtF(rolloff)} 以下明显衰减（-6 dB 点估算）。`);
    if (c.stereo) {
      const d = c.stereo.source === 'track' ? c.stereo.lrDiffDb : c.stats[0].rmsDb - c.stats[1].rmsDb;
      c.stereo.lrDiffDb = d;
      if (Math.abs(d) > 1.5) tips.push(`左右电平相差 ${Math.abs(d).toFixed(1)} dB（${d > 0 ? '左' : '右'}声道偏大），可在 DSP 中平衡增益。`);
      if (c.stereo.source === 'track') {
        const p = c.track.polarity;
        if (p.mismatch) tips.push(`测试轨极性脉冲：左侧${p.L}、右侧${p.R}，左右极性不一致，「${p.L === '反' ? '左' : '右'}」侧可能接反（含该侧所有单元），建议在 DSP 反相或检查接线后复测。`);
        if (c.track.snrDb < 15) tips.push(`录音信噪比较低（${c.track.snrDb} dB），请关空调/发动机噪声或调高车机音量后重录。`);
      } else if (c.stereo.peakCorrelation < -0.3) tips.push('左右声道呈负相关，可能存在极性接反，请用「极性检测」确认。');
      if (Math.abs(c.stereo.delayMs) > 0.1 && Math.abs(c.stereo.peakCorrelation) > 0.3) tips.push(`估计左右时间差 ${c.stereo.delayMs.toFixed(2)} ms（约 ${Math.abs(c.stereo.delayCm).toFixed(1)} cm），${c.stereo.delayMs > 0 ? '右' : '左'}声道较晚。`);
    }
    if (c.track && c.track.incomplete) tips.push(c.track.type === 'phase' ? '识别到相位测试轨，但没录完整（需约 85 秒）。请录 90 秒。' : c.track.type === 'polExt' ? '识别到单元极性轨，但没录完整（需约 14 秒）。请录 20 秒。' : '识别到测试轨开头，但录音太短，没录完整（需约 34 秒）。请录 45 秒并从 01_AUTO_TEST 开头播放。');
    if (c.track && c.track.type === 'phase') c.track.pairs.forEach((p) => { if (p.verdict === '相位相反') tips.push(`相位测试「${p.name}」：右反相段比同相段还响 ${Math.abs(p.diffDb)} dB → 左右相位相反，建议在 DSP 把一侧（例如右侧相关单元）反相，复录确认同相段更响。`); else if (p.verdict === '差异不明显') tips.push(`相位测试「${p.name}」：同相/反相差异不明显（${p.diffDb} dB），可能存在约 90° 的相位差或时间差，建议先调好延时再复测。`); });
    if (c.track && c.track.type === 'polExt') ['L', 'R'].forEach((s) => { const v = c.track[s]; if (v.present && v.polarity === '反') tips.push(`${s === 'L' ? '左' : '右'}侧当前单元的极性脉冲多数为负（${v.neg}/8）→ 可能接反，建议反相。`); });
    if (!tips.length) tips.push('整体较均衡，未发现明显问题。');
    tips.push('以上结果基于未校准麦克风与录音设备，仅供调音参考。');

    report = {
      app: '汽车音响调音 · 录音分析', createdAt: new Date().toISOString(),
      channelId: el('anChan').value ? +el('anChan').value : null,
      channel: el('anChan').value ? Channels.label(el('anChan').value) : '整车 / 多通道',
      file: c.label, durationSec: +c.duration.toFixed(2), analyzedSec: +c.analyzedSec.toFixed(2), truncated: c.truncated,
      sampleRate: c.sr, channels: c.nCh, targetCurve: curve,
      levels: { peakDb: +c.all.peakDb.toFixed(1), rmsDb: +c.all.rmsDb.toFixed(1), crestDb: +c.all.crestDb.toFixed(1), clipSamples: c.all.clipSamples, perChannel: c.stats.map((s) => ({ peakDb: +s.peakDb.toFixed(1), rmsDb: +s.rmsDb.toFixed(1), clipSamples: s.clipSamples })) },
      bands: bands.map((b) => ({ fc: Math.round(b.fc), level: +b.rel.toFixed(1), target: +b.target.toFixed(1), dev: +b.dev.toFixed(1) })),
      balance: { bass: +balance.bass.toFixed(1), mid: +balance.mid.toFixed(1), treble: +balance.treble.toFixed(1), harsh2to5k: +harsh.toFixed(1), sibilance5to9k: +sib.toFixed(1), lowRolloffHz: rolloff ? Math.round(rolloff) : null },
      track: c.track || null,
      stereo: c.stereo ? { source: c.stereo.source || 'stereo-file', lrDiffDb: +c.stereo.lrDiffDb.toFixed(2), correlation: +c.stereo.correlation.toFixed(3), peakCorrelation: +c.stereo.peakCorrelation.toFixed(3), delayMs: +c.stereo.delayMs.toFixed(3), delayCm: +c.stereo.delayCm.toFixed(1) } : null,
      problems, eq, tips,
    };
    cache.bands = bands;
    render();
    if (typeof TunePlan !== 'undefined') TunePlan.onAnalysis(report);
  }

  function fmtF(f) { return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + ' kHz' : Math.round(f) + ' Hz'; }

  function render() {
    if (!report) return;
    const r = report;
    el('anResults').hidden = false;
    el('anInfo').innerHTML = [
      ['通道', esc(r.channel)], ['文件', esc(r.file)], ['时长', r.durationSec + ' 秒' + (r.truncated ? `（分析前 ${r.analyzedSec}s）` : '')],
      ['采样率', r.sampleRate + ' Hz'], ['声道', r.channels],
      ['峰值', r.levels.peakDb + ' dBFS'], ['RMS', r.levels.rmsDb + ' dBFS'],
      ['峰均比', r.levels.crestDb + ' dB'], ['削波采样', r.levels.clipSamples],
    ].map(([k, v]) => `<div class="readout"><span class="label">${k}</span><span class="value small">${v}</span></div>`).join('');
    const b = r.balance;
    el('anBalance').innerHTML = [['低音', b.bass], ['中音', b.mid], ['高音', b.treble], ['2–5k 刺耳', b.harsh2to5k], ['5–9k 齿音', b.sibilance5to9k]]
      .map(([k, v]) => `<div class="readout"><span class="label">${k}</span><span class="value small ${Math.abs(v) > 3 ? 'warnc' : ''}">${v > 0 ? '+' : ''}${v} dB</span></div>`).join('')
      + `<div class="readout"><span class="label">低频 -6dB 点</span><span class="value small">${b.lowRolloffHz ? b.lowRolloffHz + ' Hz' : '—'}</span></div>`;
    const s = r.stereo;
    const tk = r.track && r.track.segments ? r.track : null;
    const ph = r.track && r.track.type === 'phase' && r.track.pairs ? r.track : null;
    const px = r.track && r.track.type === 'polExt' && r.track.L ? r.track : null;
    el('anStereo').innerHTML = ph
      ? `<p class="hint okc">✓ 已识别相位测试轨（第 ${ph.t0Sec.toFixed(2)} 秒开始）· 同相段应比右反相段更响</p>`
        + ph.pairs.map((p) => `<div class="readout"><span class="label">${p.name}<br><small>同相 ${p.inDb} / 反相 ${p.invDb} dBFS · ${p.octaves.filter((o) => o.valid).map((o) => (o.f >= 1000 ? o.f / 1000 + 'k' : o.f) + ':' + (o.diffDb > 0 ? '+' : '') + o.diffDb).join(' ')}</small></span><span class="value small ${p.verdict === '相位相反' ? 'badc' : p.verdict.startsWith('同相') ? 'okc' : 'warnc'}">${p.verdict} (${p.diffDb > 0 ? '+' : ''}${p.diffDb} dB)</span></div>`).join('')
      : px
      ? `<p class="hint okc">✓ 已识别单元极性外录轨（第 ${px.t0Sec.toFixed(2)} 秒开始）</p>`
        + ['L', 'R'].map((s) => `<div class="readout"><span class="label">${s === 'L' ? '左' : '右'}声道单元</span><span class="value small ${px[s].polarity === '反' ? 'badc' : px[s].polarity === '正' ? 'okc' : ''}">${px[s].polarity}${px[s].present ? `（正 ${px[s].pos} / 负 ${px[s].neg}）` : ''}</span></div>`).join('')
      : tk
      ? `<p class="hint okc">✓ 已识别测试轨（第 ${tk.t0Sec.toFixed(2)} 秒开始）· 按音轨时间表分析 · 信噪比 ${tk.snrDb} dB</p>
         <div class="readout"><span class="label">左右电平差（左−右）</span><span class="value small">${tk.lrDiffDb} dB</span></div>
         <div class="readout"><span class="label">L/R 到达时间差</span><span class="value small">${tk.delayMs} ms / ${tk.delayCm} cm${tk.delayMs > 0 ? '（右晚）' : tk.delayMs < 0 ? '（左晚）' : ''}</span></div>
         <div class="readout"><span class="label">极性 左 / 右</span><span class="value small ${tk.polarity.mismatch ? 'badc' : 'okc'}">${tk.polarity.L} / ${tk.polarity.R}</span></div>`
      : s
      ? `<div class="readout"><span class="label">左右电平差</span><span class="value small">${s.lrDiffDb} dB</span></div>
         <div class="readout"><span class="label">相关度</span><span class="value small ${s.correlation < 0 ? 'badc' : 'okc'}">${s.correlation}</span></div>
         <div class="readout"><span class="label">L/R 时间差</span><span class="value small">${s.delayMs} ms / ${s.delayCm} cm</span></div>`
      : '<p class="hint">单声道录音，无立体声分析。播放「外录模式」的 01_AUTO_TEST 测试轨再录音，可自动测出左右电平差、时间差和极性。</p>';
    el('anProblems').innerHTML = r.problems.length ? r.problems.map((p) => `<li><span class="tag tag-${p.type === '谷' ? 'dip' : 'peak'}">${p.type}</span>${p.text}</li>`).join('') : '<li>未发现超过 ±4 dB 的偏差。</li>';
    el('anEq').innerHTML = r.eq.length ? r.eq.map((e, i) => `<tr><td>${i + 1}</td><td>${e.freq} Hz</td><td>${e.gain > 0 ? '+' : ''}${e.gain} dB</td><td>${e.q}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">无需 EQ 调整</td></tr>';
    el('anTips').innerHTML = r.tips.map((t) => `<li>${t}</li>`).join('');
    redraw();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function redraw() {
    if (!cache || !cache.bands) return;
    // waveform
    const cw = el('anWave'), g = cw.getContext('2d');
    g.fillStyle = '#0a0e14'; g.fillRect(0, 0, cw.width, cw.height);
    const mid = cw.height / 2, P = cache.wave.length / 2;
    g.strokeStyle = '#58a6ff'; g.beginPath();
    for (let x = 0; x < cw.width; x++) {
      const p = Math.floor(x / cw.width * P);
      g.moveTo(x + 0.5, mid - cache.wave[2 * p + 1] * mid * 0.95);
      g.lineTo(x + 0.5, mid - cache.wave[2 * p] * mid * 0.95);
    }
    g.stroke();
    g.strokeStyle = 'rgba(248,81,73,.5)';
    [0.999, -0.999].forEach((v) => { g.beginPath(); g.moveTo(0, mid - v * mid * 0.95); g.lineTo(cw.width, mid - v * mid * 0.95); g.stroke(); });
    // spectrum
    const cs = el('anSpec'), h = cs.getContext('2d'), W = cs.width, H = cs.height;
    const X = (f) => Math.log10(f / 20) / 3 * W;
    const lo = -30, hi = 15, Y = (d) => (1 - (d - lo) / (hi - lo)) * H;
    h.fillStyle = '#0a0e14'; h.fillRect(0, 0, W, H);
    h.strokeStyle = '#21262d'; h.fillStyle = '#8b949e'; h.font = '11px sans-serif';
    [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => { h.beginPath(); h.moveTo(X(f), 0); h.lineTo(X(f), H); h.stroke(); h.fillText(f >= 1000 ? f / 1000 + 'k' : f, X(f) + 2, H - 4); });
    [-20, -10, 0, 10].forEach((d) => { h.beginPath(); h.moveTo(0, Y(d)); h.lineTo(W, Y(d)); h.stroke(); h.fillText(d + 'dB', 2, Y(d) - 2); });
    const offset = cache.bands[0].level - cache.bands[0].rel;
    h.strokeStyle = 'rgba(88,166,255,.55)'; h.lineWidth = 1; h.beginPath();
    let first = true;
    for (let k = 1; k < cache.freqs.length; k++) {
      const f = cache.freqs[k]; if (f < 20 || f > 20000) continue;
      const y = Y(pdb(cache.spec[k]) - offset);
      if (first) { h.moveTo(X(f), y); first = false; } else h.lineTo(X(f), y);
    }
    h.stroke();
    const bw = W / 31;
    cache.bands.forEach((b) => {
      h.fillStyle = Math.abs(b.dev) > 4 ? 'rgba(248,81,73,.7)' : 'rgba(63,185,80,.65)';
      const y = Y(b.rel); h.fillRect(X(b.fc) - bw * 0.35, y, bw * 0.7, Math.max(2, Y(lo) - y));
    });
    if (el('anTarget').value !== 'none') {
      h.strokeStyle = '#d29922'; h.setLineDash([5, 4]); h.lineWidth = 2; h.beginPath();
      cache.bands.forEach((b, i) => { const x = X(b.fc), y = Y(b.target); i ? h.lineTo(x, y) : h.moveTo(x, y); });
      h.stroke(); h.setLineDash([]); h.lineWidth = 1;
    }
  }

  function toText(r) {
    const L = [];
    L.push('汽车音响调音 · 录音分析报告', '通道：' + r.channel, '文件：' + r.file, `时长：${r.durationSec}s  采样率：${r.sampleRate}Hz  声道：${r.channels}`,
      `峰值：${r.levels.peakDb} dBFS  RMS：${r.levels.rmsDb} dBFS  峰均比：${r.levels.crestDb} dB  削波采样：${r.levels.clipSamples}`,
      `目标曲线：${r.targetCurve}`, '', '【频段平衡】',
      `低音 ${r.balance.bass} dB / 中音 ${r.balance.mid} dB / 高音 ${r.balance.treble} dB / 2–5k ${r.balance.harsh2to5k} dB / 5–9k ${r.balance.sibilance5to9k} dB / 低频 -6dB 点 ${r.balance.lowRolloffHz || '—'} Hz`);
    if (r.stereo) L.push('', '【立体声】', `左右电平差 ${r.stereo.lrDiffDb} dB，相关度 ${r.stereo.correlation}，时间差 ${r.stereo.delayMs} ms（${r.stereo.delayCm} cm）`);
    L.push('', '【问题】', ...(r.problems.length ? r.problems.map((p) => '- ' + p.text) : ['- 无']));
    L.push('', '【建议 EQ】', ...(r.eq.length ? r.eq.map((e, i) => `${i + 1}. ${e.freq} Hz  ${e.gain} dB  Q=${e.q}`) : ['- 无']));
    L.push('', '【建议】', ...r.tips.map((t) => '- ' + t), '', '1/3 倍频程：', ...r.bands.map((b) => `${b.fc} Hz\t${b.level}\t目标 ${b.target}\t偏差 ${b.dev}`));
    return L.join('\n');
  }

  function toCsv(r) {
    const L = ['section,a,b,c,d'];
    L.push(`info,file,"${String(r.file).replace(/"/g, '""')}",,`, `info,duration_s,${r.durationSec},,`, `info,sample_rate,${r.sampleRate},,`,
      `level,peak_dbfs,${r.levels.peakDb},,`, `level,rms_dbfs,${r.levels.rmsDb},,`, `level,crest_db,${r.levels.crestDb},,`, `level,clip_samples,${r.levels.clipSamples},,`);
    L.push('band,fc_hz,level_db,target_db,dev_db', ...r.bands.map((b) => `band,${b.fc},${b.level},${b.target},${b.dev}`));
    L.push('eq,freq_hz,gain_db,q,', ...r.eq.map((e) => `eq,${e.freq},${e.gain},${e.q},`));
    if (r.stereo) L.push(`stereo,lr_diff_db,${r.stereo.lrDiffDb},,`, `stereo,correlation,${r.stereo.correlation},,`, `stereo,delay_ms,${r.stereo.delayMs},${r.stereo.delayCm},`);
    return L.join('\n');
  }

  function getSnapshot() { return report ? { channel: report.channel, file: report.file, levels: report.levels, balance: report.balance, stereo: report.stereo, eq: report.eq } : null; }

  return { init, redraw, getSnapshot };
})();
