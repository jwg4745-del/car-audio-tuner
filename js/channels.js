/** 12 通道车用 DSP 模型：名称/声道侧/类型/静音 + 每通道延时、电平、极性、分频，存 localStorage */
const Channels = (() => {
  const KEY = 'cat-channels-v1';
  const DEF = [
    ['前左高音', 'L', 'tweeter'], ['前左中音', 'L', 'mid'], ['前左低音', 'L', 'woofer'],
    ['前右高音', 'R', 'tweeter'], ['前右中音', 'R', 'mid'], ['前右低音', 'R', 'woofer'],
    ['中置', 'C', 'center'], ['后左', 'L', 'rear'], ['后右', 'R', 'rear'],
    ['超低音左', 'L', 'sub'], ['超低音右', 'R', 'sub'], ['备用/环绕', 'M', 'full'],
  ];
  const XO = {
    tweeter: { hpf: 3500, lpf: null }, mid: { hpf: 300, lpf: 3500 }, woofer: { hpf: 40, lpf: 300 },
    center: { hpf: 250, lpf: null }, rear: { hpf: 80, lpf: null }, sub: { hpf: 20, lpf: 80 }, full: { hpf: null, lpf: null },
  };
  const TYPE_CN = { tweeter: '高音', mid: '中音', woofer: '低音', center: '中置', rear: '后场', sub: '超低音', full: '全频' };
  const SIDE_CN = { L: '左', R: '右', C: '中', M: '单声道' };
  let chs = [];
  let selected = new Set([1]);
  const listeners = [];

  function defaults() {
    return DEF.map(([name, side, type], i) => ({
      id: i + 1, name, side, type, mute: false,
      distCm: null, delayMs: null, levelDb: null, polarity: '未测',
      hpf: XO[type].hpf, lpf: XO[type].lpf, slope: 24,
    }));
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && Array.isArray(s.chs) && s.chs.length === 12) { chs = s.chs; selected = new Set(s.sel || [1]); return; }
    } catch (_) {}
    chs = defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ chs, sel: [...selected] })); } catch (_) {}
    listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  }
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
    el('chFront').onclick = () => { selected = new Set([1, 2, 3, 4, 5, 6]); save(); render(); };
    el('chNone').onclick = () => { selected = new Set(); save(); render(); };
    el('chEdit').onclick = () => { const p = el('chEditor'); p.hidden = !p.hidden; renderEditor(); };
    el('chReset').onclick = () => {
      if (!confirm('恢复 12 通道默认名称、分频并清空测量数据？')) return;
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
      delayCompMs: d[i] ? +d[i].comp.toFixed(2) : null, levelDb: c.levelDb != null ? +c.levelDb.toFixed(1) : null,
      gainTrimDb: g[i] ? +g[i].trim.toFixed(1) : null, polarity: c.polarity, hpf: c.hpf, lpf: c.lpf, slope: c.slope, crossover: xoText(c),
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
        <td class="hl">${d[i] ? '+' + f2(d[i].comp) + ' ms' : '—'}</td>
        <td>${g[i] ? (g[i].trim > 0 ? '+' : '') + f2(g[i].trim, 1) + ' dB' : '—'}</td>
        <td>${esc(c.polarity)}</td>
        <td>${xoText(c)}</td>
      </tr>`).join('');
    body.querySelectorAll('.plan-in').forEach((i) => {
      i.onchange = () => update(+i.dataset.id, { distCm: i.value === '' ? null : +i.value, ...(i.value !== '' ? { delayMs: null } : {}) });
    });
  }

  function exportPlan(kind) {
    const rows = planRows();
    let text, mime;
    if (kind === 'json') { text = JSON.stringify({ app: '汽车音响调音 · 12 通道方案', savedAt: new Date().toISOString(), channels: rows }, null, 2); mime = 'application/json'; }
    else {
      const head = ['通道', '名称', '声道', '类型', '静音', '距离cm', '实测延时ms', '延时补偿ms', '相对电平dB', '增益修正dB', '极性', 'HPF', 'LPF', '斜率dB/oct'];
      const keys = ['ch', 'name', 'side', 'type', 'mute', 'distCm', 'measuredDelayMs', 'delayCompMs', 'levelDb', 'gainTrimDb', 'polarity', 'hpf', 'lpf', 'slope'];
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
