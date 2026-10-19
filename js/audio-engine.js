/**
 * 汽车音响调音 — Web Audio 核心引擎
 */
const AudioEngine = (() => {
  let ctx = null;
  let masterGain = null;
  let micStream = null;
  let micSource = null;
  let micAnalyser = null;
  let genAnalyser = null;
  let activeNodes = [];
  let masterLevel = 0.12;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = masterLevel;
      masterGain.connect(ctx.destination);
      genAnalyser = ctx.createAnalyser();
      genAnalyser.fftSize = 2048;
      genAnalyser.smoothingTimeConstant = 0.6;
      // tap before master for loopback analysis
      const tap = ctx.createGain();
      tap.gain.value = 1;
      // We'll connect generators: node -> genAnalyser -> masterGain
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function setMasterLevel(pct) {
    masterLevel = Math.max(0, Math.min(1, pct / 100));
    ensure();
    masterGain.gain.setTargetAtTime(masterLevel, ctx.currentTime, 0.02);
  }

  function getMasterLevel() {
    return masterLevel * 100;
  }

  function track(node) {
    activeNodes.push(node);
    return node;
  }

  function connectOut(node, route = 'stereo') {
    ensure();
    const merger = ctx.createChannelMerger(2);
    const gL = ctx.createGain();
    const gR = ctx.createGain();
    if (route === 'l') { gL.gain.value = 1; gR.gain.value = 0; }
    else if (route === 'r') { gL.gain.value = 0; gR.gain.value = 1; }
    else { gL.gain.value = 1; gR.gain.value = 1; }

    // split mono-ish sources
    const split = ctx.createChannelSplitter(2);
    try {
      node.connect(genAnalyser);
    } catch (_) {}
    node.connect(gL);
    node.connect(gR);
    gL.connect(merger, 0, 0);
    gR.connect(merger, 0, 1);
    merger.connect(masterGain);
    track(node); track(gL); track(gR); track(merger);
    return { gL, gR, merger };
  }

  /** Connect with optional invert on R */
  function connectStereoPair(leftNode, rightNode) {
    ensure();
    const merger = ctx.createChannelMerger(2);
    leftNode.connect(merger, 0, 0);
    rightNode.connect(merger, 0, 1);
    try { leftNode.connect(genAnalyser); } catch (_) {}
    merger.connect(masterGain);
    track(leftNode); track(rightNode); track(merger);
    return merger;
  }

  function stopAll() {
    activeNodes.forEach((n) => {
      try { if (n.stop) n.stop(); } catch (_) {}
      try { n.disconnect(); } catch (_) {}
    });
    activeNodes = [];
  }

  async function enableMic() {
    ensure();
    if (micStream) return { ok: true, analyser: micAnalyser };
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      micSource = ctx.createMediaStreamSource(micStream);
      micAnalyser = ctx.createAnalyser();
      micAnalyser.fftSize = 4096;
      micAnalyser.smoothingTimeConstant = 0.5;
      micSource.connect(micAnalyser);
      return { ok: true, analyser: micAnalyser };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  function getMicAnalyser() { return micAnalyser; }
  function getGenAnalyser() { ensure(); return genAnalyser; }
  function hasMic() { return !!micAnalyser; }

  function getAnalysisAnalyser(source) {
    ensure();
    if (source === 'gen') return genAnalyser;
    return micAnalyser || genAnalyser;
  }

  function createOsc(freq, type = 'sine') {
    ensure();
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return track(o);
  }

  function createGain(v = 1) {
    ensure();
    const g = ctx.createGain();
    g.gain.value = v;
    return track(g);
  }

  /** Pink noise via Paul Kellet filter */
  function createNoise(kind = 'white') {
    ensure();
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    if (kind === 'white') {
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    } else {
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return track(src);
  }

  function createSweepBuffer(f0, f1, dur) {
    ensure();
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * dur);
    const buffer = ctx.createBuffer(1, n, sr);
    const data = buffer.getChannelData(0);
    const ln = Math.log(f1 / f0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const phase = 2 * Math.PI * f0 * dur / ln * (Math.exp(t / dur * ln) - 1);
      // fade in/out
      let env = 1;
      const fade = 0.02;
      if (t < fade) env = t / fade;
      if (t > dur - fade) env = (dur - t) / fade;
      data[i] = Math.sin(phase) * env * 0.8;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return track(src);
  }

  function createImpulseBuffer(count = 1, gapSec = 0.35) {
    ensure();
    const sr = ctx.sampleRate;
    const pulseLen = Math.floor(sr * 0.002);
    const total = Math.floor(sr * (gapSec * count + 0.1));
    const buffer = ctx.createBuffer(1, total, sr);
    const data = buffer.getChannelData(0);
    for (let c = 0; c < count; c++) {
      const start = Math.floor(c * gapSec * sr) + Math.floor(0.05 * sr);
      for (let i = 0; i < pulseLen; i++) {
        // positive-going half-sine click
        data[start + i] = Math.sin(Math.PI * i / pulseLen) * 0.95;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return track(src);
  }

  function createChirpBuffer(durMs = 200, f0 = 200, f1 = 4000) {
    ensure();
    const sr = ctx.sampleRate;
    const dur = durMs / 1000;
    const n = Math.floor(sr * dur);
    const buffer = ctx.createBuffer(1, n, sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = f0 + (f1 - f0) * (t / dur);
      const phase = 2 * Math.PI * (f0 * t + (f1 - f0) * t * t / (2 * dur));
      let env = 1;
      const fade = Math.min(0.01, dur / 10);
      if (t < fade) env = t / fade;
      if (t > dur - fade) env = (dur - t) / fade;
      data[i] = Math.sin(phase) * env * 0.85;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return track(src);
  }

  function createBurst(freq, bursts = 4, onMs = 50, offMs = 50) {
    ensure();
    const sr = ctx.sampleRate;
    const totalMs = bursts * (onMs + offMs);
    const n = Math.floor(sr * totalMs / 1000);
    const buffer = ctx.createBuffer(1, n, sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const tMs = (i / sr) * 1000;
      const cycle = onMs + offMs;
      const pos = tMs % cycle;
      if (pos < onMs) {
        data[i] = Math.sin(2 * Math.PI * freq * (i / sr)) * 0.8;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return track(src);
  }

  function biquad(type, freq, Q = Math.SQRT1_2) {
    ensure();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    return track(f);
  }

  /** Chain Butterworth approx: 12dB = 1 biquad, 24dB = 2 cascaded */
  function makeCrossover(kind, freq, slope, freq2) {
    ensure();
    const filters = [];
    const stages = slope >= 24 ? 2 : 1;
    const mk = (type, fr) => {
      for (let i = 0; i < stages; i++) {
        filters.push(biquad(type, fr, Math.SQRT1_2));
      }
    };
    if (kind === 'hpf') mk('highpass', freq);
    else if (kind === 'lpf') mk('lowpass', freq);
    else if (kind === 'bpf') {
      mk('highpass', freq);
      mk('lowpass', freq2 || freq * 4);
    }
    return filters;
  }

  function chainConnect(source, filters, route) {
    let node = source;
    filters.forEach((f) => {
      node.connect(f);
      node = f;
    });
    return connectOut(node, route);
  }

  function captureTimeData(analyser, seconds = 0.5) {
    return new Promise((resolve) => {
      if (!analyser) { resolve(null); return; }
      ensure();
      const sr = ctx.sampleRate;
      const need = Math.floor(sr * seconds);
      const out = new Float32Array(need);
      let offset = 0;
      const buf = new Float32Array(analyser.fftSize);
      const iv = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        const take = Math.min(buf.length, need - offset);
        out.set(buf.subarray(0, take), offset);
        offset += take;
        if (offset >= need) {
          clearInterval(iv);
          resolve({ data: out, sampleRate: sr });
        }
      }, (analyser.fftSize / sr) * 1000 * 0.5);
    });
  }

  function crossCorrelate(a, b) {
    const n = Math.min(a.length, b.length);
    const maxLag = Math.min(Math.floor(n / 4), 48000); // ~1s at 48k
    let bestLag = 0;
    let bestVal = -Infinity;
    const result = new Float32Array(maxLag * 2 + 1);
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < n; i++) {
        const j = i + lag;
        if (j < 0 || j >= n) continue;
        sum += a[i] * b[j];
        count++;
      }
      const v = count ? sum / count : 0;
      result[lag + maxLag] = v;
      if (v > bestVal) { bestVal = v; bestLag = lag; }
    }
    return { bestLag, bestVal, result, maxLag };
  }

  /** Goertzel-ish phase estimate at freq between two buffers, or single mic vs ideal */
  function estimatePhase(samples, freq, sampleRate) {
    const n = samples.length;
    let re = 0, im = 0;
    const w = 2 * Math.PI * freq / sampleRate;
    for (let i = 0; i < n; i++) {
      re += samples[i] * Math.cos(w * i);
      im -= samples[i] * Math.sin(w * i);
    }
    const mag = Math.hypot(re, im);
    const phase = Math.atan2(im, re) * 180 / Math.PI;
    return { phase, mag };
  }

  function sampleRate() {
    ensure();
    return ctx.sampleRate;
  }

  function now() {
    ensure();
    return ctx.currentTime;
  }

  function getCtx() { ensure(); return ctx; }

  return {
    ensure, setMasterLevel, getMasterLevel, stopAll,
    enableMic, getMicAnalyser, getGenAnalyser, hasMic, getAnalysisAnalyser,
    createOsc, createGain, createNoise, createSweepBuffer,
    createImpulseBuffer, createChirpBuffer, createBurst,
    connectOut, connectStereoPair, chainConnect, makeCrossover, biquad,
    captureTimeData, crossCorrelate, estimatePhase,
    sampleRate, now, getCtx, track,
  };
})();
