/** RTA / 频谱分析 + 目标曲线 */
const RTA = (() => {
  let running = false;
  let anim = null;
  let peakHold = null;
  let avgBuf = null;
  let pinkOn = false;

  const OCT3 = (() => {
    const bands = [];
    let f = 20;
    while (f <= 20000) { bands.push(f); f *= Math.pow(2, 1/3); }
    return bands;
  })();
  const OCT1 = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  function el(id) { return document.getElementById(id); }

  function targetDb(freq, curve) {
    if (curve === 'none' || !curve) return null;
    const x = Math.log10(Math.max(20, freq) / 1000);
    if (curve === 'flat') return 0;
    if (curve === 'house') return -3 * Math.max(0, x); // gentle HF roll
    if (curve === 'car') return 2 - 4 * Math.max(0, x) + (freq < 80 ? 1.5 * (1 - freq/80) : 0);
    if (curve === 'xcurve') return freq > 2000 ? -3 * Math.log10(freq / 2000) / Math.log10(10) * 3 : 0;
    return 0;
  }

  function init() {
    el('rtaStart').onclick = start;
    el('rtaStop').onclick = stop;
    el('rtaResetPeak').onclick = () => { peakHold = null; };
    el('rtaPink').onclick = togglePink;
    el('rtaFft').onchange = () => {
      const a = getAnalyser();
      if (a) a.fftSize = +el('rtaFft').value;
    };
    drawIdle();
  }

  function getAnalyser() {
    const src = el('analysisSource').value;
    return AudioEngine.getAnalysisAnalyser(src);
  }

  async function start() {
    const src = el('analysisSource').value;
    if (src === 'mic') {
      const r = await AudioEngine.enableMic();
      if (!r.ok) {
        alert('麦克风不可用：' + r.error + '\n可改用「发生器环回」或先连接麦克风。');
        return;
      }
      App.setMicUI(true);
    }
    running = true;
    peakHold = null;
    avgBuf = null;
    el('rtaStart').disabled = true;
    el('rtaStop').disabled = false;
    const a = getAnalyser();
    if (a) a.fftSize = +el('rtaFft').value;
    loop();
  }

  function stop() {
    AudioEngine.releaseMic();
    running = false;
    if (anim) cancelAnimationFrame(anim);
    el('rtaStart').disabled = false;
    el('rtaStop').disabled = true;
    if (pinkOn) { AudioEngine.stopAll(); pinkOn = false; }
  }

  function togglePink() {
    if (pinkOn) {
      AudioEngine.stopAll();
      pinkOn = false;
      el('rtaPink').textContent = '+ 粉红噪声激励';
      return;
    }
    const n = AudioEngine.createNoise('pink');
    const g = AudioEngine.createGain(0.5);
    n.connect(g);
    AudioEngine.connectOut(g, 'stereo');
    n.start();
    pinkOn = true;
    el('rtaPink').textContent = '■ 停止粉红噪声';
  }

  function freqToX(f, w) {
    const minF = 20, maxF = 20000;
    return (Math.log10(f) - Math.log10(minF)) / (Math.log10(maxF) - Math.log10(minF)) * w;
  }

  function loop() {
    if (!running) return;
    const canvas = el('rtaCanvas');
    const c = canvas.getContext('2d');
    const analyser = getAnalyser();
    if (!analyser) { anim = requestAnimationFrame(loop); return; }

    const bins = analyser.frequencyBinCount;
    const data = new Float32Array(bins);
    analyser.getFloatFrequencyData(data);
    const sr = AudioEngine.sampleRate();
    if (typeof Cal !== 'undefined' && Cal.active()) {
      const key = Cal.label() + bins + sr;
      if (!loop.calKey || loop.calKey !== key) { loop.calKey = key; loop.calArr = new Float32Array(bins); for (let i = 1; i < bins; i++) loop.calArr[i] = Cal.corr(i * sr / (2 * bins)); }
      for (let i = 1; i < bins; i++) data[i] += loop.calArr[i];
    }
    const mode = el('rtaMode').value;
    const usePeak = el('rtaPeakHold').checked;
    const useAvg = el('rtaAvg').checked;
    const curve = el('targetCurve').value;

    if (!peakHold || peakHold.length !== bins) peakHold = new Float32Array(bins).fill(-140);
    if (!avgBuf || avgBuf.length !== bins) avgBuf = Float32Array.from(data);
    else {
      for (let i = 0; i < bins; i++) {
        avgBuf[i] = useAvg ? avgBuf[i] * 0.85 + data[i] * 0.15 : data[i];
        if (usePeak) peakHold[i] = Math.max(peakHold[i], data[i]);
      }
    }

    const plot = useAvg ? avgBuf : data;
    const dbMin = -100, dbMax = 0;
    c.fillStyle = '#0a0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);

    // grid
    c.strokeStyle = '#21262d';
    c.lineWidth = 1;
    [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => {
      const x = freqToX(f, canvas.width);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, canvas.height); c.stroke();
    });
    [-20, -40, -60, -80].forEach((db) => {
      const y = dbToY(db, canvas.height);
      c.beginPath(); c.moveTo(0, y); c.lineTo(canvas.width, y); c.stroke();
    });

    let peakF = 20, peakDb = -140;

    function dbToY(db, h) {
      return (1 - (db - dbMin) / (dbMax - dbMin)) * h;
    }

    if (mode === 'fft') {
      c.beginPath();
      c.strokeStyle = '#3fb950';
      c.lineWidth = 1.5;
      for (let i = 1; i < bins; i++) {
        const f = i * sr / analyser.fftSize;
        if (f < 20 || f > 20000) continue;
        const x = freqToX(f, canvas.width);
        const y = dbToY(plot[i], canvas.height);
        if (plot[i] > peakDb) { peakDb = plot[i]; peakF = f; }
        if (i === 1) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      if (usePeak) {
        c.beginPath();
        c.strokeStyle = '#d29922';
        c.lineWidth = 1;
        for (let i = 1; i < bins; i++) {
          const f = i * sr / analyser.fftSize;
          if (f < 20 || f > 20000) continue;
          const x = freqToX(f, canvas.width);
          const y = dbToY(peakHold[i], canvas.height);
          if (i === 1) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
    } else {
      const bands = mode === 'oct1' ? OCT1 : OCT3;
      const bw = mode === 'oct1' ? Math.pow(2, 0.5) : Math.pow(2, 1/6);
      bands.forEach((fc) => {
        const fLo = fc / bw, fHi = fc * bw;
        let sum = 0, n = 0, psum = 0;
        const i0 = Math.floor(fLo * analyser.fftSize / sr);
        const i1 = Math.ceil(fHi * analyser.fftSize / sr);
        for (let i = i0; i <= i1 && i < bins; i++) {
          if (i < 1) continue;
          sum += plot[i]; n++;
          psum += peakHold[i];
        }
        if (!n) return;
        const db = sum / n;
        if (db > peakDb) { peakDb = db; peakF = fc; }
        const x0 = freqToX(fLo, canvas.width);
        const x1 = freqToX(fHi, canvas.width);
        const y = dbToY(db, canvas.height);
        c.fillStyle = 'rgba(63,185,80,0.75)';
        c.fillRect(x0 + 1, y, Math.max(2, x1 - x0 - 2), canvas.height - y);
        if (usePeak) {
          const yp = dbToY(psum / n, canvas.height);
          c.fillStyle = 'rgba(210,153,34,0.5)';
          c.fillRect(x0 + 1, yp, Math.max(2, x1 - x0 - 2), 3);
        }
      });
    }

    // target curve overlay (relative shape around -30 dB)
    if (curve !== 'none') {
      c.beginPath();
      c.strokeStyle = '#f85149';
      c.setLineDash([4, 4]);
      c.lineWidth = 1.5;
      let first = true;
      for (let f = 20; f <= 20000; f *= 1.03) {
        const td = targetDb(f, curve);
        const y = dbToY(-35 + td, canvas.height);
        const x = freqToX(f, canvas.width);
        if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y);
      }
      c.stroke();
      c.setLineDash([]);
    }

    // RMS-ish from time domain
    const td = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(td);
    let s = 0;
    for (let i = 0; i < td.length; i++) s += td[i] * td[i];
    const rms = Math.sqrt(s / td.length);
    const rmsDb = rms > 1e-8 ? 20 * Math.log10(rms) : -100;

    if (peakF >= 1000) {
      el('rtaPeakF').textContent = (peakF / 1000).toFixed(2);
      el('rtaPeakF').nextElementSibling.textContent = 'kHz';
    } else {
      el('rtaPeakF').textContent = String(Math.round(peakF));
      el('rtaPeakF').nextElementSibling.textContent = 'Hz';
    }
    el('rtaPeakDb').textContent = peakDb.toFixed(1);
    el('rtaRms').textContent = rmsDb.toFixed(1);

    anim = requestAnimationFrame(loop);
  }

  function drawIdle() {
    const canvas = el('rtaCanvas');
    if (!canvas) return;
    const c = canvas.getContext('2d');
    c.fillStyle = '#0a0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#8b949e';
    c.font = '14px sans-serif';
    c.fillText('点击「开始分析」显示频谱', 20, 30);
  }

  function getSnapshot() {
    return {
      peakFreq: el('rtaPeakF').textContent,
      peakDb: el('rtaPeakDb').textContent,
      rms: el('rtaRms').textContent,
      curve: el('targetCurve').value,
      mode: el('rtaMode').value,
    };
  }

  return { init, start, stop, getSnapshot, targetDb };
})();
