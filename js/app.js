/** 主应用：标签、麦克风、解锁音频、PWA、画布适配 */
const App = (() => {
  let audioUnlocked = false;
  const CANVAS_ASPECT = {
    genCanvas: 640 / 260,
    rtaCanvas: 640 / 340,
    phaseCanvas: 640 / 280,
    polCanvas: 640 / 280,
    delayCanvas: 640 / 280,
    splCanvas: 640 / 280,
    xoCanvas: 640 / 280,
    anWave: 640 / 160,
    anSpec: 640 / 320,
  };

  function el(id) { return document.getElementById(id); }

  function setMicUI(ok, err) {
    const st = el('micStatus');
    const label = el('micLabel');
    st.classList.remove('live', 'error');
    if (ok) {
      st.classList.add('live');
      label.textContent = '麦克风测量中';
    } else if (err) {
      st.classList.add('error');
      label.textContent = '麦克风失败';
    } else {
      label.textContent = '麦克风关闭（测量时自动打开）';
    }
  }

  function setUnlockUI(ok, msg) {
    audioUnlocked = !!ok;
    const bar = el('unlockBar');
    const status = el('unlockStatus');
    if (!bar || !status) return;
    bar.classList.toggle('unlocked', ok);
    status.textContent = msg || (ok ? '音频已解锁' : '音频未解锁');
  }

  async function unlockAudio() {
    try {
      AudioEngine.startKeepAlive();
      await AudioEngine.resume();
      AudioEngine.ensure();
      const ctx = AudioEngine.getCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      // silent buffer to satisfy iOS gesture unlock
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      setUnlockUI(true, '音频已解锁 · 采样率 ' + ctx.sampleRate + ' Hz');
      el('sampleRateInfo').textContent = '采样率 ' + ctx.sampleRate + ' Hz · 主电平默认较低';
      return true;
    } catch (e) {
      setUnlockUI(false, '解锁失败：' + (e.message || e));
      return false;
    }
  }

  async function connectMic() {
    await unlockAudio();
    const r = await AudioEngine.enableMic();
    if (r.ok) {
      // 只是授权：立刻关麦，避免蓝牙切到通话模式；测量时才会再打开
      AudioEngine.releaseMic();
      setUnlockUI(true, '音频已解锁 · 麦克风已授权（测量时才开麦）');
      el('sampleRateInfo').textContent = '采样率 ' + AudioEngine.sampleRate() + ' Hz';
    } else {
      setMicUI(false, true);
      alert('无法访问麦克风：' + r.error + '\n\niOS/手机请使用 HTTPS（或电脑 localhost），并在系统弹窗中允许麦克风。');
    }
  }

  function switchTab(name) {
    if (name === 'more') {
      const sheet = el('moreSheet');
      if (sheet) sheet.hidden = !sheet.hidden;
      return;
    }
    const sheet = el('moreSheet');
    if (sheet) sheet.hidden = true;

    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach((p) => {
      const on = p.id === 'panel-' + name;
      p.classList.toggle('active', on);
      if (on) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    });

    const primary = new Set(['simple', 'gen', 'rta', 'phase']);
    document.querySelectorAll('.bnav').forEach((b) => {
      if (b.dataset.tab === 'more') {
        b.classList.toggle('active', !primary.has(name));
      } else {
        b.classList.toggle('active', b.dataset.tab === name);
      }
    });

    // Scroll top tab into view
    const topTab = document.querySelector('.tab[data-tab="' + name + '"]');
    if (topTab && topTab.scrollIntoView) {
      topTab.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }

    if (name === 'log') Logger.preview();
    if (name === 'xover') {
      el('xoType').dispatchEvent(new Event('change'));
    }
    fitCanvases();
    if (name === 'analyze') Analyzer.redraw();
  }

  function initTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    document.querySelectorAll('.bnav').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    document.querySelectorAll('.more-item[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    const close = el('moreClose');
    if (close) close.onclick = () => { el('moreSheet').hidden = true; };
  }

  function initMaster() {
    const slider = el('masterGain');
    const out = el('masterGainVal');
    const sync = () => {
      const v = +slider.value;
      out.textContent = v + '%';
      AudioEngine.setMasterLevel(v);
      const gl = el('genLevelOut');
      if (gl) gl.textContent = v;
    };
    slider.addEventListener('input', sync);
    sync();
  }

  function fitCanvases() {
    Object.keys(CANVAS_ASPECT).forEach((id) => {
      const canvas = el(id);
      if (!canvas) return;
      const parent = canvas.parentElement;
      const cssW = Math.max(260, Math.floor((parent || canvas).clientWidth || window.innerWidth - 32));
      const aspect = CANVAS_ASPECT[id];
      const cssH = Math.max(160, Math.floor(cssW / aspect));
      // Logical CSS pixels so existing draw code/fonts stay readable on phones
      if (canvas.width !== cssW || canvas.height !== cssH) {
        canvas.width = cssW;
        canvas.height = cssH;
      }
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
    });
  }

  function stopAll() {
    AudioEngine.stopAll();
    try { Generator.stop(); } catch (_) {}
    try { RTA.stop(); } catch (_) {}
    try { PhaseTest.stop(); } catch (_) {}
    try { SPL.stop(); } catch (_) {}
    try { Xover.stop(); } catch (_) {}
    el('delayStop').disabled = true;
    el('delayPlay').disabled = false;
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((e) => {
        console.warn('SW register failed', e);
      });
    });
  }

  // ---- 音频状态 / 试音 / 恢复 ----
  let everRan = false;
  function diagText() {
    const i = AudioEngine.info();
    const st = { running: '运行中', suspended: '已暂停', interrupted: '被中断', closed: '已关闭', none: '未启动' }[i.state] || i.state;
    const lat = i.outputLatency || i.baseLatency;
    const parts = ['音频：' + st];
    if (i.sampleRate) parts.push(i.sampleRate + ' Hz');
    if (lat) parts.push('延迟 ' + Math.round(lat * 1000) + ' ms');
    parts.push('主电平 ' + Math.round(AudioEngine.getMasterLevel()) + '%');
    parts.push(i.mic ? '<b class="badc">麦克风：开启</b>' : '<b class="okc">麦克风：关闭</b>');
    return parts.join(' · ');
  }
  function refreshDiag() {
    const d = el('audioDiag');
    if (d) {
      const low = AudioEngine.getMasterLevel() < 20;
      d.innerHTML = diagText() + (low ? ' <span class="warnc">· 主电平较低，可能听不清</span>' : '');
    }
    const i = AudioEngine.info();
    if (i.state === 'running') everRan = true;
    const bar = el('audioPausedBar');
    if (bar) bar.hidden = !(everRan && (i.state === 'suspended' || i.state === 'interrupted' || i.state === 'closed'));
  }
  async function recover() {
    el('audioPausedBar').textContent = '正在恢复音频…';
    const st = await AudioEngine.resume(AudioEngine.info().state === 'running' ? false : false);
    if (st !== 'running') await AudioEngine.resume(true);
    el('audioPausedBar').textContent = '⚠ 音频已暂停，点此恢复';
    initMasterSync();
    refreshDiag();
  }
  function initMasterSync() { AudioEngine.setMasterLevel(+el('masterGain').value); }
  async function testSound() {
    const st = await AudioEngine.resume();
    if (st !== 'running') await AudioEngine.resume(true);
    initMasterSync();
    AudioEngine.stopAll();
    const ctx = AudioEngine.getCtx(), t0 = ctx.currentTime + 0.05;
    const o = AudioEngine.createOsc(1000), g = AudioEngine.createGain(0);
    o.connect(g); AudioEngine.connectOut(g, 'stereo');
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.6, t0 + 0.01); g.gain.setValueAtTime(0.6, t0 + 0.35); g.gain.linearRampToValueAtTime(0, t0 + 0.37);
    o.start(t0); o.stop(t0 + 0.4);
    const n = AudioEngine.createNoise('pink'), gn = AudioEngine.createGain(0);
    n.connect(gn); AudioEngine.connectOut(gn, 'stereo');
    gn.gain.setValueAtTime(0, t0 + 0.55); gn.gain.linearRampToValueAtTime(0.5, t0 + 0.57); gn.gain.setValueAtTime(0.5, t0 + 1.55); gn.gain.linearRampToValueAtTime(0, t0 + 1.6);
    n.start(t0 + 0.5); n.stop(t0 + 1.7);
    const s = el('testStatus');
    if (s) s.textContent = '正在播放：1 kHz 嘀声 → 粉红噪声 1 秒。' + (AudioEngine.getMasterLevel() < 20 ? ' 主电平低于 20%，可能很小声。' : '') + ' 若听不到，请看「使用说明 › 没声音？」';
    refreshDiag();
  }

  function onOutputReset(reason) {
    initMasterSync();
    refreshDiag();
    const s = el('testStatus');
    if (s) s.textContent = reason === 'mic' ? '测量结束：已关闭麦克风并重置音频输出（应回到蓝牙 / 车机）。' : '已重置音频输出。现在点「🔊 试音」确认声音从车机出来。';
  }
  async function initOutputPicker() {
    const wrap = el('outPickWrap'), sel = el('outDevice');
    if (!wrap || !AudioEngine.canPickOutput()) return;
    wrap.hidden = false;
    const fill = async () => {
      const outs = await AudioEngine.listOutputs().catch(() => []);
      const prev = sel.value;
      sel.innerHTML = '<option value="">系统默认输出</option>' + outs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => `<option value="${d.deviceId}">${(d.label || '输出设备 ' + (i + 1)).replace(/</g, '&lt;')}</option>`).join('');
      if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    };
    sel.onchange = async () => { try { await AudioEngine.setOutput(sel.value); el('testStatus').textContent = '已切换输出设备，点「试音」确认。'; } catch (e) { alert('切换输出失败：' + e.message); } };
    sel.onfocus = fill;
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', fill);
    fill();
  }

  function init() {
    // Don't auto-create AudioContext on iOS until gesture — but ensure() is lazy-ish
    // Avoid calling ensure() until unlock on mobile if possible
    const isTouch = matchMedia('(hover: none), (pointer: coarse)').matches
      || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isTouch) {
      try {
        AudioEngine.ensure();
        el('sampleRateInfo').textContent = '采样率 ' + AudioEngine.sampleRate() + ' Hz · 主电平默认较低';
        setUnlockUI(true, '音频就绪（桌面）');
      } catch (_) {
        setUnlockUI(false, '请点击解锁音频');
      }
    } else {
      el('sampleRateInfo').textContent = '手机端请先解锁音频';
      setUnlockUI(false, '请点击「解锁音频」后开始');
    }

    initTabs();
    initMaster();
    Channels.init();
    Generator.init();
    RTA.init();
    PhaseTest.init();
    Polarity.init();
    DelayTest.init();
    SPL.init();
    Xover.init();
    Logger.init();
    Analyzer.init();
    if (typeof TestTrack !== 'undefined') TestTrack.init();
    if (typeof Simple !== 'undefined') Simple.init();
    TunePlan.init();
    el('planCsv').onclick = () => Channels.exportPlan('csv');
    el('planJson').onclick = () => Channels.exportPlan('json');
    el('planClear').onclick = () => { if (confirm('清空所有通道的延时/距离/电平/极性测量值？')) Channels.getAll().forEach((c) => Channels.update(c.id, { delayMs: null, distCm: null, levelDb: null, polarity: '未测', gainSetDb: null, delaySetMs: null, invert: false, eq: [] })); };

    el('btnMic').onclick = connectMic;
    el('btnStopAll').onclick = stopAll;
    const btnUnlock = el('btnUnlockAudio');
    const btnMicUnlock = el('btnMicUnlock');
    if (btnUnlock) btnUnlock.onclick = unlockAudio;
    if (btnMicUnlock) btnMicUnlock.onclick = connectMic;

    fitCanvases();
    window.addEventListener('resize', () => { fitCanvases(); Analyzer.redraw(); });
    window.addEventListener('orientationchange', () => setTimeout(fitCanvases, 200));

    registerSW();

    el('btnTestSound').onclick = testSound;
    el('btnResetOut').onclick = () => AudioEngine.resetOutput('manual');
    initOutputPicker();
    el('audioPausedBar').onclick = recover;
    AudioEngine.onState(refreshDiag);
    el('masterGain').addEventListener('input', refreshDiag);
    // 每次点按钮都先尝试恢复 AudioContext + 保活静音音频
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('button, .chc-main, label.btn')) return;
      AudioEngine.startKeepAlive();
      const i = AudioEngine.info();
      if (i.state !== 'none' && i.state !== 'running') AudioEngine.resume().then(() => { initMasterSync(); refreshDiag(); });
    }, true);
    const onVis = () => { if (document.visibilityState === 'visible') { const i = AudioEngine.info(); if (i.state !== 'none' && i.state !== 'running') AudioEngine.resume().then(refreshDiag, refreshDiag); else refreshDiag(); } };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onVis);
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        const s = el('testStatus');
        if (s) s.textContent = '检测到音频设备变化（如蓝牙连接/断开）。若没有声音，点「🔊 试音」或「音频已暂停」条恢复。';
        const i = AudioEngine.info();
        if (i.state !== 'none' && i.state !== 'running') AudioEngine.resume().then(refreshDiag);
        refreshDiag();
      });
    }
    setInterval(refreshDiag, 3000);
    refreshDiag();
  }

  return { init, setMicUI, onOutputReset, stopAll, unlockAudio, switchTab, fitCanvases };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
