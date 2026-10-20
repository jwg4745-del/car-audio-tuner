/** 分频辅助 — Butterworth HPF/LPF/BPF */
const Xover = (() => {
  let playing = false;
  let bypass = false;

  function el(id) { return document.getElementById(id); }

  function init() {
    el('xoPlay').onclick = () => { bypass = false; play(); };
    el('xoBypass').onclick = () => { bypass = true; play(); };
    el('xoStop').onclick = stop;
    ['xoType', 'xoFreq', 'xoSlope', 'xoFreq2'].forEach((id) => {
      el(id).addEventListener('change', () => { updateInfo(); drawResponse(); });
      el(id).addEventListener('input', () => { updateInfo(); drawResponse(); });
    });
    const loadFields = () => { const c = Channels.get(el('xoChan').value); if (!c) return; el('xoChHpf').value = c.hpf ?? ''; el('xoChLpf').value = c.lpf ?? ''; };
    el('xoChan').addEventListener('change', loadFields);
    Channels.onChange(loadFields);
    setTimeout(loadFields, 0);
    el('xoSaveCh').onclick = () => {
      const v = (id) => (el(id).value === '' ? null : Math.max(10, Math.min(20000, +el(id).value)));
      Channels.update(el('xoChan').value, { hpf: v('xoChHpf'), lpf: v('xoChLpf'), slope: +el('xoSlope').value });
    };
    el('xoDefCh').onclick = () => { const c = Channels.get(el('xoChan').value); const d = Channels.XO[c.type]; Channels.update(c.id, { hpf: d.hpf, lpf: d.lpf }); };
    el('xoLoadCh').onclick = () => {
      const c = Channels.get(el('xoChan').value);
      if (c.hpf && c.lpf) { el('xoType').value = 'bpf'; el('xoFreq').value = c.hpf; el('xoFreq2').value = c.lpf; }
      else if (c.hpf) { el('xoType').value = 'hpf'; el('xoFreq').value = c.hpf; }
      else if (c.lpf) { el('xoType').value = 'lpf'; el('xoFreq').value = c.lpf; }
      else { bypass = true; updateInfo(); drawResponse(); play(); return; }
      el('xoSlope').value = String(c.slope || 24);
      bypass = false; updateInfo(); drawResponse(); play();
    };
    updateInfo();
    drawResponse();
  }

  function updateInfo() {
    const type = el('xoType').value;
    const f = +el('xoFreq').value;
    const slope = el('xoSlope').value;
    const names = { hpf: 'HPF', lpf: 'LPF', bpf: 'BPF' };
    el('xoInfo').textContent = `${names[type]} ${f}Hz`;
    el('xoCut').textContent = f;
    el('xoSlopeOut').textContent = slope;
  }

  function play() {
    AudioEngine.stopAll();
    playing = true;
    el('xoPlay').disabled = true;
    el('xoStop').disabled = false;
    updateInfo();

    const type = el('xoType').value;
    const f = +el('xoFreq').value;
    const f2 = +el('xoFreq2').value;
    const slope = +el('xoSlope').value;
    const sig = el('xoSig').value;
    const route = Channels.routeFor(el('xoChan').value);

    let src;
    if (sig === 'pink' || sig === 'white') {
      src = AudioEngine.createNoise(sig);
    } else if (sig === 'sine') {
      src = AudioEngine.createOsc(+el('xoSineHz').value || 1000);
    } else {
      src = AudioEngine.createSweepBuffer(20, 20000, 8);
    }

    const g = AudioEngine.createGain(0.55);
    src.connect(g);

    if (bypass) {
      AudioEngine.connectOut(g, route);
    } else {
      const filters = AudioEngine.makeCrossover(type, f, slope, f2);
      AudioEngine.chainConnect(g, filters, route);
    }
    src.start();
    if (sig === 'sweep' || sig === 'impulse') {
      src.onended = stop;
    }
    drawResponse();
  }

  function stop() {
    playing = false;
    AudioEngine.stopAll();
    el('xoPlay').disabled = false;
    el('xoStop').disabled = true;
  }

  /** Approximate magnitude response for display */
  function magDb(type, f, fc, slope, fc2, freq) {
    const n = slope >= 24 ? 4 : 2; // order
    const w = freq / fc;
    if (type === 'hpf') {
      // Butterworth |H| approx
      return 10 * Math.log10(1 / (1 + Math.pow(1 / w, 2 * n)));
    }
    if (type === 'lpf') {
      return 10 * Math.log10(1 / (1 + Math.pow(w, 2 * n)));
    }
    // bpf = hpf*lpf
    const h = magDb('hpf', f, fc, slope, fc2, freq);
    const l = magDb('lpf', f, fc2, slope, fc2, freq);
    return h + l;
  }

  function drawResponse() {
    const canvas = el('xoCanvas');
    if (!canvas) return;
    const c = canvas.getContext('2d');
    const type = el('xoType').value;
    const fc = +el('xoFreq').value;
    const fc2 = +el('xoFreq2').value;
    const slope = +el('xoSlope').value;

    c.fillStyle = '#0a0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);

    // grid
    c.strokeStyle = '#21262d';
    [50, 100, 500, 1000, 5000, 10000].forEach((f) => {
      const x = freqToX(f, canvas.width);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, canvas.height); c.stroke();
    });

    c.strokeStyle = bypass ? '#8b949e' : '#a371f7';
    c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i < canvas.width; i++) {
      const f = xToFreq(i, canvas.width);
      const db = bypass ? 0 : magDb(type, fc, fc, slope, fc2, f);
      const y = dbToY(db, canvas.height);
      if (i === 0) c.moveTo(i, y); else c.lineTo(i, y);
    }
    c.stroke();

    // -3dB marker
    const x3 = freqToX(fc, canvas.width);
    c.strokeStyle = '#d29922';
    c.setLineDash([4, 3]);
    c.beginPath(); c.moveTo(x3, 0); c.lineTo(x3, canvas.height); c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#8b949e';
    c.font = '12px sans-serif';
    c.fillText((bypass ? '直通' : type.toUpperCase()) + ' @ ' + fc + ' Hz · ' + slope + ' dB/oct', 12, 20);
  }

  function freqToX(f, w) {
    return (Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * w;
  }
  function xToFreq(x, w) {
    return Math.pow(10, Math.log10(20) + (x / w) * (Math.log10(20000) - Math.log10(20)));
  }
  function dbToY(db, h) {
    // 10 .. -60
    const max = 10, min = -60;
    return (1 - (db - min) / (max - min)) * h;
  }

  return { init, play, stop };
})();
