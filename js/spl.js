/** 相对声压 / 电平匹配 */
const SPL = (() => {
  let running = false;
  let anim = null;
  let history = [];
  let peak = -100;
  let avgAcc = 0, avgN = 0;
  const levels = {}; // channel -> avg dBFS

  function el(id) { return document.getElementById(id); }

  function init() {
    Channels.onChange(renderTable);
    setTimeout(renderTable, 0);
    el('splStart').onclick = start;
    el('splStop').onclick = stop;
    el('splCapture').onclick = capture;
    drawEmpty();
  }

  async function start() {
    const sig = el('splSig').value;
    const r = await AudioEngine.enableMic();
    if (!r.ok && sig !== 'none') {
      // still allow gen-only meter from gen analyser
      console.warn(r.error);
    }
    if (r.ok) App.setMicUI(true);

    AudioEngine.stopAll();
    if (sig === 'pink') {
      const n = AudioEngine.createNoise('pink');
      const g = AudioEngine.createGain(0.5);
      n.connect(g);
      AudioEngine.connectOut(g, 'stereo');
      n.start();
    } else if (sig === 'sine') {
      const o = AudioEngine.createOsc(1000);
      const g = AudioEngine.createGain(0.55);
      o.connect(g);
      AudioEngine.connectOut(g, 'stereo');
      o.start();
    }

    running = true;
    peak = -100;
    avgAcc = 0; avgN = 0;
    history = [];
    el('splStart').disabled = true;
    el('splStop').disabled = false;
    loop();
  }

  function stop() {
    running = false;
    AudioEngine.stopAll();
    if (anim) cancelAnimationFrame(anim);
    el('splStart').disabled = false;
    el('splStop').disabled = true;
  }

  function getAnalyser() {
    const src = el('analysisSource').value;
    return AudioEngine.getAnalysisAnalyser(src) || AudioEngine.getGenAnalyser();
  }

  function loop() {
    if (!running) return;
    const analyser = getAnalyser();
    if (!analyser) { anim = requestAnimationFrame(loop); return; }
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / buf.length);
    const db = rms > 1e-9 ? 20 * Math.log10(rms) : -100;
    peak = Math.max(peak, db);
    avgAcc += db; avgN++;
    const avg = avgAcc / avgN;

    el('splNow').textContent = db.toFixed(1);
    el('splPeak').textContent = peak.toFixed(1);
    el('splAvg').textContent = avg.toFixed(1);

    // meter: map -60..0 to 0..100%
    const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    el('splMeter').style.width = pct + '%';

    history.push(db);
    if (history.length > 300) history.shift();
    drawHistory();
    anim = requestAnimationFrame(loop);
  }

  function capture() {
    const avg = avgN ? avgAcc / avgN : NaN;
    if (!isFinite(avg)) { alert('请先开始监测'); return; }
    Channels.getAll().forEach((c) => { if (c.gainSetDb != null) Channels.update(c.id, { gainSetDb: null }); });
    Channels.update(el('splLabel').value, { levelDb: avg });
  }

  function renderTable() {
    const body = el('splTableBody');
    if (!body) return;
    const g = Channels.gainPlan();
    const html = Channels.getAll().map((c, i) => g[i] ? `<tr><td>CH${c.id} ${c.name}</td><td>${c.levelDb.toFixed(1)}</td><td>+${g[i].rel.toFixed(1)} dB</td><td>${g[i].trim.toFixed(1)} dB</td></tr>` : '').join('');
    body.innerHTML = html || '<tr><td colspan="4" class="muted">暂无 — 每个通道单独播放后「记录当前通道」</td></tr>';
  }

  function drawHistory() {
    const canvas = el('splCanvas');
    const c = canvas.getContext('2d');
    c.fillStyle = '#0a0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.strokeStyle = '#21262d';
    [-20, -40, -60].forEach((db) => {
      const y = ((-db) / 80) * canvas.height; // rough
      const yy = (1 - (db + 80) / 80) * canvas.height;
      c.beginPath(); c.moveTo(0, yy); c.lineTo(canvas.width, yy); c.stroke();
    });
    if (history.length < 2) return;
    c.strokeStyle = '#3fb950';
    c.lineWidth = 2;
    c.beginPath();
    history.forEach((db, i) => {
      const x = (i / (history.length - 1)) * canvas.width;
      const y = (1 - (db + 80) / 80) * canvas.height;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    c.stroke();
  }

  function drawEmpty() {
    const canvas = el('splCanvas');
    if (!canvas) return;
    const c = canvas.getContext('2d');
    c.fillStyle = '#0a0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#8b949e';
    c.font = '14px sans-serif';
    c.fillText('相对电平（未校准 dBFS）', 20, 30);
  }

  function getSnapshot() { return { levels: Channels.getAll().filter((c) => c.levelDb != null).map((c) => ({ ch: c.id, name: c.name, levelDb: c.levelDb })), lastAvg: el('splAvg').textContent }; }
  function loadLevels() { renderTable(); }

  return { init, start, stop, getSnapshot, loadLevels };
})();
