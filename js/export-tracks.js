/** 播放端测试音导出：WAV 44.1k/16bit 立体声 + ZIP，不开麦克风 */
const ExportTracks = (() => {
  const $ = (id) => document.getElementById(id);
  const wait = () => new Promise((r) => setTimeout(r, 0));
  const dl = (parts, name, mime) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(parts, { type: mime || 'application/octet-stream' }));
    a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };
  // [key, 中文文件名, 说明, builder]
  const CATALOG = [
    ['simple-lr', '01_正反相_左右整体.wav', '正反相 · 两个一起 · 左右整体', () => { const t = TestTrack.buildTrack('simple', 'lr'); return { L: t.L, R: t.R }; }],
    ['simple-sub', '02_正反相_超低音vs门板.wav', '正反相 · 超低音 vs 门板', () => { const t = TestTrack.buildTrack('simple', 'sub'); return { L: t.L, R: t.R }; }],
    ['simple-tw', '03_正反相_高音vs中音.wav', '正反相 · 高音 vs 中音', () => { const t = TestTrack.buildTrack('simple', 'tw'); return { L: t.L, R: t.R }; }],
    ['polExt', '04_极性_单喇叭脉冲.wav', '极性 / 延时 / 声压 · 单喇叭', () => { const t = TestTrack.buildTrack('polExt'); return { L: t.L, R: t.R }; }],
    ['phase', '05_相位测试.wav', '相位测试 · 约 85 秒', () => { const t = TestTrack.buildTrack('phase'); return { L: t.L, R: t.R }; }],
    ['car', '06_整车识别.wav', '整车识别 · 约 45 秒', () => { const t = TestTrack.buildTrack('car'); return { L: t.L, R: t.R }; }],
    ['auto', '07_延时电平自动轨.wav', '延时 / 电平（旧双设备轨）', () => { const t = TestTrack.buildTrack('auto'); return { L: t.L, R: t.R }; }],
    ['mp', '08_多点测量_粉噪.wav', '多点测量', () => Duo.build('mp')],
    ['img', '09_声像居中.wav', '声像居中', () => Duo.build('img')],
    ['xo300', '10_分频衔接_300Hz.wav', '分频衔接 · 300 Hz', () => Duo.build('xo300')],
    ['xo4k', '11_分频衔接_4kHz.wav', '分频衔接 · 4 kHz', () => Duo.build('xo4k')],
    ['pink', '12_粉红噪声_60秒.wav', 'RTA / 发生器粉噪', () => { const t = TestTrack.buildTrack('pink'); return { L: t.L, R: t.R }; }],
    ['pinkL', '13_粉红噪声_仅左.wav', '电平匹配 · 左', () => { const t = TestTrack.buildTrack('pinkL'); return { L: t.L, R: t.R }; }],
    ['pinkR', '14_粉红噪声_仅右.wav', '电平匹配 · 右', () => { const t = TestTrack.buildTrack('pinkR'); return { L: t.L, R: t.R }; }],
    ['ls-vocal', '15_听感_人声.wav', '听感评分 · 人声', () => clip('vocal')],
    ['ls-kick', '16_听感_鼓点.wav', '听感评分 · 鼓点', () => clip('kick')],
    ['ls-bass', '17_听感_低音线.wav', '听感评分 · 低音线', () => clip('bass')],
    ['ls-sib', '18_听感_齿音.wav', '听感评分 · 齿音', () => clip('sib')],
    ['ls-image', '19_听感_声像扫动.wav', '听感评分 · 声像扫动', () => clip('image')],
  ];
  const PAGE_KEYS = {
    simple: ['simple-lr', 'simple-sub', 'simple-tw', 'polExt'],
    phase: ['phase'], carid: ['car'], multi: ['mp'], image: ['img'],
    xcheck: ['xo300', 'xo4k'], delay: ['polExt', 'auto'], polarity: ['polExt'], spl: ['polExt', 'pinkL', 'pinkR'],
    rta: ['pink'], listen: ['ls-vocal', 'ls-kick', 'ls-bass', 'ls-sib', 'ls-image'], gen: ['pink', 'gen-now'],
  };
  function clip(k) {
    const c = Listen.CLIPS[k].make();
    if (c && c.L && c.R) return { L: c.L, R: c.R };
    if (c && c.length) return { L: c, R: Float32Array.from(c) };
    throw new Error('听感片段格式不对: ' + k);
  }
  function genNow() {
    const type = ($('genType') && $('genType').value) || 'pink';
    const hz = +($('genHz') && $('genHz').value) || 1000;
    const route = ($('genRoute') && $('genRoute').value) || 'stereo';
    const SR = TestTrack.SR, n = Math.round(10 * SR);
    const L = new Float32Array(n), R = new Float32Array(n);
    const env = (i) => Math.min(1, i / (0.02 * SR), (n - i) / (0.05 * SR));
    if (type === 'sine') {
      for (let i = 0; i < n; i++) { const v = Math.sin(2 * Math.PI * hz * i / SR) * 0.4 * env(i); L[i] = v; R[i] = v; }
    } else if (type === 'sweep') {
      const f0 = 20, f1 = 20000, ln = Math.log(f1 / f0), dur = 10;
      for (let i = 0; i < n; i++) { const t = i / SR; const v = Math.sin(2 * Math.PI * f0 * dur / ln * (Math.exp(t / dur * ln) - 1)) * 0.4 * env(i); L[i] = v; R[i] = v; }
    } else {
      // pink-ish: reuse TestTrack pink 10s stereo
      const t = TestTrack.buildTrack('pink');
      const m = Math.min(n, t.L.length);
      L.set(t.L.subarray(0, m)); R.set(t.R.subarray(0, m));
    }
    if (route === 'l') R.fill(0); else if (route === 'r') L.fill(0);
    const nm = type === 'sine' ? `发生器_正弦_${hz}Hz` : type === 'sweep' ? '发生器_扫频' : '发生器_粉噪';
    return { L, R, file: `20_${nm}.wav`, name: nm };
  }
  function build(key) {
    if (key === 'gen-now') return genNow();
    const row = CATALOG.find((c) => c[0] === key); if (!row) throw new Error(key);
    const t = row[3]();
    // Listen clips may return {L,R} from norm
    let L = t.L, R = t.R;
    if (!L && t.length) { L = t; R = Float32Array.from(t); }
    if (L && !R) R = Float32Array.from(L);
    if (R && !L) L = Float32Array.from(R);
    return { L, R, file: row[1], name: row[2] };
  }
  async function saveOne(key, btn) {
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
    await wait();
    try {
      const t = build(key);
      dl([TestTrack.wavBytes(t.L, t.R)], t.file || (CATALOG.find((c) => c[0] === key) || [, key + '.wav'])[1], 'audio/wav');
    } catch (e) { alert('导出失败：' + (e.message || e)); console.error(e); }
    if (btn) { btn.disabled = false; btn.textContent = label || '⬇ 导出'; }
  }
  async function saveZip(btn) {
    if (btn) { btn.disabled = true; }
    const st = $('exStatus'); const entries = [];
    const keys = CATALOG.map((c) => c[0]);
    for (let i = 0; i < keys.length; i++) {
      if (st) st.textContent = `生成 ${i + 1}/${keys.length}…`;
      await wait();
      const t = build(keys[i]);
      entries.push({ name: '车载调音测试音/' + (t.file || CATALOG[i][1]), data: TestTrack.wavBytes(t.L, t.R) });
    }
    // also current generator
    try { const g = genNow(); entries.push({ name: '车载调音测试音/' + g.file, data: TestTrack.wavBytes(g.L, g.R) }); } catch (_) {}
    const readme = '汽车音响调音 · 测试音包\r\nWAV 44.1 kHz 16-bit 立体声，已含同步咔嗒。\r\n播放端（连车载蓝牙）用音乐 App 放这些文件；录音端打开对应页面点「开始录」。\r\n不要开麦克风导出。\r\n';
    entries.push({ name: '车载调音测试音/说明.txt', data: new TextEncoder().encode(readme) });
    if (st) st.textContent = '打包中…';
    await wait();
    dl(TestTrack.zipBytes(entries), '车载调音_全部测试音.zip', 'application/zip');
    if (st) st.textContent = '已开始下载 ZIP（约几十 MB）。Safari 可在「文件」里找。';
    if (btn) btn.disabled = false;
  }
  function panel() {
    if ($('panel-export')) return;
    const main = document.querySelector('main.panels'); if (!main) return;
    const sec = document.createElement('section'); sec.id = 'panel-export'; sec.className = 'panel'; sec.hidden = true; sec.setAttribute('role', 'tabpanel');
    sec.innerHTML = `<div class="cg"><div class="cg-top"><button type="button" class="cg-back" id="exBack">‹</button><h2>导出测试音</h2><span></span></div>
      <p class="cg-tip">播放端用这些 WAV 代替 App 内播放：拷到手机音乐库或 U 盘，录音端打开对应页面录。导出<strong>不会开麦克风</strong>。</p>
      <div class="cg-bottom"><button type="button" class="cg-go" id="exZip">⬇ 一键打包全部 ZIP</button></div>
      <p class="cg-status" id="exStatus"></p>
      <div class="ex-list" id="exList"></div>
      <div class="cg-foot"><button type="button" class="btn btn-ghost btn-sm" id="exGen">导出当前发生器设置</button></div></div>`;
    main.appendChild(sec);
    $('exBack').onclick = () => App.switchTab('home');
    $('exZip').onclick = () => saveZip($('exZip'));
    $('exGen').onclick = (e) => saveOne('gen-now', e.currentTarget);
    const list = $('exList');
    list.innerHTML = CATALOG.map((c) => `<div class="ex-row"><div><b>${c[1].replace(/\.wav$/, '')}</b><small>${c[2]}</small></div><button type="button" class="btn btn-accent btn-sm" data-ex="${c[0]}">⬇ WAV</button></div>`).join('');
    list.querySelectorAll('[data-ex]').forEach((b) => { b.onclick = () => saveOne(b.dataset.ex, b); });
  }
  function addPageBtns() {
    Object.keys(PAGE_KEYS).forEach((page) => {
      const box = document.querySelector(`#panel-${page} .cg-foot, #panel-${page} .cg-bottom`);
      if (!box || box.querySelector('[data-expage]')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.dataset.expage = page;
      b.textContent = '⬇ 导出本页测试音';
      b.onclick = async () => {
        const keys = PAGE_KEYS[page] || [];
        if (keys.length === 1) return saveOne(keys[0], b);
        // multi: zip of page tracks
        b.disabled = true; b.textContent = '生成中…';
        const entries = [];
        for (const k of keys) { await wait(); try { const t = build(k); entries.push({ name: t.file || (k + '.wav'), data: TestTrack.wavBytes(t.L, t.R) }); } catch (e) { console.warn(e); } }
        if (entries.length === 1) dl([entries[0].data], entries[0].name, 'audio/wav');
        else dl(TestTrack.zipBytes(entries.map((e) => ({ name: e.name, data: e.data }))), `测试音_${page}.zip`, 'application/zip');
        b.disabled = false; b.textContent = '⬇ 导出本页测试音';
      };
      box.appendChild(b);
    });
    // delay/polarity/spl use cgd/cgp/cgs foot
    [['delay', 'cgd'], ['polarity', 'cgp'], ['spl', 'cgs']].forEach(([page, id]) => {
      const foot = $(id + 'Write') && $(id + 'Write').parentElement;
      if (!foot || foot.querySelector('[data-expage]')) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.dataset.expage = page;
      b.textContent = '⬇ 导出本页测试音';
      b.onclick = () => saveOne(PAGE_KEYS[page][0], b);
      foot.appendChild(b);
    });
  }
  function init() {
    panel();
    // home tile
    const grid = document.querySelector('.hm-grid');
    if (grid && !grid.querySelector('[data-go="export"]')) {
      const t = document.createElement('button'); t.type = 'button'; t.className = 'hm-tile'; t.dataset.go = 'export';
      t.innerHTML = '<span>⬇</span>导出测试音'; t.onclick = () => App.switchTab('export');
      grid.insertBefore(t, grid.firstChild);
    }
    setTimeout(addPageBtns, 200);
  }
  return { init, saveOne, saveZip, CATALOG, build };
})();
