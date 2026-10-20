/** 极性检测 — 脉冲首波 */
const Polarity = (() => {
  let busy = false;

  function el(id) { return document.getElementById(id); }

  function init() {
    el('polChan').addEventListener('change', () => { const r = Channels.routeFor(el('polChan').value); el('polCh').value = r === 'stereo' ? 'both' : r; });
    el('polFire').onclick = () => fire(false);
    el('polMeasure').onclick = () => fire(true);
    el('polStop').onclick = () => {
      busy = false;
      AudioEngine.stopAll();
      el('polStop').disabled = true;
    };
    drawEmpty();
  }

  async function fire(doMeasure) {
    AudioEngine.stopAll();
    busy = true;
    el('polStop').disabled = false;
    const ch = el('polCh').value;
    const count = +el('polCount').value || 3;
    const route = ch === 'both' ? 'stereo' : ch;

    let micReady = false;
    if (doMeasure) {
      const r = await AudioEngine.enableMic();
      if (!r.ok) {
        alert('极性检测需要麦克风：' + r.error);
        // still play pulses for visual/listen
      } else {
        micReady = true;
        App.setMicUI(true);
      }
    }

    // start capture slightly before pulse
    let capturePromise = null;
    if (micReady) {
      capturePromise = AudioEngine.captureTimeData(AudioEngine.getMicAnalyser(), 0.8);
    }

    const src = AudioEngine.createImpulseBuffer(count, 0.3);
    AudioEngine.connectOut(src, route);
    src.start();

    drawPulsePreview();

    if (capturePromise) {
      const cap = await capturePromise;
      analyze(cap);
    } else {
      el('polResult').textContent = doMeasure ? '无麦' : '已发射';
      el('polResult').className = 'value status warn';
      el('polAdvice').textContent = '听感/示波自行判断';
    }

    src.onended = () => {
      busy = false;
      el('polStop').disabled = true;
    };
  }

  function analyze(cap) {
    if (!cap) return;
    const d = cap.data;
    // find peak absolute sample after noise floor settles
    let peakI = 0, peakV = 0;
    const start = Math.floor(cap.sampleRate * 0.04);
    for (let i = start; i < d.length; i++) {
      if (Math.abs(d[i]) > Math.abs(peakV)) {
        peakV = d[i];
        peakI = i;
      }
    }
    // look at first significant excursion (threshold)
    const thresh = Math.abs(peakV) * 0.35;
    let firstI = peakI;
    for (let i = start; i < d.length; i++) {
      if (Math.abs(d[i]) >= thresh) { firstI = i; break; }
    }
    // polarity from slope / first peak sign in a short window
    let winPeak = 0;
    for (let i = firstI; i < Math.min(firstI + Math.floor(cap.sampleRate * 0.005), d.length); i++) {
      if (Math.abs(d[i]) > Math.abs(winPeak)) winPeak = d[i];
    }

    const positive = winPeak >= 0;
    el('polPeak').textContent = winPeak.toFixed(3);
    const res = el('polResult');
    const adv = el('polAdvice');
    if (Math.abs(winPeak) < 0.01) {
      res.textContent = '信号弱';
      res.className = 'value status warn';
      adv.textContent = '提高音量或靠近麦克风';
    } else if (positive) {
      res.textContent = '正极性 +';
      res.className = 'value status ok';
      adv.textContent = '接线正常';
      Channels.update(el('polChan').value, { polarity: '正 +' });
    } else {
      res.textContent = '反极性 −';
      res.className = 'value status bad';
      adv.textContent = '检查正负极';
      Channels.update(el('polChan').value, { polarity: '反 −' });
    }
    drawCapture(d, firstI, winPeak);
  }

  function drawPulsePreview() {
    const canvas = el('polCanvas');
    const c = canvas.getContext('2d');
    c.fillStyle = '#0a0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.strokeStyle = '#a371f7';
    c.lineWidth = 2;
    c.beginPath();
    const mid = canvas.height / 2;
    for (let x = 0; x < canvas.width; x++) {
      const t = x / canvas.width;
      let y = mid;
      if (t > 0.2 && t < 0.28) y = mid - Math.sin((t - 0.2) / 0.08 * Math.PI) * 80;
      if (t > 0.5 && t < 0.58) y = mid - Math.sin((t - 0.5) / 0.08 * Math.PI) * 80;
      if (t > 0.8 && t < 0.88) y = mid - Math.sin((t - 0.8) / 0.08 * Math.PI) * 80;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    c.fillStyle = '#8b949e';
    c.font = '12px sans-serif';
    c.fillText('正向脉冲示意（振膜外推）', 12, 20);
  }

  function drawCapture(data, mark, peak) {
    const canvas = el('polCanvas');
    const c = canvas.getContext('2d');
    c.fillStyle = '#0a0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);
    const mid = canvas.height / 2;
    const step = Math.max(1, Math.floor(data.length / canvas.width));
    c.strokeStyle = '#58a6ff';
    c.beginPath();
    for (let x = 0; x < canvas.width; x++) {
      const i = x * step;
      const y = mid - (data[i] || 0) * mid * 0.9;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    const mx = (mark / data.length) * canvas.width;
    c.strokeStyle = peak >= 0 ? '#3fb950' : '#f85149';
    c.beginPath();
    c.moveTo(mx, 0); c.lineTo(mx, canvas.height); c.stroke();
    c.fillStyle = '#e6edf3';
    c.font = '12px sans-serif';
    c.fillText('首波 ' + (peak >= 0 ? '+' : '−') + '  peak=' + peak.toFixed(3), 12, 20);
  }

  function drawEmpty() {
    const canvas = el('polCanvas');
    if (!canvas) return;
    const c = canvas.getContext('2d');
    c.fillStyle = '#0a0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#8b949e';
    c.font = '14px sans-serif';
    c.fillText('发射脉冲后显示波形', 20, 30);
  }

  function getSnapshot() {
    return {
      result: el('polResult').textContent,
      peak: el('polPeak').textContent,
      advice: el('polAdvice').textContent,
    };
  }

  return { init, getSnapshot };
})();
