# MVP 规格（优先级 1）— 给 SwiftUI 原生用

源码根：`/workspace/car-audio-tuner/`  
空白 12 路 JSON：`shared/channels-blank.json`（已同步到 `car-audio-tuner-ios/SharedCore/`）

**注意（2026-10-21）：用户要求删除赛那预填，默认无车辆数据。**  
**更新：主界面增加「分频方式」主动/被动（默认主动），见 §4.1。**

---

## 1) 播放端 / 录音端

源：`js/role.js`

- 存储键：`cat-role-v1`，值 `player` | `recorder`；默认未选时弹窗，每台设备单独存。
- **播放端永不开麦克风**：任何录音/`AVAudioSession` 录音类别在 `player` 角色下必须拒绝；UI 提示换机或切换角色。
- 播放端：连车载蓝牙放测试音；录音端：主驾头部位置录音。
- 测完录音端立即释放麦克风会话，避免蓝牙/路由残留。
- 例外提示：校准页只在录音端；听感评分主要在播放端。

原生约定建议：
- `player` → `AVAudioSessionCategory.playback`（不要 `.playAndRecord`）
- `recorder` → `.playAndRecord` + `mode = .measurement`，关 echoCancellation / AGC

---

## 2) 同步咔嗒

源：`js/testtrack.js`（`SR=44100`，导出 WAV 固定 44.1kHz / 16-bit / 立体声）

**咔嗒波形** `clickTemplate`：
- 时长 **4 ms**
- 载频 **3000 Hz** 正弦 × Hann 窗
- L/R **同相同时**写入，幅度约 **0.9**

**标准三连击（所有外录轨共用）**  
文件头静音 `LEAD=1.0s`，然后相对 T0：
- 咔嗒 @ **0.0 / 0.5 / 1.0 s**（间隔 0.5s）
- 第 4/5 声用于辨轨型：`SIMPLE_MARK=1.25`、`POL_MARK=1.75`、`PHASE_MARK=1.5`

**检测** `detect(x, sr)`：
1. 前 90s：3kHz 带通(Q≈4) → 整流 → 1ms 平滑得包络
2. 峰 > 噪底中位数×8，峰间隔去抖 0.1s
3. 找间隔 0.5s±12ms 的三联峰
4. 与咔嗒模板互相关精修（±4ms）得 `t0`
5. 看是否还有 +1.25/+1.5/+1.75 的峰判别 `auto|simple|phase|polExt|car`

互相关：`xcorrPeak(x, tpl, center, maxLag)` 朴素点积最大绝对值。

---

## 3) 信号发生器

源：`js/generator.js` + `js/audio-engine.js` + `index.html`

| 项 | 默认 |
|---|---|
| 主电平 | **12%**（0.12），UI 0–100，**安全上限建议仍允许到 100，默认必须 12** |
| 正弦 | 1000 Hz，osc 后 gain **0.7** × master |
| 扫频 | 20→20000 Hz 对数，时长 **8 s** |
| 粉红/白噪 | gain **0.55** × master |
| 猝发 | 6 次，on 60ms / off 80ms |
| 脉冲 | count=5，gap 0.4s（发生器）；极性页 count 可配 |
| 路由 | L / R / stereo / follow 通道侧 |
| 采样率 | Web 用设备原生；**导出测试音固定 44100** |

导出单音参考：`06_1KHZ_-12DB_30S.wav` = 1kHz × **0.25**（约 −12 dBFS）。

---

## 4) 12 路空白预设

见 `shared/channels-blank.json`。  
分频起点（仅类型默认，非车辆调好的值）：

| type | HPF | LPF |
|------|-----|-----|
| tweeter | 3500 | — |
| mid | 300 | 3500 |
| woofer | 40 | 300 |
| center | 250 | — |
| rear | 80 | — |
| sub | 20 | 80 |
| full | — | — |

斜率默认 24 dB/oct。`gainSetDb` / `delaySetMs` / `eq` / `invert` 全空/false，`polarity: "未测"`。

---

---

## 4.1) 分频方式（主动 / 被动）

存储键：`cat-crossover-mode-v1`，值 `active` | `passive`，**默认 `active`（主动分频）**。  
首页宫格上方与通道栏均可切换；Web 与原生应共用同一语义。

| 模式 | 含义 | 通道显示 | 分频 | 延时 / 相位 |
|------|------|----------|------|-------------|
| **主动** `active` | 每个喇叭单元走独立 DSP 通道 | 空白 12 路不变（前左/前右高中低各自一路） | 可按单元调 HPF/LPF/斜率 | 可按单元调 |
| **被动** `passive` | 高音+中（低）音共用一路功放，经无源分频器分频 | **前声场**：同侧 `tweeter`/`mid`/`woofer` 合并为「前左」「前右」各一路显示；中置、后左/后右、超低音、备用不合并（后场已是单路则不动） | 分频点由无源分频器决定，软件**只读 / 不可写入**通道分频；可测量验证与试听对照 | 延时（及电平/极性写入）按**合并后的通道**同步到其下全部单元，不能按高/中/低单元单独设 |

底层仍保存 12 路 `cat-channels-v3` 数据；被动仅为显示与编辑约束。切换模式不清空测量数据。

原生约定：UI 绑定同一存储键；被动下隐藏或禁用分频编辑控件，文案「由无源分频器决定，仅可测量验证」。

## 5) 正反相 / 极性 / 延时算法

### A. 两机「正反相」能量法（主推，`analyzeSimple` / `analyzePhase`）
- 播放：同相 L=R=sig，再右反相 L=sig / R=−sig
- 录音比两段 RMS（可带通）
- **同相应更响**；若反相段高 ≥约 2 dB 且两段符号一致 →「相位相反」
- 阈值：同相 ≥1.5 dB → 同相；≤−1.5 → 相反（完整相位轨）

### B. 单机极性首波（`js/polarity.js`）
- 正向半正弦脉冲 ≈ **0.6 ms**（振膜外推）
- 丢弃前 40ms；阈值 35% 峰值找首波；其后 **5ms** 窗内峰值符号 → 正/反

### C. 外录极性（`analyzePolExt`）
- Chirp 估到达（300–6000 Hz，150ms），再对 8 个脉冲模板互相关，±3ms（无 chirp 时 ±12ms）
- 符号多数表决：≥6/8 同号才下结论

### D. 延时（两机轨 Chirp + 单机 `delay-test.js`）
- Chirp 模板：300→6000 Hz，**150 ms**，5ms 淡入淡出
- 自动轨：左右各 2 个 chirp，互相关 **maxLag=30ms**，`delayMs = mean(R)−mean(L)`；声速换算 **343 m/s**（cm = ms/1000×34300）
- 单机页：播放 chirp 200ms(150–6000) 或脉冲，与参考互相关；`audio-engine.crossCorrelate` maxLag≈min(n/4, 48000)
- 通道表补偿：最远为 0，其它补 `(max−own)` ms

### 采样率
- 分析：用录音实际 sr（常 48k）
- 生成/导出测试音：**44100** 与检测模板一致更稳；若录音非 44.1k，模板按实际 sr 重算（现网 `clickTemplate(sr)` 已这样做）
