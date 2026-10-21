/*!
 * MotionKit v1.0.0 — 3D 網頁遊戲「鏡頭體感偵測」共用模組（單檔、無需打包）
 *
 * 功能：
 *  1. 自動偵測與校正精靈：相機/光線 → 人體定位 → 站姿基準 → 左右移動範圍 → 踏步/跳躍/揮手測試 → 品質評分
 *  2. 雙後端：MediaPipe Pose（骨架）為主；載入失敗或太慢時自動改用「動態偵測」（畫面差分，含自適應雜訊門檻）
 *  3. 動作辨識（皆以「身體尺寸」做比例，距離遠近不影響）：
 *     腳步 step / 高抬腿 highKnee / 踢腿 kick / 跳躍 jump / 蹲下 squat / 左右跑道 lane
 *     出拳 punch / 揮手 wave / 揮掃 swipe / 拍手 clap / 雙手高舉 handsUp / 張開雙臂 armsWide
 *  4. 連續數值：雙手位置與能量、步頻 cadence、身體左右位移 lx
 *
 * 最小用法：
 *   const kit = MotionKit.create({ video, canvas, lanes: 3 });
 *   kit.on('step', () => ...); kit.on('jump', () => ...); kit.on('lane', e => e.lane);
 *   const r = await kit.start();   // 會跳出自動偵測精靈；r.ok / r.quality / r.backend
 *
 * 完整規範請見 MOTION_KIT_SPEC.md
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MotionKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const POSE_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404';

  /* ───────────── 小工具 ───────────── */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)]; };
  const std = a => { if (a.length < 2) return 0; const m = a.reduce((p, c) => p + c, 0) / a.length; return Math.sqrt(a.reduce((p, c) => p + (c - m) * (c - m), 0) / a.length); };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, ok: a.ok && b.ok });

  function loadScript(src, ms) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      const to = setTimeout(() => rej(new Error('script timeout')), ms || 15000);
      s.onload = () => { clearTimeout(to); res(); }; s.onerror = () => { clearTimeout(to); rej(new Error('script error')); };
      document.head.appendChild(s);
    });
  }

  class Emitter {
    constructor() { this._h = {}; }
    on(e, f) { (this._h[e] = this._h[e] || []).push(f); return () => this.off(e, f); }
    off(e, f) { this._h[e] = (this._h[e] || []).filter(x => x !== f); }
    emit(e, d) {
      (this._h[e] || []).slice().forEach(f => { try { f(d); } catch (err) { console.error('[MotionKit]', e, err); } });
      (this._h['*'] || []).slice().forEach(f => { try { f(e, d); } catch (_) { } });
    }
  }

  /* One-Euro 濾波：靜止時強力去抖，快速移動時幾乎無延遲 */
  class OneEuro {
    constructor(minCut, beta) { this.mc = minCut; this.b = beta; this.x = null; this.dx = 0; this.t = 0; }
    static a(c, dt) { const r = 2 * Math.PI * c * dt; return r / (r + 1); }
    f(v, t) {
      if (this.x === null) { this.x = v; this.t = t; return v; }
      const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
      this.dx += OneEuro.a(1, dt) * ((v - this.x) / dt - this.dx);
      this.x += OneEuro.a(this.mc + this.b * Math.abs(this.dx), dt) * (v - this.x);
      return this.x;
    }
    reset() { this.x = null; this.dx = 0; }
  }

  /* MediaPipe 關節索引（l=解剖學左；x 已鏡像，所以左側會出現在畫面左邊） */
  const IDX = { nose: 0, lsh: 11, rsh: 12, lel: 13, rel: 14, lwr: 15, rwr: 16, lpi: 17, rpi: 18, lin: 19, rin: 20, lhp: 23, rhp: 24, lkn: 25, rkn: 26, lan: 27, ran: 28, lft: 31, rft: 32 };
  const EXT = new Set(['lwr', 'rwr', 'lpi', 'rpi', 'lin', 'rin', 'lan', 'ran', 'lft', 'rft', 'lkn', 'rkn', 'lel', 'rel']);
  const BONES = [['lsh', 'rsh'], ['lsh', 'lel'], ['lel', 'lwr'], ['rsh', 'rel'], ['rel', 'rwr'], ['lsh', 'lhp'], ['rsh', 'rhp'], ['lhp', 'rhp'], ['lhp', 'lkn'], ['lkn', 'lan'], ['rhp', 'rkn'], ['rkn', 'ran'], ['lan', 'lft'], ['ran', 'rft']];

  function reversals(hist, amp) {
    let n = 0, dir = 0, ext = hist.length ? hist[0].x : 0;
    for (const p of hist) {
      const x = p.x;
      if (dir === 0) { if (x > ext + amp) { dir = 1; ext = x; } else if (x < ext - amp) { dir = -1; ext = x; } }
      else if (dir === 1) { if (x > ext) ext = x; else if (x < ext - amp) { n++; dir = -1; ext = x; } }
      else { if (x < ext) ext = x; else if (x > ext + amp) { n++; dir = 1; ext = x; } }
    }
    return n;
  }

  /* ═════════════════════════════════════════════════════════════
   *  PoseAnalyzer：骨架 → 動作（純邏輯，不依賴 DOM，可單獨測試/重播）
   * ═════════════════════════════════════════════════════════════ */
  class PoseAnalyzer {
    constructor(o, emit) {
      this.o = Object.assign({ lanes: 3, vis: 0.5, require: ['shoulders'] }, o);
      this.th = Object.assign({ laneTh: 0.8, laneHy: 0.25, stepTh: 0.10, kneeTh: 0.16, jumpTh: 0.16, squatTh: 0.22, punchV: 2.2, energyHi: 2.4 }, (o && o.thresholds) || {});
      this.emit = emit || function () { };
      this.reset();
    }
    reset() {
      this.filters = {}; this.last = 0; this.P = {}; this.cal = false; this.tm = 1; this.b = null; this.out = null;
      this.base = { hip: null, sh: null }; this.vy = 0; this.hipPrev = null; this.air = false; this.airT = 0; this.peak = 0;
      this.squat = false; this.sqT = 0; this.lane = (this.o.lanes - 1) >> 1; this.lx = 0;
      const leg = () => ({ ground: null, up: false, t: -1e9, pk: [0, 0] });
      this.leg = { l: leg(), r: leg() }; this.legT = -1e9; this.pend = [];
      const hand = () => ({ px: null, py: null, speed: 0, hist: [], punchT: -1e9, dz: 0, arm: 0 });
      this.hand = { l: hand(), r: hand() };
      this.cdT = {}; this.stepTimes = []; this.lastStepT = -1e9; this.lostT = 0; this.isLost = true;
      this.cxBuf = []; this.bounce = { mode: 'down', ext: 0, t: -1e9 }; this.rec = null; this.bs = null;
      this.combo = { d: [], up: 0, upOn: false, wide: 0, wideOn: false }; this.mi = 0; this.prevMI = null; this.still = false; this.sEst = 0; this.jit = 0.01;
    }
    tune(t) { Object.assign(this.th, t); }
    startRec(kinds) { this.rec = {}; kinds.forEach(k => this.rec[k] = []); }
    stopRec() { const r = this.rec; this.rec = null; return r || {}; }
    _cd(k, ms, t) { if (t - (this.cdT[k] || -1e9) < ms) return false; this.cdT[k] = t; return true; }

    /* 建立濾波後、已鏡像、單位一致（以畫面高度為 1）的身體點 */
    _body(lm, t, aspect) {
      const b = { aspect };
      for (const k in IDX) {
        const r = lm[IDX[k]];
        if (!r) { b[k] = { x: 0, y: 0, z: 0, v: 0, ok: false }; continue; }
        const v = r.visibility == null ? 1 : r.visibility;
        let x = (1 - r.x) * aspect, y = r.y;
        const inside = r.x > -0.03 && r.x < 1.03 && r.y > -0.03 && r.y < 1.03;
        if (v >= 0.3) {
          let f = this.filters[k];
          if (!f) { const bt = EXT.has(k) ? 8 : 2; f = this.filters[k] = { x: new OneEuro(1.4, bt), y: new OneEuro(1.4, bt) }; }
          x = f.x.f(x, t); y = f.y.f(y, t);
        } else if (this.filters[k]) { this.filters[k].x.reset(); this.filters[k].y.reset(); }
        b[k] = { x, y, z: (r.z || 0) * aspect, v, ok: v >= this.o.vis && inside };
      }
      b.shC = mid(b.lsh, b.rsh); b.hpC = mid(b.lhp, b.rhp);
      b.shRaw = lm[11] && lm[12] ? (lm[11].y + lm[12].y) / 2 : b.shC.y;
      b.shW = b.shC.ok ? dist(b.lsh, b.rsh) : 0;
      b.torso = b.shC.ok && b.hpC.ok ? dist(b.shC, b.hpC) : 0;
      b.cov = { head: b.nose.ok, shoulders: b.shC.ok, hands: b.lwr.ok || b.rwr.ok, hips: b.hpC.ok, knees: b.lkn.ok && b.rkn.ok, ankles: b.lan.ok && b.ran.ok };
      return b;
    }
    _S(b) {
      if (this.P.torso) return this.P.torso;
      const s = b.torso || (b.shW ? b.shW * 1.3 : 0);
      if (!s) return this.sEst || 0.25;
      this.sEst = this.sEst ? lerp(this.sEst, s, 0.05) : s; return this.sEst;
    }

    update(lm, t, aspect) {
      const dt = this.last ? clamp((t - this.last) / 1000, 0.005, 0.25) : 0.033; this.last = t;
      if (!lm) return this._noBody(t, null);
      const b = this.b = this._body(lm, t, aspect || 4 / 3);
      if (!this.o.require.every(k => b.cov[k])) return this._noBody(t, b);
      if (this.isLost) { this.isLost = false; this.emit('found', {}); }
      this.lostT = t;
      const S = this._S(b);
      const out = { t, tracking: true, backend: 'pose', cov: b.cov, S, calibrated: this.cal };
      this._base(b, dt, S);
      Object.assign(out, this._vert(b, t, dt, S));
      out.lx = this._lane(b, S, t); out.lane = this.lane;
      out.feet = this._legs(b, t, dt, S);
      out.hands = this._hands(b, t, dt, S);
      this._combos(b, out, t, dt, S);
      out.cadence = this._cadence(t);
      out.pose = this.squat ? 'squat' : this.air ? 'jump' : this.combo.upOn ? 'handsUp' : this.combo.wideOn ? 'armsWide' : 'stand';
      return this.out = out;
    }
    _noBody(t, b) {
      if (!this.isLost && t - this.lostT > 700) { this.isLost = true; this.emit('lost', {}); }
      return this.out = { t, tracking: false, backend: 'pose', cov: b ? b.cov : {} };
    }

    /* 基準收集（校正用）＋未校正時自動擷取站位中心 */
    _base(b, dt, S) {
      const cur = [b.shC.x, b.shC.y, b.lwr.x, b.lwr.y, b.rwr.x, b.rwr.y];
      if (this.prevMI) { let s = 0; for (let i = 0; i < cur.length; i++) s += Math.abs(cur[i] - this.prevMI[i]); this.mi = lerp(this.mi, s / cur.length / dt / S, 0.4); }
      this.prevMI = cur; this.still = this.mi < 0.45;
      const cx = b.hpC.ok ? (b.shC.x + b.hpC.x) / 2 : b.shC.x;
      if (this.bs && this.still) {
        const bs = this.bs; bs.n++; bs.cx.push(cx); bs.shY.push(b.shC.y);
        if (b.torso) bs.torso.push(b.torso); if (b.shW) bs.shW.push(b.shW);
        if (b.hpC.ok) bs.hipY.push(b.hpC.y);
        for (const s of ['l', 'r']) {
          const sh = b[s + 'sh'], el = b[s + 'el'], wr = b[s + 'wr'], h = b[s + 'hp'], k = b[s + 'kn'], a = b[s + 'an'];
          if (sh.ok && el.ok && wr.ok) bs.arm.push(dist(sh, el) + dist(el, wr));
          if (h.ok && k.ok) bs.thigh.push(k.y - h.y);
          if (k.ok && a.ok) bs.shin.push(dist(k, a));
          if (a.ok) bs['an' + s].push(a.y);
        }
      }
      if (!this.cal && this.P.cx0 == null && this.still) { this.cxBuf.push(cx); if (this.cxBuf.length > 20) this.cxBuf.shift(); if (this.cxBuf.length >= 20) this.P.cx0 = median(this.cxBuf); }
    }
    beginBase() { this.bs = { n: 0, cx: [], shY: [], hipY: [], torso: [], shW: [], arm: [], thigh: [], shin: [], anl: [], anr: [] }; }
    baseCount() { return this.bs ? this.bs.n : 0; }
    endBase() {
      const bs = this.bs; this.bs = null;
      if (!bs || bs.n < 10 || !bs.torso.length) return null;
      const P = this.P;
      P.torso = median(bs.torso); P.shW = median(bs.shW); P.cx0 = median(bs.cx);
      if (bs.arm.length) P.arm = median(bs.arm);
      if (bs.thigh.length) P.thigh = median(bs.thigh);
      if (bs.shin.length) P.shin = median(bs.shin);
      this.base.sh = median(bs.shY); if (bs.hipY.length) this.base.hip = median(bs.hipY);
      if (bs.anl.length) this.leg.l.ground = median(bs.anl); if (bs.anr.length) this.leg.r.ground = median(bs.anr);
      this.jit = (bs.hipY.length ? std(bs.hipY) : std(bs.shY)) / P.torso;
      const jA = std(bs.anl.concat(bs.anr)) / P.torso || 0;
      this.th.jumpTh = Math.max(this.th.jumpTh, 5 * this.jit);
      this.th.stepTh = Math.max(this.th.stepTh, 4 * jA);
      this.cal = true; this.cxBuf = [];
      return { torso: P.torso, jitter: this.jit, n: bs.n, legs: !!(bs.anl.length && bs.anr.length), arms: !!bs.arm.length };
    }

    /* 跳躍 / 蹲下 */
    _vert(b, t, dt, S) {
      const o = { rise: 0, air: this.air, squat: this.squat };
      if (!b.hpC.ok) return o;
      const th = this.th, tm = this.tm, hy = b.hpC.y, sy = b.shC.y;
      if (this.base.hip == null) { this.base.hip = hy; this.base.sh = sy; this.hipPrev = hy; }
      this.vy = lerp(this.vy, (hy - this.hipPrev) / dt, 0.5); this.hipPrev = hy;
      const rise = (this.base.hip - hy) / S, shRise = (this.base.sh - sy) / S;
      if (!this.air && rise > th.jumpTh * tm && -this.vy / S > 0.9 && shRise > 0.5 * rise && this._cd('jump', 650, t)) {
        this.air = true; this.airT = t; this.peak = rise;
        this.emit('jump', { power: clamp(rise / 0.4, 0, 1), rise });
      }
      if (this.air) {
        this.peak = Math.max(this.peak, rise);
        if ((rise < th.jumpTh * 0.35 * tm && t - this.airT > 120) || t - this.airT > 1100) {
          this.air = false; if (this.rec && this.rec.jump) this.rec.jump.push(this.peak); this.emit('land', {});
        }
      }
      const drop = -rise, ratio = b.torso && this.P.torso ? b.torso / this.P.torso : 1;
      if (!this.squat) {
        if (drop > th.squatTh && ratio > 0.65) { this.sqT += dt; if (this.sqT > 0.12) { this.squat = true; this.emit('squat', { depth: drop }); } } else this.sqT = 0;
      } else if (drop < 0.10) { this.squat = false; this.sqT = 0; this.emit('stand', {}); }
      if (!this.air && !this.squat && Math.abs(this.vy) / S < 0.35 && Math.abs(rise) < 0.2) {
        const k = 1 - Math.exp(-dt / 1.8); this.base.hip += (hy - this.base.hip) * k; this.base.sh += (sy - this.base.sh) * k;
      }
      o.rise = rise; o.air = this.air; o.squat = this.squat; return o;
    }

    /* 左右跑道（含遲滯，避免在邊界來回抖動） */
    _lane(b, S, t) {
      if (this.P.cx0 == null) return 0;
      const cx = b.hpC.ok ? (b.shC.x + b.hpC.x) / 2 : b.shC.x, lx = this.lx = (cx - this.P.cx0) / S;
      if (this.rec && this.rec.lx) this.rec.lx.push(lx);
      const N = this.o.lanes; if (N < 2) return lx;
      const bd = this.boundaries(), hy = this.th.laneHy / 2; let l = this.lane;
      while (l < N - 1 && lx > bd[l] + hy) l++;
      while (l > 0 && lx < bd[l - 1] - hy) l--;
      if (l !== this.lane) { this.lane = l; this.emit('lane', { lane: l, lx }); }
      return lx;
    }
    boundaries() {
      const N = this.o.lanes, th = this.th.laneTh; if (N === 2) return [0];
      const r = []; for (let i = 0; i < N - 1; i++) r.push(-th + i * (2 * th / (N - 2))); return r;
    }

    /* 腳步：踏步 / 高抬腿 / 踢腿（無腿部可見時改用身體上下彈跳） */
    _legs(b, t, dt, S) {
      const out = { left: null, right: null }, th = this.th, tm = this.tm; let any = false;
      for (const s of ['l', 'r']) {
        const h = b[s + 'hp'], k = b[s + 'kn'], a = b[s + 'an'], st = this.leg[s];
        const r = { tracked: false, lift: 0, knee: 0, up: st.up };
        if (a.ok) { st.ground = st.ground == null ? a.y : Math.max(a.y, st.ground - 0.05 * S * dt); r.lift = (st.ground - a.y) / S; r.tracked = true; }
        if (k.ok && h.ok) {
          const tv = k.y - h.y; if (!this.P.thigh) this.P.thigh = tv;
          r.knee = (this.P.thigh - tv) / S; r.tracked = true;
          if (r.knee < 0.05) this.P.thigh = lerp(this.P.thigh, tv, dt * 0.5);
        }
        if (r.tracked) {
          any = true;
          const upNow = r.lift > th.stepTh * tm || r.knee > th.kneeTh * tm;
          const downNow = r.lift < th.stepTh * tm * 0.5 && r.knee < th.kneeTh * tm * 0.5;
          if (!st.up && upNow) {
            st.up = true; st.pk = [r.lift, r.knee];
            if (t - st.t > 170 && t - this.lastStepT > 110) {
              const up = -this.vy / S; st.t = t;
              if (!this.air && up < 0.6) { if (up >= 0.25) this.pend.push({ t, s, lift: r.lift, knee: r.knee }); else this._step(t, s, r.lift, r.knee, 'legs'); }
            }
          } else if (st.up) {
            st.pk = [Math.max(st.pk[0], r.lift), Math.max(st.pk[1], r.knee)];
            if (downNow) { st.up = false; if (this.rec && this.rec.step) this.rec.step.push(st.pk.slice()); }
          }
          r.up = st.up;
          const tight = this.P.thigh || 0.3 * S;
          const kr = r.knee * S / tight;
          if (kr > 0.75 && !st.hk) { st.hk = true; this.emit('highKnee', { side: s === 'l' ? 'left' : 'right' }); } else if (kr < 0.5) st.hk = false;
          if (a.ok && k.ok && h.ok && this.P.shin && r.lift > 0.2 && a.y < k.y + 0.05 * S && Math.abs(a.x - k.x) > 0.35 * this.P.shin && this._cd('kick' + s, 450, t))
            this.emit('kick', { side: s === 'l' ? 'left' : 'right' });
        }
        out[s === 'l' ? 'left' : 'right'] = r;
      }
      if (this.pend.length) this.pend = this.pend.filter(p => { if (t - p.t < 90) return true; if (!this.air) this._step(t, p.s, p.lift, p.knee, 'legs'); return false; });
      if (any) this.legT = t;
      else if (t - this.legT > 600) this._bounce(b, t, S);
      out.source = any ? 'legs' : 'bounce';
      return out;
    }
    _step(t, s, lift, knee, src) {
      this.lastStepT = t; this.stepTimes.push(t);
      this.emit('step', { side: s === 'l' ? 'left' : 'right', power: Math.max(lift, knee), source: src, cadence: this._cadence(t) });
    }
    _bounce(b, t, S) {
      const y = this.bRaw = this.bRaw == null ? b.shRaw : lerp(this.bRaw, b.shRaw, 0.6), z = this.bounce, th = Math.max(0.05 * S, 0.006);
      if (z.mode === 'down') { if (y > z.ext) z.ext = y; else if (z.ext - y > th) { z.mode = 'up'; z.ext = y; if (t - z.t > 210) { z.t = t; this._step(t, this.stepTimes.length % 2 ? 'l' : 'r', 0, 0, 'bounce'); } } }
      else { if (y < z.ext) z.ext = y; else if (y - z.ext > th) { z.mode = 'down'; z.ext = y; } }
    }
    _cadence(t) {
      this.stepTimes = this.stepTimes.filter(x => t - x < 6000); const n = this.stepTimes.length;
      if (n < 3) return n * 10; return (n - 1) / ((this.stepTimes[n - 1] - this.stepTimes[0]) / 1000) * 60;
    }

    /* 雙手：位置 / 速度 / 能量 / 高度層級 / 出拳 / 揮手 / 揮掃 */
    _hands(b, t, dt, S) {
      const out = {}, th = this.th, tm = this.tm, noseY = b.nose.ok ? b.nose.y : b.shC.y - 0.7 * S;
      for (const s of ['l', 'r']) {
        const H = this.hand[s], sh = b[s + 'sh'], el = b[s + 'el'], wr = b[s + 'wr'], ip = b[s + 'in'], pk = b[s + 'pi'];
        const res = { tracked: false, x: 0, y: 0, rx: 0, ry: 0, speed: 0, energy: 0, level: 'low', ext: 0, waving: false };
        const name = s === 'l' ? 'left' : 'right';
        if (!(wr.ok && sh.ok)) { H.px = null; H.hist.length = 0; H.speed *= 0.8; out[name] = res; continue; }
        let x = wr.x, y = wr.y, w = 1;
        if (ip.ok) { x += ip.x * 0.6; y += ip.y * 0.6; w += 0.6; }
        if (pk.ok) { x += pk.x * 0.4; y += pk.y * 0.4; w += 0.4; }
        x /= w; y /= w;
        const armEst = el.ok ? dist(sh, el) + dist(el, wr) : 1.2 * S;
        const arm = this.P.arm || (H.arm = Math.max(armEst, (H.arm || armEst) * (1 - 0.02 * dt)));
        const qx = x - b.shC.x, qy = y - b.shC.y; // 相對身體的位置：全身移動不算手在動
        let sp = 0; if (H.px != null) sp = Math.hypot(qx - H.px, qy - H.py) / dt / S;
        H.px = qx; H.py = qy; H.speed = lerp(H.speed, sp, 0.55);
        H.fast = sp > th.punchV * tm ? (H.fast || 0) + 1 : 0; // 需連續 2 幀以上高速，濾掉單幀跳點
        const ext = dist(sh, { x, y }) / arm;
        res.tracked = true; res.x = x; res.y = y; res.speed = H.speed; res.ext = ext;
        res.energy = clamp((H.speed - 0.3) / (th.energyHi - 0.3), 0, 1);
        res.rx = clamp((x - b.shC.x) / (arm * 1.2), -1.2, 1.2); res.ry = clamp((b.shC.y - y) / (arm * 1.2), -1.2, 1.2);
        res.level = y < noseY - 0.1 * S ? 'over' : y < sh.y ? 'high' : (b.hpC.ok ? y < b.hpC.y : y < sh.y + S) ? 'mid' : 'low';
        if (this.rec && this.rec.hand) this.rec.hand.push(H.speed);
        H.hist.push({ t, x: qx, y: qy, e: ext }); while (H.hist.length && t - H.hist[0].t > 1300) H.hist.shift();
        const side = name, old = H.hist.find(p => t - p.t <= 300), extRise = old ? ext - old.e : 0;
        const dz = (sh.z - wr.z) / arm, ddz = (dz - H.dz) / dt; H.dz = dz;
        const raising = old && (old.y - qy) > 0.5 * arm && Math.abs(qx - old.x) < (old.y - qy); // 單純舉手不算出拳
        const punch = !raising && ((H.fast >= 2 && ext > 0.7 && (!b.hpC.ok || y < b.hpC.y)) || (extRise > 0.35 && ext > 0.85) || (dz > 0.5 && ddz > 2.5));
        if (punch && t - H.punchT > 330) { H.punchT = t; this.emit('punch', { side, power: clamp(H.speed / 5, 0.3, 1), speed: H.speed }); }
        if (res.level !== 'low' && reversals(H.hist, 0.18 * arm) >= 4) { res.waving = true; if (this._cd('wave' + s, 900, t)) this.emit('wave', { side }); }
        const p0 = H.hist.find(p => t - p.t <= 250);
        if (p0) { const dx = qx - p0.x; if (Math.abs(dx) > 0.9 * arm && Math.abs(qy - p0.y) < 0.6 * Math.abs(dx) && this._cd('swipe' + s, 400, t)) this.emit('swipe', { side, dir: dx > 0 ? 1 : -1 }); }
        out[name] = res;
      }
      return out;
    }

    /* 雙手組合動作：拍手 / 雙手高舉 / 張開雙臂 */
    _combos(b, out, t, dt, S) {
      const L = out.hands.left, R = out.hands.right, c = this.combo;
      if (L.tracked && R.tracked) {
        const d = Math.hypot(L.x - R.x, L.y - R.y) / S; c.d.push({ t, d }); while (c.d.length && t - c.d[0].t > 500) c.d.shift();
        const mx = Math.max.apply(null, c.d.map(p => p.d));
        if (d < 0.3 && mx > 0.8 && L.level !== 'low' && R.level !== 'low' && this._cd('clap', 450, t)) this.emit('clap', {});
        c.up = L.level === 'over' && R.level === 'over' ? c.up + dt : 0;
        const wide = Math.abs(b.lwr.y - b.lsh.y) < 0.4 * S && Math.abs(b.rwr.y - b.rsh.y) < 0.4 * S && L.ext > 0.8 && R.ext > 0.8 && (L.rx < -0.5 && R.rx > 0.5);
        c.wide = wide ? c.wide + dt : 0;
      } else { c.up = 0; c.wide = 0; c.d.length = 0; }
      if (c.up > 0.25 && !c.upOn) { c.upOn = true; this.emit('handsUp', {}); } else if (c.up === 0) c.upOn = false;
      if (c.wide > 0.4 && !c.wideOn) { c.wideOn = true; this.emit('armsWide', {}); } else if (c.wide === 0) c.wideOn = false;
    }
  }

  /* ═════════════════════════════════════════════════════════════
   *  MotionBackend：動態偵測備援（無 AI 模型時使用；自適應雜訊門檻）
   * ═════════════════════════════════════════════════════════════ */
  class MotionBackend {
    constructor() {
      this.w = 96; this.h = 72; this.cv = document.createElement('canvas'); this.cv.width = this.w; this.cv.height = this.h;
      this.cx = this.cv.getContext('2d', { willReadFrequently: true }); this.prev = null;
      this.noise = { l: [0.004, 0.002], r: [0.004, 0.002], c: [0.004, 0.002] }; this.learn = null; this.sm = { l: null, r: null };
      this.en = { l: 0, r: 0 }; this.stepArm = true; this.lastStep = 0; this.cool = { l: 0, r: 0 };
    }
    beginLearn() { this.learn = { l: [], r: [], c: [] }; }
    learnCount() { return this.learn ? this.learn.l.length : 0; }
    endLearn() { const L = this.learn; this.learn = null; if (!L || L.l.length < 10) return false; for (const k of ['l', 'r', 'c']) this.noise[k] = [median(L[k]), std(L[k])]; return true; }
    analyze(video, t, emit) {
      const w = this.w, h = this.h, cx = this.cx;
      cx.save(); cx.scale(-1, 1); cx.drawImage(video, -w, 0, w, h); cx.restore();
      const d = cx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
      for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      const out = { t, tracking: true, backend: 'motion', hands: {}, feet: {}, cov: {} };
      if (this.prev) {
        const Z = { l: { n: 0, m: 0, x: 0, y: 0 }, r: { n: 0, m: 0, x: 0, y: 0 }, c: { n: 0, m: 0, x: 0, y: 0 } }, pix = 22;
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
          const df = Math.abs(g[y * w + x] - this.prev[y * w + x]);
          const k = x < w * 0.42 ? 'l' : x > w * 0.58 ? 'r' : (y > h * 0.45 ? 'c' : null); if (!k) continue;
          const z = Z[k]; z.n++; if (df > pix) { z.m++; z.x += x * df; z.y += y * df; z.w = (z.w || 0) + df; }
        }
        const frac = {}; for (const k of ['l', 'r', 'c']) frac[k] = Z[k].m / Math.max(1, Z[k].n);
        if (this.learn) for (const k of ['l', 'r', 'c']) this.learn[k].push(frac[k]);
        for (const k of ['l', 'r']) {
          const [mu, sd] = this.noise[k], on = mu + 4 * sd + 0.004, name = k === 'l' ? 'left' : 'right', z = Z[k];
          const res = { tracked: false, x: 0, y: 0, rx: 0, ry: 0, speed: 0, energy: 0, level: 'mid', ext: 0, waving: false };
          if (frac[k] > on && z.w) {
            const px = z.x / z.w / w * 2 - 1, py = -(z.y / z.w / h * 2 - 1), s = this.sm[k] || (this.sm[k] = { x: px, y: py });
            s.x = lerp(s.x, px, 0.4); s.y = lerp(s.y, py, 0.4);
            this.en[k] = lerp(this.en[k], clamp((frac[k] - on) / 0.1, 0, 1), 0.5);
            res.tracked = true; res.rx = s.x; res.ry = s.y; res.x = s.x; res.y = s.y;
          } else { this.en[k] *= 0.8; this.sm[k] = null; }
          res.energy = this.en[k]; res.speed = this.en[k] * 2; out.hands[name] = res;
        }
        const [mu, sd] = this.noise.c, on = mu + 5 * sd + 0.012;
        if (frac.c > on && this.stepArm && t - this.lastStep > 230) { this.stepArm = false; this.lastStep = t; this.stepN = (this.stepN || 0) + 1; emit('step', { side: this.stepN % 2 ? 'left' : 'right', power: clamp(frac.c / 0.2, 0.3, 1), source: 'motion' }); }
        else if (frac.c < on * 0.6) this.stepArm = true;
      } else { out.hands.left = out.hands.right = { tracked: false, energy: 0, rx: 0, ry: 0 }; }
      this.prev = g; return out;
    }
  }

  /* ═════════════════════════════════════════════════════════════
   *  MotionKit 主類別
   * ═════════════════════════════════════════════════════════════ */
  const STR = {
    title: '體感鏡頭 · 自動偵測與校正', close: '關閉', skip: '略過（使用預設）', redo: '重新偵測', go: '開始遊戲', cam: '鏡頭',
    st: { light: '相機與光線', body: '人體定位', base: '站姿基準', lane: '左右移動', step: '踏步測試', jump: '跳躍測試', hands: '揮手測試', done: '完成' },
    err: {
      denied: '相機權限被拒絕：請在網址列允許使用相機，再按「重新偵測」。', nocam: '找不到相機裝置。', busy: '相機正被其他程式使用，請關閉後重試。',
      insecure: '瀏覽器要求 https 或 localhost 才能使用相機。', unknown: '無法開啟相機。'
    }
  };

  class MotionKit extends Emitter {
    constructor(o) {
      super();
      this.o = Object.assign({ id: 'default', backend: 'auto', lanes: 3, wizard: {}, legs: true, require: ['shoulders'], guides: true, complexity: 'auto', autoGain: true, title: STR.title, gestures: null, assetBase: POSE_BASE, mirror: true }, o);
      this.o.wizard = o && o.wizard === false ? false : Object.assign({ tests: ['step', 'jump', 'hands'], fast: true, autoClose: true }, (o && o.wizard) || {});
      this.S = Object.assign({}, STR, this.o.strings || {});
      this.video = this.o.video || Object.assign(document.createElement('video'), { muted: true, playsInline: true });
      this.canvas = this.o.canvas || null;
      this.A = new PoseAnalyzer({ lanes: this.o.lanes, require: this.o.require, thresholds: this.o.thresholds }, (n, d) => this._fire(n, d));
      this.inCv = document.createElement('canvas'); this.ictx = this.inCv.getContext('2d', { willReadFrequently: true });
      this.lcv = document.createElement('canvas'); this.lcv.width = 64; this.lcv.height = 48; this.lctx = this.lcv.getContext('2d', { willReadFrequently: true });
      this._filterOK = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
      this.gain = 1; this.running = false; this.backend = null; this.pose = null; this.mot = null; this.aspect = 4 / 3;
      this.live = { frames: 0, fps: 0, light: null }; this.complexity = this.o.complexity === 'auto' ? 1 : this.o.complexity;
      this.saved = this._load(); this.frame = null; this.quality = null; this._lastVT = -1; this._slow = 0; this._fast = 0;
      if (this.saved && this.saved.th) this.A.tune(this.saved.th);
      if (this.saved && this.saved.complexity != null && this.o.complexity === 'auto') this.complexity = this.saved.complexity;
    }
    _fire(n, d) { if (this.o.gestures && !this.o.gestures.includes(n) && !['lost', 'found', 'land', 'stand'].includes(n)) return; this.emit(n, d); }
    _key() { return 'motionkit.v1.' + this.o.id; }
    _load() { try { const s = JSON.parse(localStorage.getItem(this._key())); return s && Date.now() - s.t < 14 * 864e5 ? s : null; } catch (_) { return null; } }
    _save(extra) { try { localStorage.setItem(this._key(), JSON.stringify(Object.assign({ t: Date.now(), th: this.A.th, complexity: this.complexity, deviceId: this.deviceId }, extra))); } catch (_) { } }
    getProfile() { return { th: Object.assign({}, this.A.th), P: Object.assign({}, this.A.P) }; }
    setThresholds(t) { this.A.tune(t); }
    feedLandmarks(lm, t, aspect) { const f = this.A.update(lm, t == null ? now() : t, aspect || this.aspect); this._after(f); return f; }

    /* ── 相機 ── */
    async _openCam(deviceId) {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { const e = new Error(this.S.err.insecure); e.code = 'insecure'; throw e; }
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      const base = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } };
      const tryGet = v => navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      try {
        this.stream = await tryGet(deviceId ? Object.assign({}, base, { deviceId: { exact: deviceId } }) : Object.assign({}, base, { facingMode: 'user' }));
      } catch (e) {
        if (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError') { try { this.stream = await tryGet(true); } catch (e2) { e = e2; } }
        if (!this.stream) {
          const code = { NotAllowedError: 'denied', PermissionDeniedError: 'denied', NotFoundError: 'nocam', DevicesNotFoundError: 'nocam', NotReadableError: 'busy', TrackStartError: 'busy', SecurityError: 'insecure' }[e.name] || 'unknown';
          const er = new Error(this.S.err[code] || this.S.err.unknown); er.code = code; throw er;
        }
      }
      this.track = this.stream.getVideoTracks()[0]; this.deviceId = (this.track.getSettings && this.track.getSettings().deviceId) || deviceId;
      this.video.srcObject = this.stream; this.video.muted = true; this.video.playsInline = true; await this.video.play();
    }
    async listCameras() { try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (_) { return []; } }
    async switchCamera(id) { await this._openCam(id); this.A.reset(); }

    /* ── 後端 ── */
    async _initBackend() {
      if (this.o.backend !== 'motion') {
        try {
          if (!window.Pose) await loadScript(this.o.assetBase + '/pose.js', 15000);
          const pose = new window.Pose({ locateFile: f => this.o.assetBase + '/' + f });
          pose.setOptions({ modelComplexity: this.complexity, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
          pose.onResults(r => this._onPose(r));
          await Promise.race([pose.initialize(), new Promise((_, rj) => setTimeout(() => rj(new Error('model timeout')), 25000))]);
          this.pose = pose; this.backend = 'pose'; return;
        } catch (e) {
          if (this.o.backend === 'pose') { const er = new Error('AI 模型載入失敗：' + e.message); er.code = 'model'; throw er; }
          console.warn('[MotionKit] Pose 載入失敗，改用動態偵測：', e.message);
        }
      }
      this.mot = new MotionBackend(); this.backend = 'motion'; this.emit('backend', { backend: 'motion', reason: 'fallback' });
    }
    _degrade(reason) {
      if (this.backend === 'motion' || this.o.backend === 'pose') return;
      this.mot = this.mot || new MotionBackend(); this.backend = 'motion'; this.emit('backend', { backend: 'motion', reason });
    }

    /* ── 主迴圈 ── */
    _tick(id) {
      if (!this.running || id !== this._lid) return;
      const next = () => this.running && id === this._lid && requestAnimationFrame(() => this._tick(id));
      const v = this.video;
      if (this.busy || v.readyState < 2 || v.currentTime === this._lastVT) return next();
      this._lastVT = v.currentTime; this.busy = true;
      const t = now(); this._grab(t);
      let p;
      try { p = this.backend === 'pose' ? this.pose.send({ image: this.inCv }) : Promise.resolve(this._motion(t)); } catch (e) { p = Promise.reject(e); }
      p.catch(e => { this._errN = (this._errN || 0) + 1; if (this._errN > 5) this._degrade('error'); })
        .then(() => { this.busy = false; this._perf(t); next(); });
    }
    _grab(t) {
      const v = this.video, w = v.videoWidth, h = v.videoHeight; if (!w) return;
      const cv = this.inCv; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      this.ictx.filter = this._filterOK && this.gain !== 1 ? 'brightness(' + this.gain.toFixed(2) + ') contrast(1.06)' : 'none';
      this.ictx.drawImage(v, 0, 0, w, h); this.aspect = w / h;
      if (!this._lt || t - this._lt > 500) { this._lt = t; this._light(); }
    }
    _onPose(res) { const f = this.A.update(res.poseLandmarks || null, now(), this.aspect); this._after(f); }
    _motion(t) { const f = this.mot.analyze(this.video, t, (n, d) => this._fire(n, d)); this._after(f); }
    _after(f) {
      this.frame = f; this.live.frames++; this._pts = this.A.b;
      this.emit('frame', f);
      if (this.canvas) this.drawOverlay(this.canvas, { guides: this.o.guides });
      if (this._wizDraw) this._wizDraw();
    }
    _perf(t) {
      const dt = t - (this._pt || t); this._pt = t; if (dt > 0) this.live.fps = lerp(this.live.fps || 30, 1000 / dt, 0.08);
      if (this.live.frames < 45) return;
      const f = this.live.fps;
      if (this.backend === 'pose' && this.o.complexity === 'auto') {
        this._slow = f < 15 ? this._slow + 1 : 0;
        if (this._slow > 90) { this._slow = 0; if (this.complexity > 0) { this.complexity = 0; this.pose.setOptions({ modelComplexity: 0 }); this.emit('perf', { complexity: 0, fps: f }); } else if (f < 8) this._degrade('slow'); }
      }
    }

    /* ── 光線：量測 + 自動增益 ── */
    _light() {
      const v = this.video; if (!v.videoWidth) return;
      this.lctx.drawImage(v, 0, 0, 64, 48); const d = this.lctx.getImageData(0, 0, 64, 48).data;
      let s = 0, s2 = 0, n = 0, cs = 0, cn = 0, es = 0, en = 0;
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2], px = p % 64, py = (p / 64) | 0;
        s += y; s2 += y * y; n++;
        if (px > 16 && px < 48 && py > 8 && py < 40) { cs += y; cn++; } else { es += y; en++; }
      }
      const mean = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean)), cm = cs / cn, em = es / en;
      const status = mean < 70 ? 'dark' : mean > 200 ? 'bright' : (em - cm > 45 && cm < 115) ? 'backlit' : sd < 26 ? 'flat' : 'ok';
      this.live.light = { mean, sd, status };
      if (this.o.autoGain && this._filterOK) {
        const target = clamp(120 / Math.max(25, mean), 0.85, 2.2);
        if (Math.abs(target - this.gain) > 0.06) this.gain = lerp(this.gain, target, 0.2);
      }
    }
    async _hwExposure() {
      try {
        const tr = this.track, cap = tr.getCapabilities ? tr.getCapabilities() : {}, adv = {};
        if (cap.exposureMode && cap.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
        if (cap.whiteBalanceMode && cap.whiteBalanceMode.includes('continuous')) adv.whiteBalanceMode = 'continuous';
        if (Object.keys(adv).length) await tr.applyConstraints({ advanced: [adv] });
      } catch (_) { }
    }

    /* ── 繪製：鏡像影像 + 骨架 + 校正後的跑道/跳躍線 ── */
    drawOverlay(cv, o) {
      o = o || {}; const ctx = cv.getContext('2d'), w = cv.width, h = cv.height, v = this.video, vw = v.videoWidth || 640, vh = v.videoHeight || 480;
      const sc = Math.max(w / vw, h / vh), dw = vw * sc, dh = vh * sc, ox = (w - dw) / 2, oy = (h - dh) / 2, asp = vw / vh;
      ctx.save(); ctx.clearRect(0, 0, w, h); ctx.translate(ox + dw, oy); ctx.scale(-1, 1); ctx.drawImage(this.inCv.width ? this.inCv : v, 0, 0, dw, dh); ctx.restore();
      const X = x => ox + (x / asp) * dw, Y = y => oy + y * dh, A = this.A, f = this.frame;
      if (o.guides && A.cal && this.backend === 'pose' && A.P.cx0 != null) {
        const S = A.P.torso; ctx.save(); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
        if (this.o.lanes > 1) { ctx.strokeStyle = 'rgba(56,189,248,.7)'; A.boundaries().forEach(b => { const x = X(A.P.cx0 + b * S); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }); }
        if (A.base.hip != null) { const y = Y(A.base.hip - A.th.jumpTh * S); ctx.strokeStyle = 'rgba(251,191,36,.8)'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.fillStyle = '#fde68a'; ctx.font = '10px sans-serif'; ctx.fillText('⬆ 跳(髖部)', 4, y - 3); }
        ctx.restore();
      }
      const b = this._pts;
      if (this.backend === 'pose' && b && f && f.tracking) {
        ctx.lineWidth = 2.4; ctx.lineCap = 'round';
        BONES.forEach(([a, c]) => { const p = b[a], q = b[c]; if (!p.ok || !q.ok) return; ctx.strokeStyle = /el|wr|sh/.test(a + c) && !/hp/.test(a + c) ? '#22d3ee' : /kn|an|ft/.test(a + c) ? '#34d399' : '#e2e8f0'; ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(q.x), Y(q.y)); ctx.stroke(); });
        for (const k in IDX) { const p = b[k]; if (!p.ok) continue; ctx.fillStyle = p.v > 0.8 ? '#38bdf8' : '#fbbf24'; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2.4, 0, 6.3); ctx.fill(); }
        ['left', 'right'].forEach((n, i) => {
          const hd = f.hands && f.hands[n]; if (!hd || !hd.tracked) return;
          ctx.fillStyle = i ? 'rgba(0,229,255,' + (0.35 + hd.energy * 0.6) + ')' : 'rgba(255,215,0,' + (0.35 + hd.energy * 0.6) + ')';
          ctx.beginPath(); ctx.arc(X(hd.x), Y(hd.y), 6 + hd.energy * 9, 0, 6.3); ctx.fill();
        });
        ['l', 'r'].forEach(s => { const lg = A.leg[s], a = b[s + 'an']; if (lg.up && a.ok) { ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(a.x), Y(a.y), 9, 0, 6.3); ctx.stroke(); } });
      } else if (this.backend === 'motion' && f && f.hands) {
        ['left', 'right'].forEach((n, i) => { const hd = f.hands[n]; if (!hd || !hd.tracked) return; ctx.fillStyle = i ? 'rgba(0,229,255,.7)' : 'rgba(255,215,0,.7)'; ctx.beginPath(); ctx.arc((hd.rx * 0.5 + 0.5) * w, (-hd.ry * 0.5 + 0.5) * h, 8, 0, 6.3); ctx.fill(); });
      }
    }

    /* ── 啟動 / 停止 / 重新校正 ── */
    async start(o) {
      if (this.running) return this._res;
      o = o || {}; const wiz = o.wizard !== undefined ? o.wizard : this.o.wizard;
      this._abort = false; const ui = wiz ? this._wizOpen() : null;
      try {
        if (ui) ui.msg('opening'); await this._openCam(this.o.deviceId || (this.saved && this.saved.deviceId));
        if (ui) ui.msg('loading'); await this._initBackend();
        this.running = true; this.live.frames = 0; this._lid = (this._lid || 0) + 1; this._tick(this._lid);
      } catch (e) {
        if (ui) { ui.fail(e.message); ui.closeOnly(); } this._teardown();
        const r = { ok: false, reason: e.code || 'error', message: e.message }; this.emit('error', r); return r;
      }
      let q = null;
      if (ui) q = await this._wizard(ui); else await this.quickCenter();
      const r = this._res = { ok: true, backend: this.backend, quality: q }; this.emit('ready', r); return r;
    }
    _teardown() {
      this.running = false; this._abort = true; this._lid = (this._lid || 0) + 1;
      if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
      if (this.video) this.video.srcObject = null;
      this._res = null; this.busy = false;
    }
    stop() { this._teardown(); this._wizClose(); }
    async recalibrate(o) {
      if (!this.running) return this.start(o);
      if (o && o.wizard === false) { return this.quickCenter(); }
      this._abort = false; const ui = this._wizOpen(); const q = await this._wizard(ui, true); this.emit('calibrated', q); return q;
    }
    /* 不跳視窗：1.5 秒內重新抓站位中心（遊戲內「重新定位」按鈕用） */
    async quickCenter() {
      this.A.beginBase(); await this._waitFn(() => this.A.baseCount() >= 20, 3500); const r = this.A.endBase(); this.emit('calibrated', { quick: true, ok: !!r }); return !!r;
    }
    _waitFn(fn, ms, tick) {
      return new Promise(res => {
        const t0 = now(), iv = setInterval(() => {
          if (this._abort || (this._ui && this._ui.skipped)) { clearInterval(iv); return res(false); }
          const r = fn(); if (tick) tick(Math.min(1, (now() - t0) / ms));
          if (r) { clearInterval(iv); res(true); } else if (now() - t0 > ms) { clearInterval(iv); res(false); }
        }, 100);
      });
    }

    /* ── 取景引導 ── */
    _guide() {
      const A = this.A, b = A.b, f = A.out;
      if (this.backend === 'motion') return { ok: true, soft: true, text: '動態偵測模式：請站在畫面中央，雙手與雙腳可自由擺動', lv: 'ok' };
      if (!b || !f || !f.tracking) return { ok: false, soft: false, text: '找不到人體：請站到鏡頭前方，讓上半身入鏡', lv: 'warn' };
      const pts = ['nose', 'lsh', 'rsh', 'lhp', 'rhp', 'lkn', 'rkn', 'lan', 'ran'].map(k => b[k]).filter(p => p.v > 0.4), cov = b.cov;
      const hgt = pts.length ? Math.max.apply(null, pts.map(p => p.y)) - Math.min.apply(null, pts.map(p => p.y)) : 0, cx = b.shC.x / b.aspect;
      const wantLegs = this.o.legs !== false;
      if (!cov.head) return { ok: false, soft: false, text: '頭部沒有入鏡：請稍微後退或調整鏡頭角度', lv: 'warn' };
      if (Math.abs(cx - 0.5) > 0.2) return { ok: false, soft: true, text: cx > 0.5 ? '請往左移動，站到畫面中央' : '請往右移動，站到畫面中央', lv: 'warn' };
      if (wantLegs && !cov.ankles) return { ok: false, soft: true, text: '請再後退一步，讓雙腳入鏡（踏步/跳躍會更準）', lv: 'warn' };
      if (hgt < 0.4) return { ok: false, soft: true, text: '距離太遠：請靠近鏡頭一點', lv: 'warn' };
      return { ok: true, soft: true, text: '站位良好 ✓', lv: 'ok' };
    }

    /* ── 校正精靈流程 ── */
    async _wizard(ui, redo) {
      const A = this.A, W = this.o.wizard, S = this.S, pen = [], notes = [];
      const fast = !redo && W.fast && this.saved && this.saved.deviceId === this.deviceId && this.saved.tested;
      const tests = fast ? [] : (W.tests || []);
      const steps = ['light', 'body', 'base'].concat(this.o.lanes > 1 && this.backend === 'pose' ? ['lane'] : [], this.backend === 'pose' ? tests : [], ['done']);
      ui.setSteps(steps);
      if (fast) notes.push('已套用上次的校正結果（快速模式）');

      // 1) 光線
      ui.stage('light'); ui.msg('正在檢查相機與光線…');
      await this._waitFn(() => this.live.light && this.live.frames > 15, 5000);
      await this._hwExposure(); await sleep(900);
      const L = this.live.light || { status: 'ok', mean: 120 };
      if (L.status === 'dark') { pen.push(18); notes.push('環境偏暗，已自動提亮；補光會更精準'); }
      else if (L.status === 'bright') { pen.push(8); notes.push('畫面過亮，請避免鏡頭直對光源'); }
      else if (L.status === 'backlit') { pen.push(14); notes.push('背光：請避免窗戶/燈在你身後'); }
      else if (L.status === 'flat') { pen.push(6); notes.push('背景與衣服對比偏低，建議換個背景'); }
      ui.done('light', L.status === 'ok');
      if (this.live.fps && this.live.fps < 12) { pen.push(22); notes.push('裝置運算偏慢（' + this.live.fps.toFixed(0) + ' FPS）'); }
      else if (this.live.fps && this.live.fps < 18) pen.push(10);

      // 2) 人體定位
      ui.stage('body'); let okN = 0, softN = 0, last = null;
      const found = await this._waitFn(() => { const g = last = this._guide(); ui.msg(g.text, g.lv); okN = g.ok ? okN + 1 : 0; softN = g.soft && A.out && A.out.tracking ? softN + 1 : 0; return okN >= 12 || softN >= 70; }, 40000, ui.prog);
      const cov = (A.out && A.out.cov) || {};
      if (!found || ui.skipped) { pen.push(35); notes.push('尚未偵測到人體；站到鏡頭前系統會自動追蹤'); }
      else if (this.backend === 'pose') {
        if (!cov.ankles) { pen.push(15); notes.push('雙腳未入鏡：踏步改用身體上下律動判斷'); }
        else if (!cov.knees) pen.push(6);
        if (!cov.hands && this.o.require.indexOf('hands') >= 0) pen.push(10);
      }
      ui.done('body', found && okN >= 1);

      // 3) 站姿基準
      ui.stage('base'); ui.msg('請自然站立、雙手放下，保持不動 2 秒');
      if (this.backend === 'pose') {
        A.beginBase(); let prevN = -1, stall = 0;
        await this._waitFn(() => { const n = A.baseCount(); stall = n === prevN ? stall + 1 : 0; prevN = n; ui.msg(stall > 12 ? '偵測到晃動，請保持不動…' : '請自然站立、雙手放下，保持不動 2 秒', stall > 12 ? 'warn' : 'info'); return n >= 40; }, 16000, () => ui.prog(A.baseCount() / 40));
        const bs = A.endBase();
        if (!bs) { pen.push(15); notes.push('站姿基準不足，已使用預設值'); }
        else { if (bs.jitter > 0.012) { pen.push(8); notes.push('骨架偵測有些抖動（光線/衣著對比）'); } if (!bs.arms) A.P.arm = null; }
        ui.done('base', !!bs);
      } else {
        this.mot.beginLearn(); await this._waitFn(() => this.mot.learnCount() >= 36, 8000, p => ui.prog(this.mot.learnCount() / 36)); this.mot.endLearn(); ui.done('base', true);
      }

      // 4) 左右移動範圍
      let calTested = !fast && this.backend === 'pose';
      if (steps.includes('lane')) {
        ui.stage('lane'); const reach = {};
        for (const dir of [-1, 1]) {
          ui.msg(dir < 0 ? '請向「左」側移動或傾身，再回到中間' : '請向「右」側移動或傾身，再回到中間');
          A.startRec(['lx']); let hold = 0;
          await this._waitFn(() => { const v = A.lx * dir; hold = v > 0.3 ? hold + 1 : 0; ui.prog(clamp(v / 0.6, 0, 1)); return hold >= 3; }, 9000);
          reach[dir] = Math.max.apply(null, [0].concat(A.stopRec().lx.map(v => v * dir)));
          await sleep(400);
        }
        const P = A.P, free = P.cx0 != null && P.torso ? (Math.min(P.cx0, this.aspect - P.cx0) - (P.shW || 0.2) / 2) / P.torso : 1.5;
        const vals = [reach[-1], reach[1]].filter(v => v > 0.3);
        let th = vals.length ? 0.6 * Math.min.apply(null, vals) : Math.min(0.8, 0.6 * free);
        th = clamp(Math.min(th, 0.85 * free), 0.3, 1.1); A.tune({ laneTh: th });
        if (!vals.length) { pen.push(6); notes.push('未測到左右移動，已依可用空間自動設定'); }
        ui.done('lane', vals.length === 2);
      }

      // 5) 動作測試（自動學習你的動作幅度）
      if (this.backend === 'pose') for (const k of tests) {
        ui.stage(k);
        if (k === 'step') {
          ui.msg('請原地踏步（輪流抬腳）約 6 步'); A.tm = 0.6; A.startRec(['step']);
          const ok = await this._waitFn(() => { const n = A.rec.step.length; ui.prog(n / 6); return n >= 6; }, 12000);
          A.tm = 1; const r = A.stopRec().step;
          if (r.length >= 3) { A.tune({ stepTh: clamp(0.5 * median(r.map(x => x[0]).filter(x => x > 0.02)) || A.th.stepTh, Math.max(0.05, 4 * A.jit), 0.16), kneeTh: clamp(0.5 * median(r.map(x => x[1]).filter(x => x > 0.04)) || A.th.kneeTh, 0.08, 0.26) }); ui.done(k, true); }
          else { pen.push(5); notes.push('踏步測試未完成，使用預設靈敏度'); ui.done(k, false); }
        } else if (k === 'jump') {
          ui.msg('請原地向上跳 2 下'); A.tm = 0.5; A.startRec(['jump']);
          await this._waitFn(() => { const n = A.rec.jump.length; ui.prog(n / 2); return n >= 2; }, 12000);
          A.tm = 1; const r = A.stopRec().jump;
          if (r.length >= 1) { A.tune({ jumpTh: clamp(0.5 * median(r), Math.max(0.08, 5 * A.jit), 0.30) }); ui.done(k, true); }
          else { pen.push(5); notes.push('跳躍測試未完成，使用預設靈敏度'); ui.done(k, false); }
        } else if (k === 'hands') {
          ui.msg('請雙手大幅揮動（左右揮、上下揮都可以）'); A.startRec(['hand']); const t0 = now();
          await this._waitFn(() => { const n = A.rec.hand.length; ui.prog(Math.min(1, (now() - t0) / 3500)); return now() - t0 > 3500 && n > 40; }, 9000);
          const r = A.stopRec().hand;
          if (r.length > 40 && pct(r, 0.9) > 0.8) { A.tune({ energyHi: clamp(pct(r, 0.9) * 0.9, 1.2, 4.5) }); ui.done(k, true); }
          else { pen.push(5); notes.push('揮手測試未偵測到足夠動作，使用預設靈敏度'); ui.done(k, false); }
        }
        await sleep(300);
      }

      // 6) 完成
      ui.stage('done'); const score = clamp(Math.round(100 - pen.reduce((a, b) => a + b, 0)), 5, 100);
      const label = score >= 85 ? '優秀' : score >= 65 ? '良好' : score >= 45 ? '尚可' : '建議調整環境';
      const caps = { hands: !!cov.hands || this.backend === 'motion', feet: !!cov.ankles, jump: !!cov.hips, lane: this.o.lanes > 1 && this.backend === 'pose', steps: this.backend === 'motion' ? 'motion' : cov.ankles ? 'legs' : 'bounce' };
      const q = this.quality = { score, label, notes, caps, backend: this.backend, fps: Math.round(this.live.fps || 0), light: L.status, thresholds: Object.assign({}, A.th) };
      this._save({ tested: fast || (calTested && tests.length > 0) || (this.saved && this.saved.tested) });
      this.emit('calibrated', q);
      await ui.summary(q, W.autoClose);
      this._wizClose(); return q;
    }

    /* ── 精靈 UI（自帶樣式，不依賴遊戲 CSS） ── */
    _wizOpen() {
      if (typeof document === 'undefined') return null;
      this._wizClose();
      if (!document.getElementById('mk-style')) {
        const st = document.createElement('style'); st.id = 'mk-style';
        st.textContent = '.mk-wiz{position:fixed;inset:0;z-index:2147483000;background:rgba(2,6,14,.82);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-family:system-ui,"Noto Sans TC",sans-serif;color:#e2e8f0}.mk-card{width:min(860px,94vw);max-height:94vh;overflow:auto;background:#0b1220;border:1px solid #1e3a5f;border-radius:18px;box-shadow:0 20px 60px #000a;padding:14px}.mk-head{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:10px}.mk-head b{font-size:15px;color:#67e8f9}.mk-head select,.mk-head button,.mk-foot button{background:#13213a;color:#cbd5e1;border:1px solid #2a4a75;border-radius:9px;padding:5px 10px;font-size:12px;cursor:pointer}.mk-main{display:grid;grid-template-columns:1.3fr 1fr;gap:12px}@media(max-width:640px){.mk-main{grid-template-columns:1fr}}.mk-view{position:relative;background:#000;border-radius:12px;overflow:hidden;aspect-ratio:4/3}.mk-view canvas{width:100%;height:100%;display:block}.mk-msg{position:absolute;left:0;right:0;bottom:0;padding:9px 12px;font-size:14px;font-weight:700;text-align:center;background:linear-gradient(transparent,#000d 55%);color:#a5f3fc}.mk-msg.warn{color:#fde68a}.mk-msg.bad{color:#fda4af}.mk-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.mk-steps li{display:flex;gap:8px;align-items:center;padding:7px 10px;border-radius:10px;background:#0f1a2e;border:1px solid #1b2c49;font-size:13px;color:#7b8aa5}.mk-steps li.on{color:#e0f2fe;border-color:#22d3ee;background:#0c2a3d}.mk-steps li.ok{color:#86efac}.mk-steps li.no{color:#fcd34d}.mk-steps li i{font-style:normal;width:18px;text-align:center}.mk-bar{height:6px;background:#13213a;border-radius:6px;overflow:hidden;margin:10px 0}.mk-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#22d3ee,#34d399);transition:width .15s}.mk-foot{display:flex;gap:8px;justify-content:flex-end;align-items:center}.mk-foot .go{background:linear-gradient(90deg,#22d3ee,#34d399);color:#04121f;font-weight:800;border:0}.mk-sum{font-size:12.5px;line-height:1.7;color:#cbd5e1;margin-top:10px}.mk-sum b{color:#67e8f9}.mk-score{font-size:30px;font-weight:900;color:#34d399;margin-right:8px}';
        document.head.appendChild(st);
      }
      const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
      const wrap = el('div', 'mk-wiz'), card = el('div', 'mk-card'), head = el('div', 'mk-head'), title = el('b', '', this.o.title), tools = el('div'), sel = el('select'), skip = el('button', '', this.S.skip), redo = el('button', '', this.S.redo);
      tools.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap'; tools.append(sel, redo, skip); head.append(title, tools);
      const main = el('div', 'mk-main'), view = el('div', 'mk-view'), cv = el('canvas'), msg = el('div', 'mk-msg', ''); cv.width = 480; cv.height = 360; view.append(cv, msg);
      const side = el('div'), ol = el('ol', 'mk-steps'), sum = el('div', 'mk-sum'); side.append(ol, sum); main.append(view, side);
      const bar = el('div', 'mk-bar'), fill = el('i'); bar.append(fill);
      const foot = el('div', 'mk-foot'), go = el('button', 'go', this.S.go); go.disabled = true; foot.append(go);
      card.append(head, main, bar, foot); wrap.append(card); document.body.append(wrap);
      const ui = this._ui = { el: wrap, skipped: false, lis: {}, sel };
      ui.finished = new Promise(r => { ui._fin = r; });
      skip.onclick = () => { ui.skipped = true; if (ui._goRes) ui._goRes(); };
      redo.onclick = () => { if (ui.redoing) return; ui.redoing = true; ui.skipped = true; if (ui._goRes) ui._goRes(); ui.finished.then(() => { if (this.running) this.recalibrate().then(q => { if (this._res) this._res.quality = q; }); }); };
      ui.closeOnly = () => { redo.style.display = 'none'; sel.style.display = 'none'; skip.textContent = this.S.close || '關閉'; skip.onclick = () => this._wizClose(); };
      this._wizDraw = () => this.drawOverlay(cv, { guides: true });
      this.listCameras().then(ds => { if (ds.length < 2) { sel.style.display = 'none'; return; } ds.forEach((d, i) => { const o = el('option', '', d.label || (this.S.cam + ' ' + (i + 1))); o.value = d.deviceId; if (d.deviceId === this.deviceId) o.selected = true; sel.append(o); }); });
      sel.onchange = async () => { try { await this.switchCamera(sel.value); ui.msg('正在重新定位…'); } catch (e) { ui.fail(e.message); } };
      const TX = { opening: '正在開啟相機…（請在瀏覽器提示中按「允許」）', loading: '正在載入 AI 姿勢模型…（首次需下載，請稍候）' };
      ui.msg = (m, lv) => { msg.textContent = TX[m] || m; msg.className = 'mk-msg ' + (lv === 'warn' ? 'warn' : lv === 'bad' ? 'bad' : ''); };
      ui.fail = m => { ui.msg(m, 'bad'); fill.style.width = '0'; };
      ui.prog = p => { fill.style.width = Math.round(clamp(p, 0, 1) * 100) + '%'; };
      ui.setSteps = ids => { ol.innerHTML = ''; ui.lis = {}; ids.forEach(id => { const li = el('li', '', ''); li.append(el('i', '', '○'), el('span', '', this.S.st[id] || id)); ol.append(li); ui.lis[id] = li; }); };
      ui.stage = id => { Object.keys(ui.lis).forEach(k => { if (ui.lis[k].className === 'on') ui.lis[k].className = ''; }); const li = ui.lis[id]; if (li) { li.className = 'on'; li.firstChild.textContent = '●'; } ui.prog(0); };
      ui.done = (id, ok) => { const li = ui.lis[id]; if (li) { li.className = ok ? 'ok' : 'no'; li.firstChild.textContent = ok ? '✓' : '⚠'; } ui.prog(1); };
      ui.summary = (q, auto) => new Promise(res => {
        if (ui.skipped) return res();
        const li = ui.lis.done; if (li) { li.className = 'ok'; li.firstChild.textContent = '✓'; }
        const c = q.caps, yn = v => v ? '✓' : '✗';
        sum.innerHTML = '<div><span class="mk-score">' + q.score + '</span><b>' + q.label + '</b>（' + (q.backend === 'pose' ? 'AI 骨架偵測' : '動態偵測') + ' · ' + q.fps + ' FPS）</div>' +
          '<div>雙手 ' + yn(c.hands) + '　雙腳 ' + yn(c.feet) + '　跳躍 ' + yn(c.jump) + '　左右跑道 ' + yn(c.lane) + '　踏步方式：' + ({ legs: '腿部追蹤', bounce: '身體律動', motion: '動態偵測' }[c.steps] || '-') + '</div>' +
          (q.notes.length ? '<div>' + q.notes.map(n => '・' + n).join('<br>') + '</div>' : '');
        ui.msg('校正完成！', 'info'); go.disabled = false; ui._goRes = res; go.onclick = res;
        if (auto && q.score >= 65 && !q.notes.length) setTimeout(res, 2200);
      });
      ui.msg('opening'); return ui;
    }
    _wizClose() { if (this._ui) { try { this._ui.el.remove(); } catch (_) { } if (this._ui._fin) this._ui._fin(); this._ui = null; } this._wizDraw = null; }
  }

  return {
    VERSION, create: o => new MotionKit(o), MotionKit, PoseAnalyzer, MotionBackend, OneEuro,
    GESTURES: ['step', 'highKnee', 'kick', 'jump', 'land', 'squat', 'stand', 'lane', 'punch', 'wave', 'swipe', 'clap', 'handsUp', 'armsWide', 'lost', 'found']
  };
});
