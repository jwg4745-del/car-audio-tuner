/** 相位测试 */
const PhaseTest = (() => {
  let playing = false;
  let measuring = false;
  let anim = null;

  function el(id) { return document.getElementById(id); }

  function init() {
    el('phasePlay').onclick = play;
    el('phaseStop').onclick = stop;
    el('phaseMeasure').onclick = measure;
    drawGauge(null);
  }

  function play() {
    AudioEngine.stopAll();
    playing = true;
    el('phasePlay').disabled = true;
    el('phaseStop').disabled = false;
    const freq = +el('phaseFreq').value;
    const mode = el('phaseMode').value;

    if (mode === 'l' || mode === 'r') {
      const o = AudioEngine.createOsc(freq);
      const g = AudioEngine.createGain(0.65);
      o.connect(g);
      AudioEngine.connectOut(g, mode);
      o.start();
    } else {
      const oL = AudioEngine.createOsc(freq);
      const oR = AudioEngine.createOsc(freq);
      const gL = AudioEngine.createGain(0.65);
      const gR = AudioEngine.createGain(mode === 'inv' ? -0.65 : 0.65);
      oL.connect(gL);
      oR.connect(gR);
      AudioEngine.connectStereoPair(gL, gR);
      oL.start();
      oR.start();
    }
    startVis(freq);
  }

  function stop() {
    playing = false;
    measuring = false;
    AudioEngine.stopAll();
    if (anim) cancelAnimationFrame(anim);
    el('phasePlay').disabled = false;
    el('phaseStop').disabled = true;
  }

  async function measure() {
    const r = await AudioEngine.enableMic();
    if (!r.ok) {
      alert('需要麦克风：' + r.error + '\n也可仅用听感对比同相/反相。');
      return;
    }
    App.setMicUI(true);
    if (!playing) play();
    measuring = true;
    el('phaseVerdict').textContent = '测量中…';

    const freq = +el('phaseFreq').value;
    // Capture while playing same-phase L+R vs listen for cancellation
    // Estimate phase of mic signal relative to ideal oscillator reference
    const cap = await AudioEngine.captureTimeData(AudioEngine.getMicAnalyser(), 0.4);
    if (!cap) return;
    const est = AudioEngine.estimatePhase(cap.data, freq, cap.sampleRate);

    // Also capture a second window for correlation stability
    const cap2 = await AudioEngine.captureTimeData(AudioEngine.getMicAnalyser(), 0.4);
    const est2 = AudioEngine.estimatePhase(cap2.data, freq, cap2.sampleRate);
    AudioEngine.releaseMic();

    // Relative phase stability: compare two windows
    let dPhase = est.phase - est2.phase;
    while (dPhase > 180) dPhase -= 360;
    while (dPhase < -180) dPhase += 360;

    // For L/R relative: play L then R — user mode; here we use magnitude + subjective
    // Better approach: generate reference internally and cross-correlate mic with ref
    const sr = cap.sampleRate;
    const ref = new Float32Array(cap.data.length);
    for (let i = 0; i < ref.length; i++) ref[i] = Math.sin(2 * Math.PI * freq * i / sr);
    const xc = AudioEngine.crossCorrelate(ref, cap.data);
    const deg = (xc.bestLag / sr) * freq * 360;
    let phase = ((deg % 360) + 360) % 360;
    if (phase > 180) phase -= 360;

    const corr = xc.bestVal;
    el('phaseDeg').textContent = phase.toFixed(1);
    el('phaseCorr').textContent = corr.toFixed(3);

    const abs = Math.abs(phase);
    const v = el('phaseVerdict');
    if (abs <= 45) {
      v.textContent = '同相';
      v.className = 'value status ok';
    } else if (abs >= 135) {
      v.textContent = '反相';
      v.className = 'value status bad';
    } else {
      v.textContent = '过渡区';
      v.className = 'value status warn';
    }
    drawGauge(phase);
  }

  function startVis(freq) {
    const canvas = el('phaseCanvas');
    const c = canvas.getContext('2d');
    const analyser = AudioEngine.getGenAnalyser();
    const buf = new Uint8Array(analyser.fftSize);
    function frame() {
      if (!playing) return;
      analyser.getByteTimeDomainData(buf);
      c.fillStyle = '#0a0e14';
      c.fillRect(0, 0, canvas.width, canvas.height);
      // two synthetic L/R traces for mode feedback
      const mode = el('phaseMode').value;
      c.strokeStyle = '#58a6ff';
      c.beginPath();
      for (let i = 0; i < buf.length; i++) {
        const x = i / buf.length * canvas.width;
        const y = canvas.height * 0.35 + (buf[i] - 128) / 128 * 50;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      c.strokeStyle = mode === 'inv' ? '#f85149' : '#3fb950';
      c.beginPath();
      for (let i = 0; i < buf.length; i++) {
        const x = i / buf.length * canvas.width;
        let s = (buf[i] - 128) / 128;
        if (mode === 'inv') s = -s;
        const y = canvas.height * 0.7 + s * 50;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      c.fillStyle = '#8b949e';
      c.font = '12px sans-serif';
      c.fillText('上: 参考  下: ' + (mode === 'inv' ? '反相' : '同相') + ' · ' + freq + ' Hz', 12, 20);
      anim = requestAnimationFrame(frame);
    }
    frame();
  }

  function drawGauge(phase) {
    const canvas = el('phaseCanvas');
    if (!canvas || playing) return;
    const c = canvas.getContext('2d');
    c.fillStyle = '#0a0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2, cy = canvas.height / 2 + 10, r = 90;
    // arcs
    function arc(a0, a1, color) {
      c.beginPath();
      c.strokeStyle = color;
      c.lineWidth = 18;
      c.arc(cx, cy, r, a0, a1);
      c.stroke();
    }
    // map phase -180..180 to angle
    arc(Math.PI * 0.75, Math.PI * 1.0, '#3fb950');
    arc(Math.PI, Math.PI * 1.25, '#3fb950');
    arc(Math.PI * 0.5, Math.PI * 0.75, '#d29922');
    arc(Math.PI * 1.25, Math.PI * 1.5, '#d29922');
    arc(-Math.PI * 0.25, Math.PI * 0.5, '#f85149');
    arc(Math.PI * 1.5, Math.PI * 2.25, '#f85149');
    c.fillStyle = '#e6edf3';
    c.font = 'bold 16px sans-serif';
    c.textAlign = 'center';
    c.fillText(phase == null ? '等待测量' : phase.toFixed(1) + '°', cx, cy + 6);
    c.textAlign = 'left';
  }

  function getSnapshot() {
    return {
      degrees: el('phaseDeg').textContent,
      verdict: el('phaseVerdict').textContent,
      corr: el('phaseCorr').textContent,
      freq: el('phaseFreq').value,
    };
  }

  return { init, play, stop, measure, getSnapshot };
})();
