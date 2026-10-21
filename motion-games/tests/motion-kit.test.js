/* MotionKit 動作辨識單元測試（Node 執行，不需相機）
 * 執行：node motion-games/tests/motion-kit.test.js
 * 以合成的 MediaPipe 骨架/手部座標驗證各動作是否觸發、是否誤觸。 */
'use strict';
const assert = require('assert');
const MK = require('../motion-kit.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

/* ── 合成骨架：以「鏡像後的畫面座標」描述（sx 小 = 畫面左 = 玩家左手側），再轉回影像座標 ── */
const ASPECT = 4 / 3;
function standing() {
  return {
    nose: [0.5, 0.2], lsh: [0.44, 0.32], rsh: [0.56, 0.32], lel: [0.42, 0.47], rel: [0.58, 0.47],
    lwr: [0.42, 0.6], rwr: [0.58, 0.6], lhp: [0.46, 0.62], rhp: [0.54, 0.62],
    lkn: [0.46, 0.78], rkn: [0.54, 0.78], lan: [0.46, 0.95], ran: [0.54, 0.95]
  };
}
const MAP = { nose: 0, lsh: 11, rsh: 12, lel: 13, rel: 14, lwr: 15, rwr: 16, lhp: 23, rhp: 24, lkn: 25, rkn: 26, lan: 27, ran: 28 };
function toLm(p) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  for (const k in MAP) lm[MAP[k]] = { x: 1 - p[k][0], y: p[k][1], z: 0, visibility: 0.99 };
  // 手指點（index/pinky）貼近手腕
  lm[19] = Object.assign({}, lm[15]); lm[17] = Object.assign({}, lm[15]);
  lm[20] = Object.assign({}, lm[16]); lm[18] = Object.assign({}, lm[16]);
  lm[31] = Object.assign({}, lm[27], { y: lm[27].y + 0.02 }); lm[32] = Object.assign({}, lm[28], { y: lm[28].y + 0.02 });
  return lm;
}
/* 建立分析器並先餵 1.5 秒站姿當基準；回傳 { A, ev, t, feed } */
function rig(opts) {
  const ev = [];
  const A = new MK.PoseAnalyzer(Object.assign({ lanes: 3 }, opts), (n, d) => ev.push({ n, d }));
  let t = 1000;
  const feed = (p, ms) => { const end = t + ms; while (t < end) { A.update(toLm(p), t, ASPECT); t += 33; } };
  feed(standing(), 1500);
  ev.length = 0;
  return { A, ev, feed, names: () => ev.map(e => e.n) };
}
const has = (r, n) => r.names().includes(n);

console.log('PoseAnalyzer 姿勢');
test('站立不動不會誤觸任何動作', () => {
  const r = rig(); r.feed(standing(), 3000);
  assert.deepStrictEqual(r.names().filter(n => n !== 'found'), []);
});
test('頭上比愛心 → heart，且不觸發 handsUp', () => {
  const r = rig(), p = standing();
  Object.assign(p, { lwr: [0.49, 0.08], rwr: [0.51, 0.08], lel: [0.36, 0.2], rel: [0.64, 0.2] });
  r.feed(p, 800);
  assert.ok(has(r, 'heart'), '應觸發 heart，實際：' + r.names());
  assert.ok(!has(r, 'handsUp'), '比愛心不應觸發 handsUp');
});
test('雙手高舉 → handsUp（不是愛心）', () => {
  const r = rig(), p = standing();
  Object.assign(p, { lwr: [0.40, 0.05], rwr: [0.60, 0.05], lel: [0.42, 0.18], rel: [0.58, 0.18] });
  r.feed(p, 800);
  assert.ok(has(r, 'handsUp')); assert.ok(!has(r, 'heart'));
});
test('Y 字歡呼 → yPose', () => {
  const r = rig(), p = standing();
  Object.assign(p, { lwr: [0.30, 0.05], rwr: [0.70, 0.05], lel: [0.37, 0.18], rel: [0.63, 0.18] });
  r.feed(p, 800);
  assert.ok(has(r, 'yPose'), r.names());
});
test('雙手胸前交叉 → cross', () => {
  const r = rig(), p = standing();
  Object.assign(p, { lwr: [0.56, 0.45], rwr: [0.44, 0.45], lel: [0.45, 0.5], rel: [0.55, 0.5] });
  r.feed(p, 800);
  assert.ok(has(r, 'cross'), r.names());
});
test('右手舉高 → raiseHand(right)', () => {
  const r = rig(), p = standing();
  Object.assign(p, { rwr: [0.6, 0.05], rel: [0.6, 0.18] });
  r.feed(p, 800);
  const e = r.ev.find(x => x.n === 'raiseHand');
  assert.ok(e && e.d.side === 'right', r.names());
});
test('左臂側平舉、右手放下 → armPoint(left)', () => {
  const r = rig(), p = standing();
  Object.assign(p, { lel: [0.34, 0.32], lwr: [0.24, 0.32] });
  r.feed(p, 900);
  const e = r.ev.find(x => x.n === 'armPoint');
  assert.ok(e && e.d.side === 'left', r.names());
});
test('上半身向右傾 → lean(right)', () => {
  const r = rig(), p = standing();
  for (const k of ['nose', 'lsh', 'rsh', 'lel', 'rel', 'lwr', 'rwr']) p[k] = [p[k][0] + 0.08, p[k][1]];
  r.feed(p, 600);
  const e = r.ev.find(x => x.n === 'lean');
  assert.ok(e && e.d.side === 'right', r.names());
});
test('點頭 → nod；搖頭 → shake', () => {
  const r = rig();
  for (let i = 0; i < 8; i++) { const p = standing(); p.nose = [0.5, 0.2 + (i % 2 ? 0.035 : -0.035)]; r.feed(p, 170); }
  assert.ok(has(r, 'nod'), '點頭：' + r.names());
  const r2 = rig();
  for (let i = 0; i < 8; i++) { const p = standing(); p.nose = [0.5 + (i % 2 ? 0.03 : -0.03), 0.2]; r2.feed(p, 170); }
  assert.ok(has(r2, 'shake'), '搖頭：' + r2.names());
});

console.log('PoseAnalyzer 腳步與跑步');
function runAt(spm, secs) {
  const r = rig(), half = 60000 / spm;
  let side = 0;
  for (let ms = 0; ms < secs * 1000; ms += half) {
    const p = standing(), s = side++ % 2 ? 'r' : 'l';
    p[s + 'an'] = [p[s + 'an'][0], 0.86]; p[s + 'kn'] = [p[s + 'kn'][0], 0.72];
    r.feed(p, Math.min(150, half / 2)); r.feed(standing(), half - Math.min(150, half / 2));
  }
  return r;
}
test('原地踏步（90 步/分）→ step 且狀態為 walk', () => {
  const r = runAt(90, 4);
  assert.ok(r.names().filter(n => n === 'step').length >= 4, r.names());
  const m = r.ev.filter(e => e.n === 'motion').map(e => e.d.state);
  assert.ok(m.includes('walk'), '狀態：' + m);
  assert.ok(!has(r, 'run'));
});
test('快速踏步（165 步/分）→ run 事件', () => {
  const r = runAt(165, 4);
  assert.ok(has(r, 'run'), r.ev.filter(e => e.n === 'motion').map(e => e.d.state));
});
test('停下後狀態回到 idle', () => {
  const r = runAt(120, 3); r.feed(standing(), 2500);
  const m = r.ev.filter(e => e.n === 'motion').map(e => e.d.state);
  assert.strictEqual(m[m.length - 1], 'idle');
});
test('左右移動 → lane 切換', () => {
  const r = rig();
  const shift = dx => { const p = standing(); for (const k in p) p[k] = [p[k][0] + dx, p[k][1]]; return p; };
  r.feed(shift(0.25), 700);
  const e = r.ev.filter(x => x.n === 'lane').pop();
  assert.ok(e && e.d.lane === 2, r.names());
});

console.log('手指手勢 classifyHand');
/* 直立手掌：手腕在下，手指朝上；f = [拇指, 食指, 中指, 無名指, 小指] true=伸直 */
function hand(f, opt) {
  opt = opt || {};
  const P = [], o = [0.5, 0.7], s = 0.25, at = (x, y) => ({ x: o[0] + x * s, y: o[1] + y * s, z: 0 });
  P[0] = at(0, 0);
  P[1] = at(-0.08, -0.08);
  if (f[0]) { P[2] = at(-0.14, -0.16); P[3] = at(-0.2, -0.23); P[4] = at(-0.29, -0.33); }
  else { P[2] = at(-0.09, -0.15); P[3] = at(-0.05, -0.2); P[4] = at(0.0, -0.2); }
  const mcp = [[-0.06, -0.32], [-0.02, -0.34], [0.02, -0.32], [0.06, -0.28]];
  mcp.forEach(([mx, my], i) => {
    const b = 5 + i * 4; P[b] = at(mx, my);
    if (f[i + 1]) { P[b + 1] = at(mx, my - 0.12); P[b + 2] = at(mx, my - 0.2); P[b + 3] = at(mx, my - 0.27); }
    else { P[b + 1] = at(mx, my - 0.08); P[b + 2] = at(mx, my - 0.02); P[b + 3] = at(mx, my + 0.03); }
  });
  if (opt.ok) { P[6] = at(-0.08, -0.44); P[7] = at(-0.11, -0.42); P[8] = at(-0.1, -0.36); P[2] = at(-0.12, -0.18); P[3] = at(-0.12, -0.27); P[4] = at(-0.1, -0.35); }
  return P;
}
const thumbsUpHand = () => {
  const o = [0.5, 0.7], s = 0.25, at = (x, y) => ({ x: o[0] + x * s, y: o[1] + y * s, z: 0 });
  const P = [at(0, 0), at(-0.05, -0.15), at(-0.08, -0.35), at(-0.08, -0.5), at(-0.08, -0.65)];
  [[0.1, -0.35], [0.12, -0.25], [0.12, -0.15], [0.1, -0.06]].forEach(([mx, my]) => { P.push(at(mx, my), at(mx + 0.1, my), at(mx + 0.12, my + 0.05), at(mx + 0.07, my + 0.07)); });
  return P;
};
const cases = [
  ['open', hand([1, 1, 1, 1, 1])], ['fist', hand([0, 0, 0, 0, 0])], ['victory', hand([0, 1, 1, 0, 0])],
  ['point', hand([0, 1, 0, 0, 0])], ['three', hand([0, 1, 1, 1, 0])], ['four', hand([0, 1, 1, 1, 1])],
  ['love', hand([1, 1, 0, 0, 1])], ['rock', hand([0, 1, 0, 0, 1])], ['call', hand([1, 0, 0, 0, 1])],
  ['ok', hand([0, 0, 1, 1, 1], { ok: true })], ['thumbsUp', thumbsUpHand()]
];
cases.forEach(([want, pts]) => test(want, () => { const c = MK.classifyHand(pts); assert.strictEqual(c.name, want, '手指 ' + c.ext.map(Number).join('')); }));
test('倒讚 = 讚的上下翻轉', () => {
  const p = thumbsUpHand().map(q => ({ x: q.x, y: 1.4 - q.y, z: 0 }));
  assert.strictEqual(MK.classifyHand(p).name, 'thumbsDown');
});

console.log('HandAnalyzer 穩定判斷');
test('同一手勢連續 6 幀才觸發一次（不重複觸發）', () => {
  const ev = [], H = new MK.HandAnalyzer((n, d) => ev.push(n));
  let t = 0; for (let i = 0; i < 20; i++) { H.update({ left: hand([0, 1, 1, 0, 0]), right: null }, t); t += 33; }
  assert.strictEqual(ev.filter(n => n === 'victory').length, 1, ev.join(','));
});
test('單幀雜訊不會觸發', () => {
  const ev = [], H = new MK.HandAnalyzer((n) => ev.push(n));
  let t = 0; for (let i = 0; i < 20; i++) { H.update({ left: i === 10 ? hand([1, 1, 0, 0, 1]) : hand([0, 0, 0, 0, 0]), right: null }, t); t += 33; }
  assert.ok(!ev.includes('love'), ev.join(','));
});
test('雙手比心 → heartHands', () => {
  const ev = [], H = new MK.HandAnalyzer((n) => ev.push(n));
  const mk = dx => { const o = [0.5 + dx, 0.6], s = 0.2, at = (x, y) => ({ x: o[0] + x * s, y: o[1] + y * s, z: 0 }); const P = hand([0, 0, 0, 0, 0]).map(q => at((q.x - 0.5) / 0.25, (q.y - 0.7) / 0.25)); P[8] = { x: 0.5, y: 0.5, z: 0 }; P[4] = { x: 0.5, y: 0.62, z: 0 }; return P; };
  let t = 0; for (let i = 0; i < 20; i++) { H.update({ left: mk(-0.06), right: mk(0.06) }, t); t += 33; }
  assert.ok(ev.includes('heartHands'), ev.join(','));
});

console.log('MotionKit 擴充 API');
test('defineGesture 自訂規則（右手摸頭）', () => {
  const kit = MK.create({ id: 't1' }), got = [];
  kit.defineGesture('touchHead', c => c.near('rwr', 'nose', 0.35), { hold: 200 });
  kit.on('touchHead', () => got.push(1));
  let t = 1000; const feed = (p, ms) => { const e = t + ms; while (t < e) { kit.feedLandmarks(toLm(p), t, ASPECT); t += 33; } };
  feed(standing(), 1200);
  const p = standing(); p.rwr = [0.53, 0.21]; p.rel = [0.62, 0.3]; feed(p, 600);
  assert.strictEqual(got.length, 1);
});
test('defineSequence 連續動作（蹲下→跳躍）與 gestures 白名單', () => {
  const kit = MK.create({ id: 't2', preset: 'quick' }), got = [];
  kit.defineSequence('superJump', ['squat', 'jump'], { within: 2000 });
  kit.on('superJump', () => got.push('s')); kit.on('kick', () => got.push('kick'));
  kit.simulate('squat'); kit.simulate('jump'); kit.simulate('kick');
  assert.deepStrictEqual(got, ['s'], 'quick 分級不含 kick，應被白名單擋下');
});
test('addTemplate 自訂姿勢比對', () => {
  const kit = MK.create({ id: 't3' }), got = [];
  let t = 1000; const feed = (p, ms) => { const e = t + ms; while (t < e) { kit.feedLandmarks(toLm(p), t, ASPECT); t += 33; } };
  const pose = standing(); Object.assign(pose, { lel: [0.34, 0.32], lwr: [0.34, 0.18] }); // 左手 L 形
  feed(pose, 300);
  kit.addTemplate('Lpose', MK.poseVector(kit.A.b), { hold: 200 });
  kit.on('Lpose', e => got.push(e.score));
  feed(standing(), 800); assert.strictEqual(got.length, 0, '站姿不應符合');
  feed(pose, 700); assert.strictEqual(got.length, 1, '擺出 L 形應符合');
});
test('preset 分級設定', () => {
  assert.strictEqual(MK.create({ preset: 'quick' }).o.wizard, false);
  assert.strictEqual(MK.create({ preset: 'advanced' }).o.backend, 'holistic');
  const k = MK.create({ preset: 'hands' }); assert.strictEqual(k.o.legs, false); assert.deepStrictEqual(k.o.wizard.tests, ['hands']);
  assert.strictEqual(MK.create({ preset: 'quick', lanes: 3 }).o.lanes, 3, '遊戲自己的設定要優先');
});

console.log(`\n${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
