/** 12 通道车用 DSP 模型：名称/声道侧/类型/静音 + 每通道延时、电平、极性、分频，存 localStorage
 *  分频方式（主动/被动）：cat-crossover-mode-v1 = active|passive，默认 active
 */
const Channels = (() => {
  const KEY = 'cat-channels-v3';
  const OLD_KEYS = ['cat-channels-v2', 'cat-channels-v1'];
  const MODE_KEY = 'cat-crossover-mode-v1';
  // 空白通用 12 路：只有常见布局名称与单元类型，分频用类型默认值；增益/延时/极性/EQ 全部为空，等测量后填写
  // [名称, 侧, 类型, HPF|null用类型默认, LPF|null用类型默认, 增益dB, 延时ms, 反相, 静音, EQ, 备注]
  const DEF = [
    ['前左高音', 'L', 'tweeter', null, null, null, null, false, false, [], ''],
    ['前左中音', 'L', 'mid', null, null, null, null, false, false, [], ''],
    ['前左低音', 'L', 'woofer', null, null, null, null, false, false, [], ''],
    ['前右高音', 'R', 'tweeter', null, null, null, null, false, false, [], ''],
    ['前右中音', 'R', 'mid', null, null, null, null, false, false, [], ''],
    ['前右低音', 'R', 'woofer', null, null, null, null, false, false, [], ''],
    ['中置', 'C', 'center', null, null, null, null, false, false, [], ''],
    ['后左', 'L', 'rear', null, null, null, null, false, false, [], ''],
    ['后右', 'R', 'rear', null, null, null, null, false, false, [], ''],
    ['超低音左', 'L', 'sub', null, null, null, null, false, false, [], ''],
    ['超低音右', 'R', 'sub', null, null, null, null, false, false, [], ''],
    ['备用', 'M', 'full', null, null, null, null, false, false, [], ''],
  ];
  const XO = {
    tweeter: { hpf: 3500, lpf: null }, mid: { hpf: 300, lpf: 3500 }, woofer: { hpf: 40, lpf: 300 },
    center: { hpf: 250, lpf: null }, rear: { hpf: 80, lpf: null }, sub: { hpf: 20, lpf: 80 }, full: { hpf: null, lpf: null },
  };
  const TYPE_CN = { tweeter: '高音', mid: '中音', woofer: '低音', center: '中置', rear: '后场', sub: '超低音', full: '全频' };
  const SIDE_CN = { L: '左', R: '右', C: '中', M: '单声道' };
  const FRONT_TYPES = ['tweeter', 'mid', 'woofer'];
  let chs = [];
  let selected = new Set([1]);
  let mode = 'active'; // active | passive
  const listeners = [];

  function defaults() {
    return DEF.map(([name, side, type, hpf, lpf, g, d, inv, mute, eq, note], i) => {
      const xo = XO[type] || XO.full;
      const h = hpf != null ? hpf : xo.hpf;
      const l = lpf != null ? lpf : xo.lpf;
      return {
        id: i + 1, name, side, type, mute,
        distCm: null, delayMs: null, levelDb: null, polarity: mute ? '—' : '未测',
        hpf: h, lpf: l, slope: 24, gainSetDb: g, delaySetMs: d, invert: inv, note,
        eq: (eq || []).map((e) => Array.isArray(e) ? { freq: e[0], gain: e[1], q: e[2] } : e),
      };
    });
  }
  function loadMode() {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === 'active' || m === 'passive') mode = m;
      else mode = 'active';
    } catch (_) { mode = 'active'; }
  }
  function getMode() { return mode; }
  function isPassive() { return mode === 'passive'; }
  function isFrontUnit(c) { return c && FRONT_TYPES.includes(c.type); }

  /** 被动：前声场同侧高/中/低合并为一组；后场已是单路则不动；中置/超低音/备用不动 */
  function groups() {
    if (mode !== 'passive') {
      return chs.map((c) => ({ primary: c.id, memberIds: [c.id], name: c.name, side: c.side, type: c.type, merged: false }));
    }
    const used = new Set();
    const out = [];
    ['L', 'R'].forEach((side) => {
      const members = chs.filter((c) => c.side === side && isFrontUnit(c));
      if (!members.length) return;
      members.forEach((m) => used.add(m.id));
      out.push({
        primary: members[0].id,
        memberIds: members.map((m) => m.id),
        name: side === 'L' ? '前左' : '前右',
        side,
        type: 'full',
        merged: true,
      });
    });
    chs.forEach((c) => {
      if (!used.has(c.id)) out.push({ primary: c.id, memberIds: [c.id], name: c.name, side: c.side, type: c.type, merged: false });
    });
    return out;
  }
  function groupOf(id) {
    const n = +id;
    return groups().find((g) => g.primary === n || g.memberIds.includes(n)) || null;
  }
  function firstVal(members, key) {
    for (const m of members) {
      const v = m[key];
      if (v != null && v !== '') return v;
    }
    return null;
  }
  function displayOf(g) {
    const members = g.memberIds.map((id) => get(id)).filter(Boolean);
    const primary = get(g.primary) || members[0];
    if (!primary) return null;
    return {
      id: g.primary,
      name: g.name,
      side: g.side,
      type: g.type,
      mute: members.every((m) => m.mute),
      merged: !!g.merged,
      memberIds: g.memberIds.slice(),
      distCm: firstVal(members, 'distCm'),
      delayMs: firstVal(members, 'delayMs'),
      levelDb: firstVal(members, 'levelDb'),
      polarity: primary.polarity,
      hpf: g.merged ? null : primary.hpf,
      lpf: g.merged ? null : primary.lpf,
      slope: primary.slope,
      gainSetDb: firstVal(members, 'gainSetDb'),
      delaySetMs: firstVal(members, 'delaySetMs'),
      invert: members.some((m) => m.invert),
      note: g.merged ? '被动分频合并通道' : primary.note,
      eq: primary.eq || [],
    };
  }
  function displayList() { return groups().map(displayOf).filter(Boolean); }

  function load() {
    loadMode();
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && Array.isArray(s.chs) && s.chs.length === 12) {
        chs = s.chs; selected = new Set(s.sel || [1]);
        return;
      }
      OLD_KEYS.forEach((k) => {
        const old = localStorage.getItem(k);
        if (old) { try { localStorage.setItem(k + '-backup', old); } catch (_) {} localStorage.removeItem(k); }
      });
    } catch (_) {}
    chs = defaults();
  }
  function notify() {
    listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ chs, sel: [...selected] })); } catch (_) {}
    notify();
  }
  function setMode(m) {
    if (m !== 'active' && m !== 'passive') return;
    if (m === mode) { syncModeUI(); return; }
    mode = m;
    try { localStorage.setItem(MODE_KEY, mode); } catch (_) {}
    // 切到被动时：选择折叠到合并通道的全部成员；切回主动保留 ids
    if (mode === 'passive') {
      const next = new Set();
      [...selected].forEach((id) => {
        const g = groupOf(id);
        (g ? g.memberIds : [id]).forEach((x) => next.add(x));
      });
      selected = next.size ? next : new Set(groups()[0] ? groups()[0].memberIds : [1]);
    }
    try { localStorage.setItem(KEY, JSON.stringify({ chs, sel: [...selected] })); } catch (_) {}
    notify();
    render();
    renderEditor();
    syncModeUI();
  }

  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function get(id) { return chs.find((c) => c.id === +id); }
  function label(id) {
    const g = groupOf(id);
    if (g && g.merged) return `${g.name}`;
    const c = get(id);
    return c ? `CH${c.id} ${c.name}` : '—';
  }
  function labelDisplay(d) {
    if (d.merged) return d.name;
    return `CH${d.id} ${d.name}`;
  }

  const SYNC_KEYS = ['delayMs', 'delaySetMs', 'distCm', 'levelDb', 'mute', 'gainSetDb', 'invert', 'polarity', 'eq'];

  function update(id, patch) {
    const g = groupOf(id);
    const p = { ...patch };
    // 被动模式：分频参数不可写入（由无源分频器决定）
    if (mode === 'passive') {
      delete p.hpf;
      delete p.lpf;
      delete p.slope;
    }
    if (mode === 'passive' && g && g.merged) {
      // 延时/电平/极性等按合并通道同步到全部单元
      const sync = {};
      SYNC_KEYS.forEach((k) => { if (k in p) sync[k] = p[k]; });
      g.memberIds.forEach((mid) => {
        const c = get(mid);
        if (c) Object.assign(c, sync);
      });
      save();
      render();
      return;
    }
    const c = get(id);
    if (!c) return;
    Object.assign(c, p);
    save();
    render();
  }

  function current() {
    const ids = [...selected].sort((a, b) => a - b);
    if (!ids.length) return null;
    if (mode === 'passive') {
      const g = groupOf(ids[0]);
      return g ? displayOf(g) : get(ids[0]);
    }
    return get(ids[0]);
  }
  function routeFor(id) { const c = get(id) || (groupOf(id) && get(groupOf(id).primary)); if (!c) return 'stereo'; return c.side === 'L' ? 'l' : c.side === 'R' ? 'r' : 'stereo'; }
  function suggestRoute() {
    const s = [...selected].map(get).filter((c) => c && !c.mute);
    const l = s.some((c) => c.side !== 'R'), r = s.some((c) => c.side !== 'L');
    return l && r ? 'stereo' : l ? 'l' : r ? 'r' : 'stereo';
  }
  function allSelectedMuted() { const s = [...selected].map(get); return s.length > 0 && s.every((c) => c.mute); }

  function selectGroup(g, exclusive) {
    if (exclusive) selected = new Set(g.memberIds);
    else {
      const allOn = g.memberIds.every((id) => selected.has(id));
      if (allOn) g.memberIds.forEach((id) => selected.delete(id));
      else g.memberIds.forEach((id) => selected.add(id));
    }
  }
  function groupSelected(g) {
    return g.memberIds.some((id) => selected.has(id));
  }
  function groupSolo(g) {
    return g.memberIds.every((id) => selected.has(id)) && selected.size === g.memberIds.length;
  }

  function syncModeUI() {
    document.querySelectorAll('[data-xo-mode]').forEach((b) => {
      b.classList.toggle('on', b.dataset.xoMode === mode);
      b.setAttribute('aria-pressed', b.dataset.xoMode === mode ? 'true' : 'false');
    });
    document.querySelectorAll('[data-xo-hint]').forEach((n) => {
      n.textContent = mode === 'passive'
        ? '被动分频：前声场按左右合并显示；分频由无源分频器决定，软件仅可测量验证；延时按合并后的通道调。'
        : '主动分频：每个喇叭单元独立 DSP 通道，可单独调分频点、延时和相位。';
    });
    document.body.classList.toggle('xo-passive', mode === 'passive');
    document.body.classList.toggle('xo-active', mode === 'active');
    const title = el('chPanelTitle');
    if (title) title.textContent = mode === 'passive' ? `通道（被动 · ${displayList().length} 路）` : '12 通道';
    const banner = el('xoPassiveBanner');
    if (banner) banner.hidden = mode !== 'passive';
    // 分频辅助页控件
    ['xoChHpf', 'xoChLpf', 'xoSaveCh', 'xoDefCh'].forEach((id) => {
      const n = el(id);
      if (!n) return;
      if (n.tagName === 'INPUT') n.disabled = mode === 'passive';
      else n.disabled = mode === 'passive';
    });
  }

  function bindModeButtons(root) {
    (root || document).querySelectorAll('[data-xo-mode]').forEach((b) => {
      if (b.dataset.xoBound) return;
      b.dataset.xoBound = '1';
      b.onclick = () => setMode(b.dataset.xoMode);
    });
  }

  function init() {
    load();
    el('chAll').onclick = () => {
      selected = new Set(chs.map((c) => c.id));
      save(); render();
    };
    el('chFront').onclick = () => {
      if (mode === 'passive') {
        selected = new Set();
        groups().filter((g) => g.merged).forEach((g) => g.memberIds.forEach((id) => selected.add(id)));
      } else {
        selected = new Set(chs.filter((c) => !c.mute && FRONT_TYPES.includes(c.type)).map((c) => c.id));
      }
      save(); render();
    };
    el('chNone').onclick = () => { selected = new Set(); save(); render(); };
    el('chEdit').onclick = () => { const p = el('chEditor'); p.hidden = !p.hidden; renderEditor(); };
    el('chReset').onclick = () => {
      if (!confirm('恢复空白通用 12 路（清空测量数据、增益/延时/极性/EQ）？分频方式保持不变。')) return;
      chs = defaults(); selected = new Set([1]); save(); render(); renderEditor();
    };
    bindModeButtons(document);
    render();
    syncModeUI();
  }

  function render() {
    const gEl = el('chGrid');
    if (!gEl) return;
    const list = displayList();
    gEl.innerHTML = list.map((c) => `
      <div class="chc ${groupSelected(groupOf(c.id)) ? 'sel' : ''} ${groupSolo(groupOf(c.id)) ? 'solo' : ''} ${c.mute ? 'muted' : ''} ${c.merged ? 'merged' : ''}" data-id="${c.id}">
        <button type="button" class="chc-main" data-id="${c.id}"><b>${c.merged ? '合并' : 'CH' + c.id}</b><span>${esc(c.name)}</span><small>${SIDE_CN[c.side]}·${c.merged ? '被动' : (TYPE_CN[c.type] || '')}</small></button>
        <button type="button" class="chc-mute" data-mute="${c.id}" aria-label="静音">${c.mute ? '🔇' : '🔈'}</button>
      </div>`).join('');
    gEl.querySelectorAll('.chc-main').forEach((b) => {
      const id = +b.dataset.id;
      let t = null, long = false;
      b.addEventListener('pointerdown', () => {
        long = false;
        t = setTimeout(() => {
          long = true;
          const g = groupOf(id);
          if (g) selectGroup(g, true);
          else selected = new Set([id]);
          save(); render();
        }, 450);
      });
      const clr = () => { if (t) clearTimeout(t); t = null; };
      b.addEventListener('pointerleave', clr); b.addEventListener('pointercancel', clr);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        clr();
        if (long) return;
        const g = groupOf(id);
        if (e.shiftKey) {
          if (g) selectGroup(g, true);
          else selected = new Set([id]);
        } else if (g) {
          selectGroup(g, false);
        } else if (selected.has(id)) selected.delete(id); else selected.add(id);
        save(); render();
      });
    });
    gEl.querySelectorAll('.chc-mute').forEach((b) => {
      b.onclick = () => {
        const id = +b.dataset.mute;
        const cur = displayOf(groupOf(id)) || get(id);
        update(id, { mute: !(cur && cur.mute) });
      };
    });
    const cur = current();
    const curLabel = cur
      ? (cur.merged
        ? `当前：${cur.name}（${SIDE_CN[cur.side]}${cur.mute ? '，已静音' : ''} · 被动合并）`
        : `当前：${label(cur.id)}（${SIDE_CN[cur.side]}${cur.mute ? '，已静音' : ''}）`)
      : '未选择通道';
    const nSel = mode === 'passive'
      ? groups().filter((g) => groupSelected(g)).length
      : selected.size;
    el('chCurrent').textContent = cur
      ? curLabel + (nSel > 1 ? ` 等 ${nSel} 路` : '')
      : '未选择通道';
    fillSelects();
    renderPlan();
    syncModeUI();
  }

  function fillSelects() {
    const list = displayList();
    document.querySelectorAll('select.ch-select').forEach((s) => {
      const prev = s.value;
      const extra = s.dataset.extra ? `<option value="">${s.dataset.extra}</option>` : '';
      s.innerHTML = extra + list.map((c) => `<option value="${c.id}">${esc(labelDisplay(c))}</option>`).join('');
      if (prev && [...s.options].some((o) => o.value === prev)) s.value = prev;
      else if (s.dataset.default) s.value = s.dataset.default;
      else if (!s.dataset.extra && current()) s.value = String(current().id);
    });
  }

  function renderEditor() {
    const p = el('chEditorBody');
    if (!p) return;
    if (mode === 'passive') {
      p.innerHTML = `<p class="hint" style="grid-column:1/-1">被动分频下前声场已合并为「前左 / 前右」。单元名称仍可改（影响底层 12 路数据）；分频点不可在此调节。</p>` +
        chs.map((c) => `
      <div class="ched-row"><b>CH${c.id}</b>
        <input type="text" maxlength="16" data-f="name" data-id="${c.id}" value="${esc(c.name)}" />
        <select data-f="side" data-id="${c.id}">${Object.keys(SIDE_CN).map((k) => `<option value="${k}" ${c.side === k ? 'selected' : ''}>${SIDE_CN[k]}</option>`).join('')}</select>
        <select data-f="type" data-id="${c.id}" ${isFrontUnit(c) ? 'disabled title="被动模式下前声场类型用于合并，改类型请先切回主动"' : ''}>${Object.keys(TYPE_CN).map((k) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${TYPE_CN[k]}</option>`).join('')}</select>
      </div>`).join('');
    } else {
      p.innerHTML = chs.map((c) => `
      <div class="ched-row"><b>CH${c.id}</b>
        <input type="text" maxlength="16" data-f="name" data-id="${c.id}" value="${esc(c.name)}" />
        <select data-f="side" data-id="${c.id}">${Object.keys(SIDE_CN).map((k) => `<option value="${k}" ${c.side === k ? 'selected' : ''}>${SIDE_CN[k]}</option>`).join('')}</select>
        <select data-f="type" data-id="${c.id}">${Object.keys(TYPE_CN).map((k) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${TYPE_CN[k]}</option>`).join('')}</select>
      </div>`).join('');
    }
    p.querySelectorAll('[data-f]').forEach((i) => {
      i.onchange = () => {
        if (i.disabled) return;
        const patch = { [i.dataset.f]: i.dataset.f === 'name' ? (i.value.trim() || '未命名') : i.value };
        if (i.dataset.f === 'type') Object.assign(patch, { hpf: XO[i.value].hpf, lpf: XO[i.value].lpf });
        // 名称/侧/类型直接写底层，不走合并同步
        const c = get(+i.dataset.id);
        if (!c) return;
        if (i.dataset.f === 'type' && mode === 'passive') return;
        Object.assign(c, patch);
        save();
        render();
        renderEditor();
      };
    });
  }

  // ---- 计算（底层 12 路；被动展示时合并行取代表值）----
  function delayPlan() {
    const ms = chs.map((c) => (c.delayMs != null ? c.delayMs : c.distCm != null ? c.distCm / 34.3 : null));
    const vals = ms.filter((v) => v != null);
    const max = vals.length ? Math.max(...vals) : null;
    return chs.map((c, i) => (ms[i] == null ? null : { ms: ms[i], comp: max - ms[i], compCm: (max - ms[i]) * 34.3 }));
  }
  function gainPlan() {
    const v = chs.map((c) => c.levelDb).filter((x) => x != null);
    const min = v.length ? Math.min(...v) : null;
    return chs.map((c) => (c.levelDb == null ? null : { rel: c.levelDb - min, trim: min - c.levelDb }));
  }
  const xoText = (c) => {
    if (mode === 'passive' && (c.merged || isFrontUnit(c))) return '被动分频（无源分频器 · 仅测量验证）';
    if (mode === 'passive') return [c.hpf ? `HPF ${c.hpf}Hz` : '', c.lpf ? `LPF ${c.lpf}Hz` : ''].filter(Boolean).join(' / ') + ((c.hpf || c.lpf) ? ` · ${c.slope}dB/oct` : '全频') + '（被动下不可调）';
    return [c.hpf ? `HPF ${c.hpf}Hz` : '', c.lpf ? `LPF ${c.lpf}Hz` : ''].filter(Boolean).join(' / ') + ((c.hpf || c.lpf) ? ` · ${c.slope}dB/oct` : '全频');
  };
  const f2 = (v, n = 2) => (v == null ? '—' : v.toFixed(n));

  function planRows() {
    const d = delayPlan(), g = gainPlan();
    if (mode === 'passive') {
      return displayList().map((c) => {
        const di = delayPlan()[c.id - 1];
        const gi = gainPlan()[c.id - 1];
        return {
          ch: c.merged ? c.name : 'CH' + c.id, name: c.name, side: SIDE_CN[c.side], type: c.merged ? '被动合并' : TYPE_CN[c.type], mute: c.mute ? '是' : '否',
          distCm: c.distCm, measuredDelayMs: c.delayMs != null ? +c.delayMs.toFixed(3) : null,
          delayCompMs: c.delaySetMs != null ? c.delaySetMs : di ? +di.comp.toFixed(2) : null, levelDb: c.levelDb != null ? +c.levelDb.toFixed(1) : null,
          gainTrimDb: c.gainSetDb != null ? c.gainSetDb : gi ? +gi.trim.toFixed(1) : null, polarity: c.polarity, invert: c.invert ? '是' : '否',
          eq: (c.eq || []).map((e) => `${e.freq}Hz ${e.gain}dB Q${e.q}`).join('; '), hpf: c.hpf, lpf: c.lpf, slope: c.slope, crossover: xoText(c),
        };
      });
    }
    return chs.map((c, i) => ({
      ch: 'CH' + c.id, name: c.name, side: SIDE_CN[c.side], type: TYPE_CN[c.type], mute: c.mute ? '是' : '否',
      distCm: c.distCm, measuredDelayMs: c.delayMs != null ? +c.delayMs.toFixed(3) : null,
      delayCompMs: c.delaySetMs != null ? c.delaySetMs : d[i] ? +d[i].comp.toFixed(2) : null, levelDb: c.levelDb != null ? +c.levelDb.toFixed(1) : null,
      gainTrimDb: c.gainSetDb != null ? c.gainSetDb : g[i] ? +g[i].trim.toFixed(1) : null, polarity: c.polarity, invert: c.invert ? '是' : '否',
      eq: (c.eq || []).map((e) => `${e.freq}Hz ${e.gain}dB Q${e.q}`).join('; '), hpf: c.hpf, lpf: c.lpf, slope: c.slope, crossover: xoText(c),
    }));
  }

  function renderPlan() {
    const body = el('planBody');
    if (!body) return;
    const d = delayPlan(), g = gainPlan();
    const list = mode === 'passive' ? displayList() : chs.map((c) => ({ ...c, merged: false, memberIds: [c.id] }));
    body.innerHTML = list.map((c) => {
      const i = c.id - 1;
      return `
      <tr class="${c.mute ? 'row-muted' : ''}${c.merged ? ' row-merged' : ''}">
        <td><b>${c.merged ? esc(c.name) : 'CH' + c.id}</b> ${c.merged ? '<small>被动合并</small>' : esc(c.name)}<br><small>${SIDE_CN[c.side]}·${c.merged ? '被动' : TYPE_CN[c.type]}${c.mute ? ' · 静音' : ''}</small></td>
        <td><input type="number" class="plan-in" data-id="${c.id}" data-f="distCm" value="${c.distCm ?? ''}" placeholder="cm" min="0" max="500" ${''} /></td>
        <td>${c.delayMs != null ? f2(c.delayMs) : '—'}</td>
        <td class="hl">${c.delaySetMs != null ? '+' + f2(c.delaySetMs) + ' ms<small> 方案</small>' : d[i] ? '+' + f2(d[i].comp) + ' ms' : '—'}</td>
        <td>${c.gainSetDb != null ? (c.gainSetDb > 0 ? '+' : '') + f2(c.gainSetDb, 1) + ' dB<small> 方案</small>' : g[i] ? (g[i].trim > 0 ? '+' : '') + f2(g[i].trim, 1) + ' dB' : '—'}</td>
        <td>${c.invert ? '<b class="badc">反相</b><br><small>' + esc(c.polarity) + '</small>' : esc(c.polarity)}</td>
        <td>${xoText(c)}</td>
        <td>${(c.eq && c.eq.length) ? `<details><summary>${c.eq.length} 段</summary>${c.eq.map((e) => `${e.freq}Hz ${e.gain > 0 ? '+' : ''}${e.gain}dB Q${e.q}`).join('<br>')}</details>` : '—'}</td>
      </tr>`;
    }).join('');
    body.querySelectorAll('.plan-in').forEach((i) => {
      i.onchange = () => update(+i.dataset.id, { distCm: i.value === '' ? null : +i.value, delaySetMs: null, ...(i.value !== '' ? { delayMs: null } : {}) });
    });
  }

  function exportPlan(kind) {
    const rows = planRows();
    let text, mime;
    if (kind === 'json') { text = JSON.stringify({ app: '汽车音响调音 · 通道方案', crossoverMode: mode, savedAt: new Date().toISOString(), channels: rows }, null, 2); mime = 'application/json'; }
    else {
      const head = ['通道', '名称', '声道', '类型', '静音', '距离cm', '实测延时ms', '延时补偿ms', '相对电平dB', '增益修正dB', '极性', '反相', 'HPF', 'LPF', '斜率dB/oct', 'EQ'];
      const keys = ['ch', 'name', 'side', 'type', 'mute', 'distCm', 'measuredDelayMs', 'delayCompMs', 'levelDb', 'gainTrimDb', 'polarity', 'invert', 'hpf', 'lpf', 'slope', 'eq'];
      text = [head.join(','), ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
      mime = 'text/csv';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: mime + ';charset=utf-8' }));
    a.download = 'dsp-plan-' + mode + '-' + Date.now() + '.' + kind;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function getAll() { return chs.map((c) => ({ ...c })); }
  function setAll(list) {
    if (!Array.isArray(list) || list.length !== 12) return false;
    chs = list.map((c, i) => Object.assign(defaults()[i], c, { id: i + 1 })); save(); render(); return true;
  }
  function getActive() { return [...selected].map((id) => label(id)); }
  function onChange(f) { listeners.push(f); }

  return {
    init, get, label, update, current, routeFor, suggestRoute, allSelectedMuted,
    getAll, setAll, getActive, planRows, exportPlan, renderPlan, fillSelects, onChange,
    delayPlan, gainPlan, XO,
    getMode, setMode, isPassive, displayList, groups, bindModeButtons, syncModeUI, MODE_KEY,
  };
})();
