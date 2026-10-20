/** 极简「正反相」：两台设备（一台放、一台录）。模式：两个一起（相位）/ 单个喇叭（极性） */
const Simple = (() => {
  const KEY = 'cat-simple-v1', POLKEY = 'cat-simple-pol-v1', ANKEY = 'cat-analyses-v1';
  const $ = (id) => document.getElementById(id);
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch (_) { return d; } };
  const st = Object.assign({ role: 'player', mode: 'pair', pair: 'lr', ch: 1 }, ls(KEY, {}));
  const save = () => localStorage.setItem(KEY, JSON.stringify(st));
  const chs = () => (typeof Channels !== 'undefined' ? Channels.getAll() : []);
  const chName = (id) => { const c = chs().find((x) => x.id === id); return c ? `CH${c.id} ${c.name}` : 'CH' + id; };
  let player = null, rec = null, last = null;

  // ---------- 渲染 ----------
  function render() {
    document.querySelectorAll('[data-spmode]').forEach((b) => b.classList.toggle('on', b.dataset.spmode === st.mode));
    document.querySelectorAll('[data-sprole]').forEach((b) => b.classList.toggle('on', b.dataset.sprole === st.role));
    $('spPairWrap').hidden = st.mode !== 'pair';
    $('spChWrap').hidden = st.mode !== 'single';
    $('spPair').value = st.pair;
    $('spPairHint').hidden = st.pair === 'lr';
    $('spPlayer').hidden = st.role !== 'player';
    $('spRecorder').hidden = st.role !== 'recorder';
    const pol = ls(POLKEY, {});
    $('spChGrid').innerHTML = chs().map((c) => {
      const v = pol[c.id]; const ic = v === 'ok' ? '✅' : v === 'inverted' ? '❌' : v === 'unknown' ? '⚠️' : '';
      return `<button type="button" class="sp-ch ${c.id === st.ch ? 'on' : ''}" data-spch="${c.id}"><b>CH${c.id}</b><span>${c.name}</span><i>${ic}</i></button>`;
    }).join('');
    $('spChGrid').querySelectorAll('[data-spch]').forEach((b) => { b.onclick = () => { st.ch = +b.dataset.spch; save(); render(); }; });
    $('spChNow').textContent = chName(st.ch);
    const done = Object.keys(pol).length;
    $('spChDone').textContent = done ? `已测 ${done}/${chs().length}` : '';
  }

  // ---------- 播放端 ----------
  function cueList() {
    const L0 = 1;
    if (st.mode === 'single') { const c = chs().find((x) => x.id === st.ch); const nm = chName(st.ch); return [[0, '准备…'], [L0, '同步咔嗒'], [L0 + 2.5, `脉冲：${nm}`], [L0 + 12.5, '完成 ✓']].filter((x, i) => !(c && i === 2 && false)); }
    const pr = TestTrack.SIMPLE_PAIRS[st.pair];
    return [[0, '准备…'], [L0, '同步咔嗒'], [L0 + 2.5, `${pr.labels[0]}：同相`], [L0 + 8.5, '（停）'], [L0 + 9.5, `${pr.labels[0]}：右边反相`], [L0 + 15.5, '（停）'], [L0 + 16.5, `${pr.labels[1]}：同相`], [L0 + 22.5, '（停）'], [L0 + 23.5, `${pr.labels[1]}：右边反相`], [L0 + 29.5, '完成 ✓']];
  }
  function stopPlay() { if (!player) return; try { player.src.onended = null; player.src.stop(); } catch (_) {} cancelAnimationFrame(player.raf); player = null; $('spPlay').textContent = '▶ 开始放'; $('spPlay').classList.remove('busy'); }
  async function play() {
    if (player) { stopPlay(); $('spCue').textContent = '已停止'; return; }
    const t = st.mode === 'single' ? TestTrack.buildTrack('polExt') : TestTrack.buildTrack('simple', st.pair);
    await AudioEngine.resume(true);
    const ctx = AudioEngine.getCtx();
    const buf = ctx.createBuffer(2, t.L.length, TestTrack.SR); buf.copyToChannel(t.L, 0); buf.copyToChannel(t.R, 1);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.1, dur = buf.duration, cs = cueList();
    src.start(t0); player = { src, raf: 0 };
    $('spPlay').textContent = '■ 停止'; $('spPlay').classList.add('busy');
    const tick = () => {
      if (!player) return;
      const el = Math.max(0, ctx.currentTime - t0); let c = cs[0][1]; for (const [a, s] of cs) if (el >= a) c = s;
      $('spCue').textContent = c; $('spCount').textContent = `还剩 ${Math.max(0, Math.ceil(dur - el))} 秒`;
      player.raf = requestAnimationFrame(tick);
    };
    tick();
    src.onended = () => { stopPlay(); $('spCue').textContent = '放完了 ✓ 看录音端结果'; $('spCount').textContent = ''; };
  }

  // ---------- 录音端 ----------
  function concat(chunks, n) { const y = new Float32Array(n); let o = 0; for (const c of chunks) { y.set(c, o); o += c.length; } return y; }
  async function stopRec() {
    if (!rec) return null;
    const r = rec; rec = null; clearInterval(r.timer);
    try { r.sp.disconnect(); r.srcN.disconnect(); } catch (_) {}
    r.stream.getTracks().forEach((t) => t.stop());
    try { await r.ctx.close(); } catch (_) {}
    AudioEngine.setExternalMic(false);
    try { await AudioEngine.resetOutput('mic'); } catch (_) {}
    $('spRec').textContent = '● 开始录'; $('spRec').classList.remove('busy');
    return { x: concat(r.chunks, r.n), sr: r.sr };
  }
  async function record() {
    if (rec) { const d = await stopRec(); finish(d); return; }
    $('spResult').hidden = true;
    AudioEngine.releaseMic({ noReset: true }); AudioEngine.setExternalMic(true);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
    catch (e) { AudioEngine.setExternalMic(false); show({ verdict: 'unknown', reason: '没拿到麦克风权限：请在浏览器设置里允许麦克风' }); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    const srcN = ctx.createMediaStreamSource(stream), sp = ctx.createScriptProcessor(4096, 1, 1);
    const r = { stream, ctx, srcN, sp, chunks: [], n: 0, sr: ctx.sampleRate, t0: Date.now() };
    sp.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); r.chunks.push(new Float32Array(d)); r.n += d.length; };
    srcN.connect(sp); sp.connect(ctx.destination);
    rec = r;
    const maxSec = st.mode === 'single' ? 30 : 45;
    $('spRec').textContent = '■ 停止'; $('spRec').classList.add('busy');
    $('spRecStatus').textContent = '录音中…现在去播放端点「▶ 开始放」';
    r.timer = setInterval(async () => {
      if (rec !== r) return;
      const el = (Date.now() - r.t0) / 1000;
      const x = concat(r.chunks, r.n);
      const det = r.n > r.sr * 3 ? TestTrack.detect(x, r.sr) : null;
      $('spRecStatus').textContent = det ? `听到测试音了 ✓ 继续录…（${Math.round(el)} 秒）` : `录音中…等待测试音（${Math.round(el)} / ${maxSec} 秒）`;
      if ((det && det.complete) || el >= maxSec) { const d = await stopRec(); finish(d); }
    }, 1500);
  }
  function finish(d) {
    $('spRecStatus').textContent = '';
    if (!d) return;
    show(judge(d.x, d.sr, st.mode, st.pair, (chs().find((c) => c.id === st.ch) || {}).type));
  }
  /** 纯函数：判断一段录音（便于测试） */
  function judge(x, sr, mode = st.mode, pair = st.pair, chType) {
    let peak = 0; for (let i = 0; i < x.length; i += 7) peak = Math.max(peak, Math.abs(x[i]));
    const det = TestTrack.detect(x, sr);
    if (!det) return { verdict: 'unknown', reason: peak < 0.003 ? '声音太小：调大播放音量，录音手机靠近喇叭' : '没检测到测试音：声音太小或播放端没在放。先点录再点放，音量调大，两边模式一致' };
    if (!det.complete) return { verdict: 'unknown', reason: '没录完整：录音别提前停' };
    if (mode === 'pair') {
      if (det.type !== 'simple') return { verdict: 'unknown', reason: '播放端放的不是「两个一起」的测试音：两边都切到同一模式' };
      return TestTrack.analyzeSimple(x, sr, det, pair);
    }
    if (det.type !== 'polExt') return { verdict: 'unknown', reason: '播放端放的不是「单个喇叭」的测试音：两边都切到同一模式' };
    const p = TestTrack.analyzePolExt(x, sr, det);
    const side = !p.L.present && !p.R.present ? null : !p.R.present ? p.L : !p.L.present ? p.R : (p.L.levelDb >= p.R.levelDb ? p.L : p.R);
    const low = chType === 'sub' || chType === 'woofer';
    if (!side) return { type: 'pol', verdict: 'unknown', reason: '声音太小或环境太吵：调大音量、靠近这只喇叭再测', detail: p };
    if (side.polarity === '不确定') return { type: 'pol', verdict: 'unknown', reason: low ? '低音单元脉冲不好判断：建议改用「两个一起」测 超低音 vs 门板' : '脉冲方向不一致：手机正对这只喇叭、20–50 cm 再测', detail: p };
    return { type: 'pol', verdict: side.polarity === '正' ? 'ok' : 'inverted', lowNote: low, detail: p };
  }

  // ---------- 结果 ----------
  function show(r) {
    last = r;
    const card = $('spResult'); card.hidden = false;
    const single = st.mode === 'single';
    card.className = 'sp-result ' + r.verdict;
    $('spVerdict').textContent = r.verdict === 'ok' ? (single ? '✅ 极性正常' : '✅ 相位正常') : r.verdict === 'inverted' ? (single ? '❌ 接反了' : '❌ 相位接反了') : '⚠️ 判断不出';
    const fix = single ? '在 DSP 里把这一路反相，或调换喇叭正负线' : st.pair === 'lr' ? '在 DSP 里把右边反相' : st.pair === 'sub' ? '在 DSP 里把超低音反相' : '在 DSP 里把高音反相';
    $('spReason').textContent = r.verdict === 'inverted' ? fix : r.verdict === 'unknown' ? r.reason : (r.lowNote ? '低音单元结果仅供参考，可用「两个一起」复核' : '');
    $('spDetail').textContent = JSON.stringify(r.segs || r.detail || r, null, 1);
    $('spWrite').hidden = single || r.verdict === 'unknown';
    $('spNext').hidden = !single;
    if (single) { const pol = ls(POLKEY, {}); pol[st.ch] = r.verdict; localStorage.setItem(POLKEY, JSON.stringify(pol)); if (r.verdict !== 'unknown') Channels.update(st.ch, { polarity: r.verdict === 'ok' ? '正（外录）' : '反（外录）' }); render(); }
  }
  function writePlan(r = last) {
    if (!r || r.type !== 'simple' || r.verdict === 'unknown') return false;
    const a = ls(ANKEY, {});
    const pairs = ((a.phase && a.phase.track && a.phase.track.pairs) || []).filter((p) => p.id !== r.planId);
    pairs.push({ id: r.planId, name: r.pairName, diffDb: r.diffDb, verdict: r.verdict === 'ok' ? '同相（正常）' : '相位相反' });
    a.phase = { track: { type: 'phase', pairs, anyInverted: pairs.some((p) => p.verdict === '相位相反') }, at: new Date().toISOString() };
    localStorage.setItem(ANKEY, JSON.stringify(a));
    return true;
  }

  function init() {
    if (!$('panel-simple')) return;
    document.querySelectorAll('[data-spmode]').forEach((b) => { b.onclick = () => { st.mode = b.dataset.spmode; save(); $('spResult').hidden = true; render(); }; });
    document.querySelectorAll('[data-sprole]').forEach((b) => { b.onclick = () => { st.role = b.dataset.sprole; save(); render(); }; });
    $('spPair').onchange = () => { st.pair = $('spPair').value; save(); render(); };
    $('spPlay').onclick = play;
    $('spRec').onclick = record;
    $('spAgain').onclick = () => { $('spResult').hidden = true; if (st.role === 'recorder') record(); };
    $('spWrite').onclick = () => { $('spWrite').textContent = writePlan() ? '已写入 ✓' : '无法写入'; setTimeout(() => ($('spWrite').textContent = '写入调音方案'), 2000); };
    $('spNext').onclick = () => { const l = chs(); const i = l.findIndex((c) => c.id === st.ch); st.ch = l[(i + 1) % l.length].id; save(); $('spResult').hidden = true; render(); };
    $('spReset').onclick = () => { localStorage.removeItem(POLKEY); render(); };
    if (typeof Channels !== 'undefined' && Channels.onChange) Channels.onChange(render);
    render();
  }
  return { init, judge, writePlan, show, stopPlay };
})();
if (typeof module !== 'undefined') module.exports = Simple;
