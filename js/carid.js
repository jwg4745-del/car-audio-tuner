/** 整车识别：两台设备（一台放、一台录），一次录音得出左右电平/延时/相位、低音下潜、高频延伸、频响峰谷、评分 */
const CarId = (() => {
  const KEY = 'cat-carid-v1', ANKEY = 'cat-analyses-v1';
  const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch (_) { return d; } };
  const st = Object.assign({ role: 'player', target: 'car' }, typeof localStorage !== 'undefined' ? ls(KEY, {}) : {});
  const save = () => localStorage.setItem(KEY, JSON.stringify(st));
  const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
  const dB = (v) => (v > 1e-12 ? 20 * Math.log10(v) : -240);
  const fmtF = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + ' kHz' : Math.round(f) + ' Hz');
  let player = null, rec = null, last = null;

  function targetDb(f, curve) {
    const x = Math.log10(Math.max(20, f) / 1000);
    if (curve === 'flat') return 0;
    if (curve === 'house') return -3 * Math.max(0, x);
    // 车用偏暖：低音 +6 dB 搁架（<100 Hz），高频缓降
    return (f < 100 ? 6 : f < 200 ? 6 * Math.log2(200 / f) : 0) - 3 * Math.max(0, x);
  }
  function rms(x, a, b) { let s = 0; a = Math.max(0, a); b = Math.min(x.length, b); for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr; re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  /** Welch 平均 → 1/3 倍频程能量 dB */
  function thirdOct(seg, sr, fmin = 20, fmax = 20000) {
    const N = 8192, win = new Float64Array(N); let ws = 0;
    for (let i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); ws += win[i] * win[i]; }
    const acc = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N); let fr = 0;
    for (let off = 0; off + N <= seg.length; off += N / 2) { for (let i = 0; i < N; i++) { re[i] = seg[off + i] * win[i]; im[i] = 0; } fft(re, im); for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k]; fr++; }
    const out = [];
    for (let i = -17; i <= 13; i++) {
      const fc = 1000 * Math.pow(2, i / 3); if (fc < fmin || fc > fmax || fc > sr / 2.2) continue;
      const lo = fc / Math.pow(2, 1 / 6), hi = fc * Math.pow(2, 1 / 6); let s = 0;
      for (let k = Math.max(1, Math.floor(lo * N / sr)); k < N / 2 && k * sr / N < hi; k++) if (k * sr / N >= lo) s += acc[k];
      out.push({ fc: Math.round(fc), level: 10 * Math.log10(s / Math.max(1, fr) / ws + 1e-20) });
    }
    return out;
  }
  const mean = (a) => a.reduce((p, v) => p + v, 0) / (a.length || 1);

  /** 纯函数：分析整车识别轨录音 */
  function analyze(x, sr, det, curve = st.target) {
    const TT = TestTrack, C = TT.CAR, T = (s) => det.t0 + Math.round(s * sr), warn = [];
    const bp = (s) => TT.biquad(TT.biquad(s, 'hp', 80, 0.707, sr), 'lp', 10000, 0.707, sr);
    const lvl = (a, b) => { const y = bp(x.subarray(T(a), T(b))); return dB(rms(y, Math.floor(0.15 * sr), y.length)); };
    const noise = lvl(1.85, 2.45);
    const Ldb = lvl(C.L + 0.4, C.L + C.seg - 0.4), Rdb = lvl(C.R + 0.4, C.R + C.seg - 0.4), Bdb = lvl(C.B + 0.4, C.B + C.seg - 0.4), Idb = lvl(C.I + 0.4, C.I + C.seg - 0.4);
    const snr = Math.min(Ldb, Rdb) - noise;
    if (Math.max(Ldb, Rdb, Bdb) - noise < 8) return { ok: false, reason: '声音太小或环境太吵：调大音量、关空调、录音手机放主驾头部再测', noiseDb: r1(noise) };
    const out = { ok: true, noiseDb: r1(noise), snrDb: r1(snr), levels: { L: r1(Ldb), R: r1(Rdb), both: r1(Bdb), inv: r1(Idb) } };
    // 1. 左右电平
    const lPresent = Ldb - noise > 8, rPresent = Rdb - noise > 8;
    out.level = !lPresent || !rPresent ? { reliable: false, note: !lPresent ? '左边几乎没声音：检查左声道接线/DSP 静音' : '右边几乎没声音：检查右声道接线/DSP 静音', missing: !lPresent ? 'L' : 'R' }
      : { reliable: snr >= 12, diffDb: r1(Ldb - Rdb), louder: Math.abs(Ldb - Rdb) < 0.5 ? null : Ldb > Rdb ? 'L' : 'R' };
    if (out.level.missing) warn.push(out.level.note);
    // 2. 左右延时（Chirp 互相关）
    const ch = TT.chirpTemplate(sr), arr = { L: [], R: [] }, q = [];
    for (let k = 0; k < C.nChirp; k++) { const r = TT.xcorrPeak(x, ch, T(C.chirp0 + k * 0.5), Math.round(0.03 * sr)); (k % 2 ? arr.R : arr.L).push(r.lag / sr * 1000); q.push(Math.abs(r.val)); }
    const spread = (a) => Math.max(...a) - Math.min(...a);
    const dMs = mean(arr.R) - mean(arr.L), dOk = lPresent && rPresent && spread(arr.L) < 0.25 && spread(arr.R) < 0.25 && snr >= 10;
    out.delay = { reliable: dOk, diffMs: r2(dMs), cm: r1(dMs * 34.3), early: Math.abs(dMs) < 0.05 ? null : dMs > 0 ? 'L' : 'R', arrivalMs: { L: arr.L.map(r2), R: arr.R.map(r2) } };
    if (lPresent && rPresent && !dOk) warn.push('左右延时多次测量不一致（反射太强或太吵），延时结果仅供参考');
    // 3. 相位：同相段 vs 右反相段
    const band = (a, b, lo, hi) => { let y = x.subarray(T(a), T(b)); y = TT.biquad(TT.biquad(y, 'hp', lo, 0.707, sr), 'lp', hi, 0.707, sr); return dB(rms(y, Math.floor(0.15 * sr), y.length)); };
    const pd = [[60, 8000], [40, 200]].map(([lo, hi]) => band(C.B + 0.4, C.B + C.seg - 0.4, lo, hi) - band(C.I + 0.4, C.I + C.seg - 0.4, lo, hi));
    const pdm = mean(pd), agree = Math.sign(pd[0]) === Math.sign(pd[1]);
    const balanced = !out.level.missing && Math.abs(Ldb - Rdb) < 8;
    out.phase = { diffDb: r1(pdm), segs: pd.map(r1), verdict: !balanced ? 'unknown' : pdm >= 2 && agree ? 'ok' : pdm <= -2 && agree ? 'inverted' : 'unknown' };
    if (out.phase.verdict === 'unknown') warn.push(balanced ? '同相/反相差别太小，相位判断不出：先按建议调好延时后再测' : '左右音量差太大，相位无法判断');
    // 4. 频响（L+R 同相粉红噪声）
    const raw = thirdOct(x.subarray(T(C.B + 0.4), T(C.B + C.seg - 0.4)), sr, 25, 16000);
    const nb = thirdOct(x.subarray(T(1.85), T(2.45)), sr, 25, 16000);
    const ref = mean(raw.filter((b) => b.fc >= 250 && b.fc <= 2000).map((b) => b.level)) - mean(raw.filter((b) => b.fc >= 250 && b.fc <= 2000).map((b) => targetDb(b.fc, curve)));
    const bands = raw.map((b, i) => { const rel = b.level - ref, tg = targetDb(b.fc, curve); const valid = b.level - (nb[i] ? nb[i].level : -200) > 6; return { fc: b.fc, level: r1(rel), target: r1(tg), dev: r1(rel - tg), valid }; });
    out.bands = bands;
    const use = bands.filter((b) => b.valid && b.fc >= 40 && b.fc <= 12500);
    out.peaks = use.filter((b) => b.dev >= 3).sort((a, b) => b.dev - a.dev).slice(0, 4).map((b) => ({ fc: b.fc, dev: b.dev }));
    out.dips = use.filter((b) => b.dev <= -4).sort((a, b) => a.dev - b.dev).slice(0, 4).map((b) => ({ fc: b.fc, dev: b.dev }));
    out.flatnessDb = r1(mean(use.map((b) => Math.abs(b.dev))));
    // 5. 低音下潜（低音扫频，参考 100–200 Hz）
    const sw = thirdOct(x.subarray(T(C.sweep + 0.2), T(C.sweep + C.sweepDur - 0.2)), sr, 20, 250);
    const swRef = mean(sw.filter((b) => b.fc >= 100 && b.fc <= 200).map((b) => b.level));
    let low = null; for (let i = sw.length - 1; i >= 0; i--) { if (sw[i].fc > 200) continue; if (sw[i].level >= swRef - 6) low = sw[i].fc; else break; }
    const swOk = swRef - noise > 6;
    out.bass = { reliable: swOk, minus6Hz: low, bands: sw.map((b) => ({ fc: b.fc, rel: r1(b.level - swRef) })) };
    if (!swOk) warn.push('低音扫频太弱，下潜结果不可靠');
    // 6. 高频延伸（相对 1–4 kHz，−10 dB 点；手机麦克风 >12 kHz 本身会衰减）
    const hRef = mean(raw.filter((b) => b.fc >= 1000 && b.fc <= 4000).map((b) => b.level));
    let hi = null; for (const b of raw) { if (b.fc < 1000) continue; if (b.level >= hRef - 10 && bands.find((y) => y.fc === b.fc).valid) hi = b.fc; else break; }
    out.treble = { minus10Hz: hi };
    // 7. 评分与问题
    const issues = []; let score = 100;
    if (out.level.missing) { score -= 40; issues.push(out.level.note); }
    else if (Math.abs(out.level.diffDb) > 1) { score -= Math.min(15, (Math.abs(out.level.diffDb) - 1) * 4); issues.push(`${out.level.louder === 'L' ? '左' : '右'}边比另一边响 ${Math.abs(out.level.diffDb)} dB`); }
    if (out.phase.verdict === 'inverted') { score -= 25; issues.push('左右相位接反（低音会变薄、声像发散）'); }
    if (out.delay.reliable && Math.abs(out.delay.diffMs) > 0.3) { score -= Math.min(10, Math.abs(out.delay.diffMs) * 3); issues.push(`${out.delay.early === 'L' ? '左' : '右'}边声音先到 ${Math.abs(out.delay.diffMs)} ms（声像偏向${out.delay.early === 'L' ? '左' : '右'}）`); }
    score -= Math.max(0, Math.min(30, (out.flatnessDb - 2) * 6));
    out.peaks.slice(0, 2).forEach((p) => issues.push(`${fmtF(p.fc)} 附近偏高 ${p.dev} dB`));
    out.dips.slice(0, 2).forEach((p) => issues.push(`${fmtF(p.fc)} 附近偏低 ${-p.dev} dB`));
    if (swOk && low && low > 50) { score -= Math.min(10, (low - 50) / 5); issues.push(`低音下潜只到约 ${low} Hz`); }
    if (hi && hi < 8000) { score -= 5; issues.push(`高频只延伸到约 ${fmtF(hi)}（检查高音是否在响）`); }
    if (out.delay.reliable && Math.abs(out.delay.diffMs) > 0.3 && out.dips.length) issues.push('左右时间差会造成中高频梳状谷：先补延时，再复测频响后再调 EQ');
    out.score = Math.max(0, Math.round(score));
    out.confident = snr >= 12 && warn.length === 0;
    out.issues = issues; out.warn = warn; out.target = curve; out.t0Sec = r2(det.t0 / sr);
    return out;
  }
  function judge(x, sr, curve) {
    let peak = 0; for (let i = 0; i < x.length; i += 7) peak = Math.max(peak, Math.abs(x[i]));
    const det = TestTrack.detect(x, sr);
    if (!det) return { ok: false, reason: peak < 0.003 ? '声音太小：调大播放音量，录音手机放主驾头部' : '没检测到测试音：先点录再点放，音量调大' };
    if (det.type !== 'car') return { ok: false, reason: '播放端放的不是「整车识别」测试音：两台都打开「整车识别」页' };
    if (!det.complete) return { ok: false, reason: '没录完整：录音别提前停（约 45 秒）' };
    return analyze(x, sr, det, curve);
  }

  /** 写入调音方案的数据（纯函数） */
  function toAnalyses(r, a = {}) {
    if (!r || !r.ok) return a;
    const lv = r.level.reliable && !r.level.missing ? r.level.diffDb : 0;
    a.all = {
      track: { type: 'auto', snrDb: r.snrDb, lrDiffDb: lv, delayMs: r.delay.reliable ? r.delay.diffMs : 0, polarity: { L: '正', R: r.phase.verdict === 'inverted' ? '反' : '正', mismatch: false } },
      channel: '整车识别', file: '整车识别', targetCurve: r.target,
      bands: r.bands.filter((b) => b.valid).map((b) => ({ fc: b.fc, level: b.level, target: b.target, dev: b.dev })),
      balance: { lowRolloffHz: r.bass.reliable ? r.bass.minus6Hz : null, bass: r1(mean(r.bands.filter((b) => b.fc <= 250).map((b) => b.dev))), harsh2to5k: r1(mean(r.bands.filter((b) => b.fc >= 2000 && b.fc <= 5000).map((b) => b.dev))) },
      stereo: { lrDiffDb: lv, delayMs: r.delay.reliable ? r.delay.diffMs : 0, peakCorrelation: r.delay.reliable ? 1 : 0 },
      at: new Date().toISOString(),
    };
    if (r.phase.verdict !== 'unknown') {
      const pairs = ((a.phase && a.phase.track && a.phase.track.pairs) || []).filter((p) => p.id !== 'full');
      pairs.push({ id: 'full', name: '整车识别·左右', diffDb: r.phase.diffDb, verdict: r.phase.verdict === 'ok' ? '同相（正常）' : '相位相反' });
      a.phase = { track: { type: 'phase', pairs, anyInverted: pairs.some((p) => p.verdict === '相位相反') }, at: new Date().toISOString() };
    }
    return a;
  }

  // ---------- 文案 ----------
  const side = (s) => (s === 'L' ? '左' : '右');
  function groups(s) { if (typeof Channels === 'undefined') return s === 'L' ? 'CH1–3' : 'CH4–6'; const l = Channels.getAll().filter((c) => c.side === s && !c.mute).map((c) => 'CH' + c.id); return l.join('/') || '—'; }
  function lines(r) {
    const L = [];
    if (r.level.missing) L.push(['左右电平', '⚠️ ' + r.level.note]);
    else L.push(['左右电平', `${r.level.louder ? side(r.level.louder) + '边响 ' + Math.abs(r.level.diffDb) + ' dB' : '基本一致'}${r.level.reliable ? '' : ' ⚠️'}${r.level.louder && Math.abs(r.level.diffDb) > 1 ? ` → ${side(r.level.louder)}侧（${groups(r.level.louder)}）各降 ${Math.abs(r.level.diffDb)} dB` : ''}`]);
    L.push(['左右延时', !r.delay.reliable ? `⚠️ 测不准（约 ${Math.abs(r.delay.diffMs)} ms，仅供参考）` : !r.delay.early ? '基本同时到达 ✓' : `${side(r.delay.early)}边先到 ${Math.abs(r.delay.diffMs)} ms → 给${side(r.delay.early)}侧（${groups(r.delay.early)}）加 ${Math.abs(r.delay.diffMs)} ms`]);
    L.push(['左右相位', r.phase.verdict === 'ok' ? '✅ 正常' : r.phase.verdict === 'inverted' ? `❌ 接反 → DSP 里把右侧（${groups('R')}）反相后复测` : '⚠️ 判断不出']);
    L.push(['低音下潜', r.bass.reliable && r.bass.minus6Hz ? `约 ${r.bass.minus6Hz} Hz（−6 dB）${r.bass.minus6Hz <= 40 ? ' 很好' : r.bass.minus6Hz <= 60 ? ' 正常' : ' 偏浅'}` : '⚠️ 测不出']);
    L.push(['高频延伸', r.treble.minus10Hz ? `约 ${fmtF(r.treble.minus10Hz)}（手机麦克风高频本身偏弱，仅供参考）` : '⚠️ 测不出']);
    L.push(['频响峰谷', [...r.peaks.map((p) => `${fmtF(p.fc)} +${p.dev}`), ...r.dips.map((p) => `${fmtF(p.fc)} ${p.dev}`)].join('，') || '基本在 ±3 dB 内 ✓']);
    return L;
  }

  // ---------- 播放端 ----------
  function cueList() { const C = TestTrack.CAR, a = 1; return [[0, '准备…'], [a, '同步咔嗒'], [a + C.L, '只有左边'], [a + C.R, '只有右边'], [a + C.B, '左右一起'], [a + C.I, '右边反相'], [a + C.chirp0, '延时测试'], [a + C.sweep, '低音扫频'], [a + C.len, '完成 ✓']]; }
  function stopPlay() { if (!player) return; try { player.src.onended = null; player.src.stop(); } catch (_) {} cancelAnimationFrame(player.raf); player = null; $('ciPlay').textContent = '▶ 开始放'; $('ciPlay').classList.remove('busy'); }
  async function play() {
    if (player) { stopPlay(); $('ciCue').textContent = '已停止'; return; }
    const t = TestTrack.buildTrack('car');
    await AudioEngine.resume(true);
    const ctx = AudioEngine.getCtx();
    const buf = ctx.createBuffer(2, t.L.length, TestTrack.SR); buf.copyToChannel(t.L, 0); buf.copyToChannel(t.R, 1);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.1, dur = buf.duration, cs = cueList();
    src.start(t0); player = { src, raf: 0 };
    $('ciPlay').textContent = '■ 停止'; $('ciPlay').classList.add('busy');
    const tick = () => { if (!player) return; const el = Math.max(0, ctx.currentTime - t0); let c = cs[0][1]; for (const [a, s] of cs) if (el >= a) c = s; $('ciCue').textContent = c; $('ciCount').textContent = `还剩 ${Math.max(0, Math.ceil(dur - el))} 秒`; player.raf = requestAnimationFrame(tick); };
    tick();
    src.onended = () => { stopPlay(); $('ciCue').textContent = '放完了 ✓ 看录音端结果'; $('ciCount').textContent = ''; };
  }
  // ---------- 录音端 ----------
  function concat(chunks, n) { const y = new Float32Array(n); let o = 0; for (const c of chunks) { y.set(c, o); o += c.length; } return y; }
  async function stopRec() {
    if (!rec) return null;
    const r = rec; rec = null; clearInterval(r.timer);
    try { r.sp.disconnect(); r.srcN.disconnect(); } catch (_) {}
    r.stream.getTracks().forEach((t) => t.stop());
    try { await r.ctx.close(); } catch (_) {}
    AudioEngine.setExternalMic(false);
    try { await AudioEngine.resetOutput('mic'); } catch (_) {}
    $('ciRec').textContent = '● 开始录'; $('ciRec').classList.remove('busy');
    return { x: concat(r.chunks, r.n), sr: r.sr };
  }
  async function record() {
    if (rec) { finish(await stopRec()); return; }
    $('ciResult').hidden = true;
    AudioEngine.releaseMic({ noReset: true }); AudioEngine.setExternalMic(true);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
    catch (e) { AudioEngine.setExternalMic(false); show({ ok: false, reason: '没拿到麦克风权限：请在浏览器设置里允许麦克风' }); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume();
    const srcN = ctx.createMediaStreamSource(stream), sp = ctx.createScriptProcessor(4096, 1, 1);
    const r = { stream, ctx, srcN, sp, chunks: [], n: 0, sr: ctx.sampleRate, t0: Date.now() };
    sp.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); r.chunks.push(new Float32Array(d)); r.n += d.length; };
    srcN.connect(sp); sp.connect(ctx.destination); rec = r;
    const maxSec = 65;
    $('ciRec').textContent = '■ 停止'; $('ciRec').classList.add('busy');
    $('ciRecStatus').textContent = '录音中…现在去播放端点「▶ 开始放」';
    r.timer = setInterval(async () => {
      if (rec !== r) return;
      const el = (Date.now() - r.t0) / 1000, x = concat(r.chunks, r.n);
      const det = r.n > r.sr * 3 ? TestTrack.detect(x, r.sr) : null;
      $('ciRecStatus').textContent = det ? `听到测试音了 ✓ 继续录…（${Math.round(el)} 秒）` : `录音中…等待测试音（${Math.round(el)} / ${maxSec} 秒）`;
      if ((det && det.complete) || el >= maxSec) finish(await stopRec());
    }, 1500);
  }
  function finish(d) { $('ciRecStatus').textContent = ''; if (!d) return; $('ciRecStatus').textContent = '分析中…'; setTimeout(() => { const r = judge(d.x, d.sr, st.target); $('ciRecStatus').textContent = ''; show(r); }, 30); }

  // ---------- 结果 ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function show(r) {
    last = r;
    const card = $('ciResult'); card.hidden = false;
    if (!r.ok) { card.className = 'sp-result unknown'; $('ciScore').textContent = '⚠️ 测不出'; $('ciSummary').innerHTML = `<p class="sp-reason">${esc(r.reason)}</p>`; $('ciWrite').hidden = true; $('ciDetail').textContent = JSON.stringify(r, null, 1); return; }
    card.className = 'sp-result ' + (r.score >= 80 && r.confident ? 'ok' : r.score < 60 ? 'inverted' : 'unknown');
    $('ciScore').textContent = `${r.confident ? '' : '⚠️ '}整车评分 ${r.score}`;
    $('ciSummary').innerHTML = `<table class="ci-tab">${lines(r).map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>`
      + (r.issues.length ? `<div class="ci-iss"><b>主要问题</b><ol>${r.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ol></div>` : '<p class="sp-reason">没发现明显问题 ✓</p>')
      + (r.warn.length ? `<p class="ci-warn">${r.warn.map((w) => '⚠️ ' + esc(w)).join('<br>')}</p>` : '')
      + '<p class="sp-hint">基于手机麦克风（未校准）测量，仅供参考</p>';
    $('ciWrite').hidden = false;
    $('ciDetail').textContent = JSON.stringify({ levels: r.levels, snrDb: r.snrDb, delay: r.delay, phase: r.phase, bass: r.bass, treble: r.treble, flatnessDb: r.flatnessDb, bands: r.bands.map((b) => `${b.fc}Hz ${b.level} (目标 ${b.target}, 偏差 ${b.dev})${b.valid ? '' : ' 噪声内'}`) }, null, 1);
  }
  function writePlan() {
    if (!last || !last.ok) return false;
    localStorage.setItem(ANKEY, JSON.stringify(toAnalyses(last, ls(ANKEY, {}))));
    TunePlan.show(); App.switchTab('plan');
    setTimeout(() => { const o = $('tpOut'); if (o && o.scrollIntoView) o.scrollIntoView({ behavior: 'smooth' }); }, 100);
    return true;
  }
  function render() {
    document.querySelectorAll('[data-cirole]').forEach((b) => b.classList.toggle('on', b.dataset.cirole === st.role));
    $('ciPlayer').hidden = st.role !== 'player'; $('ciRecorder').hidden = st.role !== 'recorder';
    $('ciTarget').value = st.target;
  }
  function init() {
    if (!$('panel-carid')) return;
    document.querySelectorAll('[data-cirole]').forEach((b) => { b.onclick = () => { st.role = b.dataset.cirole; save(); render(); }; });
    $('ciTarget').onchange = () => { st.target = $('ciTarget').value; save(); };
    $('ciPlay').onclick = play; $('ciRec').onclick = record;
    $('ciAgain').onclick = () => { $('ciResult').hidden = true; if (st.role === 'recorder') record(); };
    $('ciWrite').onclick = () => { if (!writePlan()) alert('没有可用结果'); };
    render();
  }
  return { init, judge, analyze, toAnalyses, lines, targetDb, stopPlay };
})();
if (typeof module !== 'undefined') module.exports = CarId;
