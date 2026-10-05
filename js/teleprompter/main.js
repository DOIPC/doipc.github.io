/* =========================================================
   字幕提词器 · 主逻辑
   —— 章节化字幕 / 卡拉OK逐字 / 录制打点 / 回放校准 /
      项目归档 / 封面大标题 / 播放进度控制
   ========================================================= */
(function () {
    'use strict';

    /* 1. DOM 引用 */
    const $ = (id) => document.getElementById(id);

    // 输入区
    const rawTextDom = $('rawText');
    const speedInput = $('speedInput');
    const autoSplitCheck = $('autoSplitCheck');
    const chapterSplitCheck = $('chapterSplitCheck');
    const timeRuleDom = $('timeRule');
    const exportTimeRuleDom = $('exportTimeRule');
    const sizeSelect = $('sizeSelect');
    const sizeDesc = $('sizeDesc');
    const frameTitleInput = $('frameTitleInput');
    const frameTitleDom = $('frameTitle');
    const frameFooterInput = $('frameFooterInput');
    const frameFooterDom = $('frameFooter');
    const frameFooterTextDom = $('footerText');

    // 封面大标题（叠加在录屏区中央，用于拍摄视频封面）
    const coverTitleInput = $('coverTitleInput');
    const coverSubInput = $('coverSubInput');
    const coverToggleCheck = $('coverToggleCheck');
    const coverScaleRange = $('coverScaleRange');
    const coverScaleVal = $('coverScaleVal');
    const coverOverlay = $('coverOverlay');
    const coverTitleDom = $('coverTitleDom');
    const coverSubDom = $('coverSubDom');

    // 卡拉OK模式开关
    const karaokeToggle = $('karaokeToggle');
    const karaokeToggleLabel = $('karaokeToggleLabel');

    // 音频相关
    const audioFileInput = $('audioFileInput');
    const audioNameDom = $('audioName');
    const audioClearBtn = $('audioClearBtn');
    const meterFill = $('meterFill');
    const meterThresh = $('meterThresh');
    const threshRange = $('threshRange');
    const threshVal = $('threshVal');
    const soundTapCheck = $('soundTapCheck');

    // 项目文件相关
    const projectOpenInput = $('projectOpenInput');
    const projectSaveBtn = $('projectSaveBtn');
    const projectNameDom = $('projectName');

    // 播放进度控制
    const progressRange = $('progressRange');
    const progressTimeDom = $('progressTime');

    // 预览区
    const subtitleBox = $('subtitleBox');
    const currentTimeDom = $('currentTime');
    const recordFrame = $('recordFrame');

    // 按钮
    const autoGenBtn = $('autoGenBtn');
    const parseBtn = $('parseBtn');
    const recordBtn = $('recordBtn');
    const playBtn = $('playBtn');
    const nextBtn = $('nextBtn');
    const playbackRecBtn = $('playbackRecBtn');
    const exportCopyBtn = $('exportCopyBtn');
    const resetBtn = $('resetBtn');

    // 状态灯
    const statusDot = $('statusDot');
    const statusText = $('statusText');

    /* 2. 状态 */

    /**
     * 字幕条目结构（章节化之后）：
     *   { time: number, text: string, chapter: number }
     *
     *   chapter 从 0 开始递增，标识该句属于第几个章节。
     *   —— 章节由时间轴 / 原文中的「空行」划分（见 chapterSplit 开关）
     *   —— 关闭章节分割时，所有条目 chapter 均为 0
     */
    let subs = [];              // 解析后的原始字幕
    let exportSubs = [];        // 校准后的字幕 { time, text, tapped, chapter }
    let itemEls = [];           // 字幕 DOM 缓存（与 subs 一一对应，顺序一致）

    let isPlaying = false;
    let isRecording = false;
    let baseTime = 0;           // 虚拟计时累计秒数（无音频时使用）
    let startStamp = 0;         // 本段计时起点 performance.now()
    let rafId = null;           // requestAnimationFrame id
    let lastLoopTs = 0;         // 上一帧时间戳
    let curIdx = -1;            // 当前激活字幕索引
    let curChapter = -1;        // 当前激活章节（用于整章节高亮）

    /**
     * 独立记录"上一次 setActive 处理的索引"。
     *
     * 为什么需要它：nextSub() 里先执行 `curIdx += 1`，再调用
     * setActive(curIdx)。如果 setActive 内部用 `const prevIdx = curIdx`
     * 读取"上一次的索引"，此时 curIdx 已被改成新值，prevIdx 永远等于 idx，
     * `chapterChanged` 恒为 false —— 章节高亮 .chapter-active 永远不会被添加，
     * 用户看不到任何白色高亮。
     *
     * 用独立变量 lastActiveIdx 记录，就不受外部是否提前修改 curIdx 的影响。
     * 开始新一轮录制 / 重新解析 / 重置 / 回放时，需重置为 -1。
     */
    let lastActiveIdx = -1;

    /**
     * 计时源开关：
     *   false → 优先使用 audioEl.currentTime 作为唯一时间基准
     *   true  → 音频播放被浏览器拒绝 / 加载失败 → 回退虚拟计时
     *
     * 一旦进入虚拟计时模式，除非重新加载音频文件或整体重置，
     * 否则保持虚拟计时 —— 避免每帧反复尝试从"僵死的 audioEl.currentTime"
     * 读取时间，导致计时器整体冻结。
     */
    let useVirtualClock = false;

    /**
     * 卡拉OK模式开关：
     *   false → 保持原来的整句高亮
     *   true  → 当前句已读的字逐个变紫色；
     *           同一章节内、先前已读过的整句保持紫色，不再退回
     */
    let karaokeMode = false;

    /**
     * 章节分割开关：
     *   true  → 时间轴 / 原文中的空行视为章节分隔
     *           同一章节的字幕在预览区连续显示（不换行），
     *           章节之间保持换行（新章节另起一行，间距更大）
     *           播放时整章节一起高亮放大，卡拉OK逐字变色只在当前句推进
     *   false → 忽略空行，全部字幕视为同一章节
     */
    let chapterSplit = true;

    /**
     * 播放源：
     *   'original'  → 使用 subs（原始时间轴）
     *   'recording' → 使用 exportSubs（录制校准时间轴）
     */
    let playbackSource = 'original';

    /**
     * 用户是否正在拖动进度条。
     *   true  → 主循环暂停回写进度条，避免与手指争夺滑块位置；
     *           同时进度条显示拖动预览值（时间文字实时更新）。
     *   false → 主循环每帧刷新进度条，跟随播放头前进。
     */
    let isScrubbing = false;

    function getTimeline() {
        return playbackSource === 'recording' ? exportSubs : subs;
    }

    /** 是否存在与原始时间轴不同的录制结果（以 tapped 标记为准） */
    function hasRecording() {
        if (!exportSubs.length) return false;
        for (let i = 0; i < exportSubs.length; i++) {
            if (exportSubs[i].tapped) return true;
        }
        return false;
    }

    /* ================= 音频模块状态 ================= */
    const METER_SCALE = 1600;      // RMS → 电平条宽度映射系数
    const THRESH_MIN = 0.001;      // 阈值下限
    const THRESH_MAX = 0.0625;     // 阈值上限（与 METER_SCALE 匹配，滑块满格对应 100% 位置）

    let audioEl = null;
    let audioLoaded = false;
    let audioCtx = null;
    let audioAnalyser = null;
    let audioSourceNode = null;
    let audioData = null;
    let audioUrl = null;
    let currentAudioName = '';

    /**
     * 当前音频的原始 Blob / File。
     * —— 打开音频文件时指向用户选中的 File；
     * —— 载入项目时指向从归档里还原出来的 Blob。
     * 保存项目时直接取它的字节，不必再走一次文件系统。
     */
    let currentAudioBlob = null;

    /**
     * 当前项目文件名（保存 / 载入后回填，仅用于界面展示）。
     */
    let currentProjectName = '';

    let meterLevel = 0;
    let threshValue = 0.015;
    let voiceArmed = true;
    let voiceMs = 0;
    let silenceMs = 0;

    /* 3. 时间工具 */
    function secondToTime(s) {
        if (!isFinite(s) || s < 0) s = 0;
        const h = String(Math.floor(s / 3600)).padStart(2, '0');
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const sec = String(Math.floor(s % 60)).padStart(2, '0');
        return `${h}:${m}:${sec}`;
    }

    /** 时间轴专用：带毫秒，避免同秒多条冲突 */
    function secondToTimeMs(s) {
        if (!isFinite(s) || s < 0) s = 0;
        const totalMs = Math.round(s * 1000);
        const ms = String(totalMs % 1000).padStart(3, '0');
        const totalSec = Math.floor(totalMs / 1000);
        const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
        const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
        const sec = String(totalSec % 60).padStart(2, '0');
        return `${h}:${m}:${sec}.${ms}`;
    }

    function timeToSecond(str) {
        if (str == null) return null;
        const s = String(str).trim();
        if (!s) return null;
        // 同时接受 HH:MM:SS / HH:MM:SS.mmm / MM:SS / MM:SS.mmm / SS / SS.mmm
        if (!/^\d{1,3}(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) return null;
        return s.split(':').reduce((acc, p) => acc * 60 + parseFloat(p), 0);
    }

    /* 3.1 朗读节奏模型（卡拉OK + 时长估算共用）

       —— 把「朗读一句」拆成两类时间单元：

            · 发音单元：每个字被念出来的时间
                基准 = 1 / 语速，再按字的性质加权
                虚词轻快带过、叠字拉长、数字吐清、情感字略慢、
                换气后的起音稍慢……

            · 气口单元：标点带来的换气 / 停顿
                使用接近物理时长的经验值，而不是按字数比例分摊
                因为人说得快慢，主要改变的是吐字，而不是换气长度
                句末最长、分号次之、逗号再次、引号几乎不停

       —— 两类单元一起按「本句可用总时长」做整体缩放，保证整句与相邻时间戳严格对齐。

       章节化之后，卡拉OK的「本句可用总时长」优先取
       同一章节内相邻两句的时间戳之差 —— 这个差值是逐句给定的真实
       节拍，比按语速估算准得多。只有章节末句 / 末句 / 未打点的句子
       才回退到下面的自然时长估算。 */

    /* 标点气口时长（秒）—— 标准朗读语速下的经验值 */
    const PUNCT_PAUSE = {
        '。': 0.72, '．': 0.72, '！': 0.68, '？': 0.68,
        '!': 0.66, '?': 0.66, '…': 0.60,
        '；': 0.50, ';': 0.48, '：': 0.42, ':': 0.40,
        '，': 0.40, ',': 0.38, '、': 0.30,
        '—': 0.34, '－': 0.34, '–': 0.34,
        '“': 0.06, '”': 0.08, '‘': 0.06, '’': 0.08,
        '「': 0.06, '」': 0.08, '『': 0.06, '』': 0.08,
        '《': 0.06, '》': 0.08, '〈': 0.06, '〉': 0.08,
        '（': 0.10, '）': 0.10, '(': 0.10, ')': 0.10,
        '【': 0.10, '】': 0.10, '[': 0.10, ']': 0.10,
        '·': 0.14, '～': 0.18, '~': 0.18
    };

    /* 虚词 / 连接词：读得轻、快、含糊 */
    const FUNC_CHARS = new Set(
        '的了是在和与或也就都很着过吗呢吧啊呀么之其而但却又还地得将把被让使给对从向到由如若即'
    );
    /* 数字 / 数词：吐字清晰，略慢 */
    const NUM_CHARS = new Set(
        '〇一二三四五六七八九十百千万亿两零壹贰叁肆伍陆柒捌玖拾佰仟'
    );
    /* 情感 / 强调字：略微拖长 */
    const EMO_CHARS = new Set(
        '最太真非终永深静安始重轻慢快恨爱愁悲喜欢乐苦甜冷暖'
    );

    /**
     * 构建一句话的逐字时间表。
     *
     * {string}      text      字幕文本
     * {number|null} duration  本句可用总时长（秒）。传 null 则返回「自然时长」
     * {number}      speed     朗读语速（字/秒）
     * {{starts:number[], durs:number[], total:number, natural:number}}
     *          starts[i] 为第 i 个字相对句首的起始秒数
     *          durs[i]   为第 i 个字持续秒数
     *          total     实际使用的总时长
     *          natural   未缩放时的自然时长
     */
    function buildKaraokeSchedule(text, duration, speed) {
        const chars = Array.from(text == null ? '' : String(text));
        const n = chars.length;
        if (!n) return { starts: [], durs: [], total: 0, natural: 0 };

        const spd = (isFinite(speed) && speed > 0) ? speed : 2.2;
        const charSec = 1 / spd;            // 一个普通字的基准时长

        const w = new Array(n);
        const isSpeech = new Array(n).fill(false);

        let prevWasGap = true;              // 句首视作「刚换过气」

        for (let i = 0; i < n; i++) {
            const ch = chars[i];

            /* ---------- 气口单元 ---------- */
            const pause = PUNCT_PAUSE[ch];
            if (pause !== undefined) {
                // 连续标点（如「……」「？！。」）后续那个不再给整份停顿
                w[i] = prevWasGap ? pause * 0.5 : pause;
                prevWasGap = true;
                continue;
            }
            if (ch === ' ' || ch === '\t' || ch === '\u3000' || ch === '\n') {
                w[i] = 0.08;
                prevWasGap = true;
                continue;
            }

            /* ---------- 发音单元 ---------- */
            let mul = 1;

            if (FUNC_CHARS.has(ch)) mul *= 0.74;              // 虚词 / 连接词
            if (i > 0 && chars[i - 1] === ch) mul *= 1.32;    // 叠字：慢慢、轻轻
            if (NUM_CHARS.has(ch)) mul *= 1.08;               // 数字：吐字清晰
            if (EMO_CHARS.has(ch)) mul *= 1.14;               // 情感字：略微拖长
            if (prevWasGap) mul *= 1.08;                      // 换气后重新起音

            w[i] = charSec * mul;
            isSpeech[i] = true;
            prevWasGap = false;
        }

        /* ---------- 句首起音 / 句尾收气：只作用于真正发音的字 ---------- */
        let first = -1, last = -1;
        for (let i = 0; i < n; i++) {
            if (isSpeech[i]) {
                if (first === -1) first = i;
                last = i;
            }
        }
        if (first !== -1) {
            w[first] *= 1.10;
            if (last !== first) w[last] *= 1.10;
        }

        /* ---------- 归一化：发音与停顿分开缩放 ---------- */
        let speechNatural = 0, pauseNatural = 0;
        for (let i = 0; i < n; i++) {
            if (isSpeech[i]) speechNatural += w[i];
            else pauseNatural += w[i];
        }
        let natural = speechNatural + pauseNatural;
        if (!(natural > 0)) {
            natural = n * charSec;
            speechNatural = natural;
            pauseNatural = 0;
        }

        const explicit = (duration != null && isFinite(duration) && duration > 0);
        const dur = explicit ? duration : natural;
        const kAll = dur / natural;

        /* 停顿缩放：对整体缩放做 0.45 次幂阻尼 —— 时间越紧，气口越被保住 */
        let kp = 1;
        if (pauseNatural > 0) {
            kp = Math.pow(kAll, 0.45);
            if (kp < 0.72) kp = 0.72;
            else if (kp > 1.35) kp = 1.35;
        }

        let pauseAlloc = pauseNatural * kp;

        /* 停顿最多占整句 60%，避免标点密集的句子把发音挤没 */
        if (explicit && speechNatural > 0 && pauseAlloc > dur * 0.6) {
            pauseAlloc = dur * 0.6;
            kp = pauseAlloc / pauseNatural;
        }

        /* 发音吸收剩余时长，保证总时长严格等于 dur */
        let ks;
        if (speechNatural > 0) {
            ks = (dur - pauseAlloc) / speechNatural;
            if (!(ks >= 0)) ks = 0;
        } else {
            ks = 0;
            pauseAlloc = dur;
            kp = pauseNatural > 0 ? dur / pauseNatural : 0;
        }

        const starts = new Array(n);
        const durs = new Array(n);
        let acc = 0;
        for (let i = 0; i < n; i++) {
            starts[i] = acc;
            const k = isSpeech[i] ? ks : kp;
            const d = w[i] * k;
            durs[i] = d;
            acc += d;
        }

        return { starts: starts, durs: durs, total: acc, natural: natural };
    }

    /* 估算单句自然朗读时长（秒）：与卡拉OK使用同一套节奏模型 */
    const _durCache = new Map();

    function estimateDuration(text, speed) {
        const str = String(text == null ? '' : text);
        const spd = (isFinite(speed) && speed > 0) ? speed : 2.2;
        const key = spd + '\u0000' + str;

        const hit = _durCache.get(key);
        if (hit !== undefined) return hit;

        const sched = buildKaraokeSchedule(str, null, spd);
        let v = sched.natural;
        if (!(v > 0.05)) v = 0.3;

        if (_durCache.size > 800) _durCache.clear();
        _durCache.set(key, v);
        return v;
    }

    /* 当前语速（字/秒），非法时回退默认值 */
    function currentSpeed() {
        const s = parseFloat(speedInput.value);
        return (isFinite(s) && s > 0) ? s : 2.2;
    }

    /* 4. 轻提示 Toast */
    let toastTimer = null;

    function toast(msg) {
        let el = $('toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
    }

    /* 5. 录屏区尺寸联动 */
    function applySize(val) {
        if (val === 'custom') {
            recordFrame.style.aspectRatio = 'auto';
            recordFrame.style.maxWidth = '100%';
            recordFrame.style.height = '90vh';
            sizeDesc.textContent = '自定义：已解除比例限制，请手动调整录屏区域';
            recomputeCoverBase();
            return;
        }

        const parts = val.split('|');
        const ratioStr = parts[0];
        const w = parts[1];
        const h = parts[2];

        const [rw, rh] = ratioStr.split(':').map(Number);
        const ar = rw / rh;

        recordFrame.style.aspectRatio = rw + ' / ' + rh;
        recordFrame.style.maxWidth = 'calc(90vh * ' + ar.toFixed(4) + ')';
        recordFrame.style.height = '';
        sizeDesc.textContent = `比例：${ratioStr}｜画布：${w} × ${h}`;

        // 录屏区宽高变化 → 封面字号基准同步刷新
        recomputeCoverBase();
    }

    /* 5.1 录屏区标题自定义 */
    function applyFrameTitle(value) {
        const v = String(value == null ? '' : value);
        frameTitleDom.textContent = v;
        // 留空则隐藏标题，标题整体不占据录屏区空间
        frameTitleDom.style.display = v.trim() ? '' : 'none';
    }

    /* 5.2 录屏区底部署名 / 版权自定义（留空则整栏隐藏） */
    function applyFrameFooter(value) {
        const v = String(value == null ? '' : value).trim();
        frameFooterTextDom.textContent = v;
        frameFooterDom.style.display = v ? '' : 'none';
    }

    /* 5.3 封面大标题
       —— 超大标题 + 副标题居中叠加在录屏区，用于拍摄视频封面
       —— 字号基准按录屏区实时宽度计算（ResizeObserver 驱动），
          保证 9:16 / 4:5 / 1:1 / 16:9 各比例下"超大"程度一致
       —— 打开后给 .record-frame 加 .cover-on，
          由 CSS 负责把时间 / 字幕 / 头部淡出 */

    let coverBaseSize = 48;   // 100% 时的标题字号（像素），由实际宽度推算

    /** 按录屏区宽度推算字号基准，再套用用户缩放比例 */
    function recomputeCoverBase() {
        const w = recordFrame.clientWidth;
        if (w > 0) coverBaseSize = w * 0.125;
        applyCoverScale();
    }

    /** 应用「封面标题字号」滑块 */
    function applyCoverScale() {
        let pct = parseInt(coverScaleRange.value, 10);
        if (!isFinite(pct)) pct = 100;
        pct = Math.max(60, Math.min(180, pct));

        const size = coverBaseSize * pct / 100;
        recordFrame.style.setProperty('--cover-title-size', size.toFixed(1) + 'px');
        coverScaleVal.textContent = pct + '%';
    }

    /** 同步封面文本 / 显隐状态 */
    function applyCover() {
        const title = coverTitleInput.value.trim();
        const sub = coverSubInput.value.trim();

        coverTitleDom.textContent = title;
        coverSubDom.textContent = sub;
        coverTitleDom.style.display = title ? '' : 'none';
        coverSubDom.style.display = sub ? '' : 'none';

        // 开关打开、且至少有一行文字，才真正显示
        const on = coverToggleCheck.checked && !!(title || sub);

        coverOverlay.classList.toggle('show', on);
        recordFrame.classList.toggle('cover-on', on);
        coverOverlay.setAttribute('aria-hidden', on ? 'false' : 'true');
    }

    /* 6. 音频：加载 / 分析 / 电平 / 自动打点 */

    function ensureAudioEl() {
        if (audioEl) return audioEl;

        audioEl = new Audio();
        audioEl.preload = 'auto';

        audioEl.addEventListener('ended', () => {
            if (isRecording) stopRecord();
            if (isPlaying) stopPlay();
            updateStatusIndicator();
        });

        audioEl.addEventListener('loadedmetadata', () => {
            if (currentAudioName && isFinite(audioEl.duration)) {
                audioNameDom.textContent = currentAudioName + '　' + secondToTime(audioEl.duration);
            }
            // 音频元数据就绪 → 总时长已知，刷新一次进度条量程
            updateProgressUI(elapsed());
        });

        audioEl.addEventListener('error', () => {
            toast('音频加载出错');
            if (isPlaying || isRecording) {
                // 回退：停止当前活动，避免计时卡死
                stopAll();
            }
        });

        return audioEl;
    }

    /** 建立 AudioContext + Analyser（只做一次） */
    function setupAnalyser() {
        if (audioSourceNode) return true;

        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
            toast('当前浏览器不支持音频分析，自动打点不可用');
            return false;
        }

        try {
            audioCtx = new Ctx();
            audioSourceNode = audioCtx.createMediaElementSource(audioEl);
            audioAnalyser = audioCtx.createAnalyser();
            audioAnalyser.fftSize = 1024;
            audioAnalyser.smoothingTimeConstant = 0.4;
            audioData = new Uint8Array(audioAnalyser.fftSize);

            audioSourceNode.connect(audioAnalyser);
            audioAnalyser.connect(audioCtx.destination);
            return true;
        } catch (err) {
            console.warn('音频分析初始化失败：', err);
            audioCtx = null;
            audioAnalyser = null;
            audioData = null;
            return false;
        }
    }

    function resumeAudioCtx() {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => { });
        }
    }

    function openAudioFile(file) {
        if (!file) return;
        openAudioBlob(file, file.name);
        toast('已加载音频，可用【录制】+【下一句】或开启声音自动打点');
    }

    /**
     * 从 Blob / File 装载音频。
     * —— 打开音频文件 与 载入项目文件 共用同一入口；
     * —— 保留原始 Blob 引用，保存项目时直接取字节。
     */
    function openAudioBlob(blob, name) {
        if (!blob) return;

        const el = ensureAudioEl();

        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioUrl = URL.createObjectURL(blob);
        el.src = audioUrl;

        setupAnalyser();

        audioLoaded = true;
        currentAudioBlob = blob;
        currentAudioName = name || '未命名音频';
        audioNameDom.textContent = currentAudioName;
        audioNameDom.title = currentAudioName;

        // 新音频 → 重新尝试使用音频时间源（清掉上一轮可能留下的回退标志）
        useVirtualClock = false;

        resetVoiceDetect();
        updateProgressUI(elapsed());
    }

    function clearAudio() {
        if (isPlaying || isRecording) stopAll();

        audioLoaded = false;
        currentAudioName = '';
        currentAudioBlob = null;

        // 音频被清除 → 计时源标志重置
        useVirtualClock = false;

        if (audioEl) {
            audioEl.pause();
            audioEl.removeAttribute('src');
            try { audioEl.load(); } catch (e) { /* ignore */ }
        }

        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
            audioUrl = null;
        }

        audioNameDom.textContent = '未选择音频';
        audioNameDom.removeAttribute('title');

        meterLevel = 0;
        if (meterFill) meterFill.style.width = '0%';
        soundTapCheck.checked = false;
        resetVoiceDetect();

        currentTimeDom.querySelector('span:last-child').textContent = '00:00:00';
        updateProgressUI(0);
        toast('已清除音频');
    }

    function resetVoiceDetect() {
        voiceArmed = true;
        voiceMs = 0;
        silenceMs = 0;
    }

    function applyThreshold(v) {
        // v 为滑块值 [1, 100]
        const vv = Math.max(1, Math.min(100, parseInt(v, 10) || 15));
        const pct = (vv - 1) / 99;                       // 0 ~ 1
        threshValue = THRESH_MIN + pct * (THRESH_MAX - THRESH_MIN);

        if (meterThresh) {
            // 阈值指示线与电平条位置线性一致
            meterThresh.style.left = (1.6 + pct * 98.4).toFixed(1) + '%';
        }
        if (threshVal) threshVal.textContent = String(vv);
    }

    /** 每帧：刷新电平条 + 声音打点判断 */
    function tickAudioMeter(dt) {
        if (!audioAnalyser || !audioData) return;

        audioAnalyser.getByteTimeDomainData(audioData);

        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            const v = (audioData[i] - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / audioData.length);

        // 视觉平滑
        meterLevel = meterLevel * 0.55 + rms * 0.45;

        if (meterFill) {
            meterFill.style.width =
                Math.min(100, meterLevel * METER_SCALE).toFixed(1) + '%';
        }

        // 只有录制中 + 开启自动打点时才做判定
        if (!isRecording || !soundTapCheck.checked) {
            resetVoiceDetect();
            return;
        }

        const dtMs = dt * 1000;

        if (rms > threshValue) {
            voiceMs += dtMs;
            silenceMs = 0;

            // 连续 60ms 超过阈值 → 视为一次「开口」
            if (voiceArmed && voiceMs >= 60) {
                voiceArmed = false;
                voiceMs = 0;
                autoTapByVoice();
            }
        } else {
            silenceMs += dtMs;
            voiceMs = 0;

            // 安静 220ms 后重新武装，避免一句话里反复触发
            if (silenceMs >= 220) voiceArmed = true;
        }
    }

    function autoTapByVoice() {
        if (!isRecording) return;
        if (!subs.length) return;
        if (curIdx >= subs.length - 1) return;
        nextSub();
    }

    /* 7. 计时核心（播放 / 录制 共用一个循环） */
    const clockRunning = () => isPlaying || isRecording;

    /**
     * 当前时间（秒）。
     *
     * 时间源优先级：
     *   1 音频可用（已加载 && 未被标记回退）→ audioEl.currentTime
     *   2 其余情况（无音频 / 播放失败回退）→ 虚拟计时
     */
    function elapsed() {
        if (audioLoaded && audioEl && !useVirtualClock) {
            return audioEl.currentTime || 0;
        }
        return clockRunning()
            ? baseTime + (performance.now() - startStamp) / 1000
            : baseTime;
    }

    /* 7.2 播放进度控制：总时长推算 / 进度条刷新 / 拖动跳转 */

    /**
     * 推算进度条的总时长（秒）。
     *
     * 取值优先级：
     *   1 当前时间轴末句的「起点 + 该句估算朗读时长」
     *       —— 保证末句被完整走完，进度条不会提前触底
     *   2 音频自身的真实时长（若已加载）
     *   3 两者取较大值：字幕比音频长时以字幕为准，反之亦然
     *
     * 录制过程中改用 exportSubs —— 打点会实时改写时间戳，
     * 进度条量程随打点推进而扩展，不会中途卡死。
     */
    function getTotalDuration() {
        const timeline = isRecording ? exportSubs : getTimeline();

        let subEnd = 0;
        if (timeline && timeline.length) {
            const last = timeline[timeline.length - 1];
            const lastTime = (isFinite(last.time) && last.time > 0) ? last.time : 0;
            subEnd = lastTime + estimateDuration(last.text, currentSpeed());
        }

        let audioDur = 0;
        if (audioLoaded && audioEl &&
            isFinite(audioEl.duration) && audioEl.duration > 0) {
            audioDur = audioEl.duration;
        }

        const total = Math.max(subEnd, audioDur);
        return total > 0.01 ? total : 0.01;
    }

    /**
     * 生成进度条轨道的双色渐变背景。
     * 0 ~ pct 区间为已播（青蓝），其余为未播（淡白）。
     */
    function buildProgressBg(pct) {
        const p = (Math.max(0, Math.min(1, pct)) * 100).toFixed(2);
        return 'linear-gradient(to right,'
            + ' rgba(56, 189, 248, 0.9) 0%,'
            + ' rgba(56, 189, 248, 0.9) ' + p + '%,'
            + ' rgba(255, 255, 255, 0.10) ' + p + '%,'
            + ' rgba(255, 255, 255, 0.10) 100%)';
    }

    /**
     * 刷新进度条 UI。
     * 主循环每帧调用；用户拖动期间（isScrubbing）直接跳过，
     * 把滑块位置留给手指，避免互相争夺。
     *
     * {number} t 当前播放头时间（秒）
     */
    function updateProgressUI(t) {
        if (isScrubbing) return;

        const total = getTotalDuration();
        const ratio = Math.max(0, Math.min(1, t / total));

        progressRange.value = String(Math.round(ratio * 1000));
        progressRange.style.background = buildProgressBg(ratio);
        progressTimeDom.textContent =
            secondToTime(t) + ' / ' + secondToTime(total);
    }

    /**
     * 拖动预览：只更新视觉（填充 + 时间文字），不做真正的跳转。
     * 真正的跳转放在 change / pointerup 里执行，
     * 避免拖动过程中高频写 audioEl.currentTime 造成爆音与卡顿。
     */
    function previewProgressUI(ratio) {
        progressRange.style.background = buildProgressBg(ratio);

        const total = getTotalDuration();
        progressTimeDom.textContent =
            secondToTime(ratio * total) + ' / ' + secondToTime(total);
    }

    /**
     * 跳转到指定时间点。
     *
     * 时间源同步策略：
     *   · 音频驱动 → 直接写 audioEl.currentTime（浏览器自动对齐画面）
     *   · 虚拟计时 → 改写 baseTime；若正在跑循环，同时重置 startStamp，
     *                保证 elapsed() 立刻返回目标时间，进度不跳变
     *
     * 跳转后立即反查应高亮的句子并刷新卡拉OK逐字状态，
     * 不必等下一帧 loop，视觉反馈零延迟。
     *
     * {number} t 目标时间（秒），自动收拢到 [0, total]
     */
    function seekTo(t) {
        const total = getTotalDuration();
        const target = Math.max(0, Math.min(total, t));

        /* ---------- 1 时间源同步 ---------- */
        if (audioLoaded && audioEl && !useVirtualClock) {
            try {
                audioEl.currentTime = target;
            } catch (err) {
                // 元数据尚未就绪时写入可能抛错，忽略即可
            }
        } else if (clockRunning()) {
            baseTime = target;
            startStamp = performance.now();
        } else {
            baseTime = target;
        }

        /* ---------- 2 时间文字立刻刷新 ---------- */
        currentTimeDom.querySelector('span:last-child').textContent =
            secondToTime(target);

        /* ---------- 3 字幕高亮 / 卡拉OK 同步 ---------- */
        const timeline = isRecording ? exportSubs : getTimeline();
        if (timeline.length) {
            let idx = -1;
            for (let i = timeline.length - 1; i >= 0; i--) {
                if (target >= timeline[i].time) {
                    idx = i;
                    break;
                }
            }
            if (idx !== curIdx) setActive(idx);
            updateKaraoke(target);
        }

        /* ---------- 4 进度条回写 ---------- */
        updateProgressUI(target);
    }

    /* 7.5 卡拉OK 逐字高亮：按「章节内逐句时间戳」推进 */

    /** 逐字时间表缓存：同一句 + 同一时长 + 同一语速只算一次 */
    function getKaraokeSchedule(el, text, dur, speed) {
        const c = el._sched;
        if (c && Math.abs(c.dur - dur) < 1e-4 && c.speed === speed && c.text === text) {
            return c;
        }
        const sched = buildKaraokeSchedule(text, dur, speed);
        el._sched = {
            dur: dur,
            speed: speed,
            text: text,
            starts: sched.starts,
            durs: sched.durs
        };
        return el._sched;
    }

    /** 清空所有已点亮的字 + 已读标记（重置 / 重播时调用） */
    function clearAllLit() {
        for (let i = 0; i < itemEls.length; i++) {
            const el = itemEls[i];
            el.classList.remove('read-past');
            const lit = el._lit || 0;
            if (lit > 0) {
                const chs = el.children;
                for (let k = 0; k < lit && k < chs.length; k++) {
                    chs[k].classList.remove('lit');
                }
                el._lit = 0;
            }
        }
    }

    /**
     * 核心：根据当前时间 t，同步整章节内所有句子的紫色状态。
     *
     * 分两步执行：
     *
     *   步骤 1：整章节内的「已读句子」保持紫色（单向推进，不再回退）
     *     · 同一章节内、索引小于当前句的句子：整句保持紫色
     *       —— 通过给 .subtitle-item 加上 .read-past 类实现，
     *          整句的颜色 / 字重 / 发光 / 字号 由 CSS 统一控制。
     *     · 同一章节内、索引大于当前句的句子：清除 .read-past
     *     · 其他章节的句子：清除 .read-past（换章节后旧紫色不再保留）
     *
     *   步骤 2：当前句的逐字推进
     *     · 本句可用总时长来源（优先级）：
     *         1 同一章节内、下一句时间戳可信 → 下一句时间 − 本句时间
     *         2 章节末句 / 全文末句 / 下一句未打点 → 按语速估算自然时长，
     *            再用「到下一句的间隔」封顶
     *
     * 使用 el._lit 缓存每句已点亮的字符数，避免每帧重复操作 DOM。
     */
    function updateKaraoke(t) {
        // 开关关闭 → 清掉所有遗留的 .read-past 与逐字 .lit
        if (!karaokeMode) {
            clearAllLit();
            return;
        }

        const idx = curIdx;
        if (idx < 0 || idx >= itemEls.length) return;

        // 录制中用打点轴，播放中用当前播放轴
        const timeline = isRecording ? exportSubs : getTimeline();
        const item = timeline[idx];
        if (!item) return;

        const chapter = item.chapter;

        /* ------------------------------------------------------------------
           步骤 1：同步本章节内「已读 / 未读」句子的紫色状态
           ------------------------------------------------------------------ */
        for (let i = 0; i < itemEls.length; i++) {
            if (i === idx) continue;                  // 当前句留给步骤 2

            const elX = itemEls[i];
            if (!elX) continue;

            const nX = elX.children.length;
            if (nX === 0) continue;

            const itX = timeline[i];
            const sameChapter = !!itX && itX.chapter === chapter;

            if (sameChapter && i < idx) {
                // 已读句子：整句保持紫色（.read-past），同时把已点亮的字符补齐
                if (!elX.classList.contains('read-past')) {
                    elX.classList.add('read-past');
                }

                const prevX = elX._lit || 0;
                if (prevX < nX) {
                    const chsX = elX.children;
                    for (let k = prevX; k < nX; k++) {
                        // 一次性补齐的整句变紫，用统一的柔和过渡
                        chsX[k].style.transitionDuration = '0.22s, 0.3s';
                        chsX[k].classList.add('lit');
                    }
                    elX._lit = nX;
                }
            } else {
                // 未读句子 / 其他章节：确保紫色被清空
                if (elX.classList.contains('read-past')) {
                    elX.classList.remove('read-past');
                }
                if ((elX._lit || 0) > 0) {
                    const chsX = elX.children;
                    for (let k = 0; k < nX; k++) chsX[k].classList.remove('lit');
                    elX._lit = 0;
                }
            }
        }

        /* ------------------------------------------------------------------
           步骤 2：当前句的逐字推进
           ------------------------------------------------------------------ */
        const el = itemEls[idx];
        const chs = el.children;
        const n = chs.length;
        if (!n) return;

        const t0 = item.time;
        const speed = currentSpeed();
        const next = timeline[idx + 1];

        /* 本句时间戳的可信度判定：

           · 播放原始时间轴时：相邻两条时间戳来自同一份数据，直接相减即可。

           · 录制 / 回放校准轴时：只有「已打点（tapped）」的时间戳才是真实
             采样值。未打点的下一句仍然保留着【自动生成时的预测时间】，
             它与刚打下的真实时间戳不在同一时间基准上。

           · 章节化之后额外加一条约束：只有「同一章节内」的下一句，其
             时间戳才代表本句的朗读终点。跨章节的那条时间戳标记的是
             新章节的起点，中间隔着章节间的静默留白，不能拿来当本句时长。 */
        const trustedTimeline = !isRecording && playbackSource !== 'recording';
        const sameChapterNext = !!next && next.chapter === item.chapter;

        let dur = 0;

        if (sameChapterNext && (trustedTimeline || next.tapped)) {
            const d = next.time - t0;
            if (d > 0.05) dur = d;
        }

        if (!(dur > 0.05)) {
            // 章节末句 / 末句 / 未打点 → 按语速估算自然朗读时长
            dur = estimateDuration(item.text, speed);

            // 但不允许超过到下一句（含跨章节）的间隔
            if (next) {
                const gap = next.time - t0;
                if (gap > 0.05 && dur > gap) dur = gap;
            }

            if (!(dur > 0.05)) dur = 0.3;
        }

        const sched = getKaraokeSchedule(el, item.text, dur, speed);
        const starts = sched.starts;
        const local = t - t0;

        // 二分查找：最后一个 starts[i] <= local 的下标 + 1，即已点亮的字数
        let lit = 0;
        if (local > 0) {
            let lo = 0, hi = n;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (starts[mid] <= local) lo = mid + 1;
                else hi = mid;
            }
            lit = lo;
        }

        const prev = el._lit || 0;
        if (lit === prev) return;

        if (lit > prev) {
            // 点亮新字时，动态设置该字的过渡时长：
            //   —— 慢字（气口后起音 / 叠字 / 情感字）渐变柔和
            //   —— 快字（虚词 / 标点）渐变干脆
            for (let i = prev; i < lit && i < n; i++) {
                const sp = chs[i];
                const charDur = sched.durs[i] || 0.2;
                const trans = Math.min(0.45, Math.max(0.09, charDur * 0.55));
                sp.style.transitionDuration =
                    trans.toFixed(3) + 's, ' + (trans * 1.35).toFixed(3) + 's';
                sp.classList.add('lit');
            }
        } else {
            for (let i = lit; i < prev && i < n; i++) {
                chs[i].classList.remove('lit');
            }
        }
        el._lit = lit;
    }

    /* 7.6 主循环 */
    function loop(ts) {
        if (!clockRunning()) {
            rafId = null;
            lastLoopTs = 0;
            return;
        }

        if (!lastLoopTs) lastLoopTs = ts;
        let dt = (ts - lastLoopTs) / 1000;
        lastLoopTs = ts;
        if (!isFinite(dt) || dt < 0) dt = 0;
        if (dt > 0.2) dt = 0.2;

        const t = elapsed();
        currentTimeDom.querySelector('span:last-child').textContent = secondToTime(t);
        // 进度条跟随播放头（拖动期间 updateProgressUI 内部自动让位）
        updateProgressUI(t);

        // 音频电平 / 自动打点
        tickAudioMeter(dt);

        if (isPlaying) {
            const timeline = getTimeline();
            let idx = -1;

            for (let i = timeline.length - 1; i >= 0; i--) {
                if (t >= timeline[i].time) {
                    idx = i;
                    break;
                }
            }
            if (idx !== curIdx) setActive(idx);

            updateKaraoke(t);   // 逐字上色

            // 播放 / 回放走完后自动停止。
            // 末句停留时长 = 按当前语速估算的朗读时长（与自动生成时序同一套规则），
            // 不再写死 1.5 秒：长句不会被提前截断，短句也不会空等。
            if (timeline.length > 0) {
                const last = timeline[timeline.length - 1];
                const tailDur = estimateDuration(last.text, currentSpeed());
                const endT = last.time + tailDur;

                const isLast = (idx === timeline.length - 1);
                // 有音频且音频实际在驱动计时 → 以音频播完为准（audioEl 的 ended 事件会停止）；
                // 无音频（或音频已回退虚拟计时）→ 用估算出的末句时长收尾
                const audioIdle = !audioLoaded || !audioEl || useVirtualClock || audioEl.ended;

                if (isLast && audioIdle && t >= endT) {
                    stopPlay();
                    toast(playbackSource === 'recording' ? '回放结束' : '播放结束');
                    return;
                }
            }
        } else if (isRecording) {
            updateKaraoke(t);   // 录制打点时也逐字上色
        }

        rafId = requestAnimationFrame(loop);
    }

    function ensureLoop() {
        if (rafId === null) rafId = requestAnimationFrame(loop);
    }

    function stopClockLoop() {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        lastLoopTs = 0;
    }

    /* 8. 字幕激活 & 滚动 */

    /**
     * 设置当前激活句子。
     *
     * 高亮分两层：
     *
     *   1 整章节高亮（.chapter-active）
     *      —— 【播放模式】下，当激活句子切换到新章节时，把整个章节内的
     *         所有句子一起标记为高亮（白色、加粗、发光、字符级轻微放大 2%），
     *         形成"整段一起亮起并轻微放大"，方便预览时把握段落氛围。
     *      —— 【录制模式】下不做整章节高亮 —— 录制需要的是"当前该读哪一句"
     *         的强提示，所以只让当前句亮起（见下方 2），
     *         未读 / 已读句子保持原始灰色，形成"逐句推进"的视觉。
     *
     *   2 当前句标记（.current）
     *      —— 只标记当前正在朗读 / 录制的那一句。
     *      —— 录制模式下，.current 通过独立的 CSS 规则（.subtitle-item.current）
     *         得到白色加粗 + 发光 + 字符级放大 2%，视觉表现与原整章节高亮一致，
     *         保证用户的焦点始终清晰。
     *      —— 卡拉OK逐字变色只在 .current 句上推进（见 updateKaraoke）。
     *
     * 关于"字体放大"的实现细节：
     *   —— 放大不再走 font-size（那会触发布局重排，让字幕折行、位移），
     *      而是把放大动作下移到每个字符 .ch 上，用 transform: scale(1.02) 完成。
     *   —— transform 不参与布局，因此无论整段如何缩放，
     *      字幕的折行位置、行与行的对齐、整体高度都完全不变，
     *      视觉上只是每个字轻微变大 2%，与旧版整句 scale(1.02) 效果一致。
     *
     * 说明：这里用 lastActiveIdx（而不是 curIdx）作为"上一次的索引"。
     *   —— nextSub() 里先做了 curIdx += 1，再调用 setActive(curIdx)。
     *   —— 如果此处用 `const prevIdx = curIdx` 读"上一次的索引"，
     *      此时 curIdx 已被改成新值，prevIdx 恒等于 idx，
     *      chapterChanged 永远为 false，章节高亮永远不会被添加。
     *   —— 用独立变量 lastActiveIdx 记录上一次真正处理的索引，
     *      就不受外部是否提前修改 curIdx 的影响。
     *
     * 滚动策略：
     *   —— 同一章节内句子切换时，不滚动。
     *   —— 跨章节时才滚动，且尽量把新章节滚动到字幕区「垂直居中」位置
     *      （详见 scrollChapterToCenter 的居中策略与回退规则）。
     */
    function setActive(idx) {
        const prevIdx = lastActiveIdx;    // 上一次真正处理的索引
        lastActiveIdx = idx;              // 立即更新，供下一次使用
        curIdx = idx;

        // 当前章节（-1 表示无激活）
        const newChapter = (idx >= 0 && idx < subs.length) ? subs[idx].chapter : -1;
        const oldChapter = (prevIdx >= 0 && prevIdx < subs.length) ? subs[prevIdx].chapter : -2;
        const chapterChanged = newChapter !== oldChapter;

        /* ---------- 1 清除旧句子的 .current（无论章节是否变化） ---------- */
        if (prevIdx >= 0 && prevIdx < itemEls.length) {
            itemEls[prevIdx].classList.remove('current');
        }

        /* ---------- 2 章节变化时的整章节高亮 / 清除 ---------- */
        if (chapterChanged) {
            if (isRecording) {
                /* 【录制模式】逐句高亮 ——
                   清空所有句子的 .chapter-active，
                   保证只有当前句以 .current 亮起，
                   未读 / 已读句子都保持原始灰色。 */
                for (let i = 0; i < itemEls.length; i++) {
                    itemEls[i].classList.remove('chapter-active');
                }
            } else {
                /* 【播放模式】整章节高亮 —— 原设计行为，
                   把一个章节的所有句子一起点亮（含字符级轻微放大）。 */
                for (let i = 0; i < itemEls.length; i++) {
                    const on = (subs[i].chapter === newChapter) && newChapter >= 0;
                    itemEls[i].classList.toggle('chapter-active', on);
                }
            }
            curChapter = newChapter;
        }

        /* ---------- 3 给当前句加 .current ---------- */
        if (idx >= 0 && idx < itemEls.length) {
            itemEls[idx].classList.add('current');
        }

        /* ---------- 4 滚动：只有跨章节时才滚动，并尽量让新章节垂直居中 ---------- */
        if (chapterChanged && idx >= 0 && itemEls[idx]) {
            let firstIdx = idx;
            while (firstIdx > 0 && subs[firstIdx - 1].chapter === newChapter) {
                firstIdx--;
            }
            const chapterEl = itemEls[firstIdx] ? itemEls[firstIdx].parentNode : null;
            if (chapterEl) scrollChapterToCenter(chapterEl);
        }
    }

    /**
     * 把指定章节滚动到字幕区可视范围的「垂直居中」位置。
     *
     * 居中策略（有条件居中，避免出现大段空白）：
     *
     *   1 章节高度 ≥ 可视区高度
     *        无法居中 → 退化为「顶部对齐」，保证从章节第一句开始读。
     *
     *   2 章节高度 < 可视区高度
     *        目标位置 = 章节顶部 −（可视区高 − 章节高）/ 2
     *        即：让章节上下留白相等，稳稳落在可视区正中。
     *
     *   3 目标位置收拢到合法滚动范围 [0, maxScroll]
     *        章节位于全文开头 / 结尾时，自动回退为顶部 / 底部对齐，
     *        不会因为强行居中而在上下留下无法消除的空白。
     *
     * {HTMLElement} chapterEl 章节容器（.subtitle-chapter）
     */
    function scrollChapterToCenter(chapterEl) {
        if (!chapterEl) return;

        const boxH = subtitleBox.clientHeight;      // 可视区高度（含内边距）
        const chapterH = chapterEl.offsetHeight;    // 章节实际高度
        if (boxH <= 0 || chapterH <= 0) return;

        const maxScroll = Math.max(0, subtitleBox.scrollHeight - boxH);

        // 章节顶部在「内容坐标系」中的位置。
        // 用 getBoundingClientRect 求差，避开 padding / border 带来的偏移误差。
        const boxRect = subtitleBox.getBoundingClientRect();
        const chapterRect = chapterEl.getBoundingClientRect();
        const top = subtitleBox.scrollTop + (chapterRect.top - boxRect.top);

        let target;

        if (chapterH >= boxH) {
            // 1 章节装不下 → 顶部对齐（留 20px 呼吸位）
            target = top - 20;
        } else {
            // 2 章节装得下 → 垂直居中
            target = top - (boxH - chapterH) / 2;
        }

        // 3 收拢到合法范围：靠近开头 / 结尾时自然回退为顶部 / 底部对齐
        if (target < 0) target = 0;
        else if (target > maxScroll) target = maxScroll;

        subtitleBox.scrollTo({ top: target, behavior: 'smooth' });
    }

    function updateTimeDisplayStyle() {
        if (isPlaying && playbackSource === 'recording') {
            currentTimeDom.classList.add('replay-mode');
        } else {
            currentTimeDom.classList.remove('replay-mode');
        }
    }

    /* 9. 播放 */
    function startPlay(source) {
        if (isPlaying || !subs.length) return;
        if (isRecording) stopRecord();

        if (source) playbackSource = source;

        isPlaying = true;

        /* 播放时自动隐藏封面大标题 —— 让正常字幕显示出来，
           避免超大标题遮盖后方文字，影响跟读。
           注意：只改「显示 / 隐藏」这一个状态，不动用户输入的
           标题文本、副标题与字号设置；播放结束后也不再恢复，
           把封面开关的控制权交回给用户手动操作。 */
        if (coverToggleCheck.checked) {
            coverToggleCheck.checked = false;
            applyCover();
        }

        // 音频驱动分支：只有「已加载音频 && 未回退虚拟计时」时才尝试 play()
        if (audioLoaded && audioEl && !useVirtualClock) {
            // 已经播完的话，从头开始
            if (audioEl.ended) audioEl.currentTime = 0;
            resumeAudioCtx();
            const p = audioEl.play();
            if (p && p.catch) {
                p.catch(() => {
                    // play() 被浏览器拒绝 / 音频解码失败
                    // → 切换到虚拟计时；从现在开始累计时间
                    toast('音频播放失败，已切换为虚拟计时');
                    useVirtualClock = true;
                    baseTime = 0;
                    startStamp = performance.now();
                });
            }
        } else {
            // 无音频 / 已回退虚拟计时：直接走虚拟计时
            startStamp = performance.now();
        }

        playBtn.textContent = '暂停';
        updateTimeDisplayStyle();
        ensureLoop();
        updateStatusIndicator();
    }

    function stopPlay() {
        if (!isPlaying) return;

        isPlaying = false;

        if (audioLoaded && audioEl && !useVirtualClock) {
            audioEl.pause();
        } else {
            baseTime += (performance.now() - startStamp) / 1000;
        }

        playBtn.textContent = '播放';
        stopClockLoop();
        updateTimeDisplayStyle();
        updateStatusIndicator();
        updateProgressUI(elapsed());

        /* 播放 / 回放正常结束时，不再改动封面开关 ——
           用户可在左侧「录屏区外观」分组中自由切换，
           本处保持静默，不打扰手动控制。 */
    }

    function togglePlay() {
        if (!subs.length) {
            toast('请先【解析字幕】');
            return;
        }
        isPlaying ? stopPlay() : startPlay();
    }

    /* 10. 录制 */

    /**
     * 开始一轮全新的录制。
     *
     * {boolean} skipCover
     *     是否跳过「自动显示封面大标题」这一步。
     *     —— 用户点击【录制】按钮进入 → 传 undefined，
     *        按默认流程自动显示封面（方便拍开头）；
     *     —— 用户直接点【下一句】隐式进入录制 → 传 true，
     *        因为 nextSub 马上就会开始打点，需要看到字幕，
     *        跳过显示封面可避免封面一闪而过的视觉噪声。
     */
    function startRecord(skipCover) {
        if (isRecording || !subs.length) return;
        if (isPlaying) stopPlay();

        playbackSource = 'original';
        updateTimeDisplayStyle();

        isRecording = true;
        curIdx = -1;
        curChapter = -1;
        // 重置 lastActiveIdx：让下一次 setActive(0) 被识别为章节切换
        lastActiveIdx = -1;

        exportSubs = subs.map((s) => ({ ...s, tapped: false }));

        /* 开始新一轮录制前，先清空所有历史高亮 / 已读紫色 / 逐字状态 ——
           避免上一轮播放或录制遗留的 .chapter-active / .read-past / .lit
           在视觉上"粘住"，影响新一遍打点的清晰度。 */
        clearAllLit();
        clearAllHighlight();

        /* 录制时自动显示封面大标题 ——
           录制通常是要拍视频封面画面，需要超大标题居中呈现。
           前提是用户已填写标题或副标题，否则不做无意义的切换。
           skipCover 为 true 时（由 nextSub 隐式触发），跳过这一步 ——
           因为马上就要打点，需要看到字幕。 */
        if (!skipCover &&
            (coverTitleInput.value.trim() || coverSubInput.value.trim())) {
            if (!coverToggleCheck.checked) {
                coverToggleCheck.checked = true;
            }
            applyCover();
        }

        if (audioLoaded && audioEl && !useVirtualClock) {
            audioEl.currentTime = 0;
            resumeAudioCtx();
            const p = audioEl.play();
            if (p && p.catch) {
                p.catch(() => {
                    toast('音频播放失败，已切换为虚拟计时');
                    useVirtualClock = true;
                    baseTime = 0;
                    startStamp = performance.now();
                });
            }
        } else {
            baseTime = 0;
            startStamp = performance.now();
        }

        resetVoiceDetect();

        recordBtn.textContent = '停止录制';
        recordBtn.style.background = 'rgba(22, 163, 74, 0.85)';
        currentTimeDom.querySelector('span:last-child').textContent = '00:00:00';
        updateProgressUI(0);

        renderExport();
        ensureLoop();
        updateStatusIndicator();
    }

    function stopRecord() {
        if (!isRecording) return;

        if (audioLoaded && audioEl && !useVirtualClock) {
            audioEl.pause();
        } else {
            baseTime += (performance.now() - startStamp) / 1000;
        }

        isRecording = false;
        recordBtn.textContent = '录制';
        recordBtn.style.background = 'rgba(220, 38, 38, 0.82)';
        currentTimeDom.querySelector('span:last-child').textContent = secondToTime(elapsed());

        stopClockLoop();
        updateStatusIndicator();
        updateProgressUI(elapsed());

        /* 录制停止时不再改动封面开关 ——
           用户手动开启或关闭的控制权完整保留，
           本处保持静默。 */
    }

    function toggleRecord() {
        if (!subs.length) {
            toast('请先【解析字幕】或【自动生成时序】');
            return;
        }
        isRecording ? stopRecord() : startRecord();
    }

    /**
     * 从暂停状态恢复录制（不清空已打点数据）。
     * nextSub() 中若发现既未录制也未播放，则调用此函数。
     *
     * 注意：这里如果音频播放失败，只切换到虚拟计时，
     *      不重置 baseTime —— 因为是从暂停处继续，之前的
     *      累计时间需要被保留。
     *
     * 这里刻意不做「自动显示封面」——
     * 用户此前已经打过至少一句，说明已经进入打点流程，
     * 恢复录制时应该继续看到字幕，方便核对下一句。
     * 若用户想临时回到封面画面，可以手动勾选封面开关。
     */
    function resumeRecording() {
        if (isRecording) return;

        isRecording = true;
        playbackSource = 'original';
        updateTimeDisplayStyle();

        if (audioLoaded && audioEl && !useVirtualClock) {
            resumeAudioCtx();
            const p = audioEl.play();
            if (p && p.catch) {
                p.catch(() => {
                    toast('音频播放失败，已切换为虚拟计时');
                    useVirtualClock = true;
                    startStamp = performance.now();
                    // 不重置 baseTime —— 从当前位置继续累加
                });
            }
        } else {
            startStamp = performance.now();
        }

        resetVoiceDetect();
        recordBtn.textContent = '停止录制';
        recordBtn.style.background = 'rgba(22, 163, 74, 0.85)';
        ensureLoop();
        updateStatusIndicator();
    }

    /* 11. 下一句（打点） */
    /**
     * 记录当前句的时间戳并切到下一句。
     *
     * 与之前版本相比，这里加了三道逻辑：
     *
     *   1 subs 为空 → 明确提示「请先解析字幕」，不再让用户看到
     *      "已经是最后一句了"这种误导性提示。
     *
     *   2 自动进入录制状态时，会调用 startRecord(true) 跳过封面显示 ——
     *      因为马上要打点，需要看到字幕，无需封面一闪而过；
     *      二次确认 isRecording 后，立即中止异常情况。
     *
     *   3 打点完成后，如果封面当前处于显示状态（例如用户手动打开的），
     *      自动关闭 —— 保证打点过程中字幕始终可见，不会被封面遮盖。
     */
    function nextSub() {
        // 1 前置检查：没有字幕就明确提示
        if (!subs.length) {
            toast('请先【解析字幕】或【自动生成时序】');
            return;
        }

        // 2 未在录制 / 播放状态：自动进入录制
        if (!isRecording && !isPlaying) {
            if (curIdx >= 0 && exportSubs.length) {
                // 已打过点 → 从当前位置继续（resumeRecording 不显示封面）
                resumeRecording();
            } else {
                // 全新开始 → 跳过封面显示，直接准备打点
                startRecord(true);
            }
            if (!isRecording) return;
        }

        // 3 越界检查
        if (curIdx >= subs.length - 1) {
            toast('已经是最后一句了');
            return;
        }

        curIdx += 1;
        const t = elapsed();

        if (!exportSubs[curIdx]) {
            exportSubs[curIdx] = { ...subs[curIdx], tapped: false };
        }
        exportSubs[curIdx].time = t;
        exportSubs[curIdx].tapped = true;

        currentTimeDom.querySelector('span:last-child').textContent = secondToTime(t);

        setActive(curIdx);

        /* 同步刷新卡拉OK状态：
           setActive 刚移除了上一句的 .current，
           如果等到下一帧 loop 里的 updateKaraoke 才补上 .read-past，
           浏览器会先按「无 .current、无 .read-past」渲染一帧 ——
           颜色从白色过渡到灰色的中途又被拉回紫色，
           scale 也经历一次「缩回再恢复」的中间态，表现为闪烁。
           在这里同步调用，让两次类切换落在同一个样式重算批次里，
           颜色可以直接从白过渡到紫，scale 保持连续。 */
        if (karaokeMode) updateKaraoke(t);

        /* 打点完成后自动隐藏封面大标题 ——
           点【录制】进入时会显示封面（拍开头），
           一旦开始点【下一句】打点，就必须看清字幕对准每一句，
           因此在这里隐藏封面，露出正常字幕预览。
           只改「显示 / 隐藏」状态，不动用户的标题文本、副标题与字号。 */
        if (coverToggleCheck.checked) {
            coverToggleCheck.checked = false;
            applyCover();
        }

        renderExport();
        updateProgressUI(t);
    }

    /* 12. 回放录制 */
    function playbackRecording() {
        if (!subs.length) {
            toast('请先【解析字幕】');
            return;
        }
        if (!hasRecording()) {
            toast('还没有录制结果，请先【录制】+【下一句】打点');
            return;
        }

        stopAll();

        // 复位播放进度与高亮
        baseTime = 0;
        curIdx = -1;
        curChapter = -1;
        // 回放前重置 lastActiveIdx：让回放的第一次 setActive 能正确识别章节切换
        lastActiveIdx = -1;

        if (audioLoaded && audioEl && !useVirtualClock) audioEl.currentTime = 0;

        currentTimeDom.querySelector('span:last-child').textContent = '00:00:00';
        clearAllLit();
        clearAllHighlight();
        subtitleBox.scrollTop = 0;

        playbackSource = 'recording';
        updateProgressUI(0);
        /* 回放本质是一次播放 —— startPlay 会自动关掉封面大标题，
           让正常字幕显示出来，方便逐句核对节拍。 */
        startPlay('recording');

        toast('正在回放录制节拍…');
    }

    /* 13. 时间轴渲染 & 解析 */

    /**
     * 渲染校准输出时间轴。
     * —— 章节之间插入空行，使输出结果重新解析时仍能还原章节结构。
     * —— 单调性保护：保证时间戳严格递增，避免同秒 / 倒序。
     */
    function renderExport() {
        let prev = -Infinity;
        const out = [];
        let lastChapter = null;

        exportSubs.forEach((it) => {
            // 章节切换处补一个空行
            if (chapterSplit && lastChapter !== null && it.chapter !== lastChapter) {
                out.push('');
            }
            lastChapter = it.chapter;

            let t = it.time;
            if (!isFinite(t) || t < 0) t = 0;
            if (t <= prev) t = prev + 0.001;
            prev = t;

            out.push(`${secondToTimeMs(t)}|${it.text}`);
        });

        exportTimeRuleDom.value = out.join('\n');
    }

    /** 清除所有高亮状态（章节高亮 + 当前句 + 已读标记） */
    function clearAllHighlight() {
        for (let i = 0; i < itemEls.length; i++) {
            itemEls[i].classList.remove('chapter-active');
            itemEls[i].classList.remove('current');
            itemEls[i].classList.remove('read-past');
        }
    }

    /**
     * 渲染右侧字幕预览区。
     *
     * 视觉目标：
     *   · 同一章节内的句子首尾相接，像一整段连续文本（不换行）
     *   · 章节之间保持换行 —— 新章节另起一行，间距更大
     *   · 不显示任何章节标签 / 序号 / 分隔线，保持纯净
     *
     * 实现方式：
     *   · 章节容器 .subtitle-chapter 是块级（章节之间自然换行）
     *   · 句子元素 .subtitle-item 设为 display:inline，
     *     章节内部的句子连续流动，不在句子之间换行
     *   · 每个字符由 .ch 包裹，display:inline-block，
     *     这样既能像 inline 一样自然流动，又能应用 transform，
     *     让整句的"轻微放大"效果不参与布局、不引起折行位移
     *   · itemEls 顺序与 subs 严格一一对应，索引逻辑完全不受影响
     */
    function renderSubtitleBox() {
        itemEls = [];

        const frag = document.createDocumentFragment();
        let chapterEl = null;
        let curChapterIdx = null;

        subs.forEach((item) => {
            // 章节切换 → 新建一个章节容器（块级，自动另起一行）
            if (chapterEl === null || item.chapter !== curChapterIdx) {
                curChapterIdx = item.chapter;
                chapterEl = document.createElement('div');
                chapterEl.className = 'subtitle-chapter';
                frag.appendChild(chapterEl);
            }

            const div = document.createElement('div');
            div.className = 'subtitle-item';

            // 逐字包裹：为卡拉OK逐字上色、以及整句"字符级放大"做准备
            // 每个字符是 inline-block，可独立应用 transform；
            // 颜色继承父级，所以关闭卡拉OK模式时观感与原来完全一致
            const chars = Array.from(item.text);
            for (let i = 0; i < chars.length; i++) {
                const sp = document.createElement('span');
                sp.className = 'ch';
                sp.textContent = chars[i];
                div.appendChild(sp);
            }

            div._lit = 0;
            div._sched = null;
            chapterEl.appendChild(div);
            itemEls.push(div);
        });

        if (typeof subtitleBox.replaceChildren === 'function') {
            subtitleBox.replaceChildren(frag);
        } else {
            while (subtitleBox.firstChild) subtitleBox.removeChild(subtitleBox.firstChild);
            subtitleBox.appendChild(frag);
        }
        subtitleBox.scrollTop = 0;
    }

    function parseTimeRule(opts) {
        opts = opts || {};

        // 解析前先停止所有正在进行的播放 / 录制，避免状态不一致
        stopAll();

        const lines = timeRuleDom.value.split(/\r?\n/);
        const list = [];
        let skipped = 0;
        let unsorted = 0;

        /* 章节计数：空行（不含注释行）触发一次章节递增
           只有 chapterSplit 打开时，空行才具备分割语义 */
        let chapter = 0;
        let pendingBreak = false;

        for (const raw of lines) {
            const line = raw.trim();

            if (!line) {
                // 空行：作为章节分隔（仅在开关打开、且已有内容时生效）
                if (chapterSplit && list.length) pendingBreak = true;
                continue;
            }
            if (line.startsWith('#')) continue;

            // 只按第一个 "|" 切分
            const sep = line.indexOf('|');
            if (sep === -1) {
                skipped++;
                continue;
            }

            const sec = timeToSecond(line.slice(0, sep));
            const text = line.slice(sep + 1).trim();
            if (sec === null || !text) {
                skipped++;
                continue;
            }

            // 章节边界在这里落地：本行属于新章节
            if (pendingBreak) {
                chapter++;
                pendingBreak = false;
            }

            list.push({ time: sec, text: text, chapter: chapter });
        }

        if (!list.length) {
            toast('时间轴为空或格式不正确');
            return false;
        }

        // 时间轴单调性校验：若乱序则排序，并提示用户
        let sorted = true;
        for (let i = 1; i < list.length; i++) {
            if (list[i].time < list[i - 1].time) { sorted = false; break; }
        }
        if (!sorted) {
            list.sort((a, b) => a.time - b.time);
            unsorted = 1;
        }

        subs = list;
        exportSubs = list.map((s) => ({ ...s, tapped: false }));
        curIdx = -1;
        curChapter = -1;
        // 重新解析 → 索引全部失效，重置 lastActiveIdx
        lastActiveIdx = -1;
        baseTime = 0;
        isPlaying = false;
        isRecording = false;
        playbackSource = 'original';
        // 解析新时间轴 → 重置计时源标志（下次播放重新尝试音频）
        useVirtualClock = false;

        playBtn.textContent = '播放';
        recordBtn.textContent = '录制';
        recordBtn.style.background = 'rgba(220, 38, 38, 0.82)';
        currentTimeDom.querySelector('span:last-child').textContent = '00:00:00';
        updateTimeDisplayStyle();

        renderSubtitleBox();
        renderExport();
        updateProgressUI(0);

        if (!opts.silent) {
            const chapterCount = list.length ? (list[list.length - 1].chapter + 1) : 0;
            const parts = [`已加载 ${list.length} 条字幕`];
            if (chapterSplit && chapterCount > 1) parts.push(`共 ${chapterCount} 个章节`);
            if (skipped) parts.push(`跳过 ${skipped} 行无效数据`);
            if (unsorted) parts.push('已自动按时间排序');
            toast(parts.join('，'));
        }
        return true;
    }

    /* 13.1 原文切分：按空行划章 → 章内按换行 / 标点切句 */

    /**
     * 在一段无换行的文本内部按句末标点切分，长句再按逗号等二次切分。
     * （不使用 lookbehind，兼容性更好）
     */
    function splitByPunctuation(s) {
        const SENTINEL = '\u0001';
        const normalized = String(s).replace(/([。！？!?；;…])/g, '$1' + SENTINEL);

        const rough = normalized
            .split(SENTINEL)
            .map((t) => t.trim())
            .filter(Boolean);

        const MAX = 30;
        const out = [];

        for (const seg of rough) {
            if (seg.length <= MAX) {
                out.push(seg);
                continue;
            }

            let rest = seg;
            while (rest.length > MAX) {
                let cut = -1;
                for (let i = MAX; i >= Math.floor(MAX / 2); i--) {
                    if ('，,、：:'.includes(rest[i])) {
                        cut = i + 1;
                        break;
                    }
                }
                if (cut === -1) cut = MAX;

                out.push(rest.slice(0, cut).trim());
                rest = rest.slice(cut).trim();
            }
            if (rest) out.push(rest);
        }

        return out;
    }

    /**
     * 把原文切分为「章节 → 句子」的扁平列表。
     * 返回 [{ text, chapter }]，chapter 从 0 开始。
     *
     * chapterSplit 为 true 时，空行代表章节边界，且章节边界优先级最高：
     * 空行两边的句子一定落在不同章节里，即使它们本来会被标点规则连在一起。
     * chapterSplit 为 false 时，忽略空行，全部内容视为同一章节（chapter 恒为 0）。
     */
    function buildChunks(raw, autoSplit) {
        const blocks = [];
        let cur = [];

        for (const line of String(raw).split(/\r?\n/)) {
            const s = line.trim();
            if (s) {
                cur.push(s);
            } else if (chapterSplit && cur.length) {
                // 空行 → 结束当前章节
                blocks.push(cur);
                cur = [];
            }
        }
        if (cur.length) blocks.push(cur);

        const chunks = [];
        blocks.forEach((lines, ci) => {
            for (const line of lines) {
                const parts = autoSplit ? splitByPunctuation(line) : [line];
                for (const p of parts) {
                    const text = p.trim();
                    if (text) chunks.push({ text: text, chapter: ci });
                }
            }
        });

        return chunks;
    }

    /* 14. 自动生成时序 */
    function autoGenerate() {
        const raw = rawTextDom.value.trim();
        if (!raw) {
            toast('请先粘贴原文');
            return;
        }

        let speed = parseFloat(speedInput.value);
        if (!isFinite(speed) || speed <= 0) {
            speed = 2.2;
            speedInput.value = '2.2';
        }

        const autoSplit = autoSplitCheck.checked;
        const chunks = buildChunks(raw, autoSplit);

        if (!chunks.length) {
            toast('没有可用的文本内容');
            return;
        }

        // 时间跨章节连续累计：每个章节内部的时间戳依次递增，
        // 章节之间由空行分隔，回填后仍能被识别为章节
        let t = 0;
        const out = [];
        let lastChapter = null;

        for (const c of chunks) {
            if (chapterSplit && lastChapter !== null && c.chapter !== lastChapter) {
                out.push('');
            }
            lastChapter = c.chapter;

            out.push(`${secondToTimeMs(t)}|${c.text}`);
            t += estimateDuration(c.text, speed);
        }

        timeRuleDom.value = out.join('\n');
        parseTimeRule({ silent: true });

        const chapterCount = chunks.length ? (chunks[chunks.length - 1].chapter + 1) : 0;
        const suffix = (chapterSplit && chapterCount > 1)
            ? `，${chapterCount} 个章节`
            : (autoSplit ? '' : '（按换行切分）');
        toast(`已生成 ${chunks.length} 条时序${suffix}`);
    }

    /* 15. 重置 */
    function resetAll() {
        stopAll();

        baseTime = 0;
        curIdx = -1;
        curChapter = -1;
        // 重置 lastActiveIdx：下一次 setActive 会被识别为章节切换
        lastActiveIdx = -1;
        playbackSource = 'original';
        // 重置计时源标志 —— 下次播放重新尝试使用音频
        useVirtualClock = false;

        if (audioLoaded && audioEl) {
            audioEl.pause();
            audioEl.currentTime = 0;
        }

        currentTimeDom.querySelector('span:last-child').textContent = '00:00:00';
        playBtn.textContent = '播放';
        recordBtn.textContent = '录制';
        recordBtn.style.background = 'rgba(220, 38, 38, 0.82)';
        updateTimeDisplayStyle();

        clearAllLit();
        clearAllHighlight();
        subtitleBox.scrollTop = 0;

        resetVoiceDetect();

        exportSubs = subs.map((s) => ({ ...s, tapped: false }));
        renderExport();
        updateProgressUI(0);
        updateStatusIndicator();
        toast('已重置');
    }

    /* 15.1 停止所有活动（统一入口，避免状态残留） */
    function stopAll() {
        if (isPlaying) stopPlay();
        if (isRecording) stopRecord();
        stopClockLoop();
    }

    /* 16. 复制校准字幕 */
    async function copyExport() {
        const text = exportTimeRuleDom.value.trim();
        if (!text) {
            toast('还没有可复制的内容');
            return;
        }

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            toast('已复制到剪贴板');
        } catch (e) {
            toast('复制失败，请手动选择文本复制');
        }
    }

    /* 16.1 项目文件：打包保存 / 载入

       —— 把「原文 + 音频 + 字幕时间轴 + 校准结果 + 全部设置」
          装进一个固定后缀名 .tqproj 的独立文件，
          后期一键载入即可完全还原现场。

       —— 容器格式（小端序，定长头 20 字节）：

            偏移  长度  内容
            0     8     文件标识（ASCII "TQPRJ001"）
            8     4     格式版本（uint32）
            12    4     JSON 头长度（uint32，字节）
            16    4     音频数据长度（uint32，字节；无音频为 0）
            20    n     JSON 头（UTF-8）
            20+n  m     音频二进制（原始字节，不做二次编码）

       —— 为什么用「定长头 + JSON + 裸二进制」而不是 Zip：
            · 零依赖：不引入任何第三方压缩库，单文件即可运行；
            · 音频本身已是压缩格式（mp3 / m4a / ogg / wav 视源文件而定），
              再套一层 Zip 收益极低，反而增加解码负担；
            · JSON 头天然向后兼容 —— 以后新增字段，旧版本读到多余键
              会直接忽略，不会报错。 */

    const PROJECT_MAGIC = 'TQPRJ001';    // 8 字节文件标识
    const PROJECT_EXT = '.tqproj';       // 固定后缀名
    const PROJECT_VERSION = 1;           // 归档格式版本
    const PROJECT_HEAD = 20;             // 定长头长度（8 + 4 + 4 + 4）

    /** 生成下载用的时间戳标签：20260214_093015 */
    function timestampTag() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
            '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    /** 触发浏览器下载（用完即回收 objectURL，避免内存泄漏） */
    function downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    /** 把 JSON 头 + 音频字节拼装成 .tqproj 二进制 */
    function buildProjectArchive(dataObj, audioBytes) {
        const headerBytes = new TextEncoder().encode(JSON.stringify(dataObj));
        const magicBytes = new TextEncoder().encode(PROJECT_MAGIC);
        const audio = audioBytes || new Uint8Array(0);

        const buf = new ArrayBuffer(PROJECT_HEAD + headerBytes.length + audio.length);
        const view = new DataView(buf);
        const u8 = new Uint8Array(buf);

        u8.set(magicBytes, 0);
        view.setUint32(8, PROJECT_VERSION, true);
        view.setUint32(12, headerBytes.length, true);
        view.setUint32(16, audio.length, true);
        u8.set(headerBytes, PROJECT_HEAD);
        if (audio.length) u8.set(audio, PROJECT_HEAD + headerBytes.length);

        return new Blob([buf], { type: 'application/octet-stream' });
    }

    /** 解析 .tqproj，返回 { version, data, audioBytes }；格式不对则抛错 */
    async function parseProjectArchive(file) {
        const buf = await file.arrayBuffer();
        if (buf.byteLength < PROJECT_HEAD) {
            throw new Error('文件过小，不是有效的项目文件');
        }

        const view = new DataView(buf);
        const u8 = new Uint8Array(buf);

        const magic = new TextDecoder().decode(u8.subarray(0, 8));
        if (magic !== PROJECT_MAGIC) {
            throw new Error('文件标识不匹配，请确认是本工具保存的 ' + PROJECT_EXT + ' 项目文件');
        }

        const version = view.getUint32(8, true);
        const headerLen = view.getUint32(12, true);
        const audioLen = view.getUint32(16, true);

        if (PROJECT_HEAD + headerLen + audioLen > buf.byteLength) {
            throw new Error('文件内容不完整，可能已损坏');
        }

        const headerText = new TextDecoder().decode(
            u8.subarray(PROJECT_HEAD, PROJECT_HEAD + headerLen)
        );

        let data;
        try {
            data = JSON.parse(headerText);
        } catch (err) {
            throw new Error('项目数据解析失败，文件可能已损坏');
        }

        const audioBytes = audioLen
            ? u8.subarray(PROJECT_HEAD + headerLen, PROJECT_HEAD + headerLen + audioLen)
            : null;

        return { version: version, data: data, audioBytes: audioBytes };
    }

    /* ---------- 保存 ---------- */

    async function saveProject() {
        // 空项目（没原文、没字幕、没音频）不值得落盘
        if (!rawTextDom.value.trim() && !subs.length && !audioLoaded) {
            toast('当前没有可保存的内容');
            return;
        }

        /* 1 音频字节：直接从缓存的 Blob 取，不二次编码 */
        let audioBytes = new Uint8Array(0);
        let audioMeta = null;

        if (audioLoaded && currentAudioBlob) {
            try {
                audioBytes = new Uint8Array(await currentAudioBlob.arrayBuffer());
                audioMeta = {
                    name: currentAudioName || '音频',
                    type: currentAudioBlob.type || 'audio/mpeg',
                    size: audioBytes.length
                };
            } catch (err) {
                console.warn('音频读取失败：', err);
                toast('音频读取失败，将只保存文本与设置');
                audioBytes = new Uint8Array(0);
                audioMeta = null;
            }
        }

        /* 2 JSON 头：原文 / 时间轴 / 设置 / 结构化字幕 / 音频元信息 */
        const data = {
            app: '字幕提词器',
            version: PROJECT_VERSION,
            savedAt: new Date().toISOString(),

            // 文本三件套
            rawText: rawTextDom.value,
            timeRule: timeRuleDom.value,

            // 结构化字幕 —— 直接存对象，载入时无需再解析文本，
            // 且能原样保留「已打点」标记，回放录制节拍不丢
            subs: subs,
            exportSubs: exportSubs,

            // 全部界面设置
            settings: {
                speed: speedInput.value,
                karaoke: karaokeToggle.checked,
                chapterSplit: chapterSplitCheck.checked,
                autoSplit: autoSplitCheck.checked,
                soundTap: soundTapCheck.checked,
                threshold: threshRange.value,
                size: sizeSelect.value,
                frameTitle: frameTitleInput.value,
                frameFooter: frameFooterInput.value,
                // 封面大标题
                coverTitle: coverTitleInput.value,
                coverSub: coverSubInput.value,
                coverOn: coverToggleCheck.checked,
                coverScale: coverScaleRange.value
            },

            audio: audioMeta
        };

        /* 3 打包并下载 */
        const blob = buildProjectArchive(data, audioBytes);

        const base = (frameTitleInput.value.trim() || '提词器项目')
            .slice(0, 24)
            .replace(/[\\/:*?"<>|\s]+/g, '_');
        const fileName = base + '_' + timestampTag() + PROJECT_EXT;

        downloadBlob(blob, fileName);

        currentProjectName = fileName;
        projectNameDom.textContent = fileName;
        projectNameDom.title = fileName;

        const sizeMB = (blob.size / 1048576).toFixed(2);
        toast('已保存项目：' + fileName + '（' + sizeMB + ' MB）');
    }

    /* ---------- 载入 ---------- */

    /**
     * 用归档里的结构化字幕还原时间轴。
     *
     * 返回 true 表示还原成功；返回 false 表示归档里没有可用字幕，
     * 调用方应回退到「解析时间轴文本」的常规流程。
     */
    function restoreTimelineFromProject(data) {
        const rawSubs = Array.isArray(data.subs) ? data.subs : null;
        if (!rawSubs || !rawSubs.length) return false;

        const list = [];
        for (const it of rawSubs) {
            if (!it) continue;
            const t = Number(it.time);
            const text = String(it.text == null ? '' : it.text).trim();
            if (!isFinite(t) || t < 0 || !text) continue;
            list.push({
                time: t,
                text: text,
                chapter: Math.max(0, parseInt(it.chapter, 10) || 0)
            });
        }
        if (!list.length) return false;

        // 章节分割关闭时，全部条目归入同一章节，与当前开关语义保持一致
        if (!chapterSplit) list.forEach((it) => { it.chapter = 0; });

        subs = list;

        // 校准轴：条目数对得上才采用，否则按「未打点」重建
        const rawExp = Array.isArray(data.exportSubs) ? data.exportSubs : null;
        if (rawExp && rawExp.length === list.length) {
            exportSubs = list.map((s, i) => {
                const e = rawExp[i] || {};
                const t = Number(e.time);
                return {
                    time: isFinite(t) && t >= 0 ? t : s.time,
                    text: s.text,
                    chapter: s.chapter,
                    tapped: !!e.tapped
                };
            });
        } else {
            exportSubs = list.map((s) => ({ ...s, tapped: false }));
        }

        curIdx = -1;
        curChapter = -1;
        lastActiveIdx = -1;
        baseTime = 0;
        isPlaying = false;
        isRecording = false;
        playbackSource = 'original';
        useVirtualClock = false;

        playBtn.textContent = '播放';
        recordBtn.textContent = '录制';
        recordBtn.style.background = 'rgba(220, 38, 38, 0.82)';
        currentTimeDom.querySelector('span:last-child').textContent = '00:00:00';
        updateTimeDisplayStyle();

        renderSubtitleBox();
        renderExport();
        updateProgressUI(0);
        updateStatusIndicator();
        return true;
    }

    async function loadProjectFile(file) {
        if (!file) return;

        let parsed;
        try {
            parsed = await parseProjectArchive(file);
        } catch (err) {
            console.warn('项目文件解析失败：', err);
            toast(err && err.message ? err.message : '项目文件解析失败');
            return;
        }

        const data = parsed.data || {};
        const st = data.settings || {};

        // 解析前先停掉一切正在进行的活动，避免状态打架
        stopAll();

        /* ---------- 1 设置：先落开关，再落数值，最后刷新联动 ---------- */
        if (typeof st.chapterSplit === 'boolean') chapterSplitCheck.checked = st.chapterSplit;
        if (typeof st.autoSplit === 'boolean') autoSplitCheck.checked = st.autoSplit;
        if (typeof st.karaoke === 'boolean') karaokeToggle.checked = st.karaoke;
        if (typeof st.soundTap === 'boolean') soundTapCheck.checked = st.soundTap;

        chapterSplit = chapterSplitCheck.checked;
        karaokeMode = karaokeToggle.checked;
        karaokeToggleLabel.classList.toggle('on', karaokeMode);

        if (st.speed != null) speedInput.value = st.speed;
        if (st.threshold != null) threshRange.value = st.threshold;
        applyThreshold(threshRange.value);

        if (st.size) {
            sizeSelect.value = st.size;
            // 选项不存在时回落到第一项，避免下拉框显示空白
            if (!sizeSelect.value) sizeSelect.selectedIndex = 0;
        }
        applySize(sizeSelect.value);

        if (typeof st.frameTitle === 'string') frameTitleInput.value = st.frameTitle;
        if (typeof st.frameFooter === 'string') frameFooterInput.value = st.frameFooter;
        applyFrameTitle(frameTitleInput.value);
        applyFrameFooter(frameFooterInput.value);

        // 封面大标题
        if (typeof st.coverTitle === 'string') coverTitleInput.value = st.coverTitle;
        if (typeof st.coverSub === 'string') coverSubInput.value = st.coverSub;
        if (typeof st.coverOn === 'boolean') coverToggleCheck.checked = st.coverOn;
        if (st.coverScale != null) coverScaleRange.value = st.coverScale;
        applyCoverScale();
        applyCover();

        /* ---------- 2 音频：有二进制就重建 Blob 接回播放器 ---------- */
        if (parsed.audioBytes && parsed.audioBytes.length) {
            const meta = data.audio || {};
            // slice() 复制成独立缓冲，避免与源文件共享内存
            const ab = parsed.audioBytes.slice();
            const blob = new Blob([ab], { type: meta.type || 'audio/mpeg' });
            openAudioBlob(blob, meta.name || '项目音频');
        } else if (audioLoaded) {
            // 项目里没有音频 → 清掉当前音频，保持与文件一致
            clearAudio();
        }

        /* ---------- 3 文本：原文 / 时间轴原样回填 ---------- */
        rawTextDom.value = typeof data.rawText === 'string' ? data.rawText : '';
        timeRuleDom.value = typeof data.timeRule === 'string' ? data.timeRule : '';

        /* ---------- 4 字幕：优先用归档里的结构化数据（能保留打点标记），
                             缺失时退回解析时间轴文本 ---------- */
        const restored = restoreTimelineFromProject(data);

        if (!restored) {
            if (timeRuleDom.value.trim()) {
                parseTimeRule({ silent: true });
            } else {
                // 归档里既没有结构化字幕、也没有时间轴文本 → 清空预览区
                subs = [];
                exportSubs = [];
                curIdx = -1;
                curChapter = -1;
                lastActiveIdx = -1;
                baseTime = 0;
                isPlaying = false;
                isRecording = false;
                playbackSource = 'original';
                useVirtualClock = false;

                playBtn.textContent = '播放';
                recordBtn.textContent = '录制';
                recordBtn.style.background = 'rgba(220, 38, 38, 0.82)';
                currentTimeDom.querySelector('span:last-child').textContent = '00:00:00';
                updateTimeDisplayStyle();

                renderSubtitleBox();
                renderExport();
                updateProgressUI(0);
                updateStatusIndicator();
            }
        }

        /* ---------- 5 收尾：记录项目名 + 复位滚动 ---------- */
        currentProjectName = file.name;
        projectNameDom.textContent = file.name;
        projectNameDom.title = file.name;

        subtitleBox.scrollTop = 0;
        resetVoiceDetect();

        const count = subs.length;
        toast('已载入项目：' + file.name + (count ? '（' + count + ' 条字幕）' : ''));
    }

    /* 录屏状态指示灯 */
    function updateStatusIndicator() {
        statusDot.className = 'status-dot';
        if (isRecording) {
            statusDot.classList.add('recording');
            statusText.textContent = '录制中';
        } else if (isPlaying) {
            statusDot.classList.add('playing');
            statusText.textContent = playbackSource === 'recording' ? '回放' : '播放';
        } else {
            statusDot.classList.add('idle');
            statusText.textContent = '待机';
        }
    }

    /* 17. 事件绑定 */
    sizeSelect.addEventListener('change', () => applySize(sizeSelect.value));
    autoGenBtn.addEventListener('click', autoGenerate);
    parseBtn.addEventListener('click', () => parseTimeRule());
    recordBtn.addEventListener('click', toggleRecord);
    playBtn.addEventListener('click', togglePlay);
    nextBtn.addEventListener('click', nextSub);
    playbackRecBtn.addEventListener('click', playbackRecording);
    resetBtn.addEventListener('click', resetAll);
    exportCopyBtn.addEventListener('click', copyExport);

    // 卡拉OK模式开关
    karaokeToggle.addEventListener('change', () => {
        karaokeMode = karaokeToggle.checked;
        karaokeToggleLabel.classList.toggle('on', karaokeMode);
        if (!karaokeMode) {
            // 关闭时清掉所有逐字高亮，恢复整句 / 整章节高亮
            clearAllLit();
        }
        toast(karaokeMode ? '卡拉OK模式：已开启，读过的整句保持紫色' : '卡拉OK模式：已关闭，恢复整句高亮');
    });

    // 章节分割开关：切换后立即按新语义重新解析时间轴
    chapterSplitCheck.addEventListener('change', () => {
        chapterSplit = chapterSplitCheck.checked;

        if (timeRuleDom.value.trim()) {
            // 原始时间轴里的空行仍在，重新解析即可得到新的章节结构
            parseTimeRule({ silent: true });
        }

        toast(chapterSplit
            ? '已开启：空行作为章节分割，整章节一起高亮放大'
            : '已关闭：忽略空行，全部字幕视为同一章节');
    });

    // 音频：打开文件
    audioFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) openAudioFile(file);
        // 允许重复选择同一个文件
        e.target.value = '';
    });

    audioClearBtn.addEventListener('click', clearAudio);

    threshRange.addEventListener('input', () => {
        applyThreshold(threshRange.value);
    });

    soundTapCheck.addEventListener('change', () => {
        if (soundTapCheck.checked) {
            if (!audioLoaded) {
                toast('请先【打开音频文件】');
                soundTapCheck.checked = false;
                return;
            }
            if (!audioAnalyser) {
                toast('音频分析不可用');
                soundTapCheck.checked = false;
                return;
            }
            resetVoiceDetect();
            toast('已开启声音自动打点，点【录制】开始');
        } else {
            resetVoiceDetect();
        }
    });

    // 录屏区标题实时同步
    frameTitleInput.addEventListener('input', () => {
        applyFrameTitle(frameTitleInput.value);
    });

    // 录屏区底部署名 / 版权实时同步
    frameFooterInput.addEventListener('input', () => {
        applyFrameFooter(frameFooterInput.value);
    });

    /* ---------- 封面大标题的事件绑定 ---------- */

    // 标题 / 副标题实时同步到录屏区
    coverTitleInput.addEventListener('input', applyCover);
    coverSubInput.addEventListener('input', applyCover);

    // 显隐开关：打开时若一个字都没填，给出提示
    coverToggleCheck.addEventListener('change', () => {
        if (coverToggleCheck.checked &&
            !coverTitleInput.value.trim() &&
            !coverSubInput.value.trim()) {
            toast('请先填写封面大标题');
        }
        applyCover();
    });

    // 字号缩放
    coverScaleRange.addEventListener('input', applyCoverScale);

    // 录屏区尺寸变化时重新推算字号基准
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(recomputeCoverBase).observe(recordFrame);
    }
    window.addEventListener('resize', recomputeCoverBase);

    /* ---------- 播放进度控制的事件绑定 ----------

       交互分三段，各司其职：

         1 pointerdown → isScrubbing = true
            主循环立刻停止回写进度条，把滑块交给手指。

         2 input       → 只刷新视觉（填充 + 时间文字），不跳转。
            拖动过程中高频触发，若每次都写 audioEl.currentTime
            会造成爆音与卡顿，所以这里只做预览。

         3 change / pointerup → 真正执行 seekTo()
            · change 覆盖「键盘方向键 / 点击轨道跳转」等场景
            · window.pointerup 兜底「手指拖到滑块外面才松开」
              的情形，避免 isScrubbing 卡在 true 导致进度条冻结

       seekTo 内部会把 isScrubbing 复位，两者重复触发也无副作用
       （第二次只是把播放头再写一遍同一个值）。 ---------- */

    progressRange.addEventListener('pointerdown', () => {
        isScrubbing = true;
    });

    progressRange.addEventListener('input', () => {
        isScrubbing = true;
        previewProgressUI(parseInt(progressRange.value, 10) / 1000);
    });

    progressRange.addEventListener('change', () => {
        const total = getTotalDuration();
        seekTo((parseInt(progressRange.value, 10) / 1000) * total);
        isScrubbing = false;
    });

    window.addEventListener('pointerup', () => {
        if (!isScrubbing) return;
        const total = getTotalDuration();
        seekTo((parseInt(progressRange.value, 10) / 1000) * total);
        isScrubbing = false;
    });

    // 键盘操作进度条（方向键微调 / Home / End）：兼容无指针场景
    progressRange.addEventListener('keyup', () => {
        const total = getTotalDuration();
        seekTo((parseInt(progressRange.value, 10) / 1000) * total);
    });

    // 项目文件：打开
    projectOpenInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) loadProjectFile(file);
        // 允许重复选择同一个文件
        e.target.value = '';
    });

    // 项目文件：保存
    projectSaveBtn.addEventListener('click', () => {
        saveProject().catch((err) => {
            console.warn('项目保存失败：', err);
            toast('项目保存失败');
        });
    });

    // 空格 = 下一句（输入框 / 下拉 / 按钮内不拦截）
    document.addEventListener('keydown', (e) => {
        const tag = (e.target.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;

        if (e.code === 'Space' || e.key === ' ') {
            e.preventDefault();
            nextSub();
        }
    });

    /* 18. 输入框折叠 / 展开
           通用逻辑：点击带有 data-target 的 .fold-btn，
           切换目标元素的 .collapsed 类，同步按钮文本与 aria-expanded。
           注意：初始状态若带 .collapsed，HTML 中按钮文本与 aria 必须
           与之一致（例如原始时间轴 / 校准输出块默认折叠，
           按钮文本为"展开"、aria-expanded 为 "false"）。

           本工具目前共有 4 组折叠：
             · #topFoldArea          —— 原文输入 & 基础开关（默认展开）
             · #recordStyleFoldArea  —— 录屏区外观（尺寸 / 标题 / 署名 / 封面，默认折叠）
             · #timeRuleBlock        —— 原始时间轴（默认折叠）
             · #exportTimeRuleBlock  —— 校准输出（默认折叠）
           所有分组共用这一处事件处理器，新增分组无需再写 JS。 */
    document.querySelectorAll('.fold-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = btn.getAttribute('data-target');
            const block = targetId ? document.getElementById(targetId) : null;
            if (!block) return;

            const collapsed = block.classList.toggle('collapsed');
            btn.textContent = collapsed ? '展开' : '收起';
            btn.setAttribute('aria-expanded', String(!collapsed));
        });
    });

    /* 19. 初始化 */
    chapterSplit = chapterSplitCheck.checked;
    applySize(sizeSelect.value);
    applyFrameTitle(frameTitleInput.value);
    applyFrameFooter(frameFooterInput.value);
    applyThreshold(threshRange.value);
    applyCover();
    recomputeCoverBase();
    updateTimeDisplayStyle();
    updateStatusIndicator();
    progressRange.style.background = buildProgressBg(0);
    progressTimeDom.textContent = '00:00:00 / 00:00:00';
    projectNameDom.textContent = '未选择项目';
})();