/** 12 通道车用 DSP 模型：名称/声道侧/类型/静音 + 每通道延时、电平、极性、分频，存 localStorage */
const Channels = (() => {
  const KEY = 'cat-channels-v2';
  const OLD_KEY = 'cat-channels-v1';
  // 默认 = 豆豆的赛那预设（sn7.26.jssh，预设组 7.26，OUT1–OUT12）：[名称, 侧, 类型, HPF, LPF, 增益dB, 延时ms, 反相, 静音, EQ[[Hz,dB,Q]], 备注]
  const DEF = [
    ['左尾门 GX628', 'L', 'rear', 100, 6500, -14.5, 11.604, false, false, [[160, -1.5, 1], [2500, -2.5, 1], [6300, -1.5, 0.9]], '只留空间尾韵，比右尾门低1dB'],
    ['右尾门 GX628', 'R', 'rear', 100, 6500, -13.5, 10.875, false, false, [[160, -1.5, 1], [2500, -2.5, 1], [6300, -1.5, 0.9]], '增益保守，避免人声从车尾出来'],
    ['左二排滑门 GX328', 'L', 'rear', 250, 10000, -9, 12.229, false, false, [[250, 0, 1], [500, 0, 1.2], [2500, -2, 1], [3150, -1.5, 1.2], [8000, -1, 0.8]], '串联68μF电容，实际下限约600–1000Hz'],
    ['右二排滑门 GX328', 'R', 'rear', 250, 10000, -8.5, 11.208, false, false, [[250, 0, 1], [500, 0, 1.2], [2500, -2, 1], [3150, -1.5, 1.2], [8000, -1, 0.8]], '串联68μF电容，比左高0.5dB'],
    ['左前门中低音 9600C', 'L', 'woofer', 55, 300, -1, 6.417, false, false, [[63, -1, 0.8], [125, -1, 1], [250, -1.5, 1]], '主驾近侧略收'],
    ['右前门中低音 9600C', 'R', 'woofer', 55, 300, 0, 4.229, false, false, [[63, -1, 0.8], [125, -1, 1], [250, -1.5, 1]], '中低频声像锚点'],
    ['超低音 Stage82', 'M', 'sub', 28, 75, -2, 0, false, false, [[35, 1, 0.9], [45, 1.5, 0.9], [70, -1, 1]], '实车正相，左右输入各50%；换炮/箱体需重测正反相'],
    ['仪表台中置（关闭）', 'C', 'center', null, null, null, null, false, true, [], '永久静音，不参与调音'],
    ['前左仪表台中音 GX328', 'L', 'mid', 300, 4000, -4, 6.854, false, false, [[500, -1, 1.2], [1600, 0.5, 1], [2500, -1.2, 1.2], [3150, -0.8, 1]], '主唱偏左先降0.5dB'],
    ['前右仪表台中音 GX328', 'R', 'mid', 300, 4000, -3, 4.958, false, false, [[500, -1, 1.2], [1600, 0.5, 1], [2500, -1.2, 1.2], [3150, -0.8, 1]], '比左高1dB，口型推向中控'],
    ['前左高音 FIT19T', 'L', 'tweeter', 4000, null, -7.5, 6.708, true, false, [[5000, -0.8, 1], [6300, -1.2, 1], [10000, 0.5, 0.8]], '实车反相；近耳先压低'],
    ['前右高音 FIT19T', 'R', 'tweeter', 4000, null, -6, 4.667, true, false, [[5000, -0.4, 1], [6300, -0.8, 1], [10000, 0.8, 0.8]], '实车反相；比左高1.5dB'],
  ];
  const XO = {
    tweeter: { hpf: 3500, lpf: null }, mid: { hpf: 300, lpf: 3500 }, woofer: { hpf: 40, lpf: 300 },
    center: { hpf: 250, lpf: null }, rear: { hpf: 80, lpf: null }, sub: { hpf: 20, lpf: 80 }, full: { hpf: null, lpf: null },
  };
  const TYPE_CN = { tweeter: '高音', mid: '中音', woofer: '低音', center: '中置', rear: '后场', sub: '超低音', full: '全频' };
  const SIDE_CN = { L: '左', R: '右', C: '中', M: '单声道' };
  let chs = [];
  let polFix = false;
  let selected = new Set([1]);
  const listeners = [];

  function defaults() {
    return DEF.map(([name, side, type, hpf, lpf, g, d, inv, mute, eq, note], i) => ({
      id: i + 1, name, side, type, mute,
      distCm: null, delayMs: null, levelDb: null, polarity: mute ? '—' : inv ? '反 −（预设）' : '正 +（预设）',
      hpf, lpf, slope: 24, gainSetDb: g, delaySetMs: d, invert: inv, note,
      eq: eq.map(([freq, gain, q]) => ({ freq, gain, q })),
    }));
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && Array.isArray(s.chs) && s.chs.length === 12) {
        chs = s.chs; selected = new Set(s.sel || [1]);
        // v11 预设相位修正：CH7 正相，CH11/12 反相（仅当仍是旧预设值时）
        if (!s.polFix1) {
          const d = defaults();
          [[7, '反 −（预设）'], [11, '正 +（预设）'], [12, '正 +（预设）']].forEach(([id, oldPol]) => {
            const c = chs[id - 1]; if (c && c.polarity === oldPol) { c.invert = d[id - 1].invert; c.polarity = d[id - 1].polarity; c.note = d[id - 1].note; }
          });
          polFix = true;
        }
        if (polFix) save();
        return;
      }
      // 迁移：旧版 v1 通道表备份后换成新预设（旧数据保留在 cat-channels-v1-backup）
      const old = localStorage.getItem(OLD_KEY);
      if (old) { localStorage.setItem(OLD_KEY + '-backup', old); localStorage.removeItem(OLD_KEY); }
    } catch (_) {}
    chs = defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ chs, sel: [...selected], polFix1: true })); } catch (_) {}
    listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  }
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&', '<': '<', '>': '>', '"': '"' }[c]));

  function get(id) { return chs.find((c) => c.id === +id); }
  function label(id) { const c = get(id); return c ? `CH${c.id} ${c.name}` : '—'; }
  function update(id, patch) { Object.assign(get(id), patch); save(); render(); }
  function current() {
    const ids = [...selected].sort((a, b) => a - b);
    return ids.length ? get(ids[0]) : null;
  }
  function routeFor(id) { const c = get(id); if (!c) return 'stereo'; return c.side === 'L' ? 'l' : c.side === 'R' ? 'r' : 'stereo'; }
  function suggestRoute() {
    const s = [...selected].map(get).filter((c) => c && !c.mute);
    const l = s.some((c) => c.side !== 'R'), r = s.some((c) => c.side !== 'L');
    return l && r ? 'stereo' : l ? 'l' : r ? 'r' : 'stereo';
  }
  function allSelectedMuted() { const s = [...selected].map(get); return s.length > 0 && s.every((c) => c.mute); }

  function init() {
    load();
    el('chAll').onclick = () => { selected = new Set(chs.map((c) => c.id)); save(); render(); };
    el('chFront').onclick = () => { selected = new Set(chs.filter((c) => !c.mute && ['woofer', 'mid', 'tweeter'].includes(c.type)).map((c) => c.id)); save(); render(); };
    el('chNone').onclick = () => { selected = new Set(); save(); render(); };
    el('chEdit').onclick = () => { const p = el('chEditor'); p.hidden = !p.hidden; renderEditor(); };
    el('chReset').onclick = () => {
      if (!confirm('恢复赛那 7.26 预设（OUT1–12 名称、分频、增益、延时、相位、EQ）并清空测量数据？')) return;
      chs = defaults(); selected = new Set([1]); save(); render(); renderEditor();
    };
    render();
  }

  function render() {
    const g = el('chGrid');
    if (!g) return;
    g.innerHTML = chs.map((c) => `
      <div class="chc ${selected.has(c.id) ? 'sel' : ''} ${selected.size === 1 && selected.has(c.id) ? 'solo' : ''} ${c.mute ? 'muted' : ''}" data-id="${c.id}">
        <button type="button" class="chc-main" data-id="${c.id}"><b>CH${c.id}</b><span>${esc(c.name)}</span><small>${SIDE_CN[c.side]}·${TYPE_CN[c.type] || ''}</small></button>
        <button type="button" class="chc-mute" data-mute="${c.id}" aria-label="静音">${c.mute ? '🔇' : '🔈'}</button>
      </div>`).join('');
    g.querySelectorAll('.chc-main').forEach((b) => {
      const id = +b.dataset.id;
      let t = null, long = false;
      b.addEventListener('pointerdown', () => { long = false; t = setTimeout(() => { long = true; selected = new Set([id]); save(); render(); }, 450); });
      const clr = () => { if (t) clearTimeout(t); t = null; };
      b.addEventListener('pointerleave', clr); b.addEventListener('pointercancel', clr);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        clr();
        if (long) return;
        if (e.shiftKey) selected = new Set([id]);
        else if (selected.has(id)) selected.delete(id); else selected.add(id);
        save(); render();
      });
    });
    g.querySelectorAll('.chc-mute').forEach((b) => { b.onclick = () => update(+b.dataset.mute, { mute: !get(+b.dataset.mute).mute }); });
    const cur = current();
    el('chCurrent').textContent = cur ? `当前：${label(cur.id)}（${SIDE_CN[cur.side]}${cur.mute ? '，已静音' : ''}）` + (selected.size > 1 ? ` 等 ${selected.size} 路` : '') : '未选择通道';
    fillSelects();
    renderPlan();
  }

  function fillSelects() {
    document.querySelectorAll('select.ch-select').forEach((s) => {
      const prev = s.value;
      const extra = s.dataset.extra ? `<option value="">${s.dataset.extra}</option>` : '';
      s.innerHTML = extra + chs.map((c) => `<option value="${c.id}">${esc(label(c.id))}</option>`).join('');
      if (prev && [...s.options].some((o) => o.value === prev)) s.value = prev;
      else if (s.dataset.default) s.value = s.dataset.default;
      else if (!s.dataset.extra && current()) s.value = String(current().id);
    });
  }

  function renderEditor() {
    const p = el('chEditorBody');
    if (!p) return;
    p.innerHTML = chs.map((c) => `
      <div class="ched-row"><b>CH${c.id}</b>
        <input type="text" maxlength="16" data-f="name" data-id="${c.id}" value="${esc(c.name)}" />
        <select data-f="side" data-id="${c.id}">${Object.keys(SIDE_CN).map((k) => `<option value="${k}" ${c.side === k ? 'selected' : ''}>${SIDE_CN[k]}</option>`).join('')}</select>
        <select data-f="type" data-id="${c.id}">${Object.keys(TYPE_CN).map((k) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${TYPE_CN[k]}</option>`).join('')}</select>
      </div>`).join('');
    p.querySelectorAll('[data-f]').forEach((i) => {
      i.onchange = () => {
        const patch = { [i.dataset.f]: i.dataset.f === 'name' ? (i.value.trim() || '未命名') : i.value };
        if (i.dataset.f === 'type') Object.assign(patch, { hpf: XO[i.value].hpf, lpf: XO[i.value].lpf });
        update(+i.dataset.id, patch);
      };
    });
  }

  // ---- 计算 ----
  function delayPlan() {
    // each channel: path delay ms (from distCm or measured delayMs); farthest = 0, others add (max - own)
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
  const xoText = (c) => [c.hpf ? `HPF ${c.hpf}Hz` : '', c.lpf ? `LPF ${c.lpf}Hz` : ''].filter(Boolean).join(' / ') + ((c.hpf || c.lpf) ? ` · ${c.slope}dB/oct` : '全频');
  const f2 = (v, n = 2) => (v == null ? '—' : v.toFixed(n));

  function planRows() {
    const d = delayPlan(), g = gainPlan();
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
    body.innerHTML = chs.map((c, i) => `
      <tr class="${c.mute ? 'row-muted' : ''}">
        <td><b>CH${c.id}</b> ${esc(c.name)}<br><small>${SIDE_CN[c.side]}·${TYPE_CN[c.type]}${c.mute ? ' · 静音' : ''}</small></td>
        <td><input type="number" class="plan-in" data-id="${c.id}" data-f="distCm" value="${c.distCm ?? ''}" placeholder="cm" min="0" max="500" /></td>
        <td>${c.delayMs != null ? f2(c.delayMs) : '—'}</td>
        <td class="hl">${c.delaySetMs != null ? '+' + f2(c.delaySetMs) + ' ms<small> 方案</small>' : d[i] ? '+' + f2(d[i].comp) + ' ms' : '—'}</td>
        <td>${c.gainSetDb != null ? (c.gainSetDb > 0 ? '+' : '') + f2(c.gainSetDb, 1) + ' dB<small> 方案</small>' : g[i] ? (g[i].trim > 0 ? '+' : '') + f2(g[i].trim, 1) + ' dB' : '—'}</td>
        <td>${c.invert ? '<b class="badc">反相</b><br><small>' + esc(c.polarity) + '</small>' : esc(c.polarity)}</td>
        <td>${xoText(c)}</td>
        <td>${(c.eq && c.eq.length) ? `<details><summary>${c.eq.length} 段</summary>${c.eq.map((e) => `${e.freq}Hz ${e.gain > 0 ? '+' : ''}${e.gain}dB Q${e.q}`).join('<br>')}</details>` : '—'}</td>
      </tr>`).join('');
    body.querySelectorAll('.plan-in').forEach((i) => {
      i.onchange = () => update(+i.dataset.id, { distCm: i.value === '' ? null : +i.value, delaySetMs: null, ...(i.value !== '' ? { delayMs: null } : {}) });
    });
  }

  function exportPlan(kind) {
    const rows = planRows();
    let text, mime;
    if (kind === 'json') { text = JSON.stringify({ app: '汽车音响调音 · 12 通道方案', savedAt: new Date().toISOString(), channels: rows }, null, 2); mime = 'application/json'; }
    else {
      const head = ['通道', '名称', '声道', '类型', '静音', '距离cm', '实测延时ms', '延时补偿ms', '相对电平dB', '增益修正dB', '极性', '反相', 'HPF', 'LPF', '斜率dB/oct', 'EQ'];
      const keys = ['ch', 'name', 'side', 'type', 'mute', 'distCm', 'measuredDelayMs', 'delayCompMs', 'levelDb', 'gainTrimDb', 'polarity', 'invert', 'hpf', 'lpf', 'slope', 'eq'];
      text = [head.join(','), ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
      mime = 'text/csv';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: mime + ';charset=utf-8' }));
    a.download = 'dsp-12ch-plan-' + Date.now() + '.' + kind;
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

  return { init, get, label, update, current, routeFor, suggestRoute, allSelectedMuted, getAll, setAll, getActive, planRows, exportPlan, renderPlan, fillSelects, onChange, delayPlan, gainPlan, XO };
})();
