/* 瀏覽器煙霧測試（Playwright + Chromium，無頭模式、假鏡頭）
 * 先在倉庫根目錄開伺服器：npx http-server . -p 8765 -c-1
 * 再執行：node motion-games/tests/smoke.js [http://localhost:8765/motion-games/]
 * 檢查：每頁無 JS 錯誤；三個遊戲頁的彈出資訊視窗、主控/鏡像同步、遙控字體、關閉後還原；測試台鍵盤模擬。
 * 需要網路（Tailwind / three.js / MediaPipe 由 CDN 載入）。 */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/motion-games/';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch({ args: ARGS });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, permissions: ['camera'] });
  const errs = [];
  const watch = (p, tag) => { p.on('pageerror', e => errs.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(tag + ': ' + m.text()); }); };

  for (const page of ['index.html', 'motion-lab.html']) {
    const p = await ctx.newPage(); watch(p, page); await p.goto(BASE + page); await p.waitForTimeout(1200);
    if (page === 'motion-lab.html') {
      await p.keyboard.press('Space'); await p.keyboard.press('KeyH'); await p.waitForTimeout(200);
      ok(await p.evaluate(() => document.getElementById('n-step').textContent === '1' && document.getElementById('n-heart').textContent === '1'), 'motion-lab：鍵盤模擬踏步、愛心有計數');
    } else ok(true, page + ' 載入');
    await p.close();
  }

  // 每個遊戲：[頁面, 讀分數的運算式, 在彈出視窗按的按鈕]
  const games = [
    ['3d-09-dragon-lion.html', 'gameState.score', '#btn-tanggu-drum'],
    ['3d-10-slow-jog.html', 'state.steps', '#btn-tap-step'],
    ['game-template.html', 'G.score', '[data-g=jump]']
  ];
  for (const [page, scoreExpr, btn] of games) {
    console.log(page);
    const a = await ctx.newPage(); watch(a, page); await a.goto(BASE + page); await a.waitForTimeout(1800);
    const score = p => p.evaluate(e => eval(e), scoreExpr);
    const [pop] = await Promise.all([ctx.waitForEvent('page'), a.evaluate(() => { ds.popout('info'); return 1; })]);
    watch(pop, page + '(popup)'); await pop.waitForLoadState('load'); await pop.waitForTimeout(2200);
    const L = p => p.evaluate(() => [ds.layout, ds.isAuthority, ds.peers.size]);
    const [la, lp] = [await L(a), await L(pop)];
    ok(la[0] === 'stage' && la[1] && lp[0] === 'info' && !lp[1] && la[2] === 1, '彈出後：主視窗=僅舞台/主控，彈出視窗=僅資訊/鏡像 ' + JSON.stringify([la, lp]));
    const s0 = await score(a);
    await pop.click(btn); await pop.waitForTimeout(150); await pop.click(btn); await a.bringToFront(); await a.waitForTimeout(700);
    const s1 = await score(a), s1p = await score(pop);
    ok(s1 > s0 && s1p === s1, '彈出視窗按鈕 → 主控端計分並同步回來（' + s0 + ' → ' + s1 + '，鏡像 ' + s1p + '）');
    await pop.evaluate(() => ds.setFont(1.4)); await a.evaluate(() => ds.bumpFont(0.2)); await pop.waitForTimeout(500);
    ok(Math.abs(await pop.evaluate(() => ds.font) - 1.6) < 0.01 && await pop.evaluate(() => ds.scaleEl.style.zoom) === '1.6', '舞台視窗遙控資訊字體 1.4 → 1.6');
    await pop.close({ runBeforeUnload: true }); await a.bringToFront(); for (let i = 0; i < 30 && (await L(a))[0] !== 'split'; i++) await a.waitForTimeout(200); // 軟體繪圖時計時器較慢，最多等 6 秒
    const after = await a.evaluate(() => [ds.layout, !!ds.popup, ds.popup && ds.popup.closed, !!ds._pw, document.visibilityState]);
    ok(after[0] === 'split', '關閉彈出視窗後主視窗還原並排' + (after[0] === 'split' ? '' : ' ' + JSON.stringify(after)));
    await a.evaluate(() => ds.setLayout('float')); await a.waitForTimeout(400);
    ok(await a.evaluate(() => getComputedStyle(ds.infoEl).position === 'fixed'), '浮動資訊版面');
    await a.evaluate(() => ds.setLayout('split'));
    await a.close();
  }
  ok(errs.length === 0, '沒有 JS 錯誤' + (errs.length ? '：\n    ' + errs.join('\n    ') : ''));
  await b.close();
  console.log(fails ? fails + ' 項失敗' : '全部通過');
  process.exit(fails ? 1 : 0);
})();
