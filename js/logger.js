/** 测量记录 导出/导入 */
const Logger = (() => {
  function el(id) { return document.getElementById(id); }

  function init() {
    el('logSaveJson').onclick = () => download(buildJson(), 'car-audio-tune-' + stamp() + '.json', 'application/json');
    el('logSaveCsv').onclick = () => download(buildCsv(), 'car-audio-tune-' + stamp() + '.csv', 'text/csv');
    el('logImport').onchange = onImport;
    el('logClear').onclick = () => {
      DelayTest.loadRows({});
      SPL.loadLevels({});
      preview();
    };
    preview();
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function buildJson() {
    return {
      app: '汽车音响调音',
      version: 1,
      savedAt: new Date().toISOString(),
      timezoneNote: 'Asia/Shanghai',
      channels: Channels.getActive(),
      phase: PhaseTest.getSnapshot(),
      polarity: Polarity.getSnapshot(),
      delay: DelayTest.getSnapshot(),
      spl: SPL.getSnapshot(),
      rta: RTA.getSnapshot(),
      masterLevel: AudioEngine.getMasterLevel(),
    };
  }

  function buildCsv() {
    const lines = ['section,key,value'];
    const j = buildJson();
    const flat = (obj, prefix) => {
      Object.keys(obj || {}).forEach((k) => {
        const v = obj[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, prefix + k + '.');
        else lines.push(`${prefix}${k},"${String(v).replace(/"/g, '""')}"`);
      });
    };
    flat(j, '');
    // delay rows
    const rows = DelayTest.getRows();
    Object.keys(rows).forEach((ch) => {
      lines.push(`delayRow,${ch}.ms,${rows[ch].ms}`);
      lines.push(`delayRow,${ch}.cm,${rows[ch].cm}`);
      lines.push(`delayRow,${ch}.suggest,"${rows[ch].suggest}"`);
    });
    return lines.join('\n');
  }

  function download(text, name, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    preview();
  }

  function onImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.delay && data.delay.rows) DelayTest.loadRows(data.delay.rows);
        if (data.spl && data.spl.levels) SPL.loadLevels(data.spl.levels);
        el('logPreview').textContent = '已导入：\n' + JSON.stringify(data, null, 2);
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function preview() {
    el('logPreview').textContent = JSON.stringify(buildJson(), null, 2);
  }

  return { init, buildJson, preview };
})();
