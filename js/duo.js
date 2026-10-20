/** 双设备通用：麦克风校准 Cal、1/3 倍频程分析、专业测试音轨（同步咔嗒 + 类型标记）、播放端/录音端控件 */
const Cal = (() => {
  const KEY = 'cat-cal-v1';
  // 估计曲线（麦克风相对真实声压的偏差 dB），并非逐台实测
  const PRESETS = {
    none: { name: '不校准', pts: [] },
    iphone: { name: 'iPhone 通用（估计）', pts: [[20, -12], [31.5, -8], [50, -4.5], [80, -2], [125, -0.8], [200, 0], [5000, 0], [8000, 0.5], [10000, 0], [12500, -1.5], [16000, -4], [20000, -8]] },
    android: { name: '安卓通用（估计）', pts: [[20, -16], [31.5, -11], [50, -7], [80, -4], [125, -2], [200, -0.8], [300, 0], [4000, 0], [6300, 1], [8000, 0.5], [10000, -1.5], [12500, -4], [16000, -8], [20000, -12]] },
  };
  let st = { mode: 'none', name: '', pts: [] };
  try { if (typeof localStorage !== 'undefined') st = Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (_) {} };
  /** 解析 miniDSP/UMIK/REW 校准文件：每行「频率 dB [相位]」，忽略注释和 Sens Factor 行 */
  function parse(text) {
    const pts = [];
    String(text).split(/\r?\n/).forEach((ln) => {
      const s = ln.trim(); if (!s || /^[*#;"a-z]/i.test(s)) return;
      const t = s.split(/[\s,;\t]+/).map(Number);
      if (t.length >= 2 && isFinite(t[0]) && isFinite(t[1]) && t[0] > 0 && t[0] < 100000) pts.push([t[0], t[1]]);
    });
    pts.sort((a, b) => a[0] - b[0]);
    return pts;
  }
  function interp(pts, f) {
    if (!pts || !pts.length) return 0;
    if (f <= pts[0][0]) return pts[0][1];
    if (f >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    let i = 1; while (pts[i][0] < f) i++;
    const [f0, d0] = pts[i - 1], [f1, d1] = pts[i], k = Math.log(f / f0) / Math.log(f1 / f0);
    return d0 + (d1 - d0) * k;
  }
  const curPts = () => (st.mode === 'file' ? st.pts : (PRESETS[st.mode] || PRESETS.none).pts);
  /** 加到测量 dB 上的修正量（= −麦克风偏差） */
  function corr(f) { const p = curPts(); return p.length ? -interp(p, f) : 0; }
  function active() { return st.mode !== 'none' && curPts().length > 0; }
  function label() { return st.mode === 'file' ? `校准文件 ${st.name}` : (PRESETS[st.mode] || PRESETS.none).name; }
  function estimated() { return st.mode === 'iphone' || st.mode === 'android'; }
  function note() { return !active() ? '⚠️ 手机麦克风未校准：最低音和 12 kHz 以上仅供参考' : estimated() ? `⚠️ 已用「${label()}」修正，属于估计值` : `已用 ${label()} 修正`; }
  function set(mode, name, pts) { st = { mode, name: name || '', pts: pts || [] }; save(); }
  function get() { return { ...st, label: label(), active: active() }; }
  return { PRESETS, parse, interp, corr, active, label, note, set, get, estimated };
})();

const Duo = (() => {
  const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
  const dB = (v) => (v > 1e-12 ? 20 * Math.log10(v) : -240);
  const mean = (a) => a.reduce((p, v) => p + v, 0) / (a.length || 1);
  const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
  const fmtF = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + ' kHz' : Math.round(f) + ' Hz');
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr; re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  /** Welch → 1/3 倍频程 dB（含麦克风校准修正） */
  function thirdOct(seg, sr, fmin = 20, fmax = 20000, cal = true) {
    const N = 8192, win = new Float64Array(N); let ws = 0;
    for (let i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); ws += win[i] * win[i]; }
    const acc = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N); let fr = 0;
    for (let off = 0; off + N <= seg.length; off += N / 2) { for (let i = 0; i < N; i++) { re[i] = seg[off + i] * win[i]; im[i] = 0; } fft(re, im); for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k]; fr++; }
    const out = [];
    for (let i = -17; i <= 13; i++) {
      const fc = 1000 * Math.pow(2, i / 3); if (fc < fmin || fc > fmax || fc > sr / 2.2) continue;
      const lo = fc / Math.pow(2, 1 / 6), hi = fc * Math.pow(2, 1 / 6); let s = 0;
      for (let k = Math.max(1, Math.floor(lo * N / sr)); k < N / 2 && k * sr / N < hi; k++) if (k * sr / N >= lo) s += acc[k];
      out.push({ fc: Math.round(fc), level: 10 * Math.log10(s / Math.max(1, fr) / ws + 1e-20) + (cal ? Cal.corr(fc) : 0) });
    }
    return out;
  }
  function rms(x, a, b) { let s = 0; a = Math.max(0, a); b = Math.min(x.length, b); for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }

  // ---------- 专业测试音轨：同步咔嗒 0/0.5/1.0 s + 类型标记咔嗒 2.0+0.25·(k−1) s，内容从 3.0 s 开始 ----------
  const KINDS = { mp: 1, img: 2, xo300: 3, xo4k: 4 };
  const KIND_CN = { mp: '多点测量', img: '声像居中', xo300: '分频衔接 300 Hz', xo4k: '分频衔接 4 kHz' };
  const IMG = { chirp0: 3, nChirp: 12, chirpGap: 0.4, L: 8.5, R: 13, seg: 4, M: 17.5, mSeg: 6, len: 24 };
  const MP = { s: 3, seg: 8, len: 11.5 };
  const XO = { s: 3, seg: 6, len: 9.5, band: { xo300: [70, 1300], xo4k: [900, 16000] }, fc: { xo300: 300, xo4k: 4000 } };
  const LEN = { mp: MP.len, img: IMG.len, xo300: XO.len, xo4k: XO.len };
  function clickT(sr) { const n = Math.round(0.004 * sr), t = new Float32Array(n); for (let i = 0; i < n; i++) t[i] = Math.sin(2 * Math.PI * 3000 * i / sr) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))); return t; }
  function add(out, tpl, at, amp) { for (let i = 0; i < tpl.length && at + i < out.length; i++) if (at + i >= 0) out[at + i] += tpl[i] * amp; }
  function pink(n, seed, band) {
    let s = seed >>> 0 || 1; const r = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; };
    let y = new Float32Array(n), b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) { const w = r(); b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; y[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; }
    const SR = TestTrack.SR;
    if (band) for (let k = 0; k < 2; k++) { y = TestTrack.biquad(y, 'hp', band[0], 0.707, SR); y = TestTrack.biquad(y, 'lp', band[1], 0.707, SR); }
    let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
    const g = 0.45 / (pk || 1), f = Math.floor(0.05 * SR);
    for (let i = 0; i < n; i++) y[i] *= g * Math.min(1, i / f, (n - 1 - i) / f);
    return y;
  }
  function build(kind) {
    const SR = TestTrack.SR, S = (s) => Math.round(s * SR), len = 1 + LEN[kind] + 1;
    const L = new Float32Array(S(len)), R = new Float32Array(S(len)), T0 = S(1), ck = clickT(SR);
    [0, 0.5, 1.0, 2.0 + 0.25 * (KINDS[kind] - 1)].forEach((t) => { add(L, ck, T0 + S(t), 0.9); add(R, ck, T0 + S(t), 0.9); });
    if (kind === 'mp') { const p = pink(S(MP.seg), 61); for (let i = 0; i < p.length; i++) { L[T0 + S(MP.s) + i] += p[i]; R[T0 + S(MP.s) + i] += p[i]; } }
    if (kind === 'img') {
      const ch = TestTrack.chirpTemplate(SR);
      for (let k = 0; k < IMG.nChirp; k++) add(k % 2 ? R : L, ch, T0 + S(IMG.chirp0 + k * IMG.chirpGap), 0.7);
      const a = pink(S(IMG.seg), 71, [300, 4000]), b = pink(S(IMG.seg), 72, [300, 4000]), m = pink(S(IMG.mSeg), 73, [150, 8000]);
      for (let i = 0; i < a.length; i++) { L[T0 + S(IMG.L) + i] += a[i]; R[T0 + S(IMG.R) + i] += b[i]; }
      for (let i = 0; i < m.length; i++) { L[T0 + S(IMG.M) + i] += m[i]; R[T0 + S(IMG.M) + i] += m[i]; }
    }
    if (kind === 'xo300' || kind === 'xo4k') { const p = pink(S(XO.seg), 81, XO.band[kind]); for (let i = 0; i < p.length; i++) { L[T0 + S(XO.s) + i] += p[i]; R[T0 + S(XO.s) + i] += p[i]; } }
    return { L, R, kind, name: KIND_CN[kind] };
  }
  /** 在录音里找同步咔嗒，并识别类型标记 */
  function detect(x, sr) {
    const det = TestTrack.detect(x, sr); if (!det) return null;
    const bp = (a) => { const s = Math.round(a * sr) + det.t0, seg = x.subarray(Math.max(0, s - Math.round(0.004 * sr)), s + Math.round(0.012 * sr)); return seg.length ? rms(TestTrack.biquad(seg, 'bp', 3000, 4, sr), 0, seg.length) : 0; };
    const sc = Object.keys(KINDS).map((k) => ({ k, v: bp(2.0 + 0.25 * (KINDS[k] - 1)) })).sort((a, b) => b.v - a.v);
    const ref = bp(2.875);
    const kind = sc[0].v > 3 * Math.max(sc[1].v, ref, 1e-9) ? sc[0].k : null;
    return { t0: det.t0, kind, complete: kind ? det.t0 + Math.round((LEN[kind] - 0.3) * sr) <= x.length : false };
  }
  /** 统一判定：返回 {ok, t0} 或 {ok:false, reason} */
  function locate(x, sr, kind) {
    let peak = 0; for (let i = 0; i < x.length; i += 7) peak = Math.max(peak, Math.abs(x[i]));
    const d = detect(x, sr);
    if (!d) return { ok: false, reason: peak < 0.003 ? '声音太小：调大播放音量再测' : '没听到测试音：先在录音端点「● 开始录」，再到播放端点「▶ 开始放」' };
    if (d.kind !== kind) return { ok: false, reason: d.kind ? `播放端放的是「${KIND_CN[d.kind]}」，两台设备要打开同一个页面` : '测试音没认出来（太吵或不是本页的测试音）：两台都打开同一页再测' };
    if (!d.complete) return { ok: false, reason: '没录完整：等播放端放完再停' };
    return { ok: true, t0: d.t0 };
  }

  // ---------- 播放端 ----------
  function player({ btn, cue, count, kind, cues, track, loop }) {
    let p = null;
    const stop = () => { if (!p) return; try { p.src.onended = null; p.src.stop(); } catch (_) {} cancelAnimationFrame(p.raf); p = null; btn.textContent = '▶ 开始放'; btn.classList.remove('busy'); };
    btn.onclick = async () => {
      if (p) { stop(); cue.textContent = '已停止'; return; }
      const t = track ? track() : build(typeof kind === 'function' ? kind() : kind);
      AudioEngine.unlockSync();
      await AudioEngine.resume();
      const ctx = AudioEngine.getCtx(), buf = ctx.createBuffer(2, t.L.length, TestTrack.SR);
      buf.copyToChannel(t.L, 0); buf.copyToChannel(t.R, 1);
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = !!loop; src.connect(ctx.destination);
      const t0 = ctx.currentTime + 0.1, dur = buf.duration, cs = (typeof cues === 'function' ? cues() : cues) || [[0, '播放中…']];
      src.start(t0); p = { src, raf: 0 }; btn.textContent = '■ 停止'; btn.classList.add('busy');
      const tick = () => { if (!p) return; const el = Math.max(0, ctx.currentTime - t0); let c = cs[0][1]; for (const [a, s] of cs) if (el >= a) c = s; cue.textContent = c; if (count) count.textContent = loop ? '循环播放中' : `还剩 ${Math.max(0, Math.ceil(dur - el))} 秒`; p.raf = requestAnimationFrame(tick); };
      tick();
      src.onended = () => { stop(); cue.textContent = '放完了 ✓ 看录音端'; if (count) count.textContent = ''; };
    };
    return { stop };
  }
  // ---------- 录音端（只在录音设备上开麦） ----------
  function recorder({ btn, status, kind, maxSec = 60, onDone, isDone }) {
    let rec = null;
    const concat = (c, n) => { const y = new Float32Array(n); let o = 0; for (const a of c) { y.set(a, o); o += a.length; } return y; };
    async function stopRec() {
      if (!rec) return null; const r = rec; rec = null; clearInterval(r.timer);
      try { r.sp.disconnect(); r.srcN.disconnect(); } catch (_) {}
      r.stream.getTracks().forEach((t) => t.stop()); try { await r.ctx.close(); } catch (_) {}
      AudioEngine.setExternalMic(false); try { await AudioEngine.resetOutput('mic'); } catch (_) {}
      btn.textContent = '● 开始录'; btn.classList.remove('busy');
      return { x: concat(r.chunks, r.n), sr: r.sr };
    }
    const finish = (d) => { status.textContent = d ? '分析中…' : ''; if (!d) return; setTimeout(() => { status.textContent = ''; onDone(d.x, d.sr); }, 30); };
    btn.onclick = async () => {
      if (rec) { finish(await stopRec()); return; }
      AudioEngine.releaseMic({ noReset: true }); AudioEngine.setExternalMic(true);
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: (typeof MicPick !== 'undefined') ? MicPick.constraints() : { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
      catch (e) { AudioEngine.setExternalMic(false); status.textContent = '⚠️ 没拿到麦克风权限：请在浏览器设置里允许麦克风'; return; }
      const ctx = new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume();
      const srcN = ctx.createMediaStreamSource(stream), sp = ctx.createScriptProcessor(4096, 1, 1);
      const r = { stream, ctx, srcN, sp, chunks: [], n: 0, sr: ctx.sampleRate, t0: Date.now() };
      sp.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); r.chunks.push(new Float32Array(d)); r.n += d.length; };
      srcN.connect(sp); sp.connect(ctx.destination); rec = r;
      btn.textContent = '■ 停止'; btn.classList.add('busy'); status.textContent = '录音中…现在去播放端点「▶ 开始放」';
      const k = typeof kind === 'function' ? kind() : kind;
      r.timer = setInterval(async () => {
        if (rec !== r) return;
        const el = (Date.now() - r.t0) / 1000, xx = r.n > r.sr * 3 ? concat(r.chunks, r.n) : null;
        const d = xx ? (isDone ? isDone(xx, r.sr) : detect(xx, r.sr)) : null;
        const heard = isDone ? d && d.heard : d, done = isDone ? d && d.done : d && d.kind === k && d.complete;
        status.textContent = heard ? `听到测试音了 ✓ 继续录…（${Math.round(el)} 秒）` : `录音中…等待测试音（${Math.round(el)} / ${maxSec} 秒）`;
        if (done || el >= maxSec) finish(await stopRec());
      }, 1000);
    };
    return { stop: stopRec };
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&', '<': '<', '>': '>', '"': '"' }[c]));
  /** 角色切换（播放端/录音端），状态存 localStorage */
  function roles(attr, key, onRender) {
    let role = 'player'; try { role = localStorage.getItem(key) || 'player'; } catch (_) {}
    const render = () => { document.querySelectorAll(`[${attr}]`).forEach((b) => b.classList.toggle('on', b.getAttribute(attr) === role)); onRender(role); };
    document.querySelectorAll(`[${attr}]`).forEach((b) => { b.onclick = () => { role = b.getAttribute(attr); try { localStorage.setItem(key, role); } catch (_) {} render(); }; });
    render(); return () => role;
  }
  const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? d; } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  /** 写入「整车」分析（合并已有字段） */
  function mergeAll(patch) { const a = LS.get('cat-analyses-v1', {}); a.all = Object.assign({ channel: '整车', file: '整车' }, a.all || {}, patch, { at: new Date().toISOString() }); LS.set('cat-analyses-v1', a); return a; }
  return { r1, r2, dB, mean, fmtF, thirdOct, rms, build, detect, locate, player, recorder, roles, esc, LS, mergeAll, KINDS, KIND_CN, IMG, MP, XO, LEN, $ };
})();
if (typeof module !== 'undefined') module.exports = { Cal, Duo };
