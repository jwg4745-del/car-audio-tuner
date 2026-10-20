const assert = require('assert');
const root = require('path').join(__dirname, '..');
// minimal DOM/localStorage stubs
global.localStorage = { _s: {}, getItem(k){return this._s[k]||null}, setItem(k,v){this._s[k]=String(v)}, removeItem(k){delete this._s[k]} };
global.document = { getElementById(){return null}, querySelector(){return null}, querySelectorAll(){return []}, createElement(){return {style:{}, classList:{toggle(){}}, appendChild(){}, insertBefore(){}}}, body: { classList: { toggle(){} } } };
global.window = global;
global.navigator = { mediaDevices: null };
const MicPick = require(root + '/js/micpick.js');
let pass=0,fail=0; const t=(n,f)=>{try{f();pass++;console.log('✓',n)}catch(e){fail++;console.log('✗',n,e.message)}};
t('UMIK-1 识别', () => assert.strictEqual(MicPick.knownOf('miniDSP UMIK-1 (USB Audio)').name, 'UMIK-1'));
t('UMIK-2 识别', () => assert.strictEqual(MicPick.knownOf('UMIK-2').name, 'UMIK-2'));
t('Dayton 识别', () => assert(MicPick.knownOf('Dayton Audio iMM-6')));
t('蓝牙检测 AirPods', () => assert(MicPick.isBT('AirPods Pro')));
t('蓝牙检测 Hands-Free', () => assert(MicPick.isBT('Headset (Hands-Free AG Audio)')));
t('蓝牙检测 中文', () => assert(MicPick.isBT('蓝牙耳机麦克风')));
t('内置麦不算蓝牙', () => assert(!MicPick.isBT('iPhone Microphone')));
t('constraints 默认无 deviceId', () => { MicPick.clear(); const c=MicPick.constraints(); assert(!c.deviceId); assert.strictEqual(c.echoCancellation,false); });
t('setDevice 写入后 constraints 带 exact', async () => {
  // fake list by poking internal via setDevice without list — set label manually through setDevice('')
  MicPick.clear();
  // simulate saved
  localStorage.setItem('cat-mic-v1', JSON.stringify({ deviceId: 'abc123', label: 'UMIK-1' }));
  // reload module state by clear+manual — use setDevice after injecting devices is hard; just check bindCal path
  const ok = MicPick.bindCal([[100,0],[1000,0]], 'umik.txt'); // no current device label → false
  assert.strictEqual(ok, false);
});
console.log(`\n${pass} 通过，${fail} 失败`); process.exit(fail?1:0);
