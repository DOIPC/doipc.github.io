/* =========================================================
   背景特效：太阳系星球 + 科技感粒子星云 + 暗黑激光
   —— 独立于主逻辑，只画在 #bgCanvas 上，不干扰任何 UI 交互
   —— 星球层位于星云 / 粒子 / 激光之下
   —— 整个太阳系像星云一样在背景中缓慢随机漂移
   ========================================================= */
(function backgroundFX() {
    'use strict';

    const canvas = document.getElementById('bgCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0, H = 0, DPR = 1;
    let particles = [];
    let orbs = [];
    let beams = [];
    let rafId = null;
    let lastTs = 0;
    let beamTimer = 1.2;

    const LINK_DIST = 132;              // 粒子连线距离
    const HUES = [190, 200, 210, 220, 265, 285]; // 青 / 蓝 / 紫

    const rand = (a, b) => a + Math.random() * (b - a);
    const pickHue = () => HUES[(Math.random() * HUES.length) | 0];

    /* 20.0 太阳系星球系统（整体在背景中缓慢随机漂移） */
    const SOLAR = {
        cx: 0,                                     // 当前像素坐标（每帧由漂移逻辑更新）
        cy: 0,
        rx: rand(0.34, 0.66),                      // 太阳系中心的相对位置（0~1）
        ry: rand(0.34, 0.66),
        driftAngle: Math.random() * Math.PI * 2,   // 漂移方向
        driftTurn: rand(-0.04, 0.04),              // 转向速率（弧度/秒）
        driftSpeedPct: rand(0.008, 0.018),         // 漂移速度（占屏幕短边比例/秒）
        maxR: 0,                                   // 最外层轨道半径（屏幕像素）
        sunR: 20,
        squash: 0.42,                              // 轨道椭圆纵向压扁比（俯视倾角）
        time: 0,
        bodies: []
    };

    // 球面均匀取点（用于星球表面斑块 / 云层）
    function spherePoint() {
        const y = Math.random() * 2 - 1;
        const t = Math.random() * Math.PI * 2;
        const s = Math.sqrt(Math.max(0, 1 - y * y));
        return { x: s * Math.cos(t), y: y, z: s * Math.sin(t) };
    }

    // 行星定义（周期单位为秒，半径是 maxR 的比例）
    const PLANET_DEFS = [
        {
            id: 'mercury',
            orbitR: 0.165, period: 34, radius: 0.0115, spinPeriod: 9,
            light: '#ded5c8', base: '#9a9088', dark: '#49423b', deep: '#15130f',
            spots: { n: 20, color: 'rgba(58,52,46,0.55)', size: 0.30 }
        },
        {
            id: 'venus',
            orbitR: 0.255, period: 54, radius: 0.0180, spinPeriod: 22,
            light: '#fff7dc', base: '#e3cd8e', dark: '#8b7238', deep: '#33280f',
            glow: '255,232,168',
            spots: { n: 12, color: 'rgba(255,246,206,0.30)', size: 0.55 }
        },
        {
            id: 'earth',
            orbitR: 0.370, period: 78, radius: 0.0200, spinPeriod: 7,
            light: '#d6ecff', base: '#2d6cbb', dark: '#123a6b', deep: '#061428',
            glow: '110,180,255',
            spots: { n: 15, color: 'rgba(86,150,92,0.90)', size: 0.44 },
            clouds: { n: 11, color: 'rgba(255,255,255,0.30)', size: 0.34 },
            moon: { orbitR: 2.9, period: 15, radius: 0.30 }
        },
        {
            id: 'mars',
            orbitR: 0.480, period: 118, radius: 0.0145, spinPeriod: 8,
            light: '#ffd6b8', base: '#bf4f2c', dark: '#6a2412', deep: '#250a04',
            glow: '255,130,80',
            spots: { n: 16, color: 'rgba(255,240,230,0.24)', size: 0.30 }
        },
        {
            id: 'jupiter',
            orbitR: 0.680, period: 200, radius: 0.0385, spinPeriod: 4,
            light: '#fff0da', base: '#c8a67c', dark: '#7a5a3c', deep: '#2a1d12',
            glow: '255,222,176',
            bands: [
                { y: -0.94, h: 0.15, c: 'rgba(214,196,168,0.60)' },
                { y: -0.76, h: 0.20, c: 'rgba(240,226,200,0.82)' },
                { y: -0.55, h: 0.22, c: 'rgba(188,152,112,0.72)' },
                { y: -0.33, h: 0.20, c: 'rgba(244,232,208,0.85)' },
                { y: -0.11, h: 0.22, c: 'rgba(200,164,122,0.72)' },
                { y: 0.11, h: 0.22, c: 'rgba(246,234,212,0.85)' },
                { y: 0.33, h: 0.20, c: 'rgba(182,144,104,0.72)' },
                { y: 0.55, h: 0.22, c: 'rgba(232,216,188,0.80)' },
                { y: 0.76, h: 0.20, c: 'rgba(196,160,120,0.68)' },
                { y: 0.94, h: 0.15, c: 'rgba(176,146,110,0.55)' }
            ],
            greatSpot: { y: 0.34, size: 0.36, color: 'rgba(198,110,74,0.78)' }
        },
        {
            id: 'saturn',
            orbitR: 0.880, period: 290, radius: 0.0325, spinPeriod: 5,
            light: '#fff6dd', base: '#d6bd88', dark: '#856a3c', deep: '#2e2211',
            glow: '255,236,190',
            bands: [
                { y: -0.90, h: 0.18, c: 'rgba(226,206,158,0.60)' },
                { y: -0.68, h: 0.22, c: 'rgba(244,230,190,0.80)' },
                { y: -0.44, h: 0.22, c: 'rgba(212,188,140,0.70)' },
                { y: -0.20, h: 0.22, c: 'rgba(248,238,204,0.82)' },
                { y: 0.04, h: 0.22, c: 'rgba(218,196,150,0.72)' },
                { y: 0.28, h: 0.22, c: 'rgba(246,234,198,0.80)' },
                { y: 0.52, h: 0.22, c: 'rgba(206,180,132,0.68)' },
                { y: 0.76, h: 0.20, c: 'rgba(234,216,172,0.72)' },
                { y: 0.94, h: 0.16, c: 'rgba(198,172,128,0.55)' }
            ],
            ring: { inner: 1.42, outer: 2.30, tilt: -0.30, squash: 0.34 }
        }
    ];

    function buildSolarBodies() {
        SOLAR.bodies = PLANET_DEFS.map((d) => {
            const b = Object.assign({}, d);
            b.angle = Math.random() * Math.PI * 2;
            b.spin = Math.random() * Math.PI * 2;
            b.omega = (Math.PI * 2) / d.period;
            b.spinOmega = (Math.PI * 2) / d.spinPeriod;

            b.spotList = [];
            if (d.spots) {
                for (let i = 0; i < d.spots.n; i++) {
                    b.spotList.push({
                        v: spherePoint(),
                        r: d.spots.size * rand(0.6, 1.4),
                        a: rand(0.5, 1)
                    });
                }
            }

            b.cloudList = [];
            if (d.clouds) {
                for (let i = 0; i < d.clouds.n; i++) {
                    b.cloudList.push({
                        v: spherePoint(),
                        r: d.clouds.size * rand(0.6, 1.5),
                        a: rand(0.45, 1)
                    });
                }
            }

            if (d.moon) {
                b.moon = Object.assign({}, d.moon);
                b.moon.angle = Math.random() * Math.PI * 2;
                b.moon.omega = (Math.PI * 2) / d.moon.period;
            }

            return b;
        });
    }

    function layoutSolar() {
        SOLAR.maxR = Math.min(W, H) * 0.36;
        SOLAR.sunR = Math.max(9, SOLAR.maxR * 0.062);
        SOLAR.cx = SOLAR.rx * W;
        SOLAR.cy = SOLAR.ry * H;
    }

    /* ---------- 整体漂移：让太阳系像星云一样在背景中缓慢游走 ---------- */
    function updateDrift(dt) {
        // 转向速率做小幅随机游走，路径呈自然弧线而非机械直线
        SOLAR.driftTurn += rand(-0.5, 0.5) * dt;
        if (SOLAR.driftTurn > 0.06) SOLAR.driftTurn = 0.06;
        else if (SOLAR.driftTurn < -0.06) SOLAR.driftTurn = -0.06;

        SOLAR.driftAngle += SOLAR.driftTurn * dt;

        let vx = Math.cos(SOLAR.driftAngle);
        let vy = Math.sin(SOLAR.driftAngle);

        const speedPx = SOLAR.driftSpeedPct * Math.min(W, H);   // 像素/秒
        SOLAR.rx += (vx * speedPx * dt) / W;
        SOLAR.ry += (vy * speedPx * dt) / H;

        // 柔和边界反弹，避免太阳系完全飘出画面
        const MINR = 0.16, MAXR = 0.84;
        let bounced = false;
        if (SOLAR.rx < MINR) { SOLAR.rx = MINR; vx = -vx; bounced = true; }
        else if (SOLAR.rx > MAXR) { SOLAR.rx = MAXR; vx = -vx; bounced = true; }
        if (SOLAR.ry < MINR) { SOLAR.ry = MINR; vy = -vy; bounced = true; }
        else if (SOLAR.ry > MAXR) { SOLAR.ry = MAXR; vy = -vy; bounced = true; }

        if (bounced) {
            SOLAR.driftAngle = Math.atan2(vy, vx);
            SOLAR.driftTurn = rand(-0.04, 0.04);   // 反弹后随机换向，避免固定折返
        }

        SOLAR.cx = SOLAR.rx * W;
        SOLAR.cy = SOLAR.ry * H;
    }

    function updateSolar(dt) {
        SOLAR.time += dt;
        updateDrift(dt);                            // 整体漂移
        for (const b of SOLAR.bodies) {
            b.angle += b.omega * dt;
            b.spin += b.spinOmega * dt;
            if (b.moon) b.moon.angle += b.moon.omega * dt;
        }
    }

    /* ---------- 太阳 ---------- */
    function drawSun(x, y, r) {
        const t = SOLAR.time;
        const pulse = 1 + Math.sin(t * 0.62) * 0.035;
        const R = r * pulse;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // 外层日冕
        let g = ctx.createRadialGradient(x, y, R * 0.7, x, y, R * 10);
        g.addColorStop(0, 'rgba(255,208,128,0.26)');
        g.addColorStop(0.22, 'rgba(255,152,64,0.10)');
        g.addColorStop(0.55, 'rgba(255,110,40,0.035)');
        g.addColorStop(1, 'rgba(255,90,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, R * 10, 0, Math.PI * 2);
        ctx.fill();

        // 光球
        g = ctx.createRadialGradient(
            x - R * 0.14, y - R * 0.14, R * 0.04,
            x, y, R * 1.02
        );
        g.addColorStop(0, 'rgba(255,255,248,1)');
        g.addColorStop(0.34, 'rgba(255,238,176,1)');
        g.addColorStop(0.72, 'rgba(255,190,84,1)');
        g.addColorStop(1, 'rgba(255,142,42,0.94)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fill();

        // 缓慢旋转的日珥光斑
        for (let i = 0; i < 3; i++) {
            const a = t * (0.16 + i * 0.05) + i * 2.1;
            const rr = R * (0.55 + 0.3 * Math.sin(t * 0.4 + i));
            const px = x + Math.cos(a) * R * 0.5;
            const py = y + Math.sin(a) * R * 0.5;
            const gg = ctx.createRadialGradient(px, py, 0, px, py, rr);
            gg.addColorStop(0, 'rgba(255,246,200,0.30)');
            gg.addColorStop(1, 'rgba(255,200,90,0)');
            ctx.fillStyle = gg;
            ctx.beginPath();
            ctx.arc(px, py, rr, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    /* ---------- 星球通用绘制 ---------- */
    function drawPlanet(b, x, y, r) {
        if (r < 0.7) return;

        // 指向太阳的方向（受光方向）
        let dx = SOLAR.cx - x, dy = SOLAR.cy - y;
        const dl = Math.hypot(dx, dy) || 1;
        const ux = dx / dl, uy = dy / dl;

        // —— 大气辉光 ——
        if (b.glow) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const gg = ctx.createRadialGradient(x, y, r * 0.88, x, y, r * 2.2);
            gg.addColorStop(0, 'rgba(' + b.glow + ',0.30)');
            gg.addColorStop(0.45, 'rgba(' + b.glow + ',0.09)');
            gg.addColorStop(1, 'rgba(' + b.glow + ',0)');
            ctx.fillStyle = gg;
            ctx.beginPath();
            ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.clip();

        // 基础球体（斜向光照，制造体积感）
        const base = ctx.createRadialGradient(
            x + ux * r * 0.62, y + uy * r * 0.62, r * 0.04,
            x + ux * r * 0.15, y + uy * r * 0.15, r * 1.38
        );
        base.addColorStop(0, b.light);
        base.addColorStop(0.32, b.base);
        base.addColorStop(0.70, b.dark);
        base.addColorStop(1, b.deep);
        ctx.fillStyle = base;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);

        // 表面纹理
        if (b.bands) drawBands(b, x, y, r);
        if (b.spotList && b.spotList.length) {
            drawSurfaceSpots(b.spotList, b.spots.color, b.spin, x, y, r);
        }
        if (b.cloudList && b.cloudList.length) {
            drawSurfaceSpots(b.cloudList, b.clouds.color, b.spin * 1.18, x, y, r);
        }

        // 光照阴影层（multiply 让纹理一起变暗，保持体积感）
        ctx.globalCompositeOperation = 'multiply';
        const shade = ctx.createRadialGradient(
            x + ux * r * 0.62, y + uy * r * 0.62, r * 0.02,
            x + ux * r * 0.12, y + uy * r * 0.12, r * 1.46
        );
        shade.addColorStop(0, 'rgba(255,255,255,1)');
        shade.addColorStop(0.34, 'rgba(206,206,214,1)');
        shade.addColorStop(0.70, 'rgba(104,104,116,1)');
        shade.addColorStop(1, 'rgba(42,42,54,1)');
        ctx.fillStyle = shade;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over';

        ctx.restore();
    }

    // 球面斑块（大陆 / 云层）
    function drawSurfaceSpots(list, color, spin, x, y, r) {
        const cs = Math.cos(spin), sn = Math.sin(spin);
        ctx.fillStyle = color;
        for (const s of list) {
            const vx = s.v.x, vy = s.v.y, vz = s.v.z;
            const X = vx * cs + vz * sn;
            const Z = -vx * sn + vz * cs;
            if (Z <= 0.02) continue;

            const persp = Math.sqrt(Z);
            const rad = s.r * r * (0.42 + 0.58 * persp);
            if (rad < 0.28) continue;

            const px = x + X * r;
            const py = y + vy * r;

            ctx.globalAlpha = s.a * Math.min(1, Z * 1.8) * 0.92;
            ctx.beginPath();
            ctx.ellipse(px, py, rad * (0.55 + 0.45 * persp), rad, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // 气态行星条带
    function drawBands(b, x, y, r) {
        for (const bd of b.bands) {
            const halfW = Math.sqrt(Math.max(0, 1 - bd.y * bd.y)) * r * 1.04;
            const hh = bd.h * r * 0.58;
            ctx.fillStyle = bd.c;
            ctx.beginPath();
            ctx.ellipse(x, y + bd.y * r, halfW, hh, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        if (b.greatSpot) {
            const gs = b.greatSpot;
            const sx = x + Math.sin(b.spin * 0.55) * r * 0.52;
            const sy = y + gs.y * r;
            const sr = gs.size * r;
            ctx.fillStyle = gs.color;
            ctx.beginPath();
            ctx.ellipse(sx, sy, sr, sr * 0.58, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ---------- 土星环（分前后两半） ---------- */
    function drawRingHalf(b, x, y, r, front) {
        const rg = b.ring;
        const rIn = rg.inner * r;
        const rOut = rg.outer * r;
        const N = 14;
        const a0 = front ? 0 : Math.PI;
        const a1 = front ? Math.PI : Math.PI * 2;

        ctx.save();
        ctx.translate(x, y);
        for (let i = 0; i < N; i++) {
            const rr = rIn + (rOut - rIn) * ((i + 0.5) / N);
            const alpha = 0.07 + 0.30 * Math.abs(Math.sin(i * 2.1 + 0.7));
            ctx.strokeStyle = 'rgba(226,206,166,' + alpha.toFixed(3) + ')';
            ctx.lineWidth = Math.max(0.6, (rOut - rIn) / N * 1.05);
            ctx.beginPath();
            ctx.ellipse(0, 0, rr, rr * rg.squash, rg.tilt, a0, a1);
            ctx.stroke();
        }
        ctx.restore();
    }

    /* ---------- 月球 ---------- */
    function drawMoonSpot(m) {
        const r = m.r;
        if (r < 0.5) return;

        let dx = SOLAR.cx - m.x, dy = SOLAR.cy - m.y;
        const dl = Math.hypot(dx, dy) || 1;
        const ux = dx / dl, uy = dy / dl;

        ctx.save();
        ctx.beginPath();
        ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        ctx.clip();

        ctx.fillStyle = '#b7b2aa';
        ctx.fillRect(m.x - r, m.y - r, r * 2, r * 2);

        ctx.globalCompositeOperation = 'multiply';
        const g = ctx.createRadialGradient(
            m.x + ux * r * 0.6, m.y + uy * r * 0.6, 0,
            m.x, m.y, r * 1.45
        );
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.48, 'rgba(150,150,150,1)');
        g.addColorStop(1, 'rgba(34,34,40,1)');
        ctx.fillStyle = g;
        ctx.fillRect(m.x - r, m.y - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over';

        ctx.restore();
    }

    /* ---------- 单个行星（含月球前后遮挡） ---------- */
    function drawBody(b) {
        const r = b.radius * SOLAR.maxR;
        if (r < 0.7) return;

        const x = b.px, y = b.py;

        let moon = null;
        if (b.moon) {
            const mr = b.moon.orbitR * r;
            const mx = x + Math.cos(b.moon.angle) * mr;
            const my = y + Math.sin(b.moon.angle) * mr * 0.5;
            moon = {
                x: mx,
                y: my,
                r: Math.max(1, r * b.moon.radius),
                front: Math.sin(b.moon.angle) >= 0
            };
        }

        if (moon && !moon.front) drawMoonSpot(moon);
        if (b.ring) drawRingHalf(b, x, y, r, false);
        drawPlanet(b, x, y, r);
        if (b.ring) drawRingHalf(b, x, y, r, true);
        if (moon && moon.front) drawMoonSpot(moon);
    }

    /* ---------- 绘制整个太阳系 ---------- */
    function drawSolar() {
        const R = SOLAR.maxR;
        if (R <= 0) return;

        const cx = SOLAR.cx, cy = SOLAR.cy;

        // 1) 轨道线（极淡）
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(130,185,255,0.05)';
        for (const b of SOLAR.bodies) {
            const a = b.orbitR * R;
            ctx.beginPath();
            ctx.ellipse(cx, cy, a, a * SOLAR.squash, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();

        // 2) 计算屏幕位置，按深度分组（sin<0 在太阳后方）
        const behind = [], front = [];
        for (const b of SOLAR.bodies) {
            const a = b.orbitR * R;
            b.px = cx + Math.cos(b.angle) * a;
            b.py = cy + Math.sin(b.angle) * a * SOLAR.squash;
            (Math.sin(b.angle) < 0 ? behind : front).push(b);
        }
        behind.sort((p, q) => Math.sin(p.angle) - Math.sin(q.angle));
        front.sort((p, q) => Math.sin(p.angle) - Math.sin(q.angle));

        // 3) 太阳后方的行星 → 太阳 → 太阳前方的行星
        for (const b of behind) drawBody(b);
        drawSun(cx, cy, SOLAR.sunR);
        for (const b of front) drawBody(b);
    }

    /* 20.1 星云 / 粒子 / 激光 */

    /* --- 发光精灵缓存（避免每帧创建 radialGradient，省性能） --- */
    const spriteCache = new Map();
    function getSprite(hue) {
        if (spriteCache.has(hue)) return spriteCache.get(hue);
        const size = 64;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const cx = c.getContext('2d');
        const g = cx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, `hsla(${hue}, 100%, 78%, 1)`);
        g.addColorStop(0.22, `hsla(${hue}, 100%, 66%, 0.42)`);
        g.addColorStop(1, `hsla(${hue}, 100%, 60%, 0)`);
        cx.fillStyle = g;
        cx.fillRect(0, 0, size, size);
        spriteCache.set(hue, c);
        return c;
    }

    /* --- 尺寸 & 重建 --- */
    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth;
        H = window.innerHeight;

        canvas.width = Math.floor(W * DPR);
        canvas.height = Math.floor(H * DPR);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

        buildParticles();
        buildOrbs();
        layoutSolar();
    }

    /* 星星数量：面积系数 10500，上限 260 */
    function buildParticles() {
        const count = Math.round(Math.min(260, Math.max(70, (W * H) / 10500)));
        particles = [];
        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * W,
                y: Math.random() * H,
                vx: rand(-12, 12),
                vy: rand(-12, 12),
                r: rand(0.55, 1.9),
                hue: pickHue(),
                a: rand(0.28, 0.85),
                pulse: rand(0, Math.PI * 2),
                pulseSpeed: rand(0.5, 1.7)
            });
        }
    }

    function buildOrbs() {
        orbs = [];
        const minSide = Math.min(W, H);
        for (let i = 0; i < 4; i++) {
            orbs.push({
                x: Math.random() * W,
                y: Math.random() * H,
                r: rand(minSide * 0.28, minSide * 0.6),
                hue: pickHue(),
                vx: rand(-7, 7),
                vy: rand(-7, 7),
                a: rand(0.05, 0.11)
            });
        }
    }

    /* --- 绘制：星云光斑 --- */
    function drawOrbs(dt) {
        ctx.globalCompositeOperation = 'lighter';
        for (const o of orbs) {
            o.x += o.vx * dt;
            o.y += o.vy * dt;

            if (o.x < -o.r) o.x = W + o.r;
            else if (o.x > W + o.r) o.x = -o.r;
            if (o.y < -o.r) o.y = H + o.r;
            else if (o.y > H + o.r) o.y = -o.r;

            const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
            g.addColorStop(0, `hsla(${o.hue}, 90%, 58%, ${o.a})`);
            g.addColorStop(1, `hsla(${o.hue}, 90%, 58%, 0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
    }

    /* --- 绘制：粒子连线（粒子变多后整体调淡，避免糊成一片） --- */
    function drawLinks() {
        const n = particles.length;
        ctx.lineWidth = 0.8;
        for (let i = 0; i < n; i++) {
            const p = particles[i];
            for (let j = i + 1; j < n; j++) {
                const q = particles[j];
                const dx = p.x - q.x;
                const dy = p.y - q.y;
                const d2 = dx * dx + dy * dy;
                if (d2 > LINK_DIST * LINK_DIST) continue;

                const d = Math.sqrt(d2);
                const alpha = (1 - d / LINK_DIST) * 0.14;
                ctx.strokeStyle = `hsla(${(p.hue + q.hue) >> 1}, 90%, 66%, ${alpha})`;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
                ctx.stroke();
            }
        }
    }

    /* --- 绘制：粒子本体 --- */
    function drawParticles(dt) {
        ctx.globalCompositeOperation = 'lighter';
        for (const p of particles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            if (p.x < -30) p.x = W + 30;
            else if (p.x > W + 30) p.x = -30;
            if (p.y < -30) p.y = H + 30;
            else if (p.y > H + 30) p.y = -30;

            p.pulse += p.pulseSpeed * dt;
            const tw = 0.62 + 0.38 * Math.sin(p.pulse);
            const alpha = p.a * tw;
            const r = p.r * (0.9 + 0.3 * tw);

            // 光晕
            const glowR = r * 6;
            ctx.globalAlpha = alpha * 0.85;
            ctx.drawImage(getSprite(p.hue), p.x - glowR, p.y - glowR, glowR * 2, glowR * 2);
            ctx.globalAlpha = 1;

            // 核心亮点
            ctx.fillStyle = `hsla(${p.hue}, 100%, 90%, ${alpha})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
    }

    /* --- 激光束 --- */
    function spawnBeam() {
        const dir = Math.random() < 0.5 ? 1 : -1;
        const speed = rand(720, 1450);
        const tilt = rand(-0.26, 0.26);
        const vx = Math.cos(tilt) * speed * dir;
        const vy = Math.sin(tilt) * speed * dir;
        return {
            x: dir === 1 ? -180 : W + 180,
            y: rand(H * 0.05, H * 0.95),
            vx: vx,
            vy: vy,
            // 用 atan2 反算真实运动方向，保证拖尾永远在身后
            angle: Math.atan2(vy, vx),
            len: rand(150, 330),
            w: rand(1, 2.2),
            hue: pickHue(),
            t: 0,
            ttl: rand(2.0, 3.4)
        };
    }

    function drawBeams(dt) {
        beamTimer -= dt;
        if (beamTimer <= 0) {
            beamTimer = rand(1.8, 4.6);
            beams.push(spawnBeam());
            if (Math.random() < 0.32) beams.push(spawnBeam());
        }
        if (beams.length > 6) beams.splice(0, beams.length - 6);

        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';

        for (let i = beams.length - 1; i >= 0; i--) {
            const b = beams[i];
            b.t += dt;
            b.x += b.vx * dt;
            b.y += b.vy * dt;

            const prog = b.t / b.ttl;
            if (prog >= 1) {
                beams.splice(i, 1);
                continue;
            }

            // 淡入淡出
            const fade = prog < 0.2 ? prog / 0.2 : 1 - (prog - 0.2) / 0.8;
            const alpha = Math.max(0, fade) * 0.85;

            const tailX = b.x - Math.cos(b.angle) * b.len;
            const tailY = b.y - Math.sin(b.angle) * b.len;

            const grad = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
            grad.addColorStop(0, `hsla(${b.hue}, 100%, 65%, 0)`);
            grad.addColorStop(0.65, `hsla(${b.hue}, 100%, 70%, ${alpha * 0.45})`);
            grad.addColorStop(1, `hsla(${b.hue}, 100%, 90%, ${alpha})`);

            ctx.strokeStyle = grad;
            ctx.lineWidth = b.w;
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();

            // 光束头部光晕
            const glowR = 28;
            ctx.globalAlpha = alpha * 0.7;
            ctx.drawImage(getSprite(b.hue), b.x - glowR, b.y - glowR, glowR * 2, glowR * 2);
            ctx.globalAlpha = 1;
        }

        ctx.globalCompositeOperation = 'source-over';
    }

    /* --- 主循环：星球在最底层，星云 / 粒子 / 激光依次叠加 --- */
    function frame(ts) {
        rafId = requestAnimationFrame(frame);

        if (!lastTs) lastTs = ts;
        let dt = (ts - lastTs) / 1000;
        lastTs = ts;
        if (dt > 0.05) dt = 0.05;          // 切回标签页时防止大跳
        if (reduceMotion) dt *= 0.35;

        ctx.clearRect(0, 0, W, H);          // 透出 body 的深色渐变底

        // 太阳系星球（叠加在星云后面，整体缓慢漂移）
        updateSolar(dt);
        drawSolar();

        // 星云光斑
        drawOrbs(dt);
        // 粒子连线
        drawLinks();
        // 粒子本体
        drawParticles(dt);
        // 激光束
        drawBeams(dt);
    }

    /* --- 暂停 / 恢复（省电） --- */
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            lastTs = 0;
        } else if (rafId === null) {
            rafId = requestAnimationFrame(frame);
        }
    });

    /* --- 窗口尺寸变化（防抖重建） --- */
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 150);
    });

    /* --- 启动 --- */
    resize();
    buildSolarBodies();
    rafId = requestAnimationFrame(frame);
})();