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
      label.textContent = '麦克风已连接';
    } else if (err) {
      st.classList.add('error');
      label.textContent = '麦克风失败';
    } else {
      label.textContent = '麦克风未连接';
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
      setMicUI(true);
      setUnlockUI(true, '音频已解锁 · 麦克风已授权');
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

    const primary = new Set(['gen', 'rta', 'phase', 'delay']);
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
    el('planCsv').onclick = () => Channels.exportPlan('csv');
    el('planJson').onclick = () => Channels.exportPlan('json');
    el('planClear').onclick = () => { if (confirm('清空所有通道的延时/距离/电平/极性测量值？')) Channels.getAll().forEach((c) => Channels.update(c.id, { delayMs: null, distCm: null, levelDb: null, polarity: '未测' })); };

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
  }

  return { init, setMicUI, stopAll, unlockAudio, switchTab, fitCanvases };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
