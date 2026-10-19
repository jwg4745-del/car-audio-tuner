/** 信号发生器模块 */
const Generator = (() => {
  let playing = false;
  let anim = null;
  let sweepTimer = null;

  function el(id) { return document.getElementById(id); }

  function init() {
    el('genPlay').onclick = play;
    el('genStop').onclick = stop;
    document.querySelectorAll('#genPresets .chip').forEach((c) => {
      c.onclick = () => {
        el('genHz').value = c.dataset.hz;
        document.querySelectorAll('#genPresets .chip').forEach((x) => x.classList.remove('active'));
        c.classList.add('active');
      };
    });
    drawIdle();
  }

  function play() {
    AudioEngine.stopAll();
    playing = true;
    el('genPlay').disabled = true;
    el('genStop').disabled = false;
    el('genStatus').textContent = '播放中';
    el('genStatus').className = 'value status ok';
    el('genLevelOut').textContent = Math.round(AudioEngine.getMasterLevel());

    const type = el('genType').value;
    const hz = +el('genHz').value || 1000;
    const route = el('genRoute').value === 'mono' ? 'stereo' : el('genRoute').value;
    const dur = +el('genDur').value || 8;

    let src;
    if (type === 'sine') {
      src = AudioEngine.createOsc(hz);
      const g = AudioEngine.createGain(0.7);
      src.connect(g);
      AudioEngine.connectOut(g, route);
      src.start();
      el('genCurFreq').textContent = hz;
    } else if (type === 'sweep') {
      const f0 = +el('genSweepStart').value || 20;
      const f1 = +el('genSweepEnd').value || 20000;
      src = AudioEngine.createSweepBuffer(f0, f1, dur);
      AudioEngine.connectOut(src, route);
      src.start();
      const t0 = performance.now();
      sweepTimer = setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        if (t >= dur) { clearInterval(sweepTimer); stop(); return; }
        const f = f0 * Math.pow(f1 / f0, t / dur);
        el('genCurFreq').textContent = Math.round(f);
      }, 50);
      src.onended = () => stop();
    } else if (type === 'pink' || type === 'white') {
      src = AudioEngine.createNoise(type);
      const g = AudioEngine.createGain(0.55);
      src.connect(g);
      AudioEngine.connectOut(g, route);
      src.start();
      el('genCurFreq').textContent = type === 'pink' ? '粉红' : '白噪';
    } else if (type === 'burst') {
      src = AudioEngine.createBurst(hz, 6, 60, 80);
      AudioEngine.connectOut(src, route);
      src.start();
      el('genCurFreq').textContent = hz;
      src.onended = () => stop();
    } else if (type === 'impulse') {
      src = AudioEngine.createImpulseBuffer(5, 0.4);
      AudioEngine.connectOut(src, route);
      src.start();
      el('genCurFreq').textContent = '脉冲';
      src.onended = () => stop();
    }
    startWave();
  }

  function stop() {
    playing = false;
    AudioEngine.stopAll();
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    el('genPlay').disabled = false;
    el('genStop').disabled = true;
    el('genStatus').textContent = '已停止';
    el('genStatus').className = 'value status';
    drawIdle();
  }

  function startWave() {
    const canvas = el('genCanvas');
    const c = canvas.getContext('2d');
    const analyser = AudioEngine.getGenAnalyser();
    const buf = new Uint8Array(analyser.fftSize);
    function frame() {
      if (!playing) return;
      analyser.getByteTimeDomainData(buf);
      c.fillStyle = '#0a0e14';
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.strokeStyle = '#58a6ff';
      c.lineWidth = 2;
      c.beginPath();
      const mid = canvas.height / 2;
      for (let i = 0; i < buf.length; i++) {
        const x = (i / buf.length) * canvas.width;
        const y = mid + (buf[i] - 128) / 128 * mid * 0.85;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      anim = requestAnimationFrame(frame);
    }
    frame();
  }

  function drawIdle() {
    const canvas = el('genCanvas');
    if (!canvas) return;
    const c = canvas.getContext('2d');
    c.fillStyle = '#0a0e14';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.strokeStyle = '#30363d';
    c.beginPath();
    c.moveTo(0, canvas.height / 2);
    c.lineTo(canvas.width, canvas.height / 2);
    c.stroke();
    c.fillStyle = '#8b949e';
    c.font = '14px sans-serif';
    c.fillText('波形预览（播放后显示）', 20, 30);
  }

  return { init, play, stop };
})();
