/** 旧单机页改双设备：相位 / 极性 / 延时 / 电平 跟随全局角色；频谱 RTA 录音端开麦、播放端只放粉红噪声 */
const DuoPages = (() => {
  const { esc, LS, r1, r2 } = Duo;
  const $ = Duo.$;
  const wrap = (id, title, hint, playHint, recHint, playId, recId, resultId, advId) => {
    const p = $('panel-' + id); if (!p || p.querySelector('.duo-ui')) return;
    const old = document.createElement('div'); old.className = 'duo-adv'; old.id = advId;
    while (p.firstChild) old.appendChild(p.firstChild);
    p.appendChild(Object.assign(document.createElement('h2'), { className: 'ci-title', textContent: title }));
    const h = document.createElement('p'); h.className = 'sp-hint'; h.textContent = hint; p.appendChild(h);
    const ui = document.createElement('div'); ui.className = 'duo-ui sp';
    ui.innerHTML = `<div class="duo-player sp-main" hidden>
        <button type="button" class="sp-big" id="${playId}">▶ 开始放</button>
        <div class="sp-cue" id="${playId}Cue">先在录音端点「● 开始录」</div>
        <div class="sp-count" id="${playId}Count"></div>
        <p class="sp-hint">${playHint} · 播放端不会打开麦克风</p>
      </div>
      <div class="duo-recorder sp-main" hidden>
        <button type="button" class="sp-big rec" id="${recId}">● 开始录</button>
        <p class="sp-cue small">${recHint}</p>
        <div class="sp-count" id="${recId}Status"></div>
      </div>
      <div class="sp-result" id="${resultId}" hidden>
        <div class="sp-verdict small" id="${resultId}V"></div>
        <div id="${resultId}S"></div>
        <div class="sp-actions"><button type="button" class="btn btn-touch" id="${resultId}Again">再测一次</button><button type="button" class="btn btn-accent btn-touch" id="${resultId}Write" hidden>写入调音方案</button></div>
        <details class="sp-det"><summary>详细数据</summary><pre id="${resultId}D"></pre></details>
      </div>
      <details class="sp-det duo-adv-toggle"><summary>高级：单机模式（同机又放又录，蓝牙会切通话）</summary></details>`;
    p.appendChild(ui);
    ui.querySelector('.duo-adv-toggle').appendChild(old);
  };
  const syncRole = () => {
    const r = typeof Role !== 'undefined' ? Role.get() : 'player';
    document.querySelectorAll('.duo-player').forEach((el) => { el.hidden = r !== 'player'; });
    document.querySelectorAll('.duo-recorder').forEach((el) => { el.hidden = r !== 'recorder'; });
  };
  const show = (id, ok, title, html, detail, write) => {
    const card = $(id); if (!card) return; card.hidden = false;
    card.className = 'sp-result ' + (ok === true ? 'ok' : ok === false ? 'inverted' : 'unknown');
    $(id + 'V').textContent = title; $(id + 'S').innerHTML = html; $(id + 'D').textContent = detail || '';
    const w = $(id + 'Write'); if (w) w.hidden = !write;
  };

  // ---------- 相位（外录相位轨） ----------
  const PhaseDuo = (() => {
    let last = null;
    function render(r) {
      last = r;
      if (!r || r.type !== 'phase') { show('phDuoRes', null, '⚠️ 测不出', `<p class="sp-reason">${esc((r && r.reason) || '没认到相位测试音')}</p>`); return; }
      const rows = r.pairs.map((p) => {
        const fix = p.verdict === '相位相反'
          ? (p.id === 'x3k5' ? '→ 右侧高音/中音（CH10/12）试反相' : p.id === 'x80' ? '→ 右侧超低/中低（CH6/7）试反相' : '→ 右侧整体（CH2/4/6/10/12）试反相')
          : p.verdict === '同相（正常）' ? '✓' : '⚠️ 再测或先调延时';
        return `<tr><th>${esc(p.name)}</th><td>${esc(p.verdict)}（差 ${p.diffDb} dB） ${esc(fix)}</td></tr>`;
      }).join('');
      const bad = r.anyInverted;
      show('phDuoRes', bad ? false : r.pairs.every((p) => p.verdict === '同相（正常）') ? true : null,
        bad ? '❌ 有频段相位相反' : r.pairs.every((p) => p.verdict === '同相（正常）') ? '✅ 各频段同相' : '⚠️ 部分频段判断不出',
        `<table class="ci-tab">${rows}</table><p class="ci-warn">⚠️ 基于手机麦克风，仅供参考；改完复测</p>`,
        JSON.stringify(r.pairs, null, 1), true);
      $('phDuoResWrite').onclick = () => {
        const a = LS.get('cat-analyses-v1', {});
        a.phase = { track: r, at: new Date().toISOString() }; LS.set('cat-analyses-v1', a);
        if (typeof History !== 'undefined') History.push('写入相位结果前');
        TunePlan.show(); App.switchTab('plan');
      };
    }
    function init() {
      wrap('phase', 'φ 相位测试（双设备）', '一次约 85 秒：全频 / 低频 / 80 Hz 分频区 / 3.5 kHz 分频区，各比一次同相 vs 右反相',
        'DSP 正常（所有喇叭都开），音量偏大', '录音手机放主驾头部，先点录再点放', 'phDuoPlay', 'phDuoRec', 'phDuoRes', 'phaseAdv');
      Duo.player({ btn: $('phDuoPlay'), cue: $('phDuoPlayCue'), count: $('phDuoPlayCount'),
        track: () => TestTrack.buildTrack('phase'),
        cues: [[0, '准备…'], [1, '同步咔嗒'], [4, '全频'], [24, '低频'], [44, '80 Hz 区'], [64, '3.5 kHz 区'], [85, '完成 ✓']] });
      Duo.recorder({ btn: $('phDuoRec'), status: $('phDuoRecStatus'), kind: 'phase', maxSec: 120,
        isDone: (x, sr) => { const d = TestTrack.detect(x, sr); return { heard: !!(d && d.type === 'phase'), done: !!(d && d.type === 'phase' && d.complete) }; },
        onDone: (x, sr) => {
          let peak = 0; for (let i = 0; i < x.length; i += 7) peak = Math.max(peak, Math.abs(x[i]));
          const d = TestTrack.detect(x, sr);
          if (!d) return render({ reason: peak < 0.003 ? '声音太小：调大音量再测' : '没听到测试音：先点录再点放' });
          if (d.type !== 'phase') return render({ reason: '播放端放的不是相位测试音：两台都打开「相位」页' });
          if (!d.complete) return render({ reason: '没录完整：等约 85 秒放完' });
          render(TestTrack.analyzePhase(x, sr, d));
        } });
      $('phDuoResAgain').onclick = () => { $('phDuoRes').hidden = true; };
    }
    return { init, render };
  })();

  // ---------- 极性（外录极性轨） ----------
  const PolDuo = (() => {
    function render(r) {
      if (!r || r.type !== 'polExt') { show('poDuoRes', null, '⚠️ 测不出', `<p class="sp-reason">${esc((r && r.reason) || '没认到极性测试音')}</p>`); return; }
      const side = (s, o) => !o.present ? '⚠️ 无声（DSP 只开一路再测）' : o.polarity === '正' ? '✅ 正相' : o.polarity === '反' ? '❌ 反相 → DSP 反相或改接线' : '⚠️ 不确定，再测';
      const ok = (r.L.present || r.R.present) && !(r.L.polarity === '反' || r.R.polarity === '反');
      show('poDuoRes', r.L.polarity === '反' || r.R.polarity === '反' ? false : (r.L.polarity === '正' || r.R.polarity === '正') ? true : null,
        r.L.polarity === '反' || r.R.polarity === '反' ? '❌ 有单元接反' : '极性结果',
        `<table class="ci-tab"><tr><th>左</th><td>${side('L', r.L)}</td></tr><tr><th>右</th><td>${side('R', r.R)}</td></tr></table>
         <p class="sp-hint">DSP 里只开一个单元来录，测完换下一个；超低音脉冲弱，结果仅供参考</p>`,
        JSON.stringify(r, null, 1), false);
    }
    function init() {
      wrap('polarity', '⊕ 极性检测（双设备）', '正极性脉冲：振膜先外推。DSP 每次只开一个单元',
        '约 13 秒；DSP 只开要测的那一路', '录音手机对着正在测的喇叭', 'poDuoPlay', 'poDuoRec', 'poDuoRes', 'polAdv');
      Duo.player({ btn: $('poDuoPlay'), cue: $('poDuoPlayCue'), count: $('poDuoPlayCount'),
        track: () => TestTrack.buildTrack('polExt'),
        cues: [[0, '准备…'], [1, '同步咔嗒'], [3.5, '左脉冲'], [8.5, '右脉冲'], [13, '完成 ✓']] });
      Duo.recorder({ btn: $('poDuoRec'), status: $('poDuoRecStatus'), kind: 'polExt', maxSec: 40,
        isDone: (x, sr) => { const d = TestTrack.detect(x, sr); return { heard: !!(d && d.type === 'polExt'), done: !!(d && d.type === 'polExt' && d.complete) }; },
        onDone: (x, sr) => {
          const d = TestTrack.detect(x, sr);
          if (!d || d.type !== 'polExt') return render({ reason: !d ? '没听到测试音' : '播放端要打开「极性」页' });
          if (!d.complete) return render({ reason: '没录完整' });
          render(TestTrack.analyzePolExt(x, sr, d));
        } });
      $('poDuoResAgain').onclick = () => { $('poDuoRes').hidden = true; };
    }
    return { init, render };
  })();

  // ---------- 延时（自动测试轨的 Chirp） ----------
  const DelayDuo = (() => {
    function render(r) {
      if (!r || r.delayMs == null) { show('dlDuoRes', null, '⚠️ 测不出', `<p class="sp-reason">${esc((r && r.reason) || '没认到测试音')}</p>`); return; }
      const early = Math.abs(r.delayMs) < 0.08 ? null : r.delayMs > 0 ? 'L' : 'R';
      const fix = !early ? '保持不变' : `${early === 'L' ? '左' : '右'}前声场（CH${early === 'L' ? '5/9/11' : '6/10/12'}）延时各加 ${r2(Math.abs(r.delayMs))} ms`;
      show('dlDuoRes', early ? false : true, early ? `❌ ${early === 'L' ? '左' : '右'}边先到 ${Math.abs(r.delayMs)} ms` : '✅ 左右同时到',
        `<table class="ci-tab"><tr><th>时间差</th><td>${r.delayMs} ms（约 ${r.delayCm} cm）</td></tr>
         <tr><th>建议</th><td>${esc(fix)}</td></tr></table>
         <p class="ci-warn">${r.delayConsistent ? '' : '⚠️ 多次测量不一致，仅供参考<br>'}${esc(typeof Cal !== 'undefined' ? Cal.note() : '')}</p>`,
        JSON.stringify({ arrivalMs: r.arrivalMs, delayMs: r.delayMs }, null, 1), true);
      $('dlDuoResWrite').onclick = () => {
        if (typeof History !== 'undefined') History.push('延时写入前');
        const chs = Channels.getAll();
        if (early) {
          const ids = early === 'L' ? [5, 9, 11] : [6, 10, 12], add = r2(Math.abs(r.delayMs));
          ids.forEach((id) => { const c = chs[id - 1]; if (c) c.delaySetMs = r2((c.delaySetMs || 0) + add); });
          Channels.setAll(chs);
        }
        Duo.mergeAll({ stereo: { delayMs: r.delayMs, lrDiffDb: r.lrDiffDb || 0, peakCorrelation: 1 } });
        TunePlan.show(); App.switchTab('plan');
      };
    }
    function init() {
      wrap('delay', '⏱ 延时对齐（双设备）', '左右交替 Chirp，算出谁先到、差几毫秒',
        '约 34 秒；DSP 正常', '录音手机放主驾两耳中间', 'dlDuoPlay', 'dlDuoRec', 'dlDuoRes', 'delayAdv');
      Duo.player({ btn: $('dlDuoPlay'), cue: $('dlDuoPlayCue'), count: $('dlDuoPlayCount'),
        track: () => TestTrack.buildTrack('auto'),
        cues: [[0, '准备…'], [1, '同步咔嗒'], [3, '左噪声'], [10, '右噪声'], [17, '双声道'], [24, '延时 Chirp'], [34, '完成 ✓']] });
      Duo.recorder({ btn: $('dlDuoRec'), status: $('dlDuoRecStatus'), kind: 'auto', maxSec: 55,
        isDone: (x, sr) => { const d = TestTrack.detect(x, sr); return { heard: !!(d && d.type === 'auto'), done: !!(d && d.type === 'auto' && d.complete) }; },
        onDone: (x, sr) => {
          const d = TestTrack.detect(x, sr);
          if (!d || d.type !== 'auto') return render({ reason: !d ? '没听到测试音' : '播放端要打开「延时」页' });
          if (!d.complete) return render({ reason: '没录完整' });
          render(TestTrack.analyzeTrack(x, sr, d));
        } });
      $('dlDuoResAgain').onclick = () => { $('dlDuoRes').hidden = true; };
    }
    return { init, render };
  })();

  // ---------- 电平（自动测试轨的左右噪声段） ----------
  const SplDuo = (() => {
    function render(r) {
      if (!r || r.lrDiffDb == null) { show('spDuoRes', null, '⚠️ 测不出', `<p class="sp-reason">${esc((r && r.reason) || '没认到测试音')}</p>`); return; }
      const louder = Math.abs(r.lrDiffDb) < 0.8 ? null : r.lrDiffDb > 0 ? 'L' : 'R';
      const fix = !louder ? '保持不变' : `${louder === 'L' ? '左' : '右'}侧通道增益各降 ${r1(Math.abs(r.lrDiffDb))} dB`;
      show('spDuoRes', louder ? false : true, louder ? `❌ ${louder === 'L' ? '左' : '右'}边响 ${Math.abs(r.lrDiffDb)} dB` : '✅ 左右电平基本一致',
        `<table class="ci-tab"><tr><th>左</th><td>${r.levels.L} dB</td></tr><tr><th>右</th><td>${r.levels.R} dB</td></tr>
         <tr><th>建议</th><td>${esc(fix)}</td></tr></table>
         <p class="ci-warn">${r.snrDb < 12 ? '⚠️ 信噪比偏低，仅供参考<br>' : ''}相对电平，非绝对声压</p>`,
        JSON.stringify(r.levels, null, 1), true);
      $('spDuoResWrite').onclick = () => {
        if (typeof History !== 'undefined') History.push('电平写入前');
        if (louder) {
          const chs = Channels.getAll(), d = r1(-Math.abs(r.lrDiffDb));
          chs.filter((c) => c.side === louder && !c.mute).forEach((c) => { c.gainSetDb = r1((c.gainSetDb || 0) + d); });
          Channels.setAll(chs);
        }
        Duo.mergeAll({ stereo: { lrDiffDb: r.lrDiffDb, delayMs: r.delayMs || 0, peakCorrelation: 1 } });
        TunePlan.show(); App.switchTab('plan');
      };
    }
    function init() {
      wrap('spl', '📶 电平匹配（双设备）', '左右分别放粉红噪声，比谁更响',
        '约 34 秒；DSP 正常', '录音手机放主驾头部', 'spDuoPlay', 'spDuoRec', 'spDuoRes', 'splAdv');
      Duo.player({ btn: $('spDuoPlay'), cue: $('spDuoPlayCue'), count: $('spDuoPlayCount'),
        track: () => TestTrack.buildTrack('auto'),
        cues: [[0, '准备…'], [1, '同步咔嗒'], [3, '只有左边'], [10, '只有右边'], [17, '左右一起'], [34, '完成 ✓']] });
      Duo.recorder({ btn: $('spDuoRec'), status: $('spDuoRecStatus'), kind: 'auto', maxSec: 55,
        isDone: (x, sr) => { const d = TestTrack.detect(x, sr); return { heard: !!(d && d.type === 'auto'), done: !!(d && d.type === 'auto' && d.complete) }; },
        onDone: (x, sr) => {
          const d = TestTrack.detect(x, sr);
          if (!d || d.type !== 'auto') return render({ reason: !d ? '没听到测试音' : '播放端要打开「电平」页' });
          if (!d.complete) return render({ reason: '没录完整' });
          render(TestTrack.analyzeTrack(x, sr, d));
        } });
      $('spDuoResAgain').onclick = () => { $('spDuoRes').hidden = true; };
    }
    return { init, render };
  })();

  // ---------- RTA：录音端开麦；播放端只放粉红噪声 ----------
  const RtaDuo = (() => {
    function init() {
      const p = $('panel-rta'); if (!p || p.querySelector('.rta-duo')) return;
      const box = document.createElement('div'); box.className = 'rta-duo sp';
      box.innerHTML = `<div class="rta-player sp-main" hidden>
          <button type="button" class="sp-big" id="rtaDuoPlay">▶ 放粉红噪声</button>
          <div class="sp-cue" id="rtaDuoCue">循环播放，录音端看频谱</div>
          <p class="sp-hint">播放端不会打开麦克风</p>
        </div>
        <div class="rta-rec-note" hidden><p class="sp-hint">🎙 录音端：点下面「开始分析」看实时频谱。另一部手机打开本页当播放端放粉红噪声。</p></div>`;
      p.insertBefore(box, p.firstChild);
      Duo.player({ btn: $('rtaDuoPlay'), cue: $('rtaDuoCue'), count: null, loop: true,
        track: () => TestTrack.buildTrack('pink'), cues: [[0, '粉红噪声循环中…']] });
      const sync = () => {
        const r = typeof Role !== 'undefined' ? Role.get() : 'player';
        box.querySelector('.rta-player').hidden = r !== 'player';
        box.querySelector('.rta-rec-note').hidden = r !== 'recorder';
        // 录音端显示原 RTA 控件；播放端藏起来
        [...p.children].forEach((c) => { if (!c.classList.contains('rta-duo') && !c.classList.contains('role-note') && c.tagName !== 'H2') c.style.display = r === 'recorder' ? '' : 'none'; });
      };
      sync();
      if (typeof Role !== 'undefined' && Role.onChange) Role.onChange(() => sync());
    }
    return { init };
  })();

  function init() {
    if (!$('panel-phase')) return;
    PhaseDuo.init(); PolDuo.init(); DelayDuo.init(); SplDuo.init(); RtaDuo.init();
    syncRole();
    if (typeof Role !== 'undefined' && Role.onChange) Role.onChange(syncRole);
  }
  return { init, PhaseDuo, PolDuo, DelayDuo, SplDuo, syncRole };
})();
if (typeof module !== 'undefined') module.exports = DuoPages;
