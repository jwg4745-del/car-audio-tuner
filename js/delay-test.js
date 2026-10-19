/** 延时 / 时域对齐 */
const DelayTest = (() => {
  const rows = {}; // label -> {ms, cm, suggest}
  let last = null;

  function el(id) { return document.getElementById(id); }

  function init() {
    el('delayPlay').onclick = measure;
    el('delayStop').onclick = () => {
      AudioEngine.stopAll();
      el('delayStop').disabled = true;
      el('delayPlay').disabled = false;
    };
    el('delaySaveRow').onclick = saveRow;
  }

  async function measure() {
    AudioEngine.stopAll();
    el('delayPlay').disabled = true;
    el('delayStop').disabled = false;

    const out = el('delayOut').value;
    const sig = el('delaySig').value;
    const speed = +el('soundSpeed').value || 343;

    const useMic = true;
    const r = await AudioEngine.enableMic();
    if (!r.ok) {
      alert('延时测量需要麦克风：' + r.error + '\n无麦时仅可播放测试信号。');
      // play only
      const src = sig === 'chirp'
        ? AudioEngine.createChirpBuffer(200, 200, 5000)
        : AudioEngine.createImpulseBuffer(1, 0.2);
      AudioEngine.connectOut(src, out);
      src.start();
      src.onended = () => {
        el('delayPlay').disabled = false;
        el('delayStop').disabled = true;
      };
      return;
    }
    App.setMicUI(true);

    // Capture ambient ref then play and capture response — use gen reference vs mic
    const chirpMs = 200;
    const src = sig === 'chirp'
      ? AudioEngine.createChirpBuffer(chirpMs, 150, 6000)
      : AudioEngine.createImpulseBuffer(1, 0.15);

    // Build reference samples from same buffer
    const refBuf = src.buffer.getChannelData(0);
    const ref = Float32Array.from(refBuf);

    const captureP = AudioEngine.captureTimeData(AudioEngine.getMicAnalyser(), 0.6);
    AudioEngine.connectOut(src, out);
    // small delay then start
    src.start(AudioEngine.now() + 0.05);

    const cap = await captureP;
    AudioEngine.stopAll();
    el('delayPlay').disabled = false;
    el('delayStop').disabled = true;

    if (!cap) return;

    // Cross-correlate mic capture with emitted reference (zero-pad ref to cap length)
    const a = new Float32Array(cap.data.length);
    a.set(ref.subarray(0, Math.min(ref.length, a.length)));
    const xc = AudioEngine.crossCorrelate(a, cap.data);
    const lagSec = xc.bestLag / cap.sampleRate;
    // Absolute path delay from play; for relative, user measures two channels and subtracts
    const ms = lagSec * 1000;
    const cm = lagSec * speed * 100;

    // Store as relative to "this measurement"; suggestion: if this channel is closer (smaller delay), add delay
    last = {
      label: el('delayCmpLabel').value,
      refLabel: el('delayRefLabel').value,
      ms,
      cm,
      lag: xc.bestLag,
      corr: xc.bestVal,
    };

    el('delayMs').textContent = ms.toFixed(2);
    el('delayCm').textContent = cm.toFixed(1);
    const suggest = ms >= 0
      ? `对比通道晚 ${ms.toFixed(2)} ms，参考可补延时`
      : `对比通道早 ${(-ms).toFixed(2)} ms，对比通道补 ${(-ms).toFixed(2)} ms`;
    el('delaySuggest').textContent = suggest.length > 18 ? ms.toFixed(2) + ' ms' : suggest;
    el('delaySuggest').title = suggest;

    drawXc(xc, cap.sampleRate, speed);
  }

  function saveRow() {
    if (!last) {
      alert('请先测量');
      return;
    }
    const label = el('delayCmpLabel').value;
    const speed = +el('soundSpeed').value || 343;
    rows[label] = {
      ms: last.ms,
      cm: last.cm,
      suggest: last.ms < 0 ? `+${(-last.ms).toFixed(2)} ms` : '作参考/较远',
    };
    // Also store ref if empty
    if (!rows[el('delayRefLabel').value]) {
      rows[el('delayRefLabel').value] = { ms: 0, cm: 0, suggest: '参考 0' };
    }
    renderTable();
  }

  function renderTable() {
    const body = el('delayTableBody');
    const keys = Object.keys(rows);
    if (!keys.length) {
      body.innerHTML = '<tr><td colspan="4" class="muted">暂无记录</td></tr>';
      return;
    }
    // Normalize: farthest (max ms) = 0 delay compensation, others get (max-ms)
    let maxMs = -Infinity;
    keys.forEach((k) => { maxMs = Math.max(maxMs, rows[k].ms); });
    body.innerHTML = keys.map((k) => {
      const r = rows[k];
      const comp = (maxMs - r.ms);
      return `<tr><td>${k}</td><td>${r.ms.toFixed(2)}</td><td>${r.cm.toFixed(1)}</td><td>+${comp.toFixed(2)} ms</td></tr>`;
    }).join('');
  }

  function drawXc(xc, sr, speed) {
    const canvas = el('delayCanvas');
    const c = canvas.getContext('2d');
    c.fillStyle = '#0a0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);
    const mid = canvas.height / 2;
    const data = xc.result;
    let max = 1e-9;
    for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]));
    c.strokeStyle = '#58a6ff';
    c.beginPath();
    for (let x = 0; x < canvas.width; x++) {
      const i = Math.floor(x / canvas.width * data.length);
      const y = mid - (data[i] / max) * (mid - 10);
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    const peakX = ((xc.bestLag + xc.maxLag) / (xc.maxLag * 2)) * canvas.width;
    c.strokeStyle = '#f85149';
    c.beginPath();
    c.moveTo(peakX, 0); c.lineTo(peakX, canvas.height); c.stroke();
    c.fillStyle = '#e6edf3';
    c.font = '12px sans-serif';
    c.fillText(`峰值 lag=${xc.bestLag} samples (${(xc.bestLag/sr*1000).toFixed(2)} ms)`, 12, 20);
  }

  function getRows() { return { ...rows }; }
  function getSnapshot() {
    return { last, rows: getRows() };
  }
  function loadRows(data) {
    Object.keys(rows).forEach((k) => delete rows[k]);
    if (data) Object.assign(rows, data);
    last = null;
    renderTable();
  }

  return { init, measure, getSnapshot, getRows, loadRows };
})();
