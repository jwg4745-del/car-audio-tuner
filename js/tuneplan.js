/** 自动调音方案生成器：纯函数核心（可 Node 测试）+ 页面 UI */
const TunePlan = (() => {
  const TYPE_CN = { tweeter: '高音', mid: '中音', woofer: '低音', center: '中置', rear: '后场', sub: '超低音', full: '全频' };
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const roundF = (f) => (f >= 1000 ? Math.round(f / 50) * 50 : f >= 200 ? Math.round(f / 5) * 5 : Math.round(f));
  const nm = (c) => `CH${c.id} ${c.name}`;

  /** 由 1/3 倍频程偏差生成参数 EQ：先衰减，提升 ≤ +3 dB，衰减 ≥ −6 dB，最多 max 段 */
  function eqFromBands(bands, opt = {}) {
    const max = opt.max || 8, lo = opt.lo || 31, hi = opt.hi || 16000;
    const usable = (bands || []).filter((b) => b.fc >= lo && b.fc <= hi && isFinite(b.dev));
    const used = new Set();
    const out = [];
    const cand = usable.map((b, i) => ({ i, b }))
      .filter(({ b }) => b.dev > 1.5 || b.dev < -2)
      .sort((a, b) => {
        // cut-first: positive deviations first, then by magnitude
        const pa = a.b.dev > 0 ? 1 : 0, pb = b.b.dev > 0 ? 1 : 0;
        return pb - pa || Math.abs(b.b.dev) - Math.abs(a.b.dev);
      });
    for (const { i, b } of cand) {
      if (out.length >= max || used.has(i)) continue;
      const sign = Math.sign(b.dev);
      let s = i, e = i;
      const ok = (j) => j >= 0 && j < usable.length && !used.has(j) && Math.sign(usable[j].dev) === sign && Math.abs(usable[j].dev) > 1;
      while (ok(s - 1)) s--;
      while (ok(e + 1)) e++;
      let sum = 0;
      for (let j = s; j <= e; j++) sum += usable[j].dev;
      const width = e - s + 1, avg = sum / width;
      const fc = Math.sqrt(usable[s].fc * usable[e].fc);
      if (sign < 0) {
        // narrow deep dip → likely cancellation; don't boost
        if (b.dev < -8 && width <= 2) { for (let j = s; j <= e; j++) used.add(j); out.push({ freq: roundF(fc), gain: 0, q: 0, skip: true, reason: `${roundF(fc)} Hz 窄而深的谷（${r1(b.dev)} dB），多为声学抵消，EQ 补不回来，建议调相位/延时/位置` }); continue; }
        if (opt.rolloff && fc < opt.rolloff) continue; // don't boost below driver rolloff
      }
      for (let j = s; j <= e; j++) used.add(j);
      const gain = sign > 0 ? Math.max(-6, -avg) : Math.min(3, -avg);
      if (Math.abs(gain) < 1) continue;
      out.push({ freq: roundF(fc), gain: r1(gain), q: r2(Math.max(0.5, Math.min(8, 4.32 / width))),
        reason: sign > 0 ? `${roundF(fc)} Hz 附近高出目标约 ${r1(avg)} dB` : `${roundF(fc)} Hz 附近低于目标约 ${r1(-avg)} dB（提升上限 +3 dB）` });
    }
    return { bands: out.filter((x) => !x.skip).sort((a, b) => a.freq - b.freq), notes: out.filter((x) => x.skip) };
  }

  /**
   * input = { channels:[{id,name,side,type,mute,hpf,lpf,slope,polarity,levelDb,delayMs,distCm}],
   *           analyses:{ [chId|'all']: report }, target }
   */
  function generate(input) {
    const chs = (input.channels || []).filter((c) => !c.mute);
    const A = input.analyses || {};
    const sys = A.all || null;
    const anOf = (c) => A[c.id] || null;
    const per = {};
    chs.forEach((c) => { per[c.id] = { id: c.id, name: c.name, side: c.side, type: c.type, gainDb: 0, gainSrc: '默认值', invert: false, hpf: c.hpf, lpf: c.lpf, slope: c.slope || 24, delayMs: 0, delaySrc: '默认值', eq: [] }; });
    const steps = [];

    // 1. 增益
    {
      const items = [], todo = [];
      const lv = chs.filter((c) => c.levelDb != null);
      if (lv.length >= 2) {
        const min = Math.min(...lv.map((c) => c.levelDb));
        lv.forEach((c) => { const t = r1(min - c.levelDb); per[c.id].gainDb = t; per[c.id].gainSrc = '实测'; items.push({ ch: nm(c), value: `${t > 0 ? '+' : ''}${t} dB`, reason: t === 0 ? '最安静的通道，作为基准' : `比基准响 ${r1(-t)} dB，衰减对齐` }); });
        const miss = chs.filter((c) => c.levelDb == null);
        if (miss.length) todo.push(`以下通道还没测电平：${miss.map(nm).join('、')}（先做「电平匹配」）`);
      } else todo.push('先做「电平匹配」：每个通道单独播放粉红噪声，麦克风放主驾头部，逐个「记录当前通道」。');
      const st = sys && sys.stereo;
      if (st && Math.abs(st.lrDiffDb) > 1.5 && lv.length < 2) {
        const loud = st.lrDiffDb > 0 ? 'L' : 'R', d = r1(-Math.abs(st.lrDiffDb));
        chs.filter((c) => c.side === loud).forEach((c) => { per[c.id].gainDb = d; per[c.id].gainSrc = '录音估算'; });
        items.push({ ch: `所有${loud === 'L' ? '左' : '右'}侧通道`, value: `${d} dB`, reason: `整车录音中${loud === 'L' ? '左' : '右'}声道偏响 ${Math.abs(st.lrDiffDb)} dB` });
      }
      if (!items.length) items.push({ ch: '全部通道', value: '0 dB（默认值）', reason: '暂无电平数据，先保持不变' });
      steps.push({ title: '增益 / 电平', items, todo });
    }

    // 2. 极性
    {
      const items = [], todo = [];
      const tested = chs.filter((c) => c.polarity && c.polarity !== '未测');
      chs.filter((c) => /反/.test(c.polarity || '')).forEach((c) => { per[c.id].invert = true; items.push({ ch: nm(c), value: '反相 (Invert)', reason: '极性检测首波为负，接线可能接反；可在 DSP 反相或改正负极接线' }); });
      const st = sys && sys.stereo;
      if (st && st.peakCorrelation < -0.3) items.push({ ch: '左右声道', value: '检查', reason: `整车录音左右相关度为负（${st.peakCorrelation}），疑似一侧整体反相` });
      if (tested.length < chs.length) todo.push(`未做极性检测的通道：${chs.filter((c) => !tested.includes(c)).map(nm).join('、')}（先做「极性检测」）`);
      steps.push({ title: '极性', items, todo, _pending: true });
    }

    // 3. 分频
    {
      const items = [], todo = [];
      const bySide = (side, type) => chs.find((c) => c.side === side && c.type === type);
      const subs = chs.filter((c) => c.type === 'sub');
      const subLpf = subs.length ? Math.min(...subs.map((c) => c.lpf || 80)) : null;
      const devAt = (rep, f) => {
        if (!rep || !rep.bands) return null;
        let best = null;
        rep.bands.forEach((b) => { if (!best || Math.abs(Math.log2(b.fc / f)) < Math.abs(Math.log2(best.fc / f))) best = b; });
        return best && Math.abs(Math.log2(best.fc / f)) < 0.25 ? best.dev : null;
      };
      chs.forEach((c) => {
        const p = per[c.id], rep = anOf(c) || sys, bal = rep && rep.balance;
        if (c.type === 'tweeter' && bal && bal.harsh2to5k > 3) {
          const nh = Math.min(5000, roundF((p.hpf || 3500) * 1.26));
          if (nh !== p.hpf) { items.push({ ch: nm(c), value: `HPF ${p.hpf} → ${nh} Hz`, reason: `2–5 kHz 偏高 ${bal.harsh2to5k} dB，抬高高音分频点减轻刺耳并保护高音` }); p.hpf = nh; }
        }
        if (c.type === 'tweeter' && p.slope < 24) { items.push({ ch: nm(c), value: `斜率 ${p.slope} → 24 dB/oct`, reason: '高音单元用陡斜率更安全' }); p.slope = 24; }
        if (c.type === 'woofer' && subLpf && (p.hpf || 0) < subLpf * 0.7 && bal && bal.bass > 3) {
          items.push({ ch: nm(c), value: `HPF ${p.hpf || '无'} → ${subLpf} Hz`, reason: `低音偏重 ${bal.bass} dB，门板低音与超低音（LPF ${subLpf} Hz）重叠太多` }); p.hpf = subLpf;
        }
        if (c.type === 'sub' && bal && bal.bass > 5 && (p.lpf || 80) > 63) {
          items.push({ ch: nm(c), value: `LPF ${p.lpf} → 63 Hz`, reason: `低频整体高 ${bal.bass} dB，收窄超低音上限` }); p.lpf = 63;
        }
        if (c.type === 'rear' && !p.hpf) { p.hpf = 80; items.push({ ch: nm(c), value: 'HPF 80 Hz', reason: '后场小喇叭不承担低频，避免失真' }); }
      });
      ['L', 'R'].forEach((side) => {
        const m = bySide(side, 'mid'), w = bySide(side, 'woofer'), t = bySide(side, 'tweeter');
        if (m && w && per[w.id].lpf && per[m.id].hpf && per[w.id].lpf < per[m.id].hpf * 0.8) {
          items.push({ ch: nm(m), value: `HPF ${per[m.id].hpf} → ${per[w.id].lpf} Hz`, reason: `与 ${nm(w)} LPF ${per[w.id].lpf} Hz 之间有空档` }); per[m.id].hpf = per[w.id].lpf;
        }
        [[w, m, w && per[w.id].lpf], [m, t, t && per[t.id].hpf]].forEach(([a, b, xf]) => {
          if (!a || !b || !xf) return;
          const d = devAt(anOf(b) || sys, xf);
          if (d != null && d < -4) {
            items.push({ ch: `${nm(a)} / ${nm(b)}`, value: `分频点 ${xf} Hz 有凹陷 ${r1(d)} dB`, reason: '相邻单元在分频点相互抵消：先试把较高频单元反相，或微调延时 0.1–0.3 ms；不要用 EQ 硬补' });
            if (!per[b.id].invert) per[b.id].tryInvert = true;
          }
        });
      });
      chs.forEach((c) => { if (per[c.id].hpf !== c.hpf || per[c.id].lpf !== c.lpf) per[c.id].xoChanged = true; });
      if (!sys && !chs.some((c) => anOf(c))) todo.push('还没有录音分析数据，分频为单元类型默认值；做一次整车录音分析可据频响微调。');
      const summary = chs.map((c) => ({ ch: nm(c), value: [per[c.id].hpf ? `HPF ${per[c.id].hpf} Hz` : '', per[c.id].lpf ? `LPF ${per[c.id].lpf} Hz` : ''].filter(Boolean).join(' / ') + ((per[c.id].hpf || per[c.id].lpf) ? ` · ${per[c.id].slope} dB/oct` : '全频'), reason: per[c.id].xoChanged ? '已按分析调整' : (sys || anOf(c) ? '分析未见问题，保持' : `${TYPE_CN[c.type]}单元默认值`) }));
      steps.push({ title: '分频', items: items.concat([{ ch: '— 最终分频 —', value: '', reason: '' }], summary), todo });
    }
    // fold crossover-dip invert hints into step 2
    const pol = steps[1];
    chs.filter((c) => per[c.id].tryInvert).forEach((c) => pol.items.push({ ch: nm(c), value: '试反相（可选）', reason: '分频点出现凹陷，反相后复测，凹陷变浅就保留' }));
    if (!pol.items.length) pol.items.push({ ch: '全部通道', value: '保持正相', reason: pol.todo.length ? '暂无反相证据（默认值）' : '极性检测均为正' });

    // 4. 延时
    {
      const items = [], todo = [];
      const ms = chs.map((c) => (c.delayMs != null ? c.delayMs : c.distCm != null ? c.distCm / 34.3 : null));
      const have = ms.filter((v) => v != null);
      if (have.length >= 2) {
        const mx = Math.max(...have);
        chs.forEach((c, i) => { if (ms[i] == null) return; const d = r2(mx - ms[i]); per[c.id].delayMs = d; per[c.id].delaySrc = c.delayMs != null ? '实测' : '距离'; items.push({ ch: nm(c), value: `${d} ms`, reason: d === 0 ? '最远的通道，作为基准 0' : `比最远通道近 ${r1(d * 34.3)} cm，补延时让声音同时到达` }); });
        const miss = chs.filter((c, i) => ms[i] == null);
        if (miss.length) todo.push(`缺少延时数据：${miss.map(nm).join('、')}（做「延时对齐」或在方案表填距离）`);
      } else {
        todo.push('先做「延时对齐」测量，或在「通道方案」填写每个扬声器到主驾头部的距离（cm）。');
        const st = sys && sys.stereo;
        if (st && Math.abs(st.delayMs) > 0.1 && Math.abs(st.peakCorrelation) > 0.3) {
          const early = st.delayMs > 0 ? 'L' : 'R', d = r2(Math.abs(st.delayMs));
          chs.filter((c) => c.side === early).forEach((c) => { per[c.id].delayMs = d; per[c.id].delaySrc = '录音估算'; });
          items.push({ ch: `所有${early === 'L' ? '左' : '右'}侧通道`, value: `${d} ms`, reason: `整车录音显示${early === 'L' ? '左' : '右'}侧声音先到 ${d} ms，给它补延时（粗调）` });
        } else items.push({ ch: '全部通道', value: '0 ms（默认值）', reason: '暂无距离/延时数据' });
      }
      steps.push({ title: '延时（以最远通道为 0）', items, todo });
    }

    // 5. EQ
    {
      const items = [], todo = [];
      let any = false;
      chs.forEach((c) => {
        const rep = anOf(c);
        if (!rep || !rep.bands) return;
        any = true;
        const lo = c.hpf ? Math.max(31, c.hpf) : 31, hi = c.lpf ? Math.min(16000, c.lpf) : 16000;
        const r = eqFromBands(rep.bands, { lo, hi, rolloff: rep.balance && rep.balance.lowRolloffHz });
        per[c.id].eq = r.bands;
        r.bands.forEach((e) => items.push({ ch: nm(c), value: `${e.freq} Hz  ${e.gain > 0 ? '+' : ''}${e.gain} dB  Q ${e.q}`, reason: e.reason }));
        r.notes.forEach((n) => items.push({ ch: nm(c), value: '不做 EQ', reason: n.reason }));
        if (!r.bands.length) items.push({ ch: nm(c), value: '无需 EQ', reason: '频响已接近目标' });
      });
      if (sys && sys.bands) {
        any = true;
        const r = eqFromBands(sys.bands, { rolloff: sys.balance && sys.balance.lowRolloffHz });
        per.system = r.bands;
        r.bands.forEach((e) => items.push({ ch: '整车（总 EQ / 左右同设）', value: `${e.freq} Hz  ${e.gain > 0 ? '+' : ''}${e.gain} dB  Q ${e.q}`, reason: e.reason }));
        r.notes.forEach((n) => items.push({ ch: '整车', value: '不做 EQ', reason: n.reason }));
        if (!r.bands.length) items.push({ ch: '整车', value: '无需 EQ', reason: '频响已接近目标' });
      }
      if (!any) { todo.push('先做「录音分析」：主驾头部位置录 10–30 秒粉红噪声（可按通道分别录并选「录音对应通道」）。'); items.push({ ch: '全部通道', value: '不加 EQ（默认值）', reason: '没有频响数据，不凭空调 EQ' }); }
      steps.push({ title: `EQ（目标曲线：${input.target || '—'}，先衰减，提升 ≤ +3 dB）`, items, todo });
    }

    // 6. 复测
    {
      const items = [
        { ch: '电平', value: '各通道粉红噪声电平差 ≤ 1 dB', reason: '用「电平匹配」逐通道复测' },
        { ch: '极性', value: '所有通道首波为正（或已在 DSP 反相）', reason: '用「极性检测」' },
        { ch: '延时', value: '各通道实测到达时间差 ≤ 0.1 ms', reason: '应用延时后重新做「延时对齐」' },
        { ch: '频响', value: '1/3 倍频程偏差基本在 ±3 dB 内，分频点无深谷', reason: '主驾位置重新录音分析' },
        { ch: '听感', value: '人声居中在仪表台、低音不“轰”、高音不刺耳', reason: '用熟悉的音乐试听' },
      ];
      steps.push({ title: '复测与验收', items, todo: [] });
    }

    const missing = steps.reduce((a, s) => a + s.todo.length, 0);
    return { createdAt: new Date().toISOString(), target: input.target || null, channelCount: chs.length, missing, steps, perChannel: per, disclaimer: '基于未校准麦克风与浏览器测量，仅供参考；调整时请先小音量，逐步确认。' };
  }

  function toText(p) {
    const L = ['汽车音响调音方案（自动生成，仅供参考）', '生成时间：' + p.createdAt, ''];
    p.steps.forEach((s, i) => {
      L.push(`${i + 1}. ${s.title}`);
      s.items.forEach((it) => L.push(it.value || it.reason ? `   - ${it.ch}：${it.value}${it.reason ? '  （' + it.reason + '）' : ''}` : `   ${it.ch}`));
      s.todo.forEach((t) => L.push('   ⚠ 待测：' + t));
      L.push('');
    });
    L.push('—— 各通道汇总 ——');
    Object.values(p.perChannel).filter((c) => c && c.id).forEach((c) => {
      L.push(`CH${c.id} ${c.name}：增益 ${c.gainDb > 0 ? '+' : ''}${c.gainDb} dB(${c.gainSrc}) · ${c.invert ? '反相' : '正相'} · ${c.hpf ? 'HPF ' + c.hpf : ''}${c.hpf && c.lpf ? ' / ' : ''}${c.lpf ? 'LPF ' + c.lpf : ''}${c.hpf || c.lpf ? ' Hz ' + c.slope + 'dB/oct' : '全频'} · 延时 ${c.delayMs} ms(${c.delaySrc})${c.eq.length ? ' · EQ ' + c.eq.map((e) => `${e.freq}Hz ${e.gain}dB Q${e.q}`).join('; ') : ''}`);
    });
    if (p.perChannel.system && p.perChannel.system.length) L.push('整车 EQ：' + p.perChannel.system.map((e) => `${e.freq}Hz ${e.gain}dB Q${e.q}`).join('; '));
    L.push('', p.disclaimer);
    return L.join('\n');
  }

  function toCsv(p) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const L = ['步骤,项目,建议,原因'];
    p.steps.forEach((s, i) => { s.items.forEach((it) => L.push([i + 1 + '.' + s.title, it.ch, it.value, it.reason].map(q).join(','))); s.todo.forEach((t) => L.push([i + 1 + '.' + s.title, '待测', t, ''].map(q).join(','))); });
    L.push('', '通道,名称,增益dB,反相,HPF,LPF,斜率,延时ms,EQ');
    Object.values(p.perChannel).filter((c) => c && c.id).forEach((c) => L.push(['CH' + c.id, c.name, c.gainDb, c.invert ? '是' : '否', c.hpf ?? '', c.lpf ?? '', c.slope, c.delayMs, c.eq.map((e) => `${e.freq}Hz ${e.gain}dB Q${e.q}`).join('; ')].map(q).join(',')));
    return L.join('\n');
  }

  // ---------- 浏览器 UI ----------
  const KEY = 'cat-analyses-v1';
  let last = null;
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function loadAn() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } }
  function saveAnalysis(report) {
    const a = loadAn();
    const key = report.channelId || 'all';
    a[key] = { channel: report.channel, file: report.file, targetCurve: report.targetCurve, bands: report.bands, balance: report.balance, stereo: report.stereo, levels: report.levels, at: report.createdAt };
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (_) {}
  }
  function clearAnalyses() { try { localStorage.removeItem(KEY); } catch (_) {} }
  function analysisCount() { return Object.keys(loadAn()).length; }

  function build() {
    const an = loadAn();
    const tgt = (an.all && an.all.targetCurve) || (Object.values(an)[0] || {}).targetCurve || (el('anTarget') && el('anTarget').value);
    last = generate({ channels: Channels.getAll(), analyses: an, target: tgt });
    return last;
  }

  function renderInto(boxId, p) {
    const box = el(boxId);
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<p class="hint">已用数据：${analysisCount()} 份录音分析 · ${p.channelCount} 个未静音通道${p.missing ? ` · <span class="warnc">${p.missing} 项数据缺失（见 ⚠）</span>` : ''}</p>` + p.steps.map((s, i) => `
      <div class="tp-step"><h4><span class="tp-no">${i + 1}</span>${esc(s.title)}</h4>
        <ul>${s.items.map((it) => (it.value || it.reason) ? `<li><b>${esc(it.ch)}</b><span class="tp-val">${esc(it.value)}</span>${it.reason ? `<small>${esc(it.reason)}</small>` : ''}</li>` : `<li class="tp-sep">${esc(it.ch)}</li>`).join('')}</ul>
        ${s.todo.map((t) => `<p class="tp-todo">⚠ ${esc(t)}</p>`).join('')}
      </div>`).join('') + `<p class="hint">${esc(p.disclaimer)}</p>`;
  }

  function show() { const p = build(); renderInto('tpOut', p); renderInto('anPlanOut', p); el('tpActions').hidden = false; const a2 = el('anPlanActions'); if (a2) a2.hidden = false; return p; }

  function apply() {
    const p = last || build();
    Object.values(p.perChannel).filter((c) => c && c.id).forEach((c) => {
      const cur = Channels.get(c.id);
      Channels.update(c.id, { hpf: c.hpf, lpf: c.lpf, slope: c.slope, gainSetDb: c.gainSrc === '默认值' ? null : c.gainDb, delaySetMs: c.delaySrc === '默认值' ? null : c.delayMs, invert: c.invert, eq: c.eq, polarity: c.invert && !/反/.test(cur.polarity) ? '反 −（方案）' : cur.polarity });
    });
    if (p.perChannel.system) localStorage.setItem('cat-system-eq', JSON.stringify(p.perChannel.system));
    App.switchTab('plan');
    alert('已写入 12 通道方案表（增益、极性、分频、延时、EQ）。');
  }

  function dl(text, ext, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: mime + ';charset=utf-8' }));
    a.download = 'tuning-plan-' + Date.now() + '.' + ext;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function copy() {
    const t = toText(last || build());
    try { await navigator.clipboard.writeText(t); alert('方案已复制'); } catch (_) {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); alert('方案已复制'); } catch (e) { alert('复制失败，请用导出 TXT'); } ta.remove();
    }
  }

  function init() {
    const bind = (id, fn) => { const b = el(id); if (b) b.onclick = fn; };
    bind('tpGen', show);
    ['tpApply', 'anTpApply'].forEach((id) => bind(id, apply));
    ['tpCopy', 'anTpCopy'].forEach((id) => bind(id, copy));
    bind('tpTxt', () => dl(toText(last || build()), 'txt', 'text/plain'));
    bind('tpCsv', () => dl(toCsv(last || build()), 'csv', 'text/csv'));
    bind('tpJson', () => dl(JSON.stringify(last || build(), null, 2), 'json', 'application/json'));
    bind('tpClearAn', () => { if (confirm('清除已保存的录音分析数据？')) { clearAnalyses(); show(); } });
  }

  function onAnalysis(report) { saveAnalysis(report); show(); }
  function getSnapshot() { return last; }

  return { generate, eqFromBands, toText, toCsv, init, onAnalysis, show, apply, getSnapshot };
})();
if (typeof module !== 'undefined') module.exports = TunePlan;
