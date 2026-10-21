/*!
 * MotionKit v2.0.0 — 3D 網頁遊戲「鏡頭體感偵測」共用模組（單檔、無需打包）
 *
 * 分級（preset）：
 *   quick    快速基本偵測：展場用，免校正、輕量模型、人一站上就自動定位
 *   hands    手部專用：只看上半身（揮手、出拳、拍手、舉手、比愛心…）
 *   run      跑步踏步：下半身為主（踏步、高抬腿、跳躍、蹲下、跑道、跑步速度）
 *   body     全身標準（預設）：全部骨架動作 + 校正精靈
 *   advanced 進階手勢：全身骨架 + 手指手勢（讚、YA、OK、比心…）+ 張嘴（MediaPipe Holistic）
 *
 * 最小用法：
 *   const kit = MotionKit.create({ preset: 'quick', video, canvas, lanes: 3 });
 *   kit.on('step', e => ...); kit.on('heart', () => ...); kit.on('thumbsUp', e => e.side);
 *   const r = await kit.start();   // r.ok / r.quality / r.backend
 *
 * 擴充：kit.defineGesture() 自訂規則、kit.defineSequence() 連續動作、kit.recordPose() 錄製自訂姿勢
 * 測試：kit.bindKeys({ Space: 'step' }) 鍵盤模擬、kit.simulate('jump')、kit.feedLandmarks(lm)
 *
 * 完整規範請見 docs/MOTION_KIT_SPEC.md
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MotionKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '2.0.0';
  const CDN = {
    pose: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404',
    holistic: 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629'
  };

  /* ───────────── 小工具 ───────────── */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)]; };
  const std = a => { if (a.length < 2) return 0; const m = a.reduce((p, c) => p + c, 0) / a.length; return Math.sqrt(a.reduce((p, c) => p + (c - m) * (c - m), 0) / a.length); };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, ok: a.ok && b.ok, v: Math.min(a.v, b.v) });
  /* 以 b 為頂點的夾角（度） */
  const angle3 = (a, b, c) => {
    const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y, n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    return n ? Math.acos(clamp((ux * vx + uy * vy) / n, -1, 1)) * 180 / Math.PI : 0;
  };
  const modeOf = arr => { const c = {}; let best = null, n = 0; arr.forEach(v => { c[v] = (c[v] || 0) + 1; if (c[v] > n) { n = c[v]; best = v; } }); return { v: best, count: n }; };
  const hasDOM = typeof document !== 'undefined';

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
    once(e, f) { const off = this.on(e, d => { off(); f(d); }); return off; }
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

  /* ═════════════════════════════════════════════════════════════
   *  分級設定（preset）：game 傳入的選項會覆蓋 preset
   * ═════════════════════════════════════════════════════════════ */
  const PRESETS = {
    quick: {
      label: '快速基本偵測', tier: 'basic', desc: '展場快速體驗：免校正、輕量模型、人站上就自動定位，離開後自動重置',
      backend: 'pose', complexity: 0, inputWidth: 480, wizard: false, legs: false, lanes: 1, require: ['shoulders'], autoCenter: true,
      gestures: ['step', 'jump', 'squat', 'lane', 'lean', 'punch', 'wave', 'swipe', 'clap', 'handsUp', 'armsWide', 'raiseHand', 'heart', 'yPose', 'motion', 'run']
    },
    hands: {
      label: '手部專用', tier: 'basic', desc: '只看上半身與雙手：揮手、出拳、拍手、舉手、比愛心、交叉',
      backend: 'pose', complexity: 'auto', legs: false, lanes: 1, require: ['shoulders'], wizard: { tests: ['hands'] },
      gestures: ['punch', 'wave', 'swipe', 'clap', 'handsUp', 'armsWide', 'raiseHand', 'heart', 'yPose', 'cross', 'armPoint', 'lean', 'bow', 'nod', 'shake']
    },
    run: {
      label: '跑步踏步', tier: 'basic', desc: '下半身為主：踏步、高抬腿、踢腿、跳躍、蹲下、左右跑道、跑步速度',
      backend: 'pose', complexity: 'auto', legs: true, require: ['shoulders', 'hips'], wizard: { tests: ['step', 'jump'] },
      gestures: ['step', 'highKnee', 'kick', 'jump', 'squat', 'lane', 'lean', 'motion', 'run']
    },
    body: {
      label: '全身標準', tier: 'basic', desc: '全部骨架動作 + 自動偵測校正精靈（預設）',
      backend: 'auto', complexity: 'auto', legs: true, require: ['shoulders'], wizard: { tests: ['step', 'jump', 'hands'] }, gestures: null
    },
    advanced: {
      label: '進階手勢', tier: 'advanced', desc: '全身骨架 + 手指手勢（讚、YA、OK、比心、我愛你…）+ 張嘴（較耗效能）',
      backend: 'holistic', complexity: 'auto', legs: true, require: ['shoulders'], wizard: { tests: ['step', 'hands', 'gesture'] }, gestures: null
    }
  };

  /* 動作說明：[中文名稱, 分級, 判斷方式]（測試台與文件使用） */
  const GESTURE_INFO = {
    step: ['踏步', 'basic', '原地輪流抬腳；腳沒入鏡時改用身體上下律動判斷'],
    highKnee: ['高抬腿', 'basic', '膝蓋上抬超過大腿長度 75%'],
    kick: ['踢腿', 'basic', '腳踝抬到膝蓋高度並向外踢出'],
    jump: ['跳躍', 'basic', '髖部與肩膀同時快速上升'],
    land: ['落地', 'basic', '跳躍後回到地面'],
    squat: ['蹲下', 'basic', '髖部下降超過門檻並維持 0.12 秒'],
    stand: ['站起', 'basic', '蹲下後回到站姿'],
    lane: ['左右跑道', 'basic', '身體重心左右移動（含遲滯防抖）'],
    lean: ['身體傾斜', 'basic', '上半身向左或右傾斜超過 15°'],
    punch: ['出拳', 'basic', '手臂快速伸直或往鏡頭推出'],
    wave: ['揮手', 'basic', '手在胸口以上左右來回 2 次以上'],
    swipe: ['揮掃', 'basic', '0.25 秒內手水平移動超過 0.9 個手臂長'],
    clap: ['拍手', 'basic', '雙手從張開快速合攏'],
    handsUp: ['雙手高舉', 'basic', '雙手腕高於頭頂 0.25 秒（比愛心時不觸發）'],
    armsWide: ['張開雙臂', 'basic', '雙臂水平張開（T 字）0.4 秒'],
    raiseHand: ['單手舉手', 'basic', '一手高於頭頂、另一手放低'],
    heart: ['頭上比愛心', 'basic', '雙手在頭頂相碰、手肘向外撐開'],
    yPose: ['Y 字歡呼', 'basic', '雙手高舉並張開成 Y 字'],
    cross: ['雙手交叉 X', 'basic', '雙手腕在胸前交叉'],
    armPoint: ['單臂指向', 'basic', '一手臂水平伸直指向側邊、另一手放下'],
    bow: ['鞠躬', 'basic', '肩膀下降、頭低於肩線、髖部不動'],
    nod: ['點頭', 'basic', '頭部上下擺動'],
    shake: ['搖頭', 'basic', '頭部左右擺動'],
    motion: ['移動狀態', 'basic', '依步頻分 idle / walk / jog / run / sprint'],
    run: ['跑步', 'basic', '步頻達每分鐘 145 步以上（進入跑步狀態時觸發一次）'],
    open: ['張開手掌', 'advanced', '五指伸直'],
    fist: ['握拳', 'advanced', '五指收起'],
    point: ['食指指向', 'advanced', '只伸出食指'],
    victory: ['YA ✌', 'advanced', '伸出食指與中指'],
    three: ['數字三', 'advanced', '伸出食指、中指、無名指'],
    four: ['數字四', 'advanced', '四指伸直、拇指收起'],
    thumbsUp: ['讚 👍', 'advanced', '只伸出拇指且朝上'],
    thumbsDown: ['倒讚 👎', 'advanced', '只伸出拇指且朝下'],
    ok: ['OK 👌', 'advanced', '拇指與食指圈起、其餘三指伸直'],
    love: ['我愛你 🤟', 'advanced', '伸出拇指、食指、小指'],
    rock: ['搖滾 🤘', 'advanced', '伸出食指與小指'],
    call: ['打電話 🤙', 'advanced', '伸出拇指與小指'],
    pinch: ['捏取', 'advanced', '拇指與食指指尖相碰、其餘收起'],
    fingerHeart: ['手指愛心 🫰', 'advanced', '拇指尖靠在彎曲的食指中段'],
    heartHands: ['雙手比心 🫶', 'advanced', '兩手食指尖相碰、拇指尖相碰'],
    count: ['手指數字', 'advanced', '伸出的手指數量改變（0–5）'],
    handShape: ['任一手勢', 'advanced', '任一手勢穩定成立時觸發'],
    mouthOpen: ['張嘴', 'advanced', '上下唇距離超過臉長 7.5%'],
    mouthClose: ['閉嘴', 'advanced', '張嘴後閉上']
  };
  /* 不受 gestures 白名單限制的系統事件 */
  const SYSTEM = new Set(['lost', 'found', 'land', 'stand', 'presence', 'idle', 'template', 'count', 'handShape', 'mouthClose']);

  /* MediaPipe 關節索引（l=解剖學左；x 已鏡像，所以左側會出現在畫面左邊） */
  const IDX = { nose: 0, lsh: 11, rsh: 12, lel: 13, rel: 14, lwr: 15, rwr: 16, lpi: 17, rpi: 18, lin: 19, rin: 20, lhp: 23, rhp: 24, lkn: 25, rkn: 26, lan: 27, ran: 28, lft: 31, rft: 32 };
  const EXT = new Set(['lwr', 'rwr', 'lpi', 'rpi', 'lin', 'rin', 'lan', 'ran', 'lft', 'rft', 'lkn', 'rkn', 'lel', 'rel']);
  const BONES = [['lsh', 'rsh'], ['lsh', 'lel'], ['lel', 'lwr'], ['rsh', 'rel'], ['rel', 'rwr'], ['lsh', 'lhp'], ['rsh', 'rhp'], ['lhp', 'rhp'], ['lhp', 'lkn'], ['lkn', 'lan'], ['rhp', 'rkn'], ['rkn', 'ran'], ['lan', 'lft'], ['ran', 'rft']];
  const HAND_BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

  function reversals(hist, amp, key) {
    key = key || 'x';
    let n = 0, dir = 0, ext = hist.length ? hist[0][key] : 0;
    for (const p of hist) {
      const x = p[key];
      if (dir === 0) { if (x > ext + amp) { dir = 1; ext = x; } else if (x < ext - amp) { dir = -1; ext = x; } }
      else if (dir === 1) { if (x > ext) ext = x; else if (x < ext - amp) { n++; dir = -1; ext = x; } }
      else { if (x < ext) ext = x; else if (x > ext + amp) { n++; dir = 1; ext = x; } }
    }
    return n;
  }

  /* 姿勢特徵向量（自訂姿勢比對用）：手肘/肩/髖/膝角度 + 雙臂方向 */
  function poseVector(b) {
    const g = (a, c, e) => (b[a].ok && b[c].ok && b[e].ok) ? angle3(b[a], b[c], b[e]) : null;
    const dir = (a, c) => (b[a].ok && b[c].ok) ? Math.atan2(b[c].y - b[a].y, b[c].x - b[a].x) * 180 / Math.PI : null;
    return [g('lsh', 'lel', 'lwr'), g('rsh', 'rel', 'rwr'), g('lel', 'lsh', 'lhp'), g('rel', 'rsh', 'rhp'),
      g('lsh', 'lhp', 'lkn'), g('rsh', 'rhp', 'rkn'), g('lhp', 'lkn', 'lan'), g('rhp', 'rkn', 'ran'), dir('lsh', 'lwr'), dir('rsh', 'rwr')];
  }
  function vecDiff(a, b) {
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] == null || b[i] == null) continue;
      let d = Math.abs(a[i] - b[i]); if (i >= 8) d = Math.min(d, 360 - d);
      s += d; n++;
    }
    return n >= 4 ? s / n : Infinity;
  }

  /* ═════════════════════════════════════════════════════════════
   *  PoseAnalyzer：骨架 → 動作（純邏輯，不依賴 DOM，可單獨測試/重播）
   * ═════════════════════════════════════════════════════════════ */
  class PoseAnalyzer {
    constructor(o, emit) {
      this.o = Object.assign({ lanes: 3, vis: 0.5, require: ['shoulders'] }, o);
      this.th = Object.assign({ laneTh: 0.8, laneHy: 0.25, stepTh: 0.10, kneeTh: 0.16, jumpTh: 0.16, squatTh: 0.22, punchV: 2.2, energyHi: 2.4, leanDeg: 15, heartGap: 0.6, holdMs: 300 }, (o && o.thresholds) || {});
      this.emit = emit || function () { };
      this.reset();
    }
    reset() {
      this.filters = {}; this.last = 0; this.P = {}; this.cal = false; this.tm = 1; this.b = null; this.out = null;
      this.base = { hip: null, sh: null }; this.vy = 0; this.hipPrev = null; this.air = false; this.airT = 0; this.peak = 0;
      this.squat = false; this.sqT = 0; this.lane = (this.o.lanes - 1) >> 1; this.lx = 0;
      const leg = () => ({ ground: null, up: false, t: -1e9, pk: [0, 0] });
      this.leg = { l: leg(), r: leg() }; this.legT = -1e9; this.pend = [];
      const hand = () => ({ px: null, py: null, vy: 0, speed: 0, hist: [], punchT: -1e9, dz: 0, arm: 0 });
      this.hand = { l: hand(), r: hand() };
      this.cdT = {}; this.stepTimes = []; this.lastStepT = -1e9; this.lostT = 0; this.isLost = true;
      this.cxBuf = []; this.bounce = { mode: 'down', ext: 0, t: -1e9 }; this.rec = null; this.bs = null;
      this.combo = { d: [], up: 0, upOn: false, wide: 0, wideOn: false }; this.mi = 0; this.prevMI = null; this.still = false; this.sEst = 0; this.jit = 0.01;
      this.holds = {}; this.head = []; this.mstate = { cur: 'idle', cand: 'idle', since: 0 }; this.swing = 0; this.leanDeg = 0;
    }
    tune(t) { Object.assign(this.th, t); }
    startRec(kinds) { this.rec = {}; kinds.forEach(k => this.rec[k] = []); }
    stopRec() { const r = this.rec; this.rec = null; return r || {}; }
    _cd(k, ms, t) { if (t - (this.cdT[k] == null ? -1e9 : this.cdT[k]) < ms) return false; this.cdT[k] = t; return true; }
    /* 狀態需持續 ms 才觸發一次；條件消失 120ms 後才重置（避免單幀抖動） */
    _hold(key, cond, ms, t, fire, cool) {
      const h = this.holds[key] || (this.holds[key] = { since: null, on: false, off: null });
      if (cond) {
        h.off = null; if (h.since == null) h.since = t;
        if (!h.on && t - h.since >= ms && this._cd(key, cool == null ? 800 : cool, t)) { h.on = true; fire(); }
      } else if (h.since != null) {
        if (h.off == null) h.off = t;
        if (t - h.off > 120) { h.since = null; h.on = false; h.off = null; }
      }
      return h.on;
    }

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
      const shape = this._shapes(b, out, S);
      this._combos(b, out, t, dt, S, shape);
      this._poses(b, out, t, S, shape);
      this._head(b, t, S);
      out.cadence = this._cadence(t);
      out.motion = this._motion(t, out);
      out.armSwing = this.swing;
      out.pose = this.squat ? 'squat' : this.air ? 'jump' : shape.heart ? 'heart' : this.combo.upOn ? 'handsUp' : this.combo.wideOn ? 'armsWide' : shape.cross ? 'cross' : 'stand';
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
          this.air = false; if (this.rec && this.rec.jump) this.rec.jump.push(this.peak); this.emit('land', { peak: this.peak });
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
    /* 步頻（步/分）：取最近步伐間隔的中位數，停步 1.5 秒歸零 */
    _cadence(t) {
      this.stepTimes = this.stepTimes.filter(x => t - x < 4000); const n = this.stepTimes.length;
      if (n < 2 || t - this.stepTimes[n - 1] > 1500) return 0;
      const iv = []; for (let i = 1; i < n; i++) iv.push(this.stepTimes[i] - this.stepTimes[i - 1]);
      return clamp(60000 / Math.max(150, median(iv)), 0, 260);
    }
    /* 移動狀態：idle / walk / jog / run / sprint（需維持 0.35 秒才切換） */
    _motion(t, out) {
      const c = out.cadence, m = this.mstate;
      const s = c < 1 ? 'idle' : c < 95 ? 'walk' : c < 145 ? 'jog' : c < 190 ? 'run' : 'sprint';
      if (s !== m.cand) { m.cand = s; m.since = t; }
      if (s !== m.cur && t - m.since > (s === 'idle' ? 600 : 350)) {
        const prev = m.cur; m.cur = s;
        this.emit('motion', { state: s, prev, cadence: Math.round(c), armSwing: this.swing });
        const fast = x => x === 'run' || x === 'sprint';
        if (fast(s) && !fast(prev)) this.emit('run', { cadence: Math.round(c), sprint: s === 'sprint', armSwing: this.swing });
      }
      return m.cur;
    }

    /* 雙手：位置 / 速度 / 能量 / 高度層級 / 出拳 / 揮手 / 揮掃 */
    _hands(b, t, dt, S) {
      const out = {}, th = this.th, tm = this.tm, noseY = b.nose.ok ? b.nose.y : b.shC.y - 0.7 * S;
      for (const s of ['l', 'r']) {
        const H = this.hand[s], sh = b[s + 'sh'], el = b[s + 'el'], wr = b[s + 'wr'], ip = b[s + 'in'], pk = b[s + 'pi'];
        const res = { tracked: false, x: 0, y: 0, rx: 0, ry: 0, speed: 0, energy: 0, level: 'low', ext: 0, waving: false, vy: 0 };
        const name = s === 'l' ? 'left' : 'right';
        if (!(wr.ok && sh.ok)) { H.px = null; H.hist.length = 0; H.speed *= 0.8; H.vy = 0; out[name] = res; continue; }
        let x = wr.x, y = wr.y, w = 1;
        if (ip.ok) { x += ip.x * 0.6; y += ip.y * 0.6; w += 0.6; }
        if (pk.ok) { x += pk.x * 0.4; y += pk.y * 0.4; w += 0.4; }
        x /= w; y /= w;
        const armEst = el.ok ? dist(sh, el) + dist(el, wr) : 1.2 * S;
        const arm = this.P.arm || (H.arm = Math.max(armEst, (H.arm || armEst) * (1 - 0.02 * dt)));
        const qx = x - b.shC.x, qy = y - b.shC.y; // 相對身體的位置：全身移動不算手在動
        let sp = 0; if (H.px != null) { sp = Math.hypot(qx - H.px, qy - H.py) / dt / S; H.vy = lerp(H.vy, (qy - H.py) / dt / S, 0.5); }
        H.px = qx; H.py = qy; H.speed = lerp(H.speed, sp, 0.55);
        H.fast = sp > th.punchV * tm ? (H.fast || 0) + 1 : 0; // 需連續 2 幀以上高速，濾掉單幀跳點
        const ext = dist(sh, { x, y }) / arm;
        res.tracked = true; res.x = x; res.y = y; res.speed = H.speed; res.ext = ext; res.vy = H.vy;
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

    /* 靜態姿勢幾何判斷（每幀），結果交給 _combos / _poses 做持續時間判斷 */
    _shapes(b, out, S) {
      const r = { heart: false, yPose: false, cross: false, raiseL: false, raiseR: false, pointL: false, pointR: false };
      const lw = b.lwr, rw = b.rwr, ls = b.lsh, rs = b.rsh, le = b.lel, re = b.rel, L = out.hands.left, R = out.hands.right;
      if (!ls.ok || !rs.ok) return r;
      const shW = Math.max(Math.abs(rs.x - ls.x), 0.3 * S);
      const headY = b.nose.ok ? b.nose.y : b.shC.y - 0.7 * S, hipY = b.hpC.ok ? b.hpC.y : b.shC.y + S;
      const overL = lw.ok && lw.y < headY - 0.05 * S, overR = rw.ok && rw.y < headY - 0.05 * S;
      if (lw.ok && rw.ok) {
        const gap = dist(lw, rw) / S;
        const elWide = le.ok && re.ok && Math.abs(re.x - le.x) > shW * 1.25 && le.y < ls.y + 0.2 * S && re.y < rs.y + 0.2 * S;
        r.heart = overL && overR && gap < this.th.heartGap && elWide;
        r.yPose = overL && overR && Math.abs(rw.x - lw.x) > shW * 2 && L.ext > 0.75 && R.ext > 0.75;
        r.cross = lw.x > rw.x + 0.08 * S && lw.y > headY && rw.y > headY && lw.y < hipY && rw.y < hipY;
      }
      r.raiseL = overL && !overR && (!rw.ok || rw.y > rs.y);
      r.raiseR = overR && !overL && (!lw.ok || lw.y > ls.y);
      const horizL = lw.ok && Math.abs(lw.y - ls.y) < 0.3 * S && L.ext > 0.85 && lw.x < ls.x - 0.5 * S;
      const horizR = rw.ok && Math.abs(rw.y - rs.y) < 0.3 * S && R.ext > 0.85 && rw.x > rs.x + 0.5 * S;
      const downL = !lw.ok || lw.y > ls.y + 0.5 * S, downR = !rw.ok || rw.y > rs.y + 0.5 * S;
      r.pointL = horizL && downR; r.pointR = horizR && downL;
      return r;
    }

    /* 雙手組合動作：拍手 / 雙手高舉 / 張開雙臂 + 跑步擺臂 */
    _combos(b, out, t, dt, S, shape) {
      const L = out.hands.left, R = out.hands.right, c = this.combo;
      if (L.tracked && R.tracked) {
        const d = Math.hypot(L.x - R.x, L.y - R.y) / S; c.d.push({ t, d }); while (c.d.length && t - c.d[0].t > 500) c.d.shift();
        const mx = Math.max.apply(null, c.d.map(p => p.d));
        if (d < 0.3 && mx > 0.8 && L.level !== 'low' && R.level !== 'low' && L.level !== 'over' && this._cd('clap', 450, t)) this.emit('clap', {});
        c.up = L.level === 'over' && R.level === 'over' && !shape.heart ? c.up + dt : 0;
        const wide = Math.abs(b.lwr.y - b.lsh.y) < 0.4 * S && Math.abs(b.rwr.y - b.rsh.y) < 0.4 * S && L.ext > 0.8 && R.ext > 0.8 && (L.rx < -0.5 && R.rx > 0.5);
        c.wide = wide ? c.wide + dt : 0;
        const alt = L.vy * R.vy < 0 ? Math.min(Math.abs(L.vy), Math.abs(R.vy)) : 0; // 左右手反向擺動 = 跑步擺臂
        this.swing = lerp(this.swing, clamp(alt / 1.2, 0, 1), 0.12);
      } else { c.up = 0; c.wide = 0; c.d.length = 0; this.swing *= 0.95; }
      if (c.up > 0.25 && !c.upOn) { c.upOn = true; this.emit('handsUp', {}); } else if (c.up === 0) c.upOn = false;
      if (c.wide > 0.4 && !c.wideOn) { c.wideOn = true; this.emit('armsWide', {}); } else if (c.wide === 0) c.wideOn = false;
    }

    /* 需要維持時間的姿勢：愛心 / Y 字 / 交叉 / 舉手 / 指向 / 傾斜 / 鞠躬 */
    _poses(b, out, t, S, sh) {
      const hm = this.th.holdMs;
      out.shape = sh;
      this._hold('heart', sh.heart, hm, t, () => this.emit('heart', {}), 1500);
      this._hold('yPose', sh.yPose, hm, t, () => this.emit('yPose', {}), 1200);
      this._hold('cross', sh.cross, hm, t, () => this.emit('cross', {}), 1200);
      this._hold('raiseL', sh.raiseL, hm, t, () => this.emit('raiseHand', { side: 'left' }), 900);
      this._hold('raiseR', sh.raiseR, hm, t, () => this.emit('raiseHand', { side: 'right' }), 900);
      this._hold('pointL', sh.pointL, hm + 100, t, () => this.emit('armPoint', { side: 'left', dir: -1 }), 1000);
      this._hold('pointR', sh.pointR, hm + 100, t, () => this.emit('armPoint', { side: 'right', dir: 1 }), 1000);
      out.lean = 0;
      if (b.hpC.ok && b.shC.ok) {
        const deg = this.leanDeg = Math.atan2(b.shC.x - b.hpC.x, b.hpC.y - b.shC.y) * 180 / Math.PI, th = this.th.leanDeg;
        out.lean = clamp(deg / 30, -1, 1);
        this._hold('leanL', deg < -th && !this.air, 200, t, () => this.emit('lean', { side: 'left', deg }), 700);
        this._hold('leanR', deg > th && !this.air, 200, t, () => this.emit('lean', { side: 'right', deg }), 700);
        if (b.nose.ok && this.base.sh != null && this.base.hip != null) {
          const shDrop = (b.shC.y - this.base.sh) / S, hipDrop = (b.hpC.y - this.base.hip) / S;
          const bow = shDrop > 0.25 && hipDrop < 0.12 && b.nose.y > b.shC.y - 0.25 * S && !this.squat;
          this._hold('bow', bow, 250, t, () => this.emit('bow', {}), 1500);
        }
      }
    }

    /* 點頭 / 搖頭：鼻子相對肩膀中心的來回擺動 */
    _head(b, t, S) {
      if (!b.nose.ok || !b.shC.ok || this.air || Math.abs(this.vy) / S > 0.6) { this.head.length = 0; return; }
      this.head.push({ t, x: (b.nose.x - b.shC.x) / S, y: (b.nose.y - b.shC.y) / S });
      while (this.head.length && t - this.head[0].t > 1400) this.head.shift();
      if (this.head.length < 8) return;
      const xs = this.head.map(p => p.x), ys = this.head.map(p => p.y);
      const rx = Math.max.apply(null, xs) - Math.min.apply(null, xs), ry = Math.max.apply(null, ys) - Math.min.apply(null, ys);
      if (rx > 0.1 && ry < rx * 0.6 && reversals(this.head, 0.06, 'x') >= 2 && this._cd('shake', 1400, t)) { this.emit('shake', {}); this.head.length = 0; }
      else if (ry > 0.07 && rx < ry * 0.7 && reversals(this.head, 0.04, 'y') >= 2 && this._cd('nod', 1400, t)) { this.emit('nod', {}); this.head.length = 0; }
    }
  }

  /* ═════════════════════════════════════════════════════════════
   *  手指手勢（MediaPipe 21 點手部骨架；x 已鏡像、單位同身體）
   * ═════════════════════════════════════════════════════════════ */
  function classifyHand(p) {
    const palm = dist(p[0], p[9]) || 1e-3;
    const fingerExt = (m, pi, tip) => angle3(p[m], p[pi], p[tip]) > 140 && dist(p[0], p[tip]) > dist(p[0], p[pi]) * 1.08;
    const idx = fingerExt(5, 6, 8), mid = fingerExt(9, 10, 12), ring = fingerExt(13, 14, 16), pky = fingerExt(17, 18, 20);
    const thumb = angle3(p[2], p[3], p[4]) > 145 && dist(p[4], p[5]) > 0.55 * palm && dist(p[4], p[9]) > 0.75 * palm;
    const ext = [thumb, idx, mid, ring, pky], n = ext.filter(Boolean).length;
    const ti = dist(p[4], p[8]) / palm;
    const tl = dist(p[2], p[4]) || 1e-3, tdy = (p[4].y - p[2].y) / tl;
    let name = null;
    if (ti < 0.32 && mid && ring && pky) name = 'ok';
    else if (!mid && !ring && !pky) {
      if (ti < 0.3) name = 'pinch';
      else if (!idx && Math.min(dist(p[4], p[6]), dist(p[4], p[7])) / palm < 0.38) name = 'fingerHeart';
      else if (idx) name = 'point';
      else if (thumb) name = tdy < -0.65 ? 'thumbsUp' : tdy > 0.65 ? 'thumbsDown' : null;
      else name = 'fist';
    }
    else if (idx && mid && !ring && !pky) name = 'victory';
    else if (idx && mid && ring && !pky) name = 'three';
    else if (idx && mid && ring && pky) name = thumb ? 'open' : 'four';
    else if (idx && !mid && !ring && pky) name = thumb ? 'love' : 'rock';
    else if (!idx && !mid && !ring && pky && thumb) name = 'call';
    return { name, fingers: n, ext, palm, pinch: ti };
  }

  class HandAnalyzer {
    constructor(emit, o) { this.emit = emit || function () { }; this.o = Object.assign({ hold: 220, cool: 900, window: 6, need: 4 }, o); this.reset(); }
    reset() { this.s = { left: this._st(), right: this._st() }; this.cdT = {}; this.two = { since: null, on: false }; }
    _st() { return { hist: [], fh: [], name: null, since: 0, fired: null, fingers: -1 }; }
    _cd(k, ms, t) { if (t - (this.cdT[k] == null ? -1e9 : this.cdT[k]) < ms) return false; this.cdT[k] = t; return true; }
    update(hands, t) {
      const out = {}, W = this.o.window, N = this.o.need;
      for (const side of ['left', 'right']) {
        const p = hands && hands[side], st = this.s[side];
        if (!p) { st.hist.length = 0; st.fh.length = 0; st.name = null; st.fired = null; out[side] = { tracked: false, name: null, fingers: 0 }; continue; }
        const c = classifyHand(p);
        st.hist.push(c.name || '-'); if (st.hist.length > W) st.hist.shift();
        st.fh.push(c.fingers); if (st.fh.length > W) st.fh.shift();
        const m = modeOf(st.hist), nm = m.count >= N && m.v !== '-' ? m.v : (m.count >= N ? null : st.name);
        if (nm !== st.name) { st.name = nm; st.since = t; st.fired = null; }
        if (st.name && st.fired !== st.name && t - st.since >= this.o.hold) {
          st.fired = st.name;
          if (this._cd(side + st.name, this.o.cool, t)) { this.emit(st.name, { side, fingers: c.fingers }); this.emit('handShape', { side, name: st.name, fingers: c.fingers }); }
        }
        const fm = modeOf(st.fh);
        if (fm.count >= N && fm.v !== st.fingers) { const prev = st.fingers; st.fingers = fm.v; if (prev >= 0) this.emit('count', { side, n: fm.v }); }
        out[side] = { tracked: true, name: st.name, raw: c.name, fingers: c.fingers, stableFingers: st.fingers, ext: c.ext, pts: p, palm: c.palm };
      }
      const L = out.left, R = out.right, tw = this.two; let heart = false;
      if (L.tracked && R.tracked) {
        const a = L.pts, b = R.pts, pa = (L.palm + R.palm) / 2;
        heart = dist(a[8], b[8]) < 0.6 * pa && dist(a[4], b[4]) < 0.75 * pa && a[8].y < a[4].y && b[8].y < b[4].y && a[8].y < a[0].y;
      }
      if (heart) { if (tw.since == null) tw.since = t; if (!tw.on && t - tw.since >= 300 && this._cd('heartHands', 1500, t)) { tw.on = true; this.emit('heartHands', {}); } }
      else { tw.since = null; tw.on = false; }
      out.two = heart ? 'heartHands' : null;
      return out;
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
    analyze(src, t, emit) {
      const w = this.w, h = this.h, cx = this.cx;
      cx.save(); cx.scale(-1, 1); cx.drawImage(src, -w, 0, w, h); cx.restore();
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
    st: { light: '相機與光線', body: '人體定位', base: '站姿基準', lane: '左右移動', step: '踏步測試', jump: '跳躍測試', hands: '揮手測試', gesture: '手勢測試', done: '完成' },
    err: {
      denied: '相機權限被拒絕：請在網址列允許使用相機，再按「重新偵測」。', nocam: '找不到相機裝置。', busy: '相機正被其他程式使用，請關閉後重試。',
      insecure: '瀏覽器要求 https 或 localhost 才能使用相機。', unknown: '無法開啟相機。'
    }
  };
  const DEFAULTS = {
    id: 'default', preset: 'body', backend: 'auto', lanes: 3, legs: true, require: ['shoulders'], guides: true, complexity: 'auto', autoGain: true,
    gestures: null, assetBase: null, assetBases: null, inputWidth: 640, roi: null, autoCenter: false, idleMs: 30000, debug: false, handHold: 220
  };

  class MotionKit extends Emitter {
    constructor(o) {
      super();
      this._uo = Object.assign({}, o || {});
      this.video = this._uo.video || (hasDOM ? Object.assign(document.createElement('video'), { muted: true, playsInline: true }) : null);
      this.canvas = this._uo.canvas || null;
      this.rules = []; this.seqs = []; this.log = [];
      this._resolve(this._uo.preset);
      this.S = Object.assign({}, STR, this.o.strings || {});
      this.A = new PoseAnalyzer({ lanes: this.o.lanes, require: this.o.require, thresholds: this.o.thresholds }, (n, d) => this._fire(n, d));
      this.Hd = new HandAnalyzer((n, d) => this._fire(n, d), { hold: this.o.handHold });
      if (hasDOM) {
        this.inCv = document.createElement('canvas'); this.ictx = this.inCv.getContext('2d', { willReadFrequently: true });
        this.lcv = document.createElement('canvas'); this.lcv.width = 64; this.lcv.height = 48; this.lctx = this.lcv.getContext('2d', { willReadFrequently: true });
      }
      this._filterOK = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
      this.gain = 1; this.running = false; this.backend = null; this.model = null; this.mot = null; this.aspect = 4 / 3;
      this.live = { frames: 0, fps: 0, light: null };
      this.saved = this._load(); this.frame = null; this.quality = null; this._lastVT = -1; this._slow = 0;
      this.templates = this._loadTpl();
      if (this.saved && this.saved.th) this.A.tune(this.saved.th);
      if (this.saved && this.saved.complexity != null && this.o.complexity === 'auto') this.complexity = this.saved.complexity;
    }
    /* preset → 選項（遊戲自己傳入的選項優先） */
    _resolve(name) {
      this.preset = PRESETS[name] ? name : 'body';
      const pr = PRESETS[this.preset];
      this.o = Object.assign({}, DEFAULTS, pr, this._uo, { preset: this.preset });
      const w = this._uo.wizard !== undefined ? this._uo.wizard : pr.wizard;
      this.o.wizard = w === false ? false : Object.assign({ tests: ['step', 'jump', 'hands'], fast: true, autoClose: true }, pr.wizard || {}, (this._uo.wizard && typeof this._uo.wizard === 'object') ? this._uo.wizard : {});
      if (this.o.wizard && this.o.legs === false) this.o.wizard.tests = this.o.wizard.tests.filter(k => k !== 'step' && k !== 'jump');
      if (!this._uo.title) this.o.title = (this.o.title || STR.title);
      this.complexity = this.o.complexity === 'auto' ? 1 : this.o.complexity;
    }
    get tier() { return PRESETS[this.preset].tier; }
    capabilities() {
      const all = Object.keys(GESTURE_INFO).filter(k => this.backend === 'holistic' || GESTURE_INFO[k][1] === 'basic');
      const list = this.o.gestures ? all.filter(k => this.o.gestures.includes(k) || SYSTEM.has(k)) : all;
      return this.backend === 'motion' ? ['step'] : list;
    }
    _fire(n, d) {
      if (this.o.gestures && !this.o.gestures.includes(n) && !SYSTEM.has(n) && !this._custom(n)) return;
      const t = now(); this.log.push({ n, t, d }); if (this.log.length > 30) this.log.shift();
      this.emit(n, d);
      if (n !== 'lost' && n !== 'found') this.emit('gesture', { name: n, data: d || {} });
      this._seq(n, t);
    }
    _custom(n) { return this.rules.some(r => r.name === n) || this.seqs.some(s => s.name === n) || this.templates.some(p => p.name === n); }
    _key() { return 'motionkit.v2.' + this.o.id; }
    _load() { try { const s = JSON.parse(localStorage.getItem(this._key())); return s && Date.now() - s.t < 14 * 864e5 ? s : null; } catch (_) { return null; } }
    _save(extra) { try { localStorage.setItem(this._key(), JSON.stringify(Object.assign({ t: Date.now(), th: this.A.th, complexity: this.complexity, deviceId: this.deviceId }, extra))); } catch (_) { } }
    _loadTpl() { try { return JSON.parse(localStorage.getItem(this._key() + '.templates')) || []; } catch (_) { return []; } }
    _saveTpl() { try { localStorage.setItem(this._key() + '.templates', JSON.stringify(this.templates)); } catch (_) { } }
    getProfile() { return { preset: this.preset, th: Object.assign({}, this.A.th), P: Object.assign({}, this.A.P) }; }
    setThresholds(t) { this.A.tune(t); }
    /* 測試/重播：直接餵入 33 點骨架（與可選的手部 21 點） */
    feedLandmarks(lm, t, aspect, hands) {
      t = t == null ? now() : t; const asp = aspect || this.aspect;
      const f = this.A.update(lm, t, asp);
      if (hands) f.handShapes = this.Hd.update(this._assignHands(hands.left, hands.right, asp), t);
      this._after(f, t); return f;
    }

    /* ── 擴充：自訂規則 / 連續動作 / 自訂姿勢 ── */
    defineGesture(name, test, o) { o = o || {}; this.rules.push({ name, test, hold: o.hold || 0, cool: o.cooldown == null ? 800 : o.cooldown, data: o.data }); return this; }
    defineSequence(name, steps, o) { this.seqs.push({ name, steps, within: (o && o.within) || 1500, i: 0, t0: 0 }); return this; }
    _seq(n, t) {
      for (const s of this.seqs) {
        if (n === s.name) continue;
        if (s.i > 0 && t - s.t0 > s.within) s.i = 0;
        if (n === s.steps[s.i]) { if (s.i === 0) s.t0 = t; s.i++; if (s.i >= s.steps.length) { s.i = 0; this._fire(s.name, { sequence: s.steps.slice() }); } }
        else if (n === s.steps[0]) { s.i = 1; s.t0 = t; }
      }
    }
    _ctx(f) {
      const b = this.A.b, S = f.S || 0.25;
      return {
        b, f, S, P: this.A.P, hands: f.handShapes || null,
        ok: function () { return Array.prototype.every.call(arguments, k => b[k] && b[k].ok); },
        angle: (x, y, z) => angle3(b[x], b[y], b[z]),
        above: (x, y, m) => b[x].ok && b[y].ok && b[x].y < b[y].y - (m || 0) * S,
        near: (x, y, k) => b[x].ok && b[y].ok && dist(b[x], b[y]) < (k == null ? 0.3 : k) * S,
        dist: (x, y) => dist(b[x], b[y]) / S
      };
    }
    _rules(f, t) {
      if (!this.rules.length || !f.tracking || !this.A.b || f.backend === 'motion') return;
      const ctx = this._ctx(f);
      for (const r of this.rules) {
        let ok = false; try { ok = !!r.test(ctx); } catch (_) { }
        this.A._hold('rule:' + r.name, ok, r.hold, t, () => this._fire(r.name, r.data ? r.data(ctx) : {}), r.cool);
      }
    }
    async recordPose(name, o) {
      const vs = [];
      await this._waitFn(() => { if (this.A.b && this.frame && this.frame.tracking) vs.push(poseVector(this.A.b)); return vs.length >= 12; }, 4000);
      if (vs.length < 3) return null;
      const v = vs[0].map((_, i) => { const xs = vs.map(x => x[i]).filter(x => x != null); return xs.length >= vs.length / 2 ? median(xs) : null; });
      return this.addTemplate(name, v, o);
    }
    addTemplate(name, vec, o) {
      o = o || {}; this.templates = this.templates.filter(x => x.name !== name);
      const tp = { name, vec, tol: o.tol || 22, hold: o.hold == null ? 400 : o.hold }; this.templates.push(tp); this._saveTpl(); return tp;
    }
    removeTemplate(name) { this.templates = this.templates.filter(x => x.name !== name); this._saveTpl(); }
    _tpl(f, t) {
      if (!this.templates.length || !f.tracking || !this.A.b || f.backend === 'motion') return;
      const v = poseVector(this.A.b); let best = null;
      for (const tp of this.templates) {
        const d = vecDiff(v, tp.vec);
        this.A._hold('tpl:' + tp.name, d < tp.tol, tp.hold, t, () => { const e = { name: tp.name, diff: d, score: Math.round(clamp(100 - d, 0, 100)) }; this._fire('template', e); this._fire(tp.name, e); }, 1500);
        if (!best || d < best.diff) best = { name: tp.name, diff: d };
      }
      f.template = best;
    }

    /* ── 鍵盤 / 觸控模擬（同一套事件，無相機也能玩） ── */
    simulate(n, d) { this._fire(n, Object.assign({ simulated: true }, d || {})); }
    bindKeys(map, target) {
      this.unbindKeys(); const tgt = target || window;
      const h = e => {
        if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return; const tg = e.target;
        if (tg && /INPUT|TEXTAREA|SELECT/.test(tg.tagName || '')) return;
        const v = map[e.code] || map[e.key]; if (!v) return;
        e.preventDefault();
        if (typeof v === 'function') v(e); else if (typeof v === 'string') this.simulate(v); else this.simulate(v.name, v.data);
      };
      tgt.addEventListener('keydown', h); this._keys = () => tgt.removeEventListener('keydown', h); return this._keys;
    }
    unbindKeys() { if (this._keys) this._keys(); this._keys = null; }

    /* ── 相機 ── */
    async _openCam(deviceId) {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { const e = new Error(this.S.err.insecure); e.code = 'insecure'; throw e; }
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      const base = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } };
      const tryGet = v => navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      this.stream = null;
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
      this.track.addEventListener('ended', () => { if (this.running) { this.emit('camera', { status: 'lost' }); this._reconnect(0); } });
      this.video.srcObject = this.stream; this.video.muted = true; this.video.playsInline = true; await this.video.play();
    }
    async _reconnect(n) {
      if (!this.running || n > 12) return; await sleep(1500);
      try { await this._openCam(this.deviceId); this.emit('camera', { status: 'reconnected' }); }
      catch (_) { try { await this._openCam(); this.emit('camera', { status: 'reconnected' }); } catch (e) { this._reconnect(n + 1); } }
    }
    async listCameras() { try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (_) { return []; } }
    async switchCamera(id) { await this._openCam(id); this.A.reset(); this.Hd.reset(); }

    /* ── 後端：holistic → pose → 動態偵測 ── */
    async _loadSolution(kind) {
      const base = (this.o.assetBases && this.o.assetBases[kind]) || (kind === 'pose' && this.o.assetBase) || CDN[kind];
      const G = kind === 'holistic' ? 'Holistic' : 'Pose';
      if (!window[G]) await loadScript(base + '/' + kind + '.js', 15000);
      const m = new window[G]({ locateFile: f => base + '/' + f });
      const opt = { modelComplexity: this.complexity, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 };
      if (kind === 'holistic') opt.refineFaceLandmarks = false;
      m.setOptions(opt); m.onResults(r => this._onResults(r));
      await Promise.race([m.initialize(), new Promise((_, rj) => setTimeout(() => rj(new Error('model timeout')), 30000))]);
      this.model = m; this.backend = kind;
    }
    async _initBackend() {
      if (this.model && this.model.close) { try { this.model.close(); } catch (_) { } }
      this.model = null;
      const want = this.o.backend, order = want === 'motion' ? [] : want === 'holistic' ? ['holistic', 'pose'] : ['pose'];
      let err = null;
      for (let i = 0; i < order.length; i++) {
        try { await this._loadSolution(order[i]); if (i > 0) this.emit('backend', { backend: order[i], reason: 'fallback' }); return; }
        catch (e) { err = e; console.warn('[MotionKit] ' + order[i] + ' 載入失敗：', e.message); }
      }
      if (want === 'pose') { const er = new Error('AI 模型載入失敗：' + (err && err.message)); er.code = 'model'; throw er; }
      this.mot = new MotionBackend(); this.backend = 'motion'; this.emit('backend', { backend: 'motion', reason: order.length ? 'fallback' : 'config' });
    }
    _degrade(reason) {
      if (this.backend === 'motion' || this.o.backend === 'pose') return;
      if (this.backend === 'holistic') { this.o.backend = 'auto'; this._initBackend().catch(() => { }); this.emit('backend', { backend: 'pose', reason }); return; }
      this.mot = this.mot || new MotionBackend(); this.backend = 'motion'; this.emit('backend', { backend: 'motion', reason });
    }

    /* ── 主迴圈（分頁被遮住時改用 setTimeout，避免偵測停止） ── */
    _tick(id) {
      if (!this.running || id !== this._lid) return;
      const next = () => { if (!this.running || id !== this._lid) return; if (document.hidden) setTimeout(() => this._tick(id), 40); else requestAnimationFrame(() => this._tick(id)); };
      const v = this.video;
      if (this.paused || this.busy || v.readyState < 2 || v.currentTime === this._lastVT || !this.backend || (this.backend !== 'motion' && !this.model)) return next();
      this._lastVT = v.currentTime; this.busy = true;
      const t = now(); this._grab(t);
      let p;
      try { p = this.backend === 'motion' ? Promise.resolve(this._motion(t)) : this.model.send({ image: this.inCv }); } catch (e) { p = Promise.reject(e); }
      p.catch(e => { this._errN = (this._errN || 0) + 1; if (this._errN > 5) { this._errN = 0; this._degrade('error'); } })
        .then(() => { this.busy = false; this._perf(t); next(); });
    }
    _grab(t) {
      const v = this.video, vw = v.videoWidth, vh = v.videoHeight; if (!vw) return;
      const r = this.o.roi, sx = r ? r.x * vw : 0, sy = r ? r.y * vh : 0, sw = r ? r.w * vw : vw, sh = r ? r.h * vh : vh;
      const sc = Math.min(1, (this.o.inputWidth || 640) / sw), w = Math.max(2, Math.round(sw * sc)), h = Math.max(2, Math.round(sh * sc));
      const cv = this.inCv; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      this.ictx.filter = this._filterOK && this.gain !== 1 ? 'brightness(' + this.gain.toFixed(2) + ') contrast(1.06)' : 'none';
      this.ictx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h); this.ictx.filter = 'none'; this.aspect = w / h;
      if (!this._lt || t - this._lt > 500) { this._lt = t; this._light(); }
    }
    _mirrorPts(lm, asp) { return lm.map(p => ({ x: (1 - p.x) * asp, y: p.y, z: (p.z || 0) * asp })); }
    /* 依「哪隻手腕離得近」決定左右手，不依賴模型的 handedness 慣例 */
    _assignHands(a, b, asp) {
      const res = { left: null, right: null }, hs = [a, b].filter(x => x && x.length >= 21).map(l => l[0] && l[0].x != null && l.mirrored ? l : this._mirrorPts(l, asp));
      if (!hs.length) return res;
      const B = this.A.b, lw = B && B.lwr.v > 0.2 ? B.lwr : null, rw = B && B.rwr.v > 0.2 ? B.rwr : null;
      if (lw || rw) {
        hs.forEach(h => { const dl = lw ? dist(h[0], lw) : 9, dr = rw ? dist(h[0], rw) : 9; let s = dl <= dr ? 'left' : 'right'; if (res[s]) s = s === 'left' ? 'right' : 'left'; res[s] = res[s] || h; });
      } else { hs.sort((p, q) => p[0].x - q[0].x); res.left = hs[0]; if (hs[1]) res.right = hs[1]; }
      return res;
    }
    _face(fl, t) {
      const asp = this.aspect, d = (i, j) => Math.hypot((fl[i].x - fl[j].x) * asp, fl[i].y - fl[j].y), fh = d(10, 152) || 1, m = d(13, 14) / fh;
      const F = this._fs || (this._fs = { open: false, since: null });
      const want = F.open ? m > 0.04 : m > 0.075;
      if (want !== F.open) { if (F.since == null) F.since = t; if (t - F.since > 150) { F.open = want; F.since = null; this._fire(want ? 'mouthOpen' : 'mouthClose', { ratio: m }); } } else F.since = null;
      return { mouth: m, open: F.open };
    }
    _onResults(r) {
      const t = now(), asp = this.aspect;
      const f = this.A.update(r.poseLandmarks || null, t, asp);
      if (this.backend === 'holistic') {
        f.handShapes = this.Hd.update(this._assignHands(r.leftHandLandmarks, r.rightHandLandmarks, asp), t);
        if (r.faceLandmarks) f.face = this._face(r.faceLandmarks, t);
      }
      this._after(f, t);
    }
    _motion(t) { const f = this.mot.analyze(this.inCv.width ? this.inCv : this.video, t, (n, d) => this._fire(n, d)); this._after(f, t); }
    _after(f, t) {
      t = t == null ? now() : t;
      this.frame = f; this.live.frames++; this._pts = this.A.b;
      if (f.backend !== 'motion') { this._presence(f, t); this._rules(f, t); this._tpl(f, t); }
      this.emit('frame', f);
      if (this.canvas) this.drawOverlay(this.canvas, { guides: this.o.guides });
      if (this._wizDraw) this._wizDraw();
    }
    /* 有人站上 / 離開（展場自動開始、自動重置） */
    _presence(f, t) {
      const here = !!f.tracking, P = this._pres || (this._pres = { on: false, cand: false, since: t, leftAt: null, idle: false });
      if (here !== P.cand) { P.cand = here; P.since = t; }
      if (P.cand !== P.on && t - P.since >= (here ? 500 : 1500)) {
        P.on = P.cand;
        if (P.on) {
          const away = P.leftAt == null ? Infinity : t - P.leftAt; P.idle = false;
          this.emit('presence', { present: true, away });
          if (this.o.autoCenter && this.running && (away > 1500 || !this.A.cal)) this.quickCenter();
        } else { P.leftAt = t; this.emit('presence', { present: false }); }
      }
      if (!P.on && P.leftAt != null && !P.idle && t - P.leftAt > this.o.idleMs) { P.idle = true; this.emit('idle', { away: t - P.leftAt }); }
    }
    _perf(t) {
      const dt = t - (this._pt || t); this._pt = t; if (dt > 0) this.live.fps = lerp(this.live.fps || 30, 1000 / dt, 0.08);
      if (this.live.frames < 45) return;
      const f = this.live.fps;
      if (this.backend !== 'motion' && this.o.complexity === 'auto') {
        this._slow = f < 15 ? this._slow + 1 : 0;
        if (this._slow > 90) {
          this._slow = 0;
          if (this.complexity > 0) { this.complexity = 0; this.model.setOptions({ modelComplexity: 0 }); this.emit('perf', { complexity: 0, fps: f }); }
          else if (f < 8) this._degrade('slow');
        }
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

    /* ── 繪製：鏡像影像 + 骨架 + 手部 + 校正後的跑道/跳躍線 ── */
    drawOverlay(cv, o) {
      o = o || {}; const ctx = cv.getContext('2d'), w = cv.width, h = cv.height, v = this.video;
      const src = this.inCv && this.inCv.width > 2 ? this.inCv : v, vw = src.videoWidth || src.width || 640, vh = src.videoHeight || src.height || 480;
      const sc = Math.max(w / vw, h / vh), dw = vw * sc, dh = vh * sc, ox = (w - dw) / 2, oy = (h - dh) / 2, asp = vw / vh;
      ctx.save(); ctx.clearRect(0, 0, w, h); ctx.translate(ox + dw, oy); ctx.scale(-1, 1); try { ctx.drawImage(src, 0, 0, dw, dh); } catch (_) { } ctx.restore();
      const X = x => ox + (x / asp) * dw, Y = y => oy + y * dh, A = this.A, f = this.frame;
      if (o.guides && A.cal && this.backend !== 'motion' && A.P.cx0 != null) {
        const S = A.P.torso; ctx.save(); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
        if (this.o.lanes > 1) { ctx.strokeStyle = 'rgba(56,189,248,.7)'; A.boundaries().forEach(b => { const x = X(A.P.cx0 + b * S); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }); }
        if (A.base.hip != null && this.o.legs !== false) { const y = Y(A.base.hip - A.th.jumpTh * S); ctx.strokeStyle = 'rgba(251,191,36,.8)'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.fillStyle = '#fde68a'; ctx.font = '10px sans-serif'; ctx.fillText('跳躍線', 4, y - 3); }
        ctx.restore();
      }
      const b = this._pts;
      if (this.backend !== 'motion' && b && f && f.tracking) {
        ctx.lineWidth = 2.4; ctx.lineCap = 'round';
        BONES.forEach(([a, c]) => { const p = b[a], q = b[c]; if (!p.ok || !q.ok) return; ctx.strokeStyle = /el|wr|sh/.test(a + c) && !/hp/.test(a + c) ? '#22d3ee' : /kn|an|ft/.test(a + c) ? '#34d399' : '#e2e8f0'; ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(q.x), Y(q.y)); ctx.stroke(); });
        for (const k in IDX) { const p = b[k]; if (!p.ok) continue; ctx.fillStyle = p.v > 0.8 ? '#38bdf8' : '#fbbf24'; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2.4, 0, 6.3); ctx.fill(); }
        ['left', 'right'].forEach((n, i) => {
          const hd = f.hands && f.hands[n]; if (!hd || !hd.tracked) return;
          ctx.fillStyle = i ? 'rgba(0,229,255,' + (0.35 + hd.energy * 0.6) + ')' : 'rgba(255,215,0,' + (0.35 + hd.energy * 0.6) + ')';
          ctx.beginPath(); ctx.arc(X(hd.x), Y(hd.y), 6 + hd.energy * 9, 0, 6.3); ctx.fill();
        });
        ['l', 'r'].forEach(s => { const lg = A.leg[s], a = b[s + 'an']; if (lg.up && a.ok) { ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(a.x), Y(a.y), 9, 0, 6.3); ctx.stroke(); } });
        if (f.handShapes) ['left', 'right'].forEach(n => {
          const hs = f.handShapes[n]; if (!hs || !hs.tracked) return; const p = hs.pts;
          ctx.strokeStyle = n === 'left' ? '#fde047' : '#67e8f9'; ctx.lineWidth = 1.6;
          HAND_BONES.forEach(([a, c]) => { ctx.beginPath(); ctx.moveTo(X(p[a].x), Y(p[a].y)); ctx.lineTo(X(p[c].x), Y(p[c].y)); ctx.stroke(); });
          if (hs.name) { ctx.font = 'bold 12px system-ui,sans-serif'; const lb = (GESTURE_INFO[hs.name] || [hs.name])[0]; ctx.fillStyle = 'rgba(0,0,0,.6)'; const tw = ctx.measureText(lb).width; ctx.fillRect(X(p[0].x) - tw / 2 - 4, Y(p[0].y) + 6, tw + 8, 16); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(lb, X(p[0].x), Y(p[0].y) + 18); ctx.textAlign = 'start'; }
        });
      } else if (this.backend === 'motion' && f && f.hands) {
        ['left', 'right'].forEach((n, i) => { const hd = f.hands[n]; if (!hd || !hd.tracked) return; ctx.fillStyle = i ? 'rgba(0,229,255,.7)' : 'rgba(255,215,0,.7)'; ctx.beginPath(); ctx.arc((hd.rx * 0.5 + 0.5) * w, (-hd.ry * 0.5 + 0.5) * h, 8, 0, 6.3); ctx.fill(); });
      }
      if (this.o.debug || o.debug) {
        const lines = [this.preset + ' · ' + (this.backend || '-') + ' · ' + Math.round(this.live.fps || 0) + ' FPS', f && f.tracking ? (f.motion || '') + (f.cadence ? ' ' + Math.round(f.cadence) + ' spm' : '') : '未偵測到人體']
          .concat(this.log.slice(-4).reverse().map(e => '• ' + ((GESTURE_INFO[e.n] || [e.n])[0])));
        ctx.font = '11px system-ui,sans-serif'; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(4, 4, 150, 14 * lines.length + 6);
        ctx.fillStyle = '#e2e8f0'; lines.forEach((l, i) => ctx.fillText(l, 9, 17 + i * 14));
      }
    }

    /* ── 啟動 / 停止 / 切換分級 / 重新校正 ── */
    async start(o) {
      if (this.running) return this._res;
      o = o || {}; const wiz = o.wizard !== undefined ? o.wizard : this.o.wizard;
      this._abort = false; const ui = wiz ? this._wizOpen() : null;
      try {
        if (ui) ui.msg('opening'); await this._openCam(this.o.deviceId || (this.saved && this.saved.deviceId));
        if (ui) ui.msg(this.o.backend === 'holistic' ? 'loadingAdv' : 'loading'); await this._initBackend();
        this.running = true; this.live.frames = 0; this._lid = (this._lid || 0) + 1; this._tick(this._lid);
      } catch (e) {
        if (ui) { ui.fail(e.message); ui.closeOnly(); } this._teardown();
        const r = { ok: false, reason: e.code || 'error', message: e.message }; this.emit('error', r); return r;
      }
      let q = null;
      if (ui) q = await this._wizard(ui); else if (!this.o.autoCenter) await this.quickCenter();
      const r = this._res = { ok: true, backend: this.backend, preset: this.preset, tier: this.tier, quality: q }; this.emit('ready', r); return r;
    }
    _teardown() {
      this.running = false; this._abort = true; this._lid = (this._lid || 0) + 1;
      if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
      if (this.video) this.video.srcObject = null;
      this._res = null; this.busy = false; this._pres = null;
    }
    stop() { this._teardown(); this._wizClose(); }
    destroy() { this.stop(); this.unbindKeys(); if (this.model && this.model.close) { try { this.model.close(); } catch (_) { } } this.model = null; this._h = {}; }
    pause() { this.paused = true; }
    resume() { this.paused = false; }
    async setPreset(name, extra) {
      if (!PRESETS[name]) return false;
      if (extra) Object.assign(this._uo, extra);
      const prevBackend = this.o.backend, prevCx = this.complexity;
      this._resolve(name);
      this.A.o.require = this.o.require; this.A.o.lanes = this.o.lanes; this.A.lane = Math.min(this.A.lane, this.o.lanes - 1);
      if (this.running && (prevBackend !== this.o.backend || prevCx !== this.complexity)) {
        this.paused = true; try { await this._initBackend(); } catch (e) { this.emit('error', { ok: false, reason: e.code || 'error', message: e.message }); }
        this.busy = false; this.paused = false; this.Hd.reset();
      }
      this.emit('preset', { preset: name, tier: this.tier, backend: this.backend });
      return true;
    }
    async recalibrate(o) {
      if (!this.running) return this.start(o);
      if ((o && o.wizard === false) || !this.o.wizard) { return this.quickCenter(); }
      this._abort = false; const ui = this._wizOpen(); const q = await this._wizard(ui, true); this.emit('calibrated', q); return q;
    }
    /* 不跳視窗：1.5 秒內重新抓站位中心（遊戲內「重新定位」按鈕、展場換人時自動呼叫） */
    async quickCenter() {
      if (this._centering) return false; this._centering = true;
      this.A.beginBase(); await this._waitFn(() => this.A.baseCount() >= 20, 3500); const r = this.A.endBase();
      this._centering = false; this.emit('calibrated', { quick: true, ok: !!r }); return !!r;
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

    /* ── 取景引導（遊戲也可呼叫 kit.guide() 顯示在自己的畫面上） ── */
    guide() {
      const A = this.A, b = A.b, f = A.out;
      if (this.backend === 'motion') return { ok: true, soft: true, text: '動態偵測模式：請站在畫面中央，雙手與雙腳可自由擺動', lv: 'ok' };
      if (!b || !f || !f.tracking) return { ok: false, soft: false, text: '找不到人體：請站到鏡頭前方，讓上半身入鏡', lv: 'warn' };
      const pts = ['nose', 'lsh', 'rsh', 'lhp', 'rhp', 'lkn', 'rkn', 'lan', 'ran'].map(k => b[k]).filter(p => p.v > 0.4), cov = b.cov;
      const hgt = pts.length ? Math.max.apply(null, pts.map(p => p.y)) - Math.min.apply(null, pts.map(p => p.y)) : 0, cx = b.shC.x / b.aspect;
      const wantLegs = this.o.legs !== false;
      if (!cov.head) return { ok: false, soft: false, text: '頭部沒有入鏡：請稍微後退或調整鏡頭角度', lv: 'warn' };
      if (Math.abs(cx - 0.5) > 0.2) return { ok: false, soft: true, text: cx > 0.5 ? '請往左移動，站到畫面中央' : '請往右移動，站到畫面中央', lv: 'warn' };
      if (wantLegs && !cov.ankles) return { ok: false, soft: true, text: '請再後退一步，讓雙腳入鏡（踏步/跳躍會更準）', lv: 'warn' };
      if (hgt < (wantLegs ? 0.4 : 0.25)) return { ok: false, soft: true, text: '距離太遠：請靠近鏡頭一點', lv: 'warn' };
      if (this.backend === 'holistic' && hgt > 0.85 && wantLegs) return { ok: true, soft: true, text: '站位良好 ✓（手勢要清楚時可把手舉到胸前）', lv: 'ok' };
      return { ok: true, soft: true, text: '站位良好 ✓', lv: 'ok' };
    }
    _guide() { return this.guide(); }

    /* ── 校正精靈流程 ── */
    async _wizard(ui, redo) {
      const A = this.A, W = this.o.wizard || { tests: [] }, pen = [], notes = [], AI = this.backend !== 'motion';
      const fast = !redo && W.fast && this.saved && this.saved.deviceId === this.deviceId && this.saved.tested && this.saved.preset === this.preset;
      const tests = fast ? [] : (W.tests || []);
      const steps = ['light', 'body', 'base'].concat(this.o.lanes > 1 && AI ? ['lane'] : [], AI ? tests : [], ['done']);
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
      if (this.live.fps && this.live.fps < 12) { pen.push(22); notes.push('裝置運算偏慢（' + this.live.fps.toFixed(0) + ' FPS），建議改用「快速基本偵測」'); }
      else if (this.live.fps && this.live.fps < 18) pen.push(10);

      // 2) 人體定位
      ui.stage('body'); let okN = 0, softN = 0;
      const found = await this._waitFn(() => { const g = this.guide(); ui.msg(g.text, g.lv); okN = g.ok ? okN + 1 : 0; softN = g.soft && A.out && A.out.tracking ? softN + 1 : 0; return okN >= 12 || softN >= 70; }, 40000, ui.prog);
      const cov = (A.out && A.out.cov) || {};
      if (!found || ui.skipped) { pen.push(35); notes.push('尚未偵測到人體；站到鏡頭前系統會自動追蹤'); }
      else if (AI) {
        if (this.o.legs !== false) { if (!cov.ankles) { pen.push(15); notes.push('雙腳未入鏡：踏步改用身體上下律動判斷'); } else if (!cov.knees) pen.push(6); }
        if (!cov.hands && this.o.require.indexOf('hands') >= 0) pen.push(10);
      }
      ui.done('body', found && okN >= 1);

      // 3) 站姿基準
      ui.stage('base'); ui.msg('請自然站立、雙手放下，保持不動 2 秒');
      if (AI) {
        A.beginBase(); let prevN = -1, stall = 0;
        await this._waitFn(() => { const n = A.baseCount(); stall = n === prevN ? stall + 1 : 0; prevN = n; ui.msg(stall > 12 ? '偵測到晃動，請保持不動…' : '請自然站立、雙手放下，保持不動 2 秒', stall > 12 ? 'warn' : 'info'); return n >= 40; }, 16000, () => ui.prog(A.baseCount() / 40));
        const bs = A.endBase();
        if (!bs) { pen.push(15); notes.push('站姿基準不足，已使用預設值'); }
        else { if (bs.jitter > 0.012) { pen.push(8); notes.push('骨架偵測有些抖動（光線/衣著對比）'); } if (!bs.arms) A.P.arm = null; }
        ui.done('base', !!bs);
      } else {
        this.mot.beginLearn(); await this._waitFn(() => this.mot.learnCount() >= 36, 8000, () => ui.prog(this.mot.learnCount() / 36)); this.mot.endLearn(); ui.done('base', true);
      }

      // 4) 左右移動範圍
      const calTested = !fast && AI;
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
      if (AI) for (const k of tests) {
        ui.stage(k);
        if (k === 'step') {
          ui.msg('請原地踏步（輪流抬腳）約 6 步'); A.tm = 0.6; A.startRec(['step']);
          await this._waitFn(() => { const n = A.rec.step.length; ui.prog(n / 6); return n >= 6; }, 12000);
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
        } else if (k === 'gesture') {
          if (this.backend !== 'holistic') { ui.done(k, false); notes.push('進階手勢模型未載入，已改用骨架動作'); continue; }
          ui.msg('請把手舉到胸前，比出「讚 👍」或「YA ✌」'); let got = null; const off = this.on('handShape', e => { got = e.name; });
          await this._waitFn(() => !!got, 9000, ui.prog); off();
          if (got) ui.done(k, true); else { pen.push(4); notes.push('未偵測到手指手勢：請把手靠近鏡頭、掌心朝鏡頭'); ui.done(k, false); }
        }
        await sleep(300);
      }

      // 6) 完成
      ui.stage('done'); const score = clamp(Math.round(100 - pen.reduce((a, b) => a + b, 0)), 5, 100);
      const label = score >= 85 ? '優秀' : score >= 65 ? '良好' : score >= 45 ? '尚可' : '建議調整環境';
      const caps = { hands: !!cov.hands || !AI, feet: !!cov.ankles, jump: !!cov.hips, lane: this.o.lanes > 1 && AI, fingers: this.backend === 'holistic', steps: !AI ? 'motion' : cov.ankles ? 'legs' : 'bounce' };
      const q = this.quality = { score, label, notes, caps, backend: this.backend, preset: this.preset, fps: Math.round(this.live.fps || 0), light: L.status, thresholds: Object.assign({}, A.th) };
      this._save({ preset: this.preset, tested: fast || (calTested && tests.length > 0) || (this.saved && this.saved.tested) });
      this.emit('calibrated', q);
      await ui.summary(q, W.autoClose);
      this._wizClose(); return q;
    }

    /* ── 精靈 UI（自帶樣式，不依賴遊戲 CSS） ── */
    _wizOpen() {
      if (!hasDOM) return null;
      this._wizClose();
      if (!document.getElementById('mk-style')) {
        const st = document.createElement('style'); st.id = 'mk-style';
        st.textContent = '.mk-wiz{position:fixed;inset:0;z-index:2147483000;background:rgba(2,6,14,.82);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-family:system-ui,"Noto Sans TC",sans-serif;color:#e2e8f0}.mk-card{width:min(860px,94vw);max-height:94vh;overflow:auto;background:#0b1220;border:1px solid #1e3a5f;border-radius:18px;box-shadow:0 20px 60px #000a;padding:14px}.mk-head{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:10px}.mk-head b{font-size:15px;color:#67e8f9}.mk-head small{color:#94a3b8;font-size:11px;margin-left:6px}.mk-head select,.mk-head button,.mk-foot button{background:#13213a;color:#cbd5e1;border:1px solid #2a4a75;border-radius:9px;padding:5px 10px;font-size:12px;cursor:pointer}.mk-main{display:grid;grid-template-columns:1.3fr 1fr;gap:12px}@media(max-width:640px){.mk-main{grid-template-columns:1fr}}.mk-view{position:relative;background:#000;border-radius:12px;overflow:hidden;aspect-ratio:4/3}.mk-view canvas{width:100%;height:100%;display:block}.mk-msg{position:absolute;left:0;right:0;bottom:0;padding:9px 12px;font-size:14px;font-weight:700;text-align:center;background:linear-gradient(transparent,#000d 55%);color:#a5f3fc}.mk-msg.warn{color:#fde68a}.mk-msg.bad{color:#fda4af}.mk-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.mk-steps li{display:flex;gap:8px;align-items:center;padding:7px 10px;border-radius:10px;background:#0f1a2e;border:1px solid #1b2c49;font-size:13px;color:#7b8aa5}.mk-steps li.on{color:#e0f2fe;border-color:#22d3ee;background:#0c2a3d}.mk-steps li.ok{color:#86efac}.mk-steps li.no{color:#fcd34d}.mk-steps li i{font-style:normal;width:18px;text-align:center}.mk-bar{height:6px;background:#13213a;border-radius:6px;overflow:hidden;margin:10px 0}.mk-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#22d3ee,#34d399);transition:width .15s}.mk-foot{display:flex;gap:8px;justify-content:flex-end;align-items:center}.mk-foot .go{background:linear-gradient(90deg,#22d3ee,#34d399);color:#04121f;font-weight:800;border:0}.mk-sum{font-size:12.5px;line-height:1.7;color:#cbd5e1;margin-top:10px}.mk-sum b{color:#67e8f9}.mk-score{font-size:30px;font-weight:900;color:#34d399;margin-right:8px}';
        document.head.appendChild(st);
      }
      const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
      const wrap = el('div', 'mk-wiz'), card = el('div', 'mk-card'), head = el('div', 'mk-head'), title = el('b', '', this.o.title), tools = el('div'), sel = el('select'), skip = el('button', '', this.S.skip), redo = el('button', '', this.S.redo);
      title.append(el('small', '', PRESETS[this.preset].label));
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
      const TX = { opening: '正在開啟相機…（請在瀏覽器提示中按「允許」）', loading: '正在載入 AI 姿勢模型…（首次需下載，請稍候）', loadingAdv: '正在載入進階手勢模型…（檔案較大，首次約需 10–30 秒）' };
      ui.msg = (m, lv) => { msg.textContent = TX[m] || m; msg.className = 'mk-msg ' + (lv === 'warn' ? 'warn' : lv === 'bad' ? 'bad' : ''); };
      ui.fail = m => { ui.msg(m, 'bad'); fill.style.width = '0'; };
      ui.prog = p => { fill.style.width = Math.round(clamp(p, 0, 1) * 100) + '%'; };
      ui.setSteps = ids => { ol.innerHTML = ''; ui.lis = {}; ids.forEach(id => { const li = el('li', '', ''); li.append(el('i', '', '○'), el('span', '', this.S.st[id] || id)); ol.append(li); ui.lis[id] = li; }); };
      ui.stage = id => { Object.keys(ui.lis).forEach(k => { if (ui.lis[k].className === 'on') ui.lis[k].className = ''; }); const li = ui.lis[id]; if (li) { li.className = 'on'; li.firstChild.textContent = '●'; } ui.prog(0); };
      ui.done = (id, ok) => { const li = ui.lis[id]; if (li) { li.className = ok ? 'ok' : 'no'; li.firstChild.textContent = ok ? '✓' : '⚠'; } ui.prog(1); };
      ui.summary = (q, auto) => new Promise(res => {
        if (ui.skipped) return res();
        const li = ui.lis.done; if (li) { li.className = 'ok'; li.firstChild.textContent = '✓'; }
        const c = q.caps, yn = v => v ? '✓' : '✗', bk = { pose: 'AI 骨架偵測', holistic: 'AI 骨架＋手指', motion: '動態偵測' }[q.backend] || q.backend;
        sum.innerHTML = '<div><span class="mk-score">' + q.score + '</span><b>' + q.label + '</b>（' + bk + ' · ' + q.fps + ' FPS）</div>' +
          '<div>雙手 ' + yn(c.hands) + '　雙腳 ' + yn(c.feet) + '　跳躍 ' + yn(c.jump) + '　左右跑道 ' + yn(c.lane) + '　手指手勢 ' + yn(c.fingers) + '　踏步方式：' + ({ legs: '腿部追蹤', bounce: '身體律動', motion: '動態偵測' }[c.steps] || '-') + '</div>' +
          (q.notes.length ? '<div>' + q.notes.map(n => '・' + n).join('<br>') + '</div>' : '');
        ui.msg('校正完成！', 'info'); go.disabled = false; ui._goRes = res; go.onclick = res;
        if (auto && q.score >= 65 && !q.notes.length) setTimeout(res, 2200);
      });
      ui.msg('opening'); return ui;
    }
    _wizClose() { if (this._ui) { try { this._ui.el.remove(); } catch (_) { } if (this._ui._fin) this._ui._fin(); this._ui = null; } this._wizDraw = null; }
  }

  const GESTURES = Object.keys(GESTURE_INFO).concat(['lost', 'found', 'presence', 'idle', 'template', 'gesture']);
  return {
    VERSION, PRESETS, GESTURE_INFO, GESTURES,
    create: o => new MotionKit(o), MotionKit, PoseAnalyzer, HandAnalyzer, MotionBackend, OneEuro,
    classifyHand, poseVector, vecDiff, angle3
  };
});
