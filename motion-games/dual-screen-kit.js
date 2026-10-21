/*!
 * DualScreenKit v1.0.0 — 雙視窗 / 雙螢幕展演共用模組（單檔、無需打包）
 *
 * 一個遊戲分成兩塊：stage（全螢幕 3D 主舞台）與 info（導覽與資訊視窗）。
 *   版面 layout：split 並排 ｜ float 資訊浮動在舞台上 ｜ stage 僅舞台 ｜ info 僅資訊
 *   彈出視窗：popout('info') 會用同一個網址開新視窗（?ds=info），可拖到另一個螢幕；
 *            視窗位置與大小會記住，下次自動開在同一個螢幕。
 *   送到副螢幕：sendToOtherScreen() 用 Window Management API 直接放到第二個螢幕並全螢幕。
 *   字體大小：資訊區可 A−／A+ 調整（70%–300%），每種版面各自記住；舞台視窗也能遙控副螢幕字體。
 *   同步：有舞台的視窗是「主控端」，負責遊戲邏輯並定時送出 snapshot()；
 *        只有資訊的視窗是「鏡像端」，用 apply() 顯示狀態，按鈕用 command() 交給主控端執行。
 *
 * 最小用法：
 *   const ds = DualScreen.create({
 *     app: 'my-game', title: '我的遊戲',
 *     stage: '#stage', info: '#info', scale: '#info-content',
 *     toolbar: { mount: '#ds-slot' },
 *     snapshot: () => view, apply: v => render(v), onLayout: l => resize()
 *   });
 *   ds.handle('jump', d => doJump(d));   // 主控端執行
 *   button.onclick = () => ds.command('jump', { power: 1 });  // 任一視窗都能呼叫
 *
 * 完整說明請見 docs/DUAL_SCREEN_SPEC.md
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DualScreen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = '1.0.0';
  const LAYOUTS = ['split', 'float', 'stage', 'info'];
  const LABEL = { split: '並排', float: '浮動資訊', stage: '僅舞台', info: '僅資訊' };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = s => typeof s === 'string' ? document.querySelector(s) : s;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { } }
  };
  const uid = () => Math.random().toString(36).slice(2, 9);

  /* 極簡線條圖示（不依賴其他檔案） */
  const IC = {
    pop: '<path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    screen: '<rect x="2" y="4" width="13" height="10" rx="1.5"/><path d="M6 18h5M8.5 14v4M17 8h4v10h-9v-2"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    exitfull: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    minus: '<path d="M6 12h12"/>', plus: '<path d="M12 6v12M6 12h12"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M13 4v16"/>',
    float: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="11" width="7" height="7" rx="1"/>',
    stage: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 15l3-4 2 2.5 2-2 2 3.5"/>',
    info: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>',
    dock: '<path d="M4 14h6v6M4 20l7-7M20 10h-6V4M20 4l-7 7"/>',
    grip: '<circle cx="9" cy="7" r="1"/><circle cx="15" cy="7" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="17" r="1"/><circle cx="15" cy="17" r="1"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  const svg = (k, s) => '<svg viewBox="0 0 24 24" width="' + (s || 16) + '" height="' + (s || 16) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + '</svg>';

  const CSS = `
.ds-l-stage [data-ds=info]{display:none!important}
.ds-l-stage [data-ds=stage],.ds-l-float [data-ds=stage]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;z-index:1}
.ds-l-info [data-ds=stage]{display:none!important}
.ds-l-info [data-ds=info]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;border-radius:0!important;overflow:auto!important;z-index:2}
.ds-l-float [data-ds=info]{position:fixed!important;z-index:60;overflow:auto!important;resize:both;border-radius:16px!important;box-shadow:0 30px 80px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.14)!important;max-width:96vw!important;max-height:94vh!important;min-width:280px;min-height:160px;animation:ds-pop .42s cubic-bezier(.2,1.25,.35,1)}
.ds-float-head{display:none}
.ds-l-float .ds-float-head{display:flex;position:sticky;top:0;z-index:5;align-items:center;gap:6px;height:28px;padding:0 6px 0 4px;margin:-1px -1px 6px;background:rgba(10,14,22,.82);backdrop-filter:blur(8px);color:#cbd5e1;font:600 12px/1 system-ui,"Noto Sans TC",sans-serif;cursor:grab;user-select:none;border-bottom:1px solid rgba(255,255,255,.1)}
.ds-float-head:active{cursor:grabbing}.ds-float-head span{flex:1;opacity:.8}
.ds-float-head button{all:unset;display:grid;place-items:center;width:22px;height:22px;border-radius:6px;cursor:pointer;color:#cbd5e1}.ds-float-head button:hover{background:rgba(255,255,255,.12);color:#fff}
@keyframes ds-pop{0%{opacity:0;transform:translateY(40px) scale(.72)}60%{opacity:1;transform:translateY(-4px) scale(1.02)}100%{transform:none}}
@keyframes ds-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.ds-bar{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:12px;background:rgba(8,12,20,.72);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.12);color:#e2e8f0;font:600 11px/1 system-ui,"Noto Sans TC",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);transition:opacity .35s;z-index:2147482000;user-select:none}
.ds-bar.float{position:fixed}.ds-bar.tr{top:10px;right:10px}.ds-bar.tl{top:10px;left:10px}.ds-bar.br{bottom:10px;right:10px}.ds-bar.bl{bottom:10px;left:10px}
.ds-bar.dim{opacity:.07}.ds-bar.dim:hover{opacity:1}
.ds-bar button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;min-width:26px;padding:0 6px;border-radius:8px;cursor:pointer;color:inherit;white-space:nowrap}
.ds-bar button:hover{background:rgba(255,255,255,.12)}.ds-bar button:focus-visible{outline:2px solid var(--ds-accent,#38bdf8)}
.ds-bar button.on{background:var(--ds-accent,#38bdf8);color:#04121f}
.ds-bar .ds-sep{width:1px;height:16px;background:rgba(255,255,255,.14);margin:0 3px}
.ds-bar .ds-pct{min-width:38px;text-align:center;font-variant-numeric:tabular-nums;opacity:.9;cursor:pointer}
.ds-dot{width:8px;height:8px;border-radius:50%;background:#64748b;margin:0 4px 0 6px;flex:none}.ds-dot.on{background:#34d399;box-shadow:0 0 0 3px rgba(52,211,153,.2)}
.ds-st{padding-right:4px;opacity:.85;max-width:120px;overflow:hidden;text-overflow:ellipsis}
.ds-menu{position:fixed;z-index:2147482001;min-width:200px;padding:5px;border-radius:12px;background:rgba(10,14,22,.96);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 50px rgba(0,0,0,.55);color:#e2e8f0;font:500 12.5px/1.2 system-ui,"Noto Sans TC",sans-serif;animation:ds-in .15s}
.ds-menu h6{margin:6px 8px 4px;font-size:10.5px;font-weight:700;letter-spacing:.06em;color:#94a3b8}
.ds-menu button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border-radius:8px;cursor:pointer}
.ds-menu button:hover{background:rgba(255,255,255,.1)}.ds-menu button.on{color:var(--ds-accent,#38bdf8)}
.ds-menu hr{border:0;border-top:1px solid rgba(255,255,255,.1);margin:4px 2px}
.ds-menu kbd{margin-left:auto;font:600 10px/1 ui-monospace,monospace;opacity:.6}
.ds-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147482002;max-width:min(560px,92vw);padding:9px 14px;border-radius:12px;background:rgba(10,14,22,.94);border:1px solid rgba(255,255,255,.14);color:#f1f5f9;font:600 13px/1.45 system-ui,"Noto Sans TC",sans-serif;box-shadow:0 12px 36px rgba(0,0,0,.5);animation:ds-in .2s}
.ds-fs{position:fixed;inset:0;z-index:2147482003;display:grid;place-items:center;background:rgba(2,6,12,.55);backdrop-filter:blur(4px);cursor:pointer}
.ds-fs div{padding:18px 26px;border-radius:18px;background:#0b1220;border:1px solid rgba(255,255,255,.16);color:#f8fafc;font:700 18px/1.5 system-ui,"Noto Sans TC",sans-serif;text-align:center}
.ds-fs small{display:block;font-size:12px;font-weight:500;opacity:.65}
`;

  class Bus {
    constructor(app, id, onMsg) {
      this.app = app; this.id = id; this.onMsg = onMsg; this.seq = 0; this.seen = new Map(); this.targets = new Set();
      const ch = 'ds:' + app;
      if (typeof BroadcastChannel !== 'undefined') { try { this.bc = new BroadcastChannel(ch); this.bc.onmessage = e => this._in(e.data); } catch (_) { } }
      window.addEventListener('message', e => { if (e.data && e.data.__ds === ch) this._in(e.data); });
      window.addEventListener('storage', e => { if (e.key === ch && e.newValue) { try { this._in(JSON.parse(e.newValue)); } catch (_) { } } });
      this.ch = ch;
    }
    _in(m) {
      if (!m || m.__ds !== this.ch || m.from === this.id || (m.to && m.to !== this.id)) return;
      const k = m.from + ':' + m.seq; if (this.seen.has(k)) return;
      this.seen.set(k, 1); if (this.seen.size > 400) this.seen.delete(this.seen.keys().next().value);
      this.onMsg(m);
    }
    send(type, data, to) {
      const m = { __ds: this.ch, from: this.id, seq: ++this.seq, type, data, to: to || null, t: Date.now() };
      if (this.bc) { try { this.bc.postMessage(m); } catch (_) { } }
      this.targets.forEach(w => { try { if (w && !w.closed) w.postMessage(m, '*'); } catch (_) { } });
      try { if (window.opener && !window.opener.closed) window.opener.postMessage(m, '*'); } catch (_) { }
      if (!this.bc && type !== 'state' && type !== 'hb') { try { localStorage.setItem(this.ch, JSON.stringify(m)); } catch (_) { } }
    }
  }

  class DualScreenKit {
    constructor(o) {
      this.o = Object.assign({
        app: 'game', title: document.title, stage: '[data-ds=stage]', info: '[data-ds=info]', scale: null,
        defaultLayout: 'split', layouts: LAYOUTS, syncHz: 15, accent: '#38bdf8',
        toolbar: {}, font: {}, popup: {}, labels: {}, shortcuts: true
      }, o || {});
      this.o.toolbar = this.o.toolbar === false ? false : Object.assign({ mount: null, corner: 'tr', autoHide: 2600, popoutStage: true }, this.o.toolbar);
      this.o.font = Object.assign({ min: 0.7, max: 3, step: 0.1 }, this.o.font);
      this.o.popup = Object.assign({ width: 1100, height: 780 }, this.o.popup);
      this.o.labels = Object.assign({ stage: '主舞台', info: '資訊視窗' }, this.o.labels);
      this.app = this.o.app; this.id = uid(); this._h = {}; this._cmd = {}; this._peerH = {}; this.peers = new Map();
      this.k = s => 'ds.' + this.app + '.' + s;
      const q = new URLSearchParams(location.search);
      const want = q.get('ds') || q.get('screen');
      const legacy = { left_only: 'stage', right_only: 'info', top: 'stage', bottom: 'info' };
      this.isPopup = !!(window.opener && want);
      this.layout = LAYOUTS.includes(want) ? want : legacy[want] || this._sessionLayout() || this.o.defaultLayout;
      this.stageEl = $(this.o.stage); this.infoEl = $(this.o.info); this.scaleEl = $(this.o.scale) || this.infoEl;
      if (this.stageEl) this.stageEl.setAttribute('data-ds', 'stage');
      if (this.infoEl) this.infoEl.setAttribute('data-ds', 'info');
      this._css();
      document.documentElement.style.setProperty('--ds-accent', this.o.accent);
      this.bus = new Bus(this.app, this.id, m => this._onMsg(m));
      this._floatHead(); this._toolbar(); this._keys(); this._geomWatch();
      this.setLayout(this.layout, { silent: true, init: true });
      this.bus.send('hello', this._me());
      this._hb = setInterval(() => { this.bus.send('hb', this._me()); this._prune(); }, 1000);
      this._sync = setInterval(() => this._publish(), Math.max(30, 1000 / this.o.syncHz));
      window.addEventListener('beforeunload', () => { this.bus.send('bye', {}); this._saveGeom(); });
      if (this.isPopup) document.title = this.o.title + '・' + (this.layout === 'info' ? this.o.labels.info : this.o.labels.stage);
      if (q.get('ds_fs') === '1') setTimeout(() => this._fsPrompt(), 400);
    }

    /* ───── 事件 ───── */
    on(e, f) { (this._h[e] = this._h[e] || []).push(f); return () => { this._h[e] = this._h[e].filter(x => x !== f); }; }
    _emit(e, d) { (this._h[e] || []).slice().forEach(f => { try { f(d); } catch (err) { console.error('[DualScreen]', e, err); } }); }
    /* 主控端執行的指令（任一視窗呼叫 command 都會交給主控端） */
    handle(name, fn) { this._cmd[name] = fn; return this; }
    command(name, data) {
      if (this.isAuthority) { const f = this._cmd[name]; if (f) return f(data || {}, { local: true }); console.warn('[DualScreen] 未註冊的指令', name); return; }
      this.bus.send('cmd', { name, data: data || {} });
    }
    /* 視窗之間的自訂訊息（例如提示文字、音效） */
    send(name, data) { this.bus.send('msg', { name, data }); }
    onPeer(name, fn) { (this._peerH[name] = this._peerH[name] || []).push(fn); return this; }

    /* ───── 狀態 ───── */
    _me() { return { layout: this.layout, popup: this.isPopup, title: this.o.title, font: this.hasInfo ? this.font : null }; }
    _peerFont() { for (const p of this.peers.values()) if (p.font != null) return p; return null; }
    get hasStage() { return this.layout !== 'info'; }
    get hasInfo() { return this.layout !== 'stage'; }
    get isAuthority() { return this.hasStage || !this._liveAuthority(); }
    get connected() { return this.peers.size > 0; }
    _liveAuthority() { for (const p of this.peers.values()) if (p.layout !== 'info') return p; return null; }
    _liveMirror() { for (const p of this.peers.values()) if (p.layout === 'info' || p.layout === 'split' || p.layout === 'float') return p; return null; }
    _prune() {
      const t = Date.now(); let ch = false;
      this.peers.forEach((p, k) => { if (t - p.last > 3500) { this.peers.delete(k); ch = true; } });
      if (ch) this._peerChanged();
    }
    _peerChanged() { this._updateBar(); this._emit('peer', { connected: this.connected, peers: Array.from(this.peers.values()), authority: this.isAuthority }); }
    _publish() {
      if (!this.isAuthority || !this.o.snapshot || !this.peers.size) return;
      let mirror = false; this.peers.forEach(p => { if (p.layout === 'info') mirror = true; }); if (!mirror) return;
      let s; try { s = this.o.snapshot(); } catch (e) { console.error(e); return; }
      if (s != null) this.bus.send('state', s);
    }
    pushNow() { this._lastPub = 0; this._publish(); }
    _onMsg(m) {
      const known = this.peers.has(m.from);
      if (m.type === 'bye') { if (this.peers.delete(m.from)) this._peerChanged(); if (this.popup) setTimeout(() => this._checkPopup(), 150); return; }
      const prev = this.peers.get(m.from), info = m.type === 'hello' || m.type === 'hb' ? m.data : null;
      this.peers.set(m.from, Object.assign({ id: m.from }, prev || {}, info || {}, { last: Date.now() }));
      if (!known || (info && prev && prev.layout !== info.layout)) {
        this._peerChanged();
        if (!this.isAuthority) this.bus.send('req-state', {}, m.from);
        if (this._handoff && info && info.layout !== 'info') { this.bus.send('handoff', this._handoff, m.from); this._handoff = null; }
      }
      if (m.type === 'hello') this.bus.send('hb', this._me(), m.from);
      switch (m.type) {
        case 'state': if (!this.isAuthority && this.o.apply) { this.o.apply(m.data, { from: m.from }); this._emit('state', m.data); } break;
        case 'handoff': if (this.o.apply) { this.o.apply(m.data, { handoff: true }); this._emit('handoff', m.data); } break;
        case 'req-state': if (this.isAuthority) this._publish(); break;
        case 'cmd': if (this.isAuthority && this._cmd[m.data.name]) { try { this._cmd[m.data.name](m.data.data || {}, { remote: true, from: m.from }); } catch (e) { console.error(e); } } break;
        case 'msg': (this._peerH[m.data.name] || []).forEach(f => { try { f(m.data.data, { from: m.from }); } catch (e) { console.error(e); } }); break;
        case 'font': if (this.hasInfo) { this.setFont(m.data.v != null ? m.data.v : this.font + m.data.d, { remote: true }); this.bus.send('hb', this._me()); } break;
        case 'layout': if (m.data.layout && this.o.layouts.includes(m.data.layout)) this.setLayout(m.data.layout); break;
        case 'fs-prompt': this._fsPrompt(); break;
      }
    }

    /* ───── 版面 ───── */
    _sessionLayout() { try { return this.isPopup ? null : sessionStorage.getItem(this.k('layout')); } catch (_) { return null; } }
    setLayout(l, opt) {
      opt = opt || {};
      if (!LAYOUTS.includes(l)) l = 'split';
      const prev = this.layout, h = document.documentElement;
      LAYOUTS.forEach(x => h.classList.remove('ds-l-' + x)); h.classList.add('ds-l-' + l);
      this.layout = l;
      try { if (!this.isPopup) sessionStorage.setItem(this.k('layout'), l); } catch (_) { }
      if (l === 'float') this._placeFloat(); else if (this.infoEl) { ['left', 'top', 'width', 'height'].forEach(p => this.infoEl.style.removeProperty(p)); }
      this._applyFont();
      this._mountBar();
      this.bus && this.bus.send('hb', this._me());
      if (!opt.silent || opt.init) {
        const cb = () => { if (this.o.onLayout) { try { this.o.onLayout(l, prev); } catch (e) { console.error(e); } } };
        if (opt.init) setTimeout(cb, 0); else cb(); // 初始化時延後，讓遊戲程式先宣告完變數
        [60, 340].forEach(ms => setTimeout(() => window.dispatchEvent(new Event('resize')), ms));
      }
      if (prev !== l) this._emit('layout', { layout: l, prev });
      this._updateBar();
    }

    /* ───── 彈出視窗 / 第二螢幕 ───── */
    get popupOpen() { return !!(this.popup && !this.popup.closed); }
    popout(which, opt) {
      which = which === 'stage' ? 'stage' : 'info'; opt = opt || {};
      if (this.popupOpen && this._popWhich === which) { try { this.popup.focus(); } catch (_) { } return this.popup; }
      if (this.popupOpen) this.closePopup(true);
      const url = new URL(location.href); url.searchParams.delete('screen'); url.searchParams.set('ds', which);
      if (opt.fullscreen) url.searchParams.set('ds_fs', '1'); else url.searchParams.delete('ds_fs');
      const g = opt.geom || store.get(this.k('geom.' + which)) || this._defGeom();
      const feat = 'popup=yes,width=' + Math.round(g.w) + ',height=' + Math.round(g.h) + ',left=' + Math.round(g.x) + ',top=' + Math.round(g.y);
      const w = window.open(url.toString(), 'ds_' + this.app + '_' + which, feat);
      if (!w) {
        this.toast('瀏覽器阻擋了彈出視窗：請在網址列允許「彈出式視窗」。已先改用浮動資訊視窗。');
        if (which === 'info') this.setLayout('float');
        this._emit('blocked', { which }); return null;
      }
      this.popup = w; this._popWhich = which; this.bus.targets.add(w);
      this._prePop = this.layout === 'stage' || this.layout === 'info' ? 'split' : this.layout;
      if (which === 'stage' && this.o.snapshot) { try { this._handoff = this.o.snapshot(); } catch (_) { } }
      this.setLayout(which === 'info' ? 'stage' : 'info');
      clearInterval(this._pw); this._pw = setInterval(() => this._checkPopup(), 600);
      this._emit('popup', { open: true, which }); this._updateBar();
      return w;
    }
    _checkPopup() {
      if (!this._pw || (this.popup && !this.popup.closed)) return;
      clearInterval(this._pw); this._pw = null; this.bus.targets.delete(this.popup); this.popup = null;
      if (!this._closingQuiet) this.setLayout(this._prePop || 'split');
      this._closingQuiet = false; this._emit('popup', { open: false, which: this._popWhich }); this._updateBar();
    }
    closePopup(quiet) { if (this.popupOpen) { this._closingQuiet = !!quiet; try { this.popup.close(); } catch (_) { } } }
    /* 合併回單一視窗（在彈出視窗內按：通知主視窗恢復並排後關閉自己） */
    dock() {
      if (this.isPopup) { this.bus.send('layout', { layout: 'split' }); setTimeout(() => window.close(), 80); return; }
      this.closePopup(true); this.setLayout('split');
    }
    _defGeom() {
      const W = Math.min(this.o.popup.width, screen.availWidth || 1280), H = Math.min(this.o.popup.height, screen.availHeight || 800);
      const x = (window.screenX || 0) + Math.max(0, (window.outerWidth - W) / 2) + 40, y = (window.screenY || 0) + 40;
      return { x, y, w: W, h: H };
    }
    async otherScreen() {
      if (!('getScreenDetails' in window)) return null;
      try { const d = await window.getScreenDetails(); const o = d.screens.filter(s => s !== d.currentScreen); return o.length ? o.find(s => !s.isPrimary) || o[0] : null; }
      catch (_) { return null; }
    }
    async sendToOtherScreen(which) {
      which = which || 'info';
      const s = await this.otherScreen();
      if (!s) {
        this.toast('沒有偵測到第二個螢幕（或瀏覽器不支援自動投放）：請把彈出視窗手動拖到另一個螢幕，位置會自動記住。');
        return this.popout(which);
      }
      const g = { x: s.availLeft, y: s.availTop, w: s.availWidth, h: s.availHeight };
      store.set(this.k('geom.' + which), g);
      if (this.popupOpen && this._popWhich === which) {
        try { this.popup.moveTo(g.x, g.y); this.popup.resizeTo(g.w, g.h); } catch (_) { }
        this.bus.send('fs-prompt', {}); return this.popup;
      }
      const w = this.popout(which, { geom: g, fullscreen: true });
      if (!w) this.toast('請再按一次「送到副螢幕」（授權視窗配置後需要重新點擊）。');
      return w;
    }
    forgetPosition() { ['info', 'stage'].forEach(w => store.del(this.k('geom.' + w))); store.del(this.k('float')); this.toast('已清除記住的視窗位置。'); }
    /* 彈出視窗：定時記住自己的位置與大小（下次從同一位置開啟） */
    _geomWatch() {
      document.addEventListener('visibilitychange', () => this._checkPopup());
      if (!this.isPopup) return;
      let last = '';
      this._saveGeom = () => {
        const g = { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight };
        if (document.fullscreenElement || !g.w) return;
        const s = JSON.stringify(g); if (s !== last) { last = s; store.set(this.k('geom.' + this.layout), g); }
      };
      setInterval(this._saveGeom, 1000);
    }
    _saveGeom() { }

    /* ───── 全螢幕 ───── */
    async fullscreen(on) {
      const d = document, cur = !!d.fullscreenElement, want = on == null ? !cur : !!on;
      try { if (want && !cur) await d.documentElement.requestFullscreen({ navigationUI: 'hide' }); else if (!want && cur) await d.exitFullscreen(); }
      catch (_) { this.toast('請直接按 F11 進入全螢幕。'); }
      setTimeout(() => this._updateBar(), 100);
    }
    _fsPrompt() {
      if (document.fullscreenElement || document.querySelector('.ds-fs')) return;
      const el = document.createElement('div'); el.className = 'ds-fs';
      el.innerHTML = '<div>按一下進入全螢幕<small>' + (this.layout === 'info' ? this.o.labels.info : this.o.labels.stage) + '・按 Esc 略過</small></div>';
      const done = () => { el.remove(); document.removeEventListener('keydown', esc); };
      const esc = e => { if (e.key === 'Escape') done(); };
      el.onclick = () => { done(); this.fullscreen(true); };
      document.addEventListener('keydown', esc); document.body.appendChild(el); setTimeout(done, 12000);
    }

    /* ───── 字體大小（縮放資訊區） ───── */
    get font() { return this._font || 1; }
    setFont(v, opt) {
      opt = opt || {}; const F = this.o.font;
      if (!this.hasInfo && !opt.local) { this._remote({ v: clamp(Math.round(v * 100) / 100, F.min, F.max) }); return; }
      this._font = clamp(Math.round(v * 100) / 100, F.min, F.max);
      store.set(this.k('font.' + this.layout), this._font);
      this._applyFont(); this._updateBar(); this._emit('font', { value: this._font, layout: this.layout, remote: !!opt.remote });
    }
    bumpFont(d) { if (!this.hasInfo) this._remote({ d }); else this.setFont(this.font + d); }
    /* 本視窗沒有資訊區時：遙控另一個視窗的字體（先在本地預估顯示，心跳回來後校正） */
    _remote(m) {
      this.bus.send('font', m);
      const p = this._peerFont(); if (p) p.font = clamp(m.v != null ? m.v : p.font + m.d, this.o.font.min, this.o.font.max);
      this._updateBar();
    }
    _applyFont() {
      this._font = store.get(this.k('font.' + this.layout), this._font && this._lastFontLayout === this.layout ? this._font : 1);
      this._lastFontLayout = this.layout;
      if (this.scaleEl) { this.scaleEl.style.zoom = this._font === 1 ? '' : String(this._font); this.scaleEl.style.setProperty('--ds-font', this._font); }
    }

    /* ───── 浮動資訊視窗（同一視窗內彈跳出來，可拖曳、可縮放） ───── */
    _floatHead() {
      if (!this.infoEl) return;
      const h = document.createElement('div'); h.className = 'ds-float-head';
      h.innerHTML = svg('grip', 14) + '<span>' + this.o.labels.info + '</span>' +
        '<button data-a="pop" title="彈出成獨立視窗">' + svg('pop', 14) + '</button><button data-a="dock" title="還原並排">' + svg('dock', 14) + '</button>';
      this.infoEl.insertBefore(h, this.infoEl.firstChild);
      h.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.a === 'pop') this.popout('info'); else this.setLayout('split'); });
      let st = null;
      h.addEventListener('pointerdown', e => {
        if (e.target.closest('button') || this.layout !== 'float') return;
        const r = this.infoEl.getBoundingClientRect(); st = { x: e.clientX, y: e.clientY, l: r.left, t: r.top }; h.setPointerCapture(e.pointerId);
      });
      h.addEventListener('pointermove', e => {
        if (!st) return;
        const r = this.infoEl.getBoundingClientRect();
        this.infoEl.style.left = clamp(st.l + e.clientX - st.x, 8 - r.width + 80, innerWidth - 80) + 'px';
        this.infoEl.style.top = clamp(st.t + e.clientY - st.y, 0, innerHeight - 40) + 'px';
      });
      const end = () => { if (st) { st = null; this._saveFloat(); } };
      h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
      if (window.ResizeObserver) { let to; new ResizeObserver(() => { if (this.layout !== 'float') return; clearTimeout(to); to = setTimeout(() => this._saveFloat(), 300); }).observe(this.infoEl); }
    }
    _placeFloat() {
      const el = this.infoEl; if (!el) return;
      const g = store.get(this.k('float')) || { x: innerWidth - Math.min(520, innerWidth * 0.9) - 20, y: 60, w: Math.min(520, innerWidth * 0.9), h: Math.min(620, innerHeight * 0.8) };
      el.style.left = clamp(g.x, 0, innerWidth - 120) + 'px'; el.style.top = clamp(g.y, 0, innerHeight - 60) + 'px';
      el.style.width = g.w + 'px'; el.style.height = g.h + 'px';
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    }
    _saveFloat() {
      if (this.layout !== 'float' || !this.infoEl) return; const r = this.infoEl.getBoundingClientRect();
      store.set(this.k('float'), { x: r.left, y: r.top, w: r.width, h: r.height });
    }

    /* ───── 工具列 ───── */
    _css() { if (document.getElementById('ds-style')) return; const s = document.createElement('style'); s.id = 'ds-style'; s.textContent = CSS; document.head.appendChild(s); }
    _toolbar() {
      if (this.o.toolbar === false) return;
      const b = this.bar = document.createElement('div'); b.className = 'ds-bar';
      b.innerHTML = '<span class="ds-dot"></span><span class="ds-st"></span><span class="ds-sep"></span>' +
        '<button data-a="pop" title="彈出成獨立視窗（Alt+P）">' + svg('pop') + '<span class="ds-poplb"></span></button>' +
        '<button data-a="screen" title="送到副螢幕並全螢幕">' + svg('screen') + '</button>' +
        '<button data-a="full" title="全螢幕（Alt+F）">' + svg('full') + '</button><span class="ds-sep"></span>' +
        '<button data-a="fm" title="縮小字體（Alt+−）">' + svg('minus', 14) + '</button><span class="ds-pct" title="點一下恢復 100%">100%</span>' +
        '<button data-a="fp" title="放大字體（Alt+＝）">' + svg('plus', 14) + '</button><span class="ds-sep"></span>' +
        '<button data-a="more" title="版面與更多選項">' + svg('more') + '</button>';
      b.addEventListener('click', e => {
        const t = e.target.closest('[data-a],.ds-pct'); if (!t) return;
        if (t.classList.contains('ds-pct')) { this.setFont(1); return; }
        const a = t.dataset.a, F = this.o.font.step;
        if (a === 'pop') this.isPopup ? this.dock() : this.popupOpen ? this.closePopup() : this.popout('info');
        else if (a === 'screen') this.sendToOtherScreen(this.isPopup ? null : 'info');
        else if (a === 'full') this.fullscreen();
        else if (a === 'fm') this.bumpFont(-F); else if (a === 'fp') this.bumpFont(F);
        else if (a === 'more') this._menu(t);
      });
      if (this.isPopup) b.querySelector('[data-a=screen]').style.display = 'none';
      let to; const wake = () => { if (!b.classList.contains('float') || !this.o.toolbar.autoHide) return; b.classList.remove('dim'); clearTimeout(to); to = setTimeout(() => { if (this.layout === 'stage') b.classList.add('dim'); }, this.o.toolbar.autoHide); };
      window.addEventListener('pointermove', wake, { passive: true }); this._wake = wake;
      document.addEventListener('fullscreenchange', () => this._updateBar());
    }
    _mountBar() {
      const b = this.bar; if (!b) return;
      const slot = $(this.o.toolbar.mount);
      const inline = slot && this.hasInfo && this.layout !== 'float';
      if (inline) { b.className = 'ds-bar'; if (b.parentNode !== slot) slot.appendChild(b); }
      else { b.className = 'ds-bar float ' + (this.o.toolbar.corner || 'tr'); if (b.parentNode !== document.body) document.body.appendChild(b); if (this._wake) this._wake(); }
    }
    _updateBar() {
      const b = this.bar; if (!b) return;
      const n = this.peers.size, st = b.querySelector('.ds-st'), dot = b.querySelector('.ds-dot');
      dot.classList.toggle('on', n > 0);
      st.textContent = n ? (this.isPopup ? '已連線主視窗' : '雙視窗連線中') : (LABEL[this.layout] || '');
      b.title = n ? '已連線 ' + (n + 1) + ' 個視窗・' + (this.isAuthority ? '本視窗執行遊戲' : '本視窗為鏡像顯示') : '單一視窗';
      const pop = b.querySelector('[data-a=pop]'), lb = b.querySelector('.ds-poplb');
      if (this.isPopup) { pop.innerHTML = svg('dock') + '<span class="ds-poplb">合併回主視窗</span>'; pop.title = '關閉此視窗並在主視窗恢復並排'; }
      else { lb.textContent = this.popupOpen ? '收回視窗' : '彈出' + this.o.labels.info; pop.classList.toggle('on', this.popupOpen); }
      const fb = b.querySelector('[data-a=full]'); fb.innerHTML = svg(document.fullscreenElement ? 'exitfull' : 'full');
      const pf = this._peerFont(), v = this.hasInfo ? this.font : pf ? pf.font : 1;
      b.querySelector('.ds-pct').textContent = Math.round(v * 100) + '%';
      b.querySelector('.ds-pct').title = this.hasInfo ? '資訊字體大小（點一下恢復 100%）' : '遙控副螢幕資訊字體大小';
    }
    _menu(anchor) {
      const old = document.querySelector('.ds-menu'); if (old) { old.remove(); return; }
      const m = document.createElement('div'); m.className = 'ds-menu';
      const lay = this.o.layouts.map((l, i) => '<button data-l="' + l + '" class="' + (l === this.layout ? 'on' : '') + '">' + svg(l, 15) + LABEL[l] + '<kbd>Alt+' + (i + 1) + '</kbd></button>').join('');
      m.innerHTML = '<h6>本視窗版面</h6>' + lay + '<hr>' +
        (this.isPopup ? '<button data-a="dock">' + svg('dock', 15) + '合併回主視窗</button>' :
          '<button data-a="pi">' + svg('pop', 15) + '彈出' + this.o.labels.info + '<kbd>Alt+P</kbd></button>' +
          (this.o.toolbar.popoutStage ? '<button data-a="ps">' + svg('pop', 15) + '彈出' + this.o.labels.stage + '</button>' : '') +
          '<button data-a="scr">' + svg('screen', 15) + '資訊視窗送到副螢幕</button>' +
          (this.popupOpen ? '<button data-a="close">' + svg('close', 15) + '關閉彈出視窗</button>' : '')) +
        '<hr><button data-a="f1">字體恢復 100%<kbd>Alt+0</kbd></button><button data-a="forget">清除記住的視窗位置</button>';
      document.body.appendChild(m);
      const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
      m.style.left = clamp(r.right - mw, 6, innerWidth - mw - 6) + 'px';
      m.style.top = (r.bottom + 6 + mh > innerHeight ? Math.max(6, r.top - mh - 6) : r.bottom + 6) + 'px';
      const close = e => { if (!m.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', close, true); } };
      document.addEventListener('pointerdown', close, true);
      m.addEventListener('click', e => {
        const t = e.target.closest('button'); if (!t) return; m.remove(); document.removeEventListener('pointerdown', close, true);
        if (t.dataset.l) return this.setLayout(t.dataset.l);
        ({ dock: () => this.dock(), pi: () => this.popout('info'), ps: () => this.popout('stage'), scr: () => this.sendToOtherScreen('info'), close: () => this.closePopup(), f1: () => this.setFont(1), forget: () => this.forgetPosition() })[t.dataset.a]();
      });
    }
    _keys() {
      if (!this.o.shortcuts) return;
      window.addEventListener('keydown', e => {
        if (!e.altKey || e.ctrlKey || e.metaKey) return;
        const k = e.code, F = this.o.font.step;
        const act = { Equal: () => this.bumpFont(F), NumpadAdd: () => this.bumpFont(F), Minus: () => this.bumpFont(-F), NumpadSubtract: () => this.bumpFont(-F), Digit0: () => this.setFont(1), KeyP: () => this.isPopup ? this.dock() : this.popout('info'), KeyF: () => this.fullscreen() };
        this.o.layouts.forEach((l, i) => { act['Digit' + (i + 1)] = () => this.setLayout(l); });
        if (act[k]) { e.preventDefault(); act[k](); }
      });
    }
    toast(msg, ms) {
      const old = document.querySelector('.ds-toast'); if (old) old.remove();
      const t = document.createElement('div'); t.className = 'ds-toast'; t.textContent = msg; document.body.appendChild(t);
      setTimeout(() => t.remove(), ms || 4200);
    }
    destroy() { clearInterval(this._hb); clearInterval(this._sync); clearInterval(this._pw); this.bus.send('bye', {}); if (this.bar) this.bar.remove(); }
  }

  return { VERSION, LAYOUTS, create: o => new DualScreenKit(o), DualScreenKit };
});
