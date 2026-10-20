/** 录音端麦克风选择：枚举输入设备、记住选择、注入 getUserMedia、绑定校准文件、蓝牙警告、电平表 */
const MicPick = (() => {
  const KEY = 'cat-mic-v1', CALKEY = 'cat-mic-cal-v1';
  const KNOWN = [
    { re: /umik-?2/i, name: 'UMIK-2', tip: '请导入该麦序列号对应的校准文件（.txt / .cal）' },
    { re: /umik-?1|umik/i, name: 'UMIK-1', tip: '请导入 UMIK-1 序列号校准文件（miniDSP 官网按序列号下载）' },
    { re: /imm-?6|umm-?6|dayton/i, name: 'Dayton iMM-6 / UMM-6', tip: '可导入随麦校准文件，或先用通用曲线' },
    { re: /minidsp/i, name: 'miniDSP', tip: '请导入该麦校准文件' },
  ];
  const BT_RE = /bluetooth|airpods|hfp|hands-?free|headset|蓝牙|通话/i;
  let st = { deviceId: '', label: '', notice: '' };
  let calMap = {}; // labelKey -> { name, pts }
  try { st = Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
  try { calMap = JSON.parse(localStorage.getItem(CALKEY) || '{}') || {}; } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ deviceId: st.deviceId, label: st.label })); } catch (_) {} };
  const saveCal = () => { try { localStorage.setItem(CALKEY, JSON.stringify(calMap)); } catch (_) {} };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const keyOf = (label) => String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let devices = [], meter = null, lastInfo = null;

  function constraints() {
    const a = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (st.deviceId) a.deviceId = { exact: st.deviceId };
    return a;
  }
  function softConstraints() {
    const a = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (st.deviceId) a.deviceId = { ideal: st.deviceId };
    return a;
  }
  async function ensurePerm() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: softConstraints() });
      s.getTracks().forEach((t) => t.stop());
    } catch (_) {}
  }
  async function list() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    await ensurePerm();
    const ds = await navigator.mediaDevices.enumerateDevices();
    devices = ds.filter((d) => d.kind === 'audioinput');
    return devices;
  }
  function isBT(label) { return BT_RE.test(label || ''); }
  function knownOf(label) { return KNOWN.find((k) => k.re.test(label || '')); }
  function labelOf(d) {
    if (!d) return '系统默认麦克风';
    const L = d.label || '';
    if (!L) return '麦克风（未授权时无隐藏名称）';
    if (/default|通讯|communications/i.test(L) && devices.length > 1) return '系统默认 · ' + L;
    return L;
  }
  function currentDevice() {
    if (!devices.length) return null;
    if (st.deviceId) {
      const byId = devices.find((d) => d.deviceId === st.deviceId);
      if (byId) return byId;
      if (st.label) {
        const byL = devices.find((d) => keyOf(d.label) === keyOf(st.label) || (d.label && st.label && d.label.includes(st.label.slice(0, 12))));
        if (byL) { st.deviceId = byL.deviceId; st.label = byL.label; save(); st.notice = '已按名称找回麦克风'; return byL; }
      }
      st.notice = `原来的麦克风「${st.label || '未知'}」已断开，已改用系统默认`;
      st.deviceId = ''; st.label = ''; save();
    }
    return devices[0] || null;
  }
  function clear() { st.deviceId = ''; st.label = ''; st.notice = '原来的麦克风打不开，已改用系统默认'; save(); }
  async function setDevice(id) {
    st.deviceId = id || '';
    const d = devices.find((x) => x.deviceId === id);
    st.label = d ? d.label : '';
    st.notice = '';
    save();
    applyBoundCal();
    await render();
    restartMeter();
  }
  function applyBoundCal() {
    const d = currentDevice(); if (!d) return;
    const k = keyOf(d.label); const c = calMap[k];
    if (c && c.pts && c.pts.length && typeof Cal !== 'undefined') {
      Cal.set('file', c.name || (d.label + ' 校准'), c.pts);
      if (typeof CalUI !== 'undefined' && CalUI.render) try { CalUI.render(); } catch (_) {}
    }
  }
  function bindCal(pts, name) {
    const d = currentDevice(); if (!d || !d.label) return false;
    calMap[keyOf(d.label)] = { name: name || d.label + ' 校准', pts };
    saveCal(); applyBoundCal(); return true;
  }

  // ---------- UI ----------
  function ensureUI() {
    const panel = $('panel-cal'); if (!panel || $('micPickBox')) return;
    const box = document.createElement('div'); box.id = 'micPickBox'; box.className = 'mic-pick card';
    box.innerHTML = `<b>🎤 选择麦克风</b>
      <p class="sp-hint">录音端专用。接 USB 测量麦（如 UMIK-1）后点刷新；iOS Safari 有时只显示「麦克风」不显示型号</p>
      <label class="sp-opt">输入设备 <select id="micPickSel"></select></label>
      <div class="sp-actions"><button type="button" class="btn btn-touch" id="micPickRefresh">刷新列表</button>
        <button type="button" class="btn btn-accent btn-touch" id="micPickTest">测一下电平</button></div>
      <div id="micPickWarn" class="ci-warn" hidden></div>
      <div id="micPickKnown" class="sp-hint" hidden></div>
      <div id="micPickInfo" class="mic-info"></div>
      <div class="mic-meter"><i id="micPickMeter"></i></div>
      <p class="sp-hint" id="micPickHelp">接法：iPhone 用 Lightning→USB 相机转接器（或 USB-C iPhone 直插）；安卓用 USB-C OTG；电脑 USB 直插。蓝牙麦走通话模式，不适合测量。</p>
      <p class="sp-hint" id="micPickNotice"></p>`;
    const grid = panel.querySelector('.cal-grid');
    if (grid) panel.insertBefore(box, grid); else panel.appendChild(box);
    $('micPickSel').onchange = () => setDevice($('micPickSel').value);
    $('micPickRefresh').onclick = () => refresh();
    $('micPickTest').onclick = () => restartMeter(true);
    // 头部快捷入口（仅录音端）
    const h = document.querySelector('.header-controls');
    if (h && !$('micPickHdr')) {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'micPickHdr'; b.className = 'btn btn-ghost mic-hdr';
      b.textContent = '🎤 麦克风'; b.onclick = () => { if (typeof App !== 'undefined') App.switchTab('cal'); };
      h.appendChild(b);
    }
  }
  async function render() {
    ensureUI();
    const sel = $('micPickSel'); if (!sel) return;
    const ds = devices.length ? devices : await list();
    const cur = currentDevice();
    sel.innerHTML = '<option value="">系统默认</option>' + ds.map((d) => `<option value="${esc(d.deviceId)}">${esc(labelOf(d))}${isBT(d.label) ? ' ⚠️蓝牙' : ''}</option>`).join('');
    sel.value = (cur && st.deviceId === cur.deviceId) ? cur.deviceId : (st.deviceId || '');
    const L = cur ? cur.label : st.label;
    const warn = $('micPickWarn');
    if (isBT(L)) { warn.hidden = false; warn.innerHTML = '⚠️ 蓝牙麦克风走通话模式，频响窄、延时不稳，<b>不适合测量</b>。建议用 USB 测量麦克风（UMIK-1）接 USB-C / Lightning 转接头。'; }
    else warn.hidden = true;
    const kn = knownOf(L), known = $('micPickKnown');
    if (kn) {
      known.hidden = false;
      const bound = calMap[keyOf(L)];
      known.innerHTML = `检测到 <b>${esc(kn.name)}</b>。${bound ? `已绑定校准「${esc(bound.name)}」✓` : esc(kn.tip) + ' —— 点上面「导入校准文件」后会自动绑到这支麦。'}`;
    } else known.hidden = true;
    $('micPickNotice').textContent = st.notice || '';
    $('micPickInfo').innerHTML = lastInfo
      ? `当前：<b>${esc(labelOf(cur))}</b> · 采样率 ${lastInfo.sr} Hz · 声道 ${lastInfo.ch}${lastInfo.fallback ? ' · ⚠️ 已回退默认' : ''}`
      : `当前：<b>${esc(labelOf(cur) || '尚未打开')}</b>`;
    document.body.classList.toggle('has-mic-pick', typeof Role === 'undefined' || Role.get() === 'recorder');
    applyBoundCal();
  }
  async function refresh() { st.notice = ''; await list(); await render(); }

  function stopMeter() {
    if (!meter) return;
    try { cancelAnimationFrame(meter.raf); } catch (_) {}
    try { meter.sp.disconnect(); meter.src.disconnect(); } catch (_) {}
    try { meter.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { meter.ctx.close(); } catch (_) {}
    meter = null;
  }
  async function restartMeter(force) {
    stopMeter();
    if (typeof Role !== 'undefined' && Role.get() === 'player') return;
    if (!force && !$('micPickMeter')) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: constraints() });
    } catch (e) {
      // exact deviceId 失败 → 回退默认
      if (st.deviceId) {
        st.notice = '打不开所选麦克风，已改用系统默认';
        st.deviceId = ''; st.label = ''; save();
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: softConstraints() }); lastInfo = { sr: 0, ch: 1, fallback: true }; }
        catch (e2) { if ($('micPickNotice')) $('micPickNotice').textContent = '打不开麦克风：' + (e2.message || e2); return; }
      } else { if ($('micPickNotice')) $('micPickNotice').textContent = '打不开麦克风：' + (e.message || e); return; }
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume();
    const src = ctx.createMediaStreamSource(stream), sp = ctx.createScriptProcessor(2048, 1, 1);
    let peak = 0;
    sp.onaudioprocess = (ev) => {
      const d = ev.inputBuffer.getChannelData(0); let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      const rms = Math.sqrt(s / d.length); peak = Math.max(peak * 0.92, rms);
      const el = $('micPickMeter'); if (el) el.style.width = Math.min(100, peak * 400) + '%';
    };
    src.connect(sp); sp.connect(ctx.destination);
    const track = stream.getAudioTracks()[0], set = track.getSettings ? track.getSettings() : {};
    lastInfo = { sr: ctx.sampleRate, ch: set.channelCount || 1, fallback: !!(lastInfo && lastInfo.fallback) };
    if (set.deviceId && set.deviceId !== st.deviceId) { /* browser may remap */ }
    meter = { stream, ctx, src, sp, raf: 0 };
    $('micPickInfo').innerHTML = `当前：<b>${esc(track.label || labelOf(currentDevice()))}</b> · 采样率 ${ctx.sampleRate} Hz · 声道 ${lastInfo.ch}`;
    // 10 秒后自动停，避免一直占着麦
    setTimeout(() => { if (meter && meter.ctx === ctx) stopMeter(); }, 12000);
  }

  function init() {
    if (typeof document === 'undefined') return;
    ensureUI();
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => { refresh(); });
    }
    // 导入校准文件时绑到当前麦
    const wrapCal = () => {
      if (typeof Cal === 'undefined' || Cal.__micBound) return;
      const orig = Cal.set.bind(Cal);
      Cal.set = (mode, name, pts) => {
        orig(mode, name, pts);
        if (mode === 'file' && pts && pts.length) bindCal(pts, name);
        render();
      };
      Cal.__micBound = true;
    };
    wrapCal();
    if (typeof Role !== 'undefined' && Role.onChange) {
      Role.onChange((r) => {
        document.body.classList.toggle('has-mic-pick', r === 'recorder');
        const hdr = $('micPickHdr'); if (hdr) hdr.hidden = r !== 'recorder';
        if (r === 'recorder') refresh(); else stopMeter();
      });
    }
    // 等角色就绪后再刷
    setTimeout(() => {
      const rec = typeof Role === 'undefined' || Role.get() === 'recorder';
      document.body.classList.toggle('has-mic-pick', rec);
      const hdr = $('micPickHdr'); if (hdr) hdr.hidden = !rec;
      if (rec) refresh();
    }, 200);
  }
  return { init, list, constraints, softConstraints, setDevice, clear, currentDevice, isBT, knownOf, bindCal, refresh, render, stopMeter, get: () => ({ ...st }), devices: () => devices.slice() };
})();
if (typeof module !== 'undefined') module.exports = MicPick;
