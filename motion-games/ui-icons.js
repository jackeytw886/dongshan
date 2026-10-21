/*!
 * UIIcons v1.0.0 — 極簡線條圖示（單檔、無外部字型）
 * 用法：<i data-ic="camera"></i>   改圖示：el.dataset.ic = 'mute'（會自動更新）
 *       UIIcons.svg('camera', 18) 取得 SVG 字串；UIIcons.names 列出全部名稱
 * 圖示一律 24×24、線寬 1.8、顏色跟隨文字（currentColor），大小跟隨字體（1em）。
 */
(function (root) {
  'use strict';
  const P = {
    camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    cameraOff: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><path d="M3 3l18 18"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>',
    drum: '<ellipse cx="12" cy="9" rx="8" ry="3"/><path d="M4 9v7c0 1.7 3.6 3 8 3s8-1.3 8-3V9"/><path d="M7 3l4 4.5M17 3l-4 4.5"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z"/>',
    flame: '<path d="M12 21c4 0 6.5-2.6 6.5-6.2 0-3.8-3-6-4.3-9.8C12 7 10.5 8.6 10 10.5 8.8 9.6 8.4 8.6 8.3 7.5 6.6 9.3 5.5 11.6 5.5 14.8 5.5 18.4 8 21 12 21z"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.6a3.2 3.2 0 0 1 0 6.3M18 14.3c1.8.8 3 2.7 3 4.9"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
    panorama: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>',
    dragon: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"/>',
    paw: '<circle cx="6.5" cy="9.5" r="1.7"/><circle cx="10" cy="6" r="1.7"/><circle cx="14" cy="6" r="1.7"/><circle cx="17.5" cy="9.5" r="1.7"/><path d="M12 11c-3 0-5.5 3-5.5 5.5 0 2 1.6 3 3.2 3 1 0 1.5-.5 2.3-.5s1.3.5 2.3.5c1.6 0 3.2-1 3.2-3C17.5 14 15 11 12 11z"/>',
    lantern: '<path d="M12 2v2M9 4h6M9 19h6M12 19v3"/><path d="M12 4c-4 0-6 3-6 7.5S8 19 12 19s6-3 6-7.5S16 4 12 4z"/><path d="M12 4c-1.6 2-2.2 4.5-2.2 7.5S10.4 17 12 19M12 4c1.6 2 2.2 4.5 2.2 7.5S13.6 17 12 19"/>',
    burst: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/><circle cx="12" cy="12" r="1.6"/>',
    orbit: '<circle cx="12" cy="12" r="2.2"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-25 12 12)"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    sunset: '<path d="M3 18h18M6.5 14.5a5.5 5.5 0 0 1 11 0"/><path d="M12 3v5M9.5 6l2.5 2 2.5-2"/>',
    step: '<path d="M8 3c1.8 0 2.6 2 2.6 4.4 0 2-.8 3.6-1 5.6H6.2c-.4-2-1.2-3.4-1.2-5.6C5 5 6.2 3 8 3zM6.4 15.5h3.2v1.2a1.6 1.6 0 0 1-3.2 0z"/><path d="M16 7c1.8 0 3 2 3 4.4 0 2.2-.8 3.6-1.2 5.6h-3.4c-.2-2-1-3.6-1-5.6C13.4 9 14.2 7 16 7zM14.4 19.5h3.2v.3a1.6 1.6 0 0 1-3.2 0z"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    up: '<path d="M12 20V5M6 11l6-6 6 6"/>',
    left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    dot: '<circle cx="12" cy="12" r="3.5"/>',
    zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19c3-4 6-7 10-9"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M14.6 9.4c-.4-.9-1.4-1.4-2.6-1.4-1.4 0-2.5.7-2.5 1.8 0 2.4 5 1.3 5 3.8 0 1.1-1.1 1.9-2.5 1.9-1.3 0-2.3-.6-2.7-1.5"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>',
    apple: '<path d="M12 7.5c-1.5-1-5.5-1.3-6.6 2.5-1 3.5.6 9.5 3.6 9.5 1.2 0 1.8-.6 3-.6s1.8.6 3 .6c3 0 4.6-6 3.6-9.5-1.1-3.8-5.1-3.5-6.6-2.5z"/><path d="M12 7.5c0-2 .8-3.5 2.5-4.5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.6L20 16M20 20v-4h-4"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    arch: '<path d="M4 20V11a8 8 0 0 1 16 0v9"/><path d="M8 20v-9a4 4 0 0 1 8 0v9"/><path d="M2 20h20"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.2-1.6-1.2-2.8 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
    radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6.5 7-2.7 0-4-1.3-5.4-3.4L3.4 15a1.6 1.6 0 0 1 2.6-1.8L8 15"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    run: '<circle cx="14" cy="4.5" r="1.8"/><path d="M6 20l3.5-5 3 2.5V22M8 11l3-3.5 3.5 2.5 2.5 3.5h3M11 7.5l1.5 5"/>',
    gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 13l4-4"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    gamepad: '<rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r=".9"/><circle cx="18" cy="13.5" r=".9"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7"/>',
    smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    wand: '<path d="M4 20L15 9M14 4v3M12.5 5.5h3M19 9v3M17.5 10.5h3"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'
  };
  const svg = (n, s) => '<svg class="ic-svg" viewBox="0 0 24 24" width="' + (s || '1em') + '" height="' + (s || '1em') + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[n] || P.dot) + '</svg>';
  function paint(el) { const n = el.getAttribute('data-ic'); if (el._ic === n) return; el._ic = n; el.classList.add('ic'); el.innerHTML = svg(n); }
  function upgrade(root) { (root || document).querySelectorAll('[data-ic]').forEach(paint); }
  if (typeof document !== 'undefined') {
    const st = document.createElement('style');
    st.textContent = '.ic{display:inline-flex;width:1em;height:1em;flex:none;vertical-align:-.14em;font-style:normal}.ic svg{width:100%;height:100%}';
    document.head.appendChild(st);
    const go = () => {
      upgrade();
      new MutationObserver(ms => ms.forEach(m => {
        if (m.type === 'attributes') paint(m.target);
        else m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (n.hasAttribute('data-ic')) paint(n); upgrade(n); });
      })).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ic'] });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
  root.UIIcons = { svg, upgrade, names: Object.keys(P), paths: P };
})(typeof self !== 'undefined' ? self : this);
