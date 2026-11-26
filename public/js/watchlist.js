/* KravN watchlist — one small script for every page.
   - any [data-watch] bookmark button works (posters, discussions, movie page, search…), also on infinite-scroll cards
   - tap: save to "My Watchlist" · tap again: remove (Undo) · saved in several lists: pick lists
   - the /watchlist page: filter, search with suggestions, themed sort menu, grid/list view, mark watched + progress,
     select & bulk actions (watched / move / copy / remove), long-press to select on phones,
     "pick something for me", share, save someone's public list
   - any <input data-wl-suggest> elsewhere on the site shows watchlist suggestions while typing */
(() => {
  'use strict';
  if (window.__wlLoaded) return; // never run twice
  window.__wlLoaded = true;

  // styles live in this file, so there is nothing else to load
  const style = document.createElement('style');
  style.textContent = `
/* KravN watchlist — bookmark buttons, list picker, toast and the Watchlist page.
   Uses the site's own variables (--bg --text --surface --accent --font). */

html.wl-lock { overflow: hidden; }

/* ------------------------------ bookmark button ------------------------------ */
.mcard-poster { position: relative; }

.wl-btn { -webkit-tap-highlight-color: transparent; cursor: pointer; }
.wl-btn svg { width: 18px; height: 18px; flex: none; pointer-events: none; }
.wl-btn svg path { transition: fill .15s ease; }
.wl-btn[aria-pressed="true"] svg path { fill: currentColor; }

/* on top of a poster */
.wl-btn--poster {
  position: absolute; top: 8px; right: 8px; z-index: 3; display: grid; place-items: center; width: 36px; height: 36px; padding: 0;
  border: 0; border-radius: 50%; color: #fff; background: rgba(12, 12, 16, .62);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  transition: transform .15s ease, background .2s ease;
}
.wl-btn--poster::after { content: ''; position: absolute; inset: -6px; }   /* bigger touch target */
.wl-btn--poster:hover { background: rgba(12, 12, 16, .85); }
.wl-btn--poster:active { transform: scale(.9); }
.wl-btn--poster[aria-pressed="true"] { background: var(--accent); }
.wl-btn--poster[disabled] { opacity: .6; }

/* inside a discussion card's action row (also has class .act) */
.wl-btn--act[aria-pressed="true"] { color: var(--accent); }

/* pill with text (movie page, profile) */
.wl-btn--inline {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 18px; border-radius: 999px;
  font: 500 13.5px/1 var(--font); letter-spacing: .02em; color: var(--text); background: transparent;
  border: 1px solid color-mix(in srgb, var(--accent) 85%, #fff 10%);
  transition: transform .2s ease, background .2s ease, border-color .2s ease;
}
.wl-btn--inline:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
.wl-btn--inline:active { transform: scale(.97); }
.wl-btn--inline[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }

.wl-btn:focus-visible, .wl-act:focus-visible, .wl-chip:focus-visible, .wl-tab:focus-visible,
.wl-link:focus-visible, .wl-x:focus-visible, .wl-solid:focus-visible, .wl-ghost:focus-visible, .wl-cta:focus-visible,
.wl-dd-btn:focus-visible, .wl-search input:focus-visible, .wl-iconbtn:focus-visible, .wl-bulk-btn:focus-visible, .wl-row:focus-visible,
.wl-qclear:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}

/* ------------------------------ sheet (picker + dialogs) ------------------------------ */
.wl-layer { position: fixed; inset: 0; z-index: 400; display: flex; align-items: flex-end; justify-content: center; visibility: hidden; }
.wl-layer.open { visibility: visible; }
.wl-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, .55); opacity: 0; transition: opacity .18s ease; }
.wl-layer.open .wl-backdrop { opacity: 1; }

.wl-sheet {
  position: relative; width: 100%; max-width: 460px; max-height: min(82vh, 640px); overflow-y: auto; overscroll-behavior: contain;
  padding: 18px 18px calc(18px + env(safe-area-inset-bottom)); border-radius: 22px 22px 0 0;
  color: var(--text); background: var(--surface); border: 1px solid color-mix(in srgb, var(--text) 12%, transparent); border-bottom: 0;
  box-shadow: 0 -20px 50px -20px rgba(0, 0, 0, .7);
  transform: translateY(24px); opacity: 0; transition: transform .2s ease, opacity .2s ease;
}
.wl-layer.open .wl-sheet { transform: none; opacity: 1; }
/* little grab handle on phones */
.wl-sheet::before { content: ''; display: block; width: 38px; height: 4px; margin: -6px auto 12px; border-radius: 4px; background: color-mix(in srgb, var(--text) 22%, transparent); }

@media (min-width: 821px) {
  .wl-layer { align-items: center; }
  .wl-sheet { border-radius: 20px; border-bottom: 1px solid color-mix(in srgb, var(--text) 12%, transparent); padding-bottom: 18px; box-shadow: 0 30px 70px -25px rgba(0, 0, 0, .8); }
  .wl-sheet::before { display: none; }
}

.wl-sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.wl-sheet-title { margin: 0; font: 700 18px/1.2 var(--font); letter-spacing: -.01em; }
.wl-sheet-sub { margin: 4px 0 0; font-size: 13px; color: color-mix(in srgb, var(--text) 58%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-sheet-text { margin: 10px 0 0; font-size: 14px; line-height: 1.5; color: color-mix(in srgb, var(--text) 78%, transparent); }
.wl-x { display: grid; place-items: center; width: 40px; height: 40px; margin-right: -8px; border: 0; border-radius: 50%; font-size: 22px; line-height: 1; color: inherit; background: transparent; cursor: pointer; }
.wl-x:hover { background: color-mix(in srgb, var(--text) 9%, transparent); }

.wl-lists { margin: 14px 0 0; padding: 0; list-style: none; }
.wl-row { display: flex; align-items: center; gap: 12px; min-height: 50px; padding: 6px 10px; border-radius: 12px; cursor: pointer; transition: background .15s ease; }
.wl-row:hover { background: color-mix(in srgb, var(--text) 7%, transparent); }
button.wl-row { width: 100%; border: 0; background: none; color: inherit; font: inherit; text-align: left; }
.wl-row input { flex: none; width: 20px; height: 20px; margin: 0; accent-color: var(--accent); cursor: pointer; }
.wl-row-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-row-n { flex: none; font-size: 12.5px; color: color-mix(in srgb, var(--text) 52%, transparent); }

.wl-new { display: flex; gap: 8px; margin-top: 12px; }
.wl-new input, .wl-field {
  flex: 1; min-width: 0; height: 46px; padding: 0 14px; border-radius: 12px; font: 500 16px/1 var(--font); color: var(--text);
  background: color-mix(in srgb, var(--text) 6%, var(--surface)); border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); outline: 0;
}
.wl-new input:focus, .wl-field:focus { border-color: color-mix(in srgb, var(--accent) 75%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
.wl-field { width: 100%; margin-top: 14px; }

.wl-solid, .wl-ghost {
  height: 46px; padding: 0 18px; border-radius: 12px; font: 600 14px/1 var(--font); cursor: pointer; white-space: nowrap;
  transition: transform .15s ease, background .2s ease, opacity .2s ease;
}
.wl-solid { color: #fff; background: var(--accent); border: 1px solid var(--accent); }
.wl-solid--danger { background: #d0383c; border-color: #d0383c; }
.wl-solid:disabled { opacity: .55; cursor: default; }
.wl-solid:active, .wl-ghost:active { transform: scale(.97); }
.wl-ghost { color: var(--text); background: transparent; border: 1px solid color-mix(in srgb, var(--text) 18%, transparent); }
.wl-ghost:hover { background: color-mix(in srgb, var(--text) 7%, transparent); }
.wl-done { width: 100%; margin-top: 12px; }
.wl-buttons { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }

/* ------------------------------ toast ------------------------------ */
.wl-toast {
  position: fixed; left: 50%; bottom: calc(80px + env(safe-area-inset-bottom)); z-index: 450; display: flex; align-items: center; gap: 6px;
  max-width: min(92vw, 440px); padding: 6px 8px 6px 16px; border-radius: 14px; font-size: 14px; line-height: 1.3; color: var(--text);
  background: color-mix(in srgb, var(--surface) 96%, transparent); border: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); box-shadow: 0 18px 40px -16px rgba(0, 0, 0, .8);
  opacity: 0; transform: translate(-50%, 10px); pointer-events: none; transition: opacity .2s ease, transform .2s ease;
}
.wl-toast.show { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
.wl-toast.error { border-color: color-mix(in srgb, #d0383c 70%, transparent); }
.wl-toast-msg { padding: 8px 6px 8px 0; }
.wl-toast button { flex: none; height: 38px; padding: 0 12px; border: 0; border-radius: 10px; font: 700 13px/1 var(--font); color: var(--accent); background: transparent; cursor: pointer; }
.wl-toast button:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
@media (min-width: 821px) { .wl-toast { bottom: 28px; } }
/* keep the toast above the selection bar */
html.wl-selecting .wl-toast { bottom: calc(210px + env(safe-area-inset-bottom)); }
@media (min-width: 821px) { html.wl-selecting .wl-toast { bottom: 150px; } }

/* ------------------------------ Watchlist page ------------------------------ */
.wl-page { width: 100%; max-width: 1100px; margin: 0 auto; padding: 22px 16px 48px; }
.wl-page.is-selecting { padding-bottom: 220px; }
.wl-head h1 { margin: 0; font: 800 28px/1.1 var(--font); letter-spacing: -.03em; }
.wl-sub { margin: 6px 0 0; font-size: 14px; color: color-mix(in srgb, var(--text) 60%, transparent); }

.wl-tabs { display: flex; gap: 8px; margin: 20px -16px 0; padding: 2px 16px 6px; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; scroll-snap-type: x proximity; }
.wl-tabs::-webkit-scrollbar { display: none; }
.wl-tab {
  flex: none; display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: 999px; text-decoration: none; cursor: pointer; scroll-snap-align: start;
  font: 500 13.5px/1 var(--font); color: color-mix(in srgb, var(--text) 72%, transparent); background: transparent;
  border: 1px solid color-mix(in srgb, var(--text) 16%, transparent); transition: background .2s ease, color .2s ease, border-color .2s ease;
}
.wl-tab:hover { color: var(--text); background: color-mix(in srgb, var(--text) 7%, transparent); }
.wl-tab.on { color: var(--text); background: color-mix(in srgb, var(--accent) 20%, transparent); border-color: color-mix(in srgb, var(--accent) 70%, transparent); }
.wl-tab-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-tab-n { font-size: 12px; opacity: .7; }
.wl-tab--new { border-style: dashed; }

/* list title + visibility note + progress + actions */
.wl-listbar { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px 16px; margin: 20px 0 4px; }
.wl-listbar-main { min-width: 0; flex: 1 1 240px; }
.wl-list-title { margin: 0; font: 700 20px/1.25 var(--font); letter-spacing: -.01em; overflow-wrap: anywhere; }
.wl-vis { margin: 4px 0 0; font-size: 12.5px; line-height: 1.4; color: color-mix(in srgb, var(--text) 56%, transparent); }
.wl-vis--public { color: color-mix(in srgb, var(--accent) 80%, var(--text)); }

.wl-progress { display: flex; align-items: center; gap: 10px; max-width: 340px; margin-top: 12px; }
.wl-progress[hidden] { display: none; }
.wl-progress-bar { flex: 1; height: 6px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--text) 12%, transparent); }
.wl-progress-bar i { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width .3s ease; }
.wl-progress-text { flex: none; font-size: 12.5px; white-space: nowrap; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--text) 62%, transparent); }

.wl-manage { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.wl-link {
  display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border: 0; border-radius: 999px;
  font: 500 13px/1 var(--font); color: color-mix(in srgb, var(--text) 78%, transparent); background: transparent; cursor: pointer;
  transition: background .2s ease, color .2s ease;
}
.wl-link:hover { background: color-mix(in srgb, var(--text) 8%, transparent); color: var(--text); }
.wl-link:disabled { opacity: .5; cursor: default; }
.wl-link--pill { border: 1px solid color-mix(in srgb, var(--text) 16%, transparent); padding: 0 14px; }
.wl-link--pill[aria-pressed="true"] { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 60%, transparent); }
.wl-link--primary { color: var(--text); padding: 0 16px; border: 1px solid color-mix(in srgb, var(--accent) 80%, transparent); }
.wl-link--primary:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
.wl-link--danger { color: #e5575b; }

/* filters, search, sort, view */
.wl-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; margin: 14px 0 18px; }
.wl-chips { display: flex; gap: 6px; max-width: 100%; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.wl-chips::-webkit-scrollbar { display: none; }
.wl-chip { flex: none; height: 36px; padding: 0 14px; border-radius: 999px; font: 500 13px/1 var(--font); cursor: pointer; color: color-mix(in srgb, var(--text) 70%, transparent); background: transparent; border: 1px solid transparent; }
.wl-chip:hover { background: color-mix(in srgb, var(--text) 7%, transparent); }
.wl-chip[aria-pressed="true"] { color: var(--text); background: color-mix(in srgb, var(--text) 12%, transparent); }

.wl-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex: 1 1 320px; justify-content: flex-end; min-width: 0; }

/* search box + suggestions */
.wl-search { position: relative; flex: 1 1 160px; max-width: 300px; min-width: 0; }
.wl-search > svg { position: absolute; left: 13px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); opacity: .55; pointer-events: none; }
.wl-search input {
  width: 100%; height: 40px; padding: 0 38px 0 36px; border-radius: 999px; font: 500 16px/1 var(--font); color: var(--text); outline: 0;
  background: color-mix(in srgb, var(--text) 6%, var(--surface)); border: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
  -webkit-appearance: none; appearance: none;
}
.wl-search input::-webkit-search-cancel-button, .wl-search input::-webkit-search-decoration { -webkit-appearance: none; display: none; }
.wl-search input:focus { border-color: color-mix(in srgb, var(--accent) 75%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent); }
.wl-qclear {
  position: absolute; right: 5px; top: 50%; display: grid; place-items: center; width: 30px; height: 30px; margin-top: -15px; padding: 0; border: 0; border-radius: 50%;
  font-size: 18px; line-height: 1; color: color-mix(in srgb, var(--text) 70%, transparent); background: color-mix(in srgb, var(--text) 10%, transparent); cursor: pointer;
}
.wl-qclear[hidden] { display: none; }
.wl-qclear:hover { color: var(--text); }

.wl-sugg {
  position: absolute; z-index: 70; top: calc(100% + 8px); right: 0; width: 360px; max-width: calc(100vw - 24px); max-height: min(60vh, 440px); overflow-y: auto; overscroll-behavior: contain;
  padding: 6px; border-radius: 16px; color: var(--text); background: var(--surface); border: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
  box-shadow: 0 24px 60px -20px rgba(0, 0, 0, .85);
}
.wl-sugg[hidden] { display: none; }
.wl-sugg--float { position: fixed; top: 0; right: auto; z-index: 420; }
.wl-sg-head { padding: 8px 10px 4px; font: 600 11px/1 var(--font); letter-spacing: .06em; text-transform: uppercase; color: color-mix(in srgb, var(--text) 50%, transparent); }
.wl-sg-row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 6px 8px; border-radius: 12px; cursor: pointer; }
.wl-sg-row:hover, .wl-sg-row.on { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.wl-sg-thumb { flex: none; width: 36px; height: 54px; overflow: hidden; border-radius: 6px; background: color-mix(in srgb, var(--text) 10%, var(--surface)); }
.wl-sg-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.wl-sg-body { flex: 1; min-width: 0; display: grid; gap: 3px; }
.wl-sg-title { font-size: 14.5px; font-weight: 600; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-sg-title mark { color: var(--accent); background: transparent; font-weight: 800; }
.wl-sg-sub { font-size: 12px; line-height: 1.3; color: color-mix(in srgb, var(--text) 56%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-sg-seen { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-size: 12px; font-weight: 700; color: #fff; background: var(--accent); }
.wl-sg-empty { padding: 18px 12px; font-size: 13.5px; line-height: 1.4; text-align: center; color: color-mix(in srgb, var(--text) 62%, transparent); }

/* themed sort menu (replaces the native select, so it follows the site theme everywhere) */
.wl-dd { position: relative; flex: none; }
.wl-dd-btn {
  display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px 0 16px; border-radius: 999px; cursor: pointer; white-space: nowrap;
  font: 500 13.5px/1 var(--font); color: var(--text); background: color-mix(in srgb, var(--text) 6%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); -webkit-tap-highlight-color: transparent;
  transition: background .2s ease, border-color .2s ease;
}
.wl-dd-btn:hover { background: color-mix(in srgb, var(--text) 11%, var(--surface)); }
.wl-dd.open .wl-dd-btn { border-color: color-mix(in srgb, var(--accent) 75%, transparent); }
.wl-dd-btn svg { width: 14px; height: 14px; opacity: .7; transition: transform .2s ease; }
.wl-dd.open .wl-dd-btn svg { transform: rotate(180deg); }
.wl-dd-menu {
  position: absolute; right: 0; top: calc(100% + 8px); z-index: 80; min-width: 200px; margin: 0; padding: 6px; list-style: none; border-radius: 16px;
  color: var(--text); background: var(--surface); border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); box-shadow: 0 24px 60px -20px rgba(0, 0, 0, .85);
}
.wl-dd-menu[hidden] { display: none; }
.wl-dd-menu [role="option"] {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; padding: 0 12px; border-radius: 10px;
  font-size: 14px; cursor: pointer; outline: 0; -webkit-tap-highlight-color: transparent;
}
.wl-dd-menu [role="option"]:hover, .wl-dd-menu [role="option"]:focus { background: color-mix(in srgb, var(--text) 9%, transparent); }
.wl-dd-menu [role="option"][aria-selected="true"] { color: var(--accent); font-weight: 700; }
.wl-dd-menu [role="option"][aria-selected="true"]::after { content: '✓'; }
.wl-dd-scrim { position: fixed; inset: 0; z-index: 405; background: rgba(0, 0, 0, .5); }

.wl-iconbtn {
  flex: none; display: inline-grid; place-items: center; width: 40px; height: 40px; padding: 0; border-radius: 50%; cursor: pointer;
  color: color-mix(in srgb, var(--text) 78%, transparent); background: color-mix(in srgb, var(--text) 6%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); -webkit-tap-highlight-color: transparent;
  transition: background .2s ease, color .2s ease, border-color .2s ease, transform .15s ease;
}
.wl-iconbtn svg { width: 17px; height: 17px; pointer-events: none; }
.wl-iconbtn:hover { color: var(--text); background: color-mix(in srgb, var(--text) 11%, var(--surface)); }
.wl-iconbtn:active { transform: scale(.92); }
.wl-iconbtn[aria-pressed="true"] { color: #fff; background: var(--accent); border-color: var(--accent); }
.wl-iconbtn[data-mode="grid"] .ic-grid, .wl-iconbtn[data-mode="list"] .ic-list { display: none; }
@media (min-width: 821px) { .wl-search input { font-size: 13.5px; } }

@media (max-width: 640px) {
  .wl-page { padding: 16px 14px 40px; }
  .wl-head h1 { font-size: 26px; }
  .wl-tabs { margin-left: -14px; margin-right: -14px; padding-left: 14px; padding-right: 14px; }
  .wl-tools { flex-basis: 100%; justify-content: flex-start; gap: 8px; }
  .wl-search { flex: 1 1 100%; max-width: none; order: -1; }
  .wl-sugg { left: 0; right: 0; width: auto; max-width: none; }
  .wl-dd { flex: 1 1 auto; min-width: 0; }
  .wl-dd-btn { width: 100%; justify-content: space-between; }
  /* sort menu becomes a bottom sheet */
  .wl-dd-menu {
    position: fixed; left: 12px; right: 12px; top: auto; bottom: calc(12px + env(safe-area-inset-bottom)); z-index: 410; min-width: 0; padding: 8px; border-radius: 20px;
  }
  .wl-dd-menu [role="option"] { min-height: 52px; font-size: 15.5px; }
  .wl-manage { width: 100%; }
}

/* grid + cards */
.wl-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; }
@media (min-width: 480px) { .wl-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); } }
@media (min-width: 560px) { .wl-grid { grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 22px 16px; } }
@media (min-width: 821px) { .wl-grid { grid-template-columns: repeat(auto-fill, minmax(188px, 1fr)); gap: 26px 20px; } .wl-page { padding-top: 32px; } .wl-head h1 { font-size: 34px; } }

.wl-card { display: flex; flex-direction: column; min-width: 0; transition: opacity .18s ease, transform .18s ease; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.wl-card[hidden] { display: none; }
.wl-card.gone { opacity: 0; transform: scale(.96); }
.wl-poster { position: relative; display: block; aspect-ratio: 2 / 3; overflow: hidden; border-radius: 12px; background: color-mix(in srgb, var(--text) 8%, var(--surface)); }
.wl-poster img { width: 100%; height: 100%; object-fit: cover; display: block; transition: opacity .2s ease; }
.wl-poster-fallback { display: grid; place-items: center; height: 100%; padding: 12px; text-align: center; font-size: 13px; font-weight: 600; color: color-mix(in srgb, var(--text) 65%, transparent); }
.wl-tag { position: absolute; left: 8px; top: 8px; padding: 4px 8px; border-radius: 999px; font: 600 11px/1 var(--font); color: #fff; background: rgba(12, 12, 16, .66); }
.wl-seen { position: absolute; left: 8px; bottom: 8px; display: none; padding: 5px 9px; border-radius: 999px; font: 700 11px/1 var(--font); color: #fff; background: var(--accent); }
.wl-card.is-watched .wl-seen { display: inline-flex; }
.wl-card.is-watched .wl-poster img { opacity: .5; }
.wl-info { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; min-width: 0; }
.wl-title { font-size: 14px; font-weight: 600; line-height: 1.3; color: var(--text); text-decoration: none; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wl-title:hover { text-decoration: underline; }
.wl-year { font-size: 12.5px; color: color-mix(in srgb, var(--text) 55%, transparent); min-height: 1em; }
.wl-kind { display: none; }
.wl-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
.wl-act { height: 42px; border-radius: 10px; font: 600 12.5px/1 var(--font); cursor: pointer; color: var(--text); background: transparent; border: 1px solid color-mix(in srgb, var(--text) 16%, transparent); transition: background .2s ease; -webkit-tap-highlight-color: transparent; }
.wl-act:hover { background: color-mix(in srgb, var(--text) 8%, transparent); }
.wl-act:active { transform: scale(.97); }
.wl-act--watch { grid-column: 1 / -1; }
.wl-act--watch[aria-pressed="true"] { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 60%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.wl-act--remove:hover { background: color-mix(in srgb, #d0383c 18%, transparent); border-color: color-mix(in srgb, #d0383c 60%, transparent); }
.wl-act:disabled { opacity: .5; cursor: default; }

/* "pick something for me" / "jump to this title" highlight */
.wl-card.pick .wl-poster { box-shadow: 0 0 0 3px var(--accent), 0 14px 34px -12px color-mix(in srgb, var(--accent) 70%, transparent); }

/* list view: one row per title, like a playlist */
.wl-grid.wl-grid--list { grid-template-columns: 1fr; gap: 10px; }
.wl-grid--list .wl-card {
  display: grid; grid-template-columns: 76px minmax(0, 1fr); grid-template-areas: "p i" "p a"; column-gap: 14px; align-content: start; align-items: start;
  padding: 10px; border-radius: 14px; background: color-mix(in srgb, var(--text) 3%, var(--surface)); border: 1px solid color-mix(in srgb, var(--text) 8%, transparent);
}
.wl-grid--list .wl-poster { grid-area: p; border-radius: 8px; }
.wl-grid--list .wl-info { grid-area: i; margin-top: 2px; }
.wl-grid--list .wl-title { font-size: 15px; }
.wl-grid--list .wl-kind { display: inline; }
.wl-grid--list .wl-tag { display: none; }
.wl-grid--list .wl-seen { left: 4px; bottom: 4px; padding: 4px 6px; font-size: 10px; }
.wl-grid--list .wl-actions { grid-area: a; grid-template-columns: repeat(3, auto); justify-content: start; margin-top: 8px; }
.wl-grid--list .wl-act { height: 38px; padding: 0 12px; }
.wl-grid--list .wl-act--watch { grid-column: auto; }
@media (max-width: 420px) { .wl-grid--list .wl-act { padding: 0 9px; font-size: 12px; } }

/* select mode */
.is-selecting .wl-actions { display: none; }
.is-selecting .wl-card { cursor: pointer; user-select: none; -webkit-user-select: none; }
.is-selecting .wl-poster::after {
  content: ''; position: absolute; top: 8px; right: 8px; z-index: 2; width: 26px; height: 26px; box-sizing: border-box; border-radius: 50%;
  background: rgba(12, 12, 16, .55); border: 2px solid #fff;
}
.is-selecting .wl-card.sel .wl-poster { box-shadow: 0 0 0 3px var(--accent); }
.is-selecting .wl-card.sel .wl-poster::after { content: '✓'; display: grid; place-items: center; background: var(--accent); border-color: var(--accent); color: #fff; font: 700 14px/1 var(--font); }
.is-selecting .wl-grid--list .wl-poster::after { top: 4px; right: 4px; width: 22px; height: 22px; font-size: 12px; }

.wl-bulk {
  position: fixed; left: 50%; bottom: 20px; z-index: 200; display: grid; gap: 8px; width: min(620px, calc(100vw - 24px)); padding: 10px 12px; transform: translateX(-50%);
  border-radius: 18px; color: var(--text); background: color-mix(in srgb, var(--surface) 95%, transparent);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); box-shadow: 0 24px 60px -20px rgba(0, 0, 0, .85);
}
.wl-bulk[hidden] { display: none; }
@media (max-width: 820px) { .wl-bulk { bottom: calc(84px + env(safe-area-inset-bottom)); } }
.wl-bulk-top { display: flex; align-items: center; gap: 4px; }
.wl-bulk-n { margin-right: auto; padding-left: 4px; font: 700 14px/1 var(--font); }
.wl-bulk-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.wl-bulk-btn { flex: 1 1 auto; height: 42px; padding: 0 12px; border-radius: 10px; font: 600 13px/1 var(--font); cursor: pointer; color: var(--text); background: transparent; border: 1px solid color-mix(in srgb, var(--text) 18%, transparent); transition: background .2s ease; }
.wl-bulk-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--text) 9%, transparent); }
.wl-bulk-btn:disabled { opacity: .45; cursor: default; }
.wl-bulk-btn--danger { color: #e5575b; }

.wl-empty, .wl-nomatch { display: grid; justify-items: center; gap: 8px; padding: 56px 16px; text-align: center; color: color-mix(in srgb, var(--text) 62%, transparent); }
.wl-empty[hidden], .wl-nomatch[hidden] { display: none; }
.wl-empty h3, .wl-nomatch h3 { margin: 6px 0 0; font: 700 18px/1.3 var(--font); color: var(--text); }
.wl-empty p, .wl-nomatch p { margin: 0; max-width: 34ch; font-size: 14px; line-height: 1.5; }
.wl-cta { display: inline-flex; align-items: center; height: 44px; margin-top: 10px; padding: 0 20px; border-radius: 999px; font: 600 14px/1 var(--font); color: #fff; text-decoration: none; background: var(--accent); border: 0; cursor: pointer; }

@media (prefers-reduced-motion: reduce) {
  .wl-sheet, .wl-backdrop, .wl-toast, .wl-card, .wl-btn, .wl-progress-bar i, .wl-dd-btn svg { transition: none; }
}

/* hero button on a movie / series page */
.wl-btn--hero svg { width: 16px; height: 16px; }
.wl-btn--hero[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
@media (max-width: 640px) {
  .movie-page .mhero .hero-actions { grid-template-columns: 1fr 1fr 1fr !important; }
  .movie-page .mhero .hero-actions [data-act="compose"] { grid-column: 1 / -1; }
}
`;
  document.head.appendChild(style);

  const tag = document.querySelector('script[data-watchlist]');
  const ME = !!tag && tag.getAttribute('data-me') === '1';
  let keys = new Set();

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const el = (name, cls, text) => {
    const n = document.createElement(name);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  // must match tmdb.normalize() on the server (used for the "is this title saved?" keys)
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // for searching: same idea, but keeps letters of every language (Hindi, Japanese, Arabic…)
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  /* ------------------------------ network ------------------------------ */

  async function call(url, body, signal) {
    let res;
    try {
      res = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      const err = new Error('No connection. Check your internet and try again.');
      err.network = true;
      throw err;
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty or non-JSON body */ }
    if (!res.ok) {
      const fallback = res.status === 404
        ? 'The server doesn’t know this action yet (404 on ' + url.split('?')[0] + '). Restart the server, then refresh the page.'
        : 'Something went wrong (error ' + res.status + '). Please try again.';
      const err = new Error(data.error || fallback);
      err.status = res.status;
      err.login = !!data.login;
      throw err;
    }
    return data;
  }
  const post = (url, body) => call(url, body || {});

  const goLogin = () => { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); };

  const store = {
    get(k) { try { return localStorage.getItem('wl-' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('wl-' + k, v); } catch (e) { /* ignore */ } },
  };

  /* ------------------------------ saved state ------------------------------ */

  const keysFor = (b) => {
    const out = [];
    const { type, id, imdb, title } = b.dataset;
    if (type && id) out.push(type + ':' + id);
    if (imdb) out.push('imdb:' + imdb);
    if (!(type && id) && !imdb) { const n = norm(title); if (n) out.push('name:' + n); }
    return out;
  };
  const isSaved = (b) => keysFor(b).some((k) => keys.has(k));
  const refOf = (b) => ({ type: b.dataset.type, id: b.dataset.id, imdb: b.dataset.imdb, title: b.dataset.title, year: b.dataset.year });

  function setBtn(b, on) {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', on ? 'Saved to your watchlist. Tap to remove or change lists' : 'Save to watchlist');
    b.title = on ? 'Saved to watchlist' : 'Save to watchlist';
    const t = $('.wl-btn-text', b);
    if (t) t.textContent = on ? 'Saved' : 'Watchlist';
  }

  function paint(root) {
    if (!ME) return;
    $$('[data-watch]', root).forEach((b) => {
      if (b.dataset.busy === '1') return;
      const on = isSaved(b);
      if ((b.getAttribute('aria-pressed') === 'true') !== on) setBtn(b, on);
    });
  }

  // suggestion boxes remember their results briefly; any change to your lists clears them
  const suggesters = [];
  const bump = () => suggesters.forEach((s) => s.clear());

  async function load() {
    if (!ME) return;
    try {
      const d = await call('/api/watchlist/status');
      keys = new Set(d.keys || []);
      paint();
    } catch (e) { /* buttons simply stay unsaved */ }
  }

  function apply(d, refresh) {
    (d.keys || []).forEach((k) => (d.saved ? keys.add(k) : keys.delete(k)));
    paint();
    bump();
    if (refresh !== false) load(); // re-sync (e.g. a title name shared by two saved items)
  }

  /* ------------------------------ toast ------------------------------ */

  let toastEl = null;
  let toastTimer = 0;
  function toast(message, actions, isError) {
    if (!toastEl) {
      toastEl = el('div', 'wl-toast');
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    clearTimeout(toastTimer);
    toastEl.textContent = '';
    toastEl.classList.toggle('error', !!isError);
    toastEl.appendChild(el('span', 'wl-toast-msg', message));
    (actions || []).forEach((a) => {
      const btn = el('button', '', a.label);
      btn.type = 'button';
      btn.addEventListener('click', () => { hideToast(); a.fn(); });
      toastEl.appendChild(btn);
    });
    requestAnimationFrame(() => toastEl.classList.add('show'));
    toastTimer = setTimeout(hideToast, (actions && actions.length) ? 6000 : 3500);
  }
  function hideToast() { if (toastEl) toastEl.classList.remove('show'); }

  function fail(err) {
    if (err && err.login) return goLogin();
    toast((err && err.message) || 'Something went wrong. Please try again.', [], true);
  }

  /* ------------------------------ sheet (picker + dialogs) ------------------------------ */

  function makeLayer(label) {
    const prev = document.activeElement;
    const layer = el('div', 'wl-layer');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', label);
    const backdrop = el('div', 'wl-backdrop');
    const sheet = el('div', 'wl-sheet');
    layer.append(backdrop, sheet);
    document.body.appendChild(layer);
    document.documentElement.classList.add('wl-lock');
    requestAnimationFrame(() => layer.classList.add('open'));

    let closed = false;
    let onClose = null;

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      const f = $$('button, input, a[href]', sheet).filter((n) => !n.disabled && n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      layer.classList.remove('open');
      document.documentElement.classList.remove('wl-lock');
      setTimeout(() => layer.remove(), 200);
      if (prev && prev.focus && document.contains(prev)) prev.focus();
      if (onClose) onClose();
    }
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('click', close);
    return { sheet, close, setOnClose: (fn) => { onClose = fn; } };
  }

  function sheetHead(title, close) {
    const head = el('div', 'wl-sheet-head');
    head.appendChild(el('h2', 'wl-sheet-title', title));
    const x = el('button', 'wl-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', close);
    head.appendChild(x);
    return head;
  }

  // Small prompt / confirm dialog -> resolves to the typed text (or true for a confirm), null when cancelled
  function ask(o) {
    return new Promise((resolve) => {
      const L = makeLayer(o.title);
      let done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); L.close(); };
      L.setOnClose(() => { if (!done) { done = true; resolve(null); } });

      const form = el('form');
      form.appendChild(sheetHead(o.title, L.close));
      if (o.text) form.appendChild(el('p', 'wl-sheet-text', o.text));
      let input = null;
      if (o.input) {
        input = el('input', 'wl-field');
        input.type = 'text';
        input.maxLength = 60;
        input.value = o.value || '';
        input.placeholder = o.placeholder || '';
        input.autocomplete = 'off';
        input.setAttribute('aria-label', o.title);
        form.appendChild(input);
      }
      const row = el('div', 'wl-buttons');
      const cancel = el('button', 'wl-ghost', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => finish(null));
      const ok = el('button', 'wl-solid' + (o.danger ? ' wl-solid--danger' : ''), o.confirm || 'OK');
      ok.type = 'submit';
      row.append(cancel, ok);
      form.appendChild(row);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (input) {
          const v = input.value.trim();
          if (!v) { input.focus(); return; }
          finish(v);
        } else finish(true);
      });
      L.sheet.appendChild(form);
      (input || ok).focus();
      if (input) input.select();
    });
  }

  /* ------------------------------ list picker (bookmark) ------------------------------ */

  async function openPicker(source, data, opts) {
    const options = opts || {};
    let info = data;
    if (!info || !info.lists) {
      try { info = await post('/api/watchlist/membership', refOf(source)); } catch (err) { return fail(err); }
    }
    const ref = { type: info.ref.type, id: info.ref.id };
    const L = makeLayer('Save to a list');
    let changed = false;

    L.sheet.appendChild(sheetHead('Save to…', L.close));
    if (source.dataset.title) L.sheet.appendChild(el('p', 'wl-sheet-sub', source.dataset.title));
    const ul = el('ul', 'wl-lists');
    L.sheet.appendChild(ul);

    const addRow = (l, has) => {
      const li = el('li');
      const label = el('label', 'wl-row');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!has;
      const count = el('span', 'wl-row-n', String(l.count));
      cb.addEventListener('change', async () => {
        const want = cb.checked;
        cb.disabled = true;
        try {
          const d = await post(want ? '/api/watchlist/add' : '/api/watchlist/remove', { type: ref.type, id: ref.id, listId: l.id });
          changed = true;
          l.count = Math.max(0, l.count + (want ? 1 : -1));
          count.textContent = String(l.count);
          apply(d);
        } catch (err) {
          cb.checked = !want;
          fail(err);
        }
        cb.disabled = false;
      });
      label.append(cb, el('span', 'wl-row-name', l.name), count);
      li.appendChild(label);
      ul.appendChild(li);
    };
    info.lists.forEach((l) => addRow(l, l.has));

    const form = el('form', 'wl-new');
    const input = el('input');
    input.type = 'text';
    input.maxLength = 60;
    input.placeholder = 'New list name';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'New list name');
    const go = el('button', 'wl-solid', 'Create');
    go.type = 'submit';
    form.append(input, go);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      go.disabled = true;
      try {
        const d = await post('/api/watchlist/lists', { name, add: { type: ref.type, id: ref.id } });
        changed = true;
        addRow({ id: d.list.id, name: d.list.name, count: 1 }, true);
        input.value = '';
        apply(d);
      } catch (err) { fail(err); }
      go.disabled = false;
    });
    L.sheet.appendChild(form);

    const done = el('button', 'wl-ghost wl-done', 'Done');
    done.type = 'button';
    done.addEventListener('click', L.close);
    L.sheet.appendChild(done);

    L.setOnClose(() => { if (changed && options.onChange) options.onChange(); });
    const first = $('input[type="checkbox"]', L.sheet);
    (first || input).focus();
  }

  /* ------------------------------ search suggestions (shared) ------------------------------ */

  let sgCount = 0;

  // o: { input, box, remote(q, signal) -> Promise<items>, local(q) -> items, onPick(item), floating, emptyText(q), head }
  function makeSuggest(o) {
    const { input, box } = o;
    let items = [];
    let active = -1;
    let timer = 0;
    let blurTimer = 0;
    let ctl = null;
    let seq = 0;
    let ver = 0;
    const cache = new Map();
    const boxId = box.id || ('wl-sg-' + (++sgCount));
    box.id = boxId;
    box.setAttribute('role', 'listbox');
    box.setAttribute('aria-label', 'Suggestions');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', boxId);

    const isOpen = () => !box.hidden;

    function place() {
      if (!o.floating) return;
      const r = input.getBoundingClientRect();
      const narrow = window.innerWidth <= 640;
      const w = narrow ? window.innerWidth - 16 : Math.min(Math.max(r.width, 340), window.innerWidth - 16);
      const left = narrow ? 8 : Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      box.style.width = w + 'px';
      box.style.left = left + 'px';
      box.style.top = (r.bottom + 8) + 'px';
      box.style.maxHeight = Math.max(160, Math.min(440, window.innerHeight - r.bottom - 24)) + 'px';
    }

    function close() {
      box.hidden = true;
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function open() {
      place();
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function highlight(text, q) {
      const frag = document.createDocumentFragment();
      const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
      if (i < 0) { frag.appendChild(document.createTextNode(text)); return frag; }
      frag.appendChild(document.createTextNode(text.slice(0, i)));
      frag.appendChild(el('mark', '', text.slice(i, i + q.length)));
      frag.appendChild(document.createTextNode(text.slice(i + q.length)));
      return frag;
    }

    function setActive(i) {
      const rows = $$('.wl-sg-row', box);
      if (!rows.length) return;
      active = (i + rows.length) % rows.length;
      rows.forEach((r, n) => {
        const on = n === active;
        r.classList.toggle('on', on);
        r.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) {
          input.setAttribute('aria-activedescendant', r.id);
          r.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    function render(list, q) {
      items = list;
      active = -1;
      input.removeAttribute('aria-activedescendant');
      box.textContent = '';
      if (!list.length) {
        box.appendChild(el('div', 'wl-sg-empty', o.emptyText ? o.emptyText(q) : 'No matches'));
        open();
        return;
      }
      if (o.head) box.appendChild(el('div', 'wl-sg-head', o.head));
      list.forEach((it, i) => {
        const row = el('div', 'wl-sg-row');
        row.id = boxId + '-' + i;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        row.dataset.i = String(i);
        const thumb = el('div', 'wl-sg-thumb');
        if (it.poster) {
          const img = el('img');
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.src = it.poster;
          img.addEventListener('error', () => img.remove());
          thumb.appendChild(img);
        }
        const body = el('div', 'wl-sg-body');
        const title = el('div', 'wl-sg-title');
        title.appendChild(highlight(it.title, q));
        const parts = [];
        if (it.year) parts.push(it.year);
        parts.push(it.type === 'tv' ? 'Series' : 'Movie');
        const names = (it.lists || []).map((l) => l.name);
        if (names.length) parts.push(names.length > 2 ? names.slice(0, 2).join(', ') + ' +' + (names.length - 2) : names.join(', '));
        body.append(title, el('div', 'wl-sg-sub', parts.join(' · ')));
        row.append(thumb, body);
        if (it.watched) {
          const s = el('span', 'wl-sg-seen', '✓');
          s.title = 'Watched';
          row.appendChild(s);
        }
        box.appendChild(row);
      });
      open();
    }

    async function run() {
      const q = input.value.trim();
      const my = ++seq;
      if (!q) { close(); return; }
      if (!o.remote) { render(o.local(q), q); return; }
      const k = ver + ':' + q.toLowerCase();
      if (cache.has(k)) { render(cache.get(k), q); return; }
      let list;
      try {
        if (ctl) ctl.abort();
        ctl = new AbortController();
        list = await o.remote(q, ctl.signal);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        if (my !== seq) return;
        if (err && err.login) { close(); return; }
        list = o.local ? o.local(q) : []; // server hiccup: still help from what is on screen
        if (my !== seq) return;
        render(list, q);
        return;
      }
      if (my !== seq) return;
      cache.set(k, list);
      if (cache.size > 40) cache.delete(cache.keys().next().value);
      render(list, q);
    }

    function pick(i) {
      const it = items[i];
      if (!it) return;
      close();
      o.onPick(it);
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, o.remote ? 140 : 0);
    });
    input.addEventListener('focus', () => {
      clearTimeout(blurTimer);
      if (input.value.trim()) run();
    });
    input.addEventListener('blur', () => {
      blurTimer = setTimeout(close, 180); // lets a tap on a suggestion land first
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        if (!isOpen()) { run(); return; }
        e.preventDefault(); setActive(active + 1);
      } else if (e.key === 'ArrowUp') {
        if (!isOpen()) return;
        e.preventDefault(); setActive(active < 0 ? -1 : active - 1);
      } else if (e.key === 'Enter') {
        if (isOpen() && active >= 0) { e.preventDefault(); pick(active); }
      } else if (e.key === 'Escape') {
        if (isOpen()) { e.preventDefault(); e.stopPropagation(); close(); }
      }
    });
    box.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input on desktop
    box.addEventListener('click', (e) => {
      const row = e.target.closest('.wl-sg-row');
      if (row) pick(Number(row.dataset.i));
    });
    if (o.floating) {
      window.addEventListener('resize', () => { if (isOpen()) place(); });
      window.addEventListener('scroll', () => { if (isOpen()) place(); }, true);
    }

    const api = { close, refresh: run, clear() { cache.clear(); ver++; } };
    suggesters.push(api);
    return api;
  }

  const remoteSuggest = async (q, signal) => (await call('/api/watchlist/suggest?q=' + encodeURIComponent(q), undefined, signal)).items || [];

  // any <input data-wl-suggest> (e.g. the site-wide search box) gets watchlist suggestions while typing
  function initGlobalSuggest() {
    if (!ME) return;
    $$('input[data-wl-suggest]').forEach((input) => {
      if (input.dataset.wlSuggestReady || input.closest('#wl-page')) return;
      input.dataset.wlSuggestReady = '1';
      const box = el('div', 'wl-sugg wl-sugg--float');
      box.hidden = true;
      document.body.appendChild(box);
      makeSuggest({
        input, box, floating: true,
        head: 'In your watchlist',
        remote: remoteSuggest,
        emptyText: () => 'Nothing in your watchlist matches',
        onPick: (it) => { location.href = it.url; },
      });
    });
  }

  /* ------------------------------ add bookmark buttons automatically ------------------------------ */

  const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1z"/></svg>';
  const TITLE_URL = /^\/(movie|tv)\/(\d+)(?:[/?#]|$)/;

  function makeBtn(variant, info) {
    const b = el('button', 'wl-btn wl-btn--' + variant + (variant === 'act' ? ' act' : variant === 'hero' ? ' btn btn-glass' : ''));
    b.type = 'button';
    b.setAttribute('data-watch', '');
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', 'Save to watchlist');
    b.title = 'Save to watchlist';
    ['type', 'id', 'imdb', 'title', 'year'].forEach((k) => { if (info[k]) b.dataset[k] = String(info[k]); });
    b.innerHTML = ICON;
    if (variant === 'hero') b.appendChild(el('span', 'wl-btn-text', 'Watchlist'));
    return b;
  }

  // a discussion card knows its movie from the movie link (id, or imdb/title/year), or from the movie page it sits on
  function movieOfPostCard(card) {
    const a = $('.pcard-movie', card);
    if (a) {
      const href = a.getAttribute('href') || '';
      const text = a.textContent.trim();
      const m = TITLE_URL.exec(href);
      if (m) return { type: m[1], id: m[2], title: text };
      try {
        const q = new URL(href, location.origin).searchParams;
        return { imdb: q.get('imdb') || '', title: q.get('title') || text, year: q.get('year') || '' };
      } catch (e) { return { title: text }; }
    }
    const hero = $('[data-share-movie]');
    const m = hero && TITLE_URL.exec(hero.dataset.url || '');
    return m ? { type: m[1], id: m[2], title: hero.dataset.title || '' } : null;
  }

  function enhance() {
    $$('a.mcard').forEach((card) => {
      const poster = $('.mcard-poster', card);
      if (!poster || $('[data-watch]', poster)) return;
      const m = TITLE_URL.exec(card.getAttribute('href') || '');
      if (m) poster.appendChild(makeBtn('poster', { type: m[1], id: m[2], title: card.getAttribute('title') || '' }));
    });
    // one bookmark per discussion card: top-right of the poster on tiles (home rail + discussions grid), in the action row elsewhere
    $$('.pcard').forEach((pcard) => {
      if ($('[data-watch]', pcard)) return;
      const info = movieOfPostCard(pcard);
      if (!info) return;
      const poster = $('.pcard-poster', pcard);
      if (poster && pcard.closest('.pgrid, .rail-track--posts')) { poster.after(makeBtn('poster', info)); return; }
      const acts = $('.pcard-actions', pcard);
      if (acts) acts.insertBefore(makeBtn('act', info), $('[data-share-post]', acts));
    });
    const share = $('[data-share-movie]');
    if (share && share.parentNode && !$('[data-watch]', share.parentNode)) {
      const m = TITLE_URL.exec(share.dataset.url || '');
      if (m) share.parentNode.insertBefore(makeBtn('hero', { type: m[1], id: m[2], title: share.dataset.title || '' }), share.nextSibling);
    }
    initGlobalSuggest();
  }

  /* ------------------------------ bookmark buttons ------------------------------ */

  async function onWatch(b) {
    if (!ME) return goLogin();
    if (b.dataset.busy === '1') return;
    b.dataset.busy = '1';
    const was = b.getAttribute('aria-pressed') === 'true';
    setBtn(b, !was); // instant feedback, rolled back on error
    try {
      const d = await post('/api/watchlist/toggle', refOf(b));
      if (d.state === 'choose') {
        setBtn(b, true);
        apply(d, false);
        delete b.dataset.busy;
        openPicker(b, d);
        return;
      }
      setBtn(b, d.state === 'added');
      apply(d, false);
      if (d.state === 'added') {
        toast('Saved to ' + d.listName, [{ label: 'Lists', fn: () => openPicker(b) }]);
      } else {
        toast('Removed from ' + d.listName, [{
          label: 'Undo',
          fn: async () => {
            try { apply(await post('/api/watchlist/add', { type: d.ref.type, id: d.ref.id, listId: d.listId })); }
            catch (err) { fail(err); }
          },
        }]);
      }
      load();
    } catch (err) {
      setBtn(b, was);
      fail(err);
    }
    delete b.dataset.busy;
  }

  // capture phase: the button sits inside a card link, so stop the link from opening
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-watch]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    onWatch(b);
  }, true);

  /* ------------------------------ themed dropdown ------------------------------ */

  function initDropdown(root, onChange) {
    const btn = $('.wl-dd-btn', root);
    const menu = $('.wl-dd-menu', root);
    const label = $('.wl-dd-label', root);
    const opts = $$('[role="option"]', menu);
    let scrim = null;
    if (!btn || !menu || !opts.length) return null;
    opts.forEach((o) => { o.tabIndex = -1; });

    const isOpen = () => !menu.hidden;
    const current = () => opts.find((o) => o.getAttribute('aria-selected') === 'true') || opts[0];

    function open() {
      if (isOpen()) return;
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      root.classList.add('open');
      if (window.matchMedia('(max-width: 640px)').matches) {
        scrim = el('div', 'wl-dd-scrim');
        scrim.addEventListener('click', () => close(true));
        document.body.appendChild(scrim);
        document.documentElement.classList.add('wl-lock');
      }
      current().focus();
    }
    function close(focusBtn) {
      if (!isOpen()) return;
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      root.classList.remove('open');
      if (scrim) { scrim.remove(); scrim = null; document.documentElement.classList.remove('wl-lock'); }
      if (focusBtn) btn.focus();
    }
    function set(value, silent) {
      const o = opts.find((x) => x.dataset.value === value);
      if (!o) return;
      opts.forEach((x) => x.setAttribute('aria-selected', x === o ? 'true' : 'false'));
      label.textContent = o.textContent;
      root.dataset.value = value;
      if (!silent) onChange(value);
    }

    btn.addEventListener('click', () => (isOpen() ? close(true) : open()));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
    });
    menu.addEventListener('click', (e) => {
      const o = e.target.closest('[role="option"]');
      if (!o) return;
      set(o.dataset.value);
      close(true);
    });
    menu.addEventListener('keydown', (e) => {
      const i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); opts[(i + 1) % opts.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); opts[(i - 1 + opts.length) % opts.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); opts[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); opts[opts.length - 1].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (i >= 0) { set(opts[i].dataset.value); close(true); }
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close(false);
    });
    document.addEventListener('pointerdown', (e) => {
      if (isOpen() && !root.contains(e.target) && !(scrim && e.target === scrim)) close(false);
    });
    return { set, close };
  }

  /* ------------------------------ the Watchlist page ------------------------------ */

  function initPage() {
    const page = $('#wl-page');
    if (!page) return;
    const owner = page.dataset.owner === '1';
    const listId = Number(page.dataset.list);
    const listName = page.dataset.listName;
    const baseUrl = page.dataset.base || '/watchlist';
    const grid = $('#wl-grid', page);
    const bulkBar = $('#wl-bulk', page);
    const searchInput = $('#wl-q', page);
    const clearBtn = $('[data-wl-qclear]', page);

    // a message saved before a reload (e.g. after "Move")
    try {
      const m = sessionStorage.getItem('wl-toast');
      if (m) { sessionStorage.removeItem('wl-toast'); toast(m); }
    } catch (e) { /* ignore */ }

    // precompute what searching looks at, once
    if (grid) $$('.wl-card', grid).forEach((c) => { c.dataset.n = fold(c.dataset.title || $('.wl-title', c).textContent); });

    /* ----- view: filter + search + sort + grid/list ----- */
    const num = (c, k) => Number(c.dataset[k]) || 0;
    const SORTS = {
      recent: (a, b) => num(a, 'pos') - num(b, 'pos'),
      oldest: (a, b) => num(b, 'pos') - num(a, 'pos'),
      title: (a, b) => a.dataset.sort.localeCompare(b.dataset.sort) || num(a, 'pos') - num(b, 'pos'),
      'year-new': (a, b) => num(b, 'year') - num(a, 'year') || num(a, 'pos') - num(b, 'pos'),
      'year-old': (a, b) => (num(a, 'year') || 9999) - (num(b, 'year') || 9999) || num(a, 'pos') - num(b, 'pos'),
    };
    const view = { filter: 'all', q: '', sort: 'recent', mode: 'grid' };
    const savedSort = store.get('sort');
    if (savedSort && SORTS[savedSort]) view.sort = savedSort;
    if (store.get('mode') === 'list') view.mode = 'list';

    const dd = initDropdown($('#wl-sort', page), (value) => {
      view.sort = SORTS[value] ? value : 'recent';
      store.set('sort', view.sort);
      applyView(true);
    });
    if (dd) dd.set(view.sort, true);

    function applyMode() {
      if (grid) grid.classList.toggle('wl-grid--list', view.mode === 'list');
      const b = $('[data-wl-view]', page);
      if (b) {
        const label = view.mode === 'list' ? 'Switch to grid view' : 'Switch to list view';
        b.dataset.mode = view.mode;
        b.setAttribute('aria-label', label);
        b.title = label;
      }
    }

    function updateProgress() {
      const box = $('#wl-progress', page);
      if (!box || !grid) return;
      const cards = $$('.wl-card', grid);
      const done = cards.filter((c) => c.dataset.watched === '1').length;
      const pct = cards.length ? Math.round((done / cards.length) * 100) : 0;
      const bar = $('.wl-progress-bar', box);
      if (bar) {
        bar.setAttribute('aria-valuenow', String(pct));
        const fill = $('i', bar);
        if (fill) fill.style.width = pct + '%';
      }
      const text = $('.wl-progress-text', box);
      if (text) text.textContent = done + ' of ' + cards.length + ' watched';
      box.hidden = !cards.length;
    }

    const selected = () => (grid ? $$('.wl-card.sel', grid).filter((c) => !c.hidden) : []);
    function syncBulk() {
      if (!bulkBar) return;
      const n = selected().length;
      $('.wl-bulk-n', bulkBar).textContent = n + ' selected';
      $$('[data-wl-bulk]', bulkBar).forEach((b) => { b.disabled = n === 0; });
    }

    function setFilter(f) {
      view.filter = f;
      $$('[data-wl-filter]', page).forEach((c) => c.setAttribute('aria-pressed', c.dataset.wlFilter === f ? 'true' : 'false'));
    }

    // resort=true only when the order can change (sort menu, new cards); filtering and typing just show/hide cards
    function applyView(resort) {
      if (!grid) return;
      let cards = $$('.wl-card', grid);
      if (resort) {
        cards = cards.sort(SORTS[view.sort] || SORTS.recent);
        const frag = document.createDocumentFragment();
        cards.forEach((c) => frag.appendChild(c));
        grid.appendChild(frag);
      }
      let shown = 0;
      const f = view.filter;
      cards.forEach((c) => {
        const okFilter = f === 'all' || c.dataset.type === f ||
          (f === 'watched' && c.dataset.watched === '1') || (f === 'todo' && c.dataset.watched !== '1');
        const okSearch = !view.q || (c.dataset.n || '').includes(view.q);
        const hide = !(okFilter && okSearch);
        if (c.hidden !== hide) c.hidden = hide;
        if (hide) c.classList.remove('sel');
        else shown++;
      });
      const none = $('.wl-nomatch', page);
      if (none) none.hidden = shown > 0 || !cards.length;
      updateProgress();
      syncBulk();
    }

    function setQuery(text) {
      if (searchInput) searchInput.value = text;
      view.q = fold(text);
      if (clearBtn) clearBtn.hidden = !text;
      applyView(false);
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => setQuery(searchInput.value));
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && searchInput.value) { e.preventDefault(); setQuery(''); }
        else if (e.key === 'Enter') searchInput.blur(); // closes the phone keyboard
      });
    }
    // "/" jumps to the search box
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || !searchInput) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    });

    /* ----- jump to / highlight one title ----- */
    let pickTimer = 0;
    function highlightCard(type, id) {
      if (!grid) return false;
      const card = $('.wl-card[data-type="' + type + '"][data-id="' + id + '"]', grid);
      if (!card) return false;
      if (card.hidden) { setFilter('all'); setQuery(''); applyView(false); }
      $$('.wl-card.pick', grid).forEach((c) => c.classList.remove('pick'));
      card.classList.add('pick');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      clearTimeout(pickTimer);
      pickTimer = setTimeout(() => card.classList.remove('pick'), 3500);
      return true;
    }

    /* ----- suggestions ----- */
    const sugBox = $('#wl-sugg', page);
    if (searchInput && sugBox) {
      const local = (q) => {
        const f = fold(q);
        const out = [];
        $$('.wl-card', grid).forEach((c) => {
          if (!f || !(c.dataset.n || '').includes(f)) return;
          const img = $('.wl-poster img', c);
          out.push({
            type: c.dataset.type,
            id: c.dataset.id,
            title: c.dataset.title || $('.wl-title', c).textContent,
            year: c.dataset.year && c.dataset.year !== '0' ? c.dataset.year : '',
            poster: img ? img.getAttribute('src') : '',
            watched: c.dataset.watched === '1',
            lists: [{ id: listId, name: listName }],
            starts: c.dataset.n.startsWith(f),
          });
        });
        out.sort((a, b) => Number(b.starts) - Number(a.starts));
        return out.slice(0, 8);
      };
      makeSuggest({
        input: searchInput,
        box: sugBox,
        head: owner ? 'In your lists' : 'In this list',
        remote: owner ? remoteSuggest : null,
        local,
        emptyText: (q) => 'No titles match “' + q + '”',
        onPick: (it) => {
          const here = (it.lists || []).some((l) => Number(l.id) === listId);
          if (here || !owner) {
            setQuery(it.title);
            searchInput.blur();
            highlightCard(it.type, it.id);
          } else {
            location.href = baseUrl + '?list=' + it.lists[0].id + '&focus=' + it.type + '-' + it.id;
          }
        },
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => { setQuery(''); if (searchInput) searchInput.focus(); });
    }

    // ?focus=movie-123 (coming from a suggestion in another list)
    try {
      const params = new URLSearchParams(location.search);
      const focus = params.get('focus');
      if (focus) {
        const m = /^(movie|tv)-(\d+)$/.exec(focus);
        params.delete('focus');
        const qs = params.toString();
        history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
        if (m) setTimeout(() => highlightCard(m[1], m[2]), 120);
      }
    } catch (e) { /* ignore */ }

    // broken poster -> show the title instead of an empty box
    if (grid) {
      grid.addEventListener('error', (e) => {
        const img = e.target;
        if (!img || img.tagName !== 'IMG') return;
        const holder = img.closest('.wl-poster');
        if (!holder) return;
        const fb = el('span', 'wl-poster-fallback', (img.closest('.wl-card') || {}).dataset ? img.closest('.wl-card').dataset.title : '');
        img.replaceWith(fb);
      }, true);
    }

    /* ----- sharing ----- */
    async function shareLink() {
      const url = location.origin + page.dataset.share;
      const text = owner ? 'Check out my “' + listName + '” list on KravN' : 'Check out “' + listName + '” on KravN';
      if (navigator.share) {
        try { await navigator.share({ title: listName + ' · KravN', text, url }); return; }
        catch (err) { if (err && err.name === 'AbortError') return; /* otherwise fall back to copy */ }
      }
      try { await navigator.clipboard.writeText(url); toast('Link copied'); }
      catch (err) { window.prompt('Copy this link', url); }
    }

    const PUBLIC_TEXT = 'Anyone with the link can view “' + listName + '” (they can’t change it, and they can save their own copy). Your other lists stay private unless you make them public too. You can make it private again at any time.';

    async function onShare() {
      if (owner && page.dataset.listPublic !== '1') {
        const ok = await ask({ title: 'Make this list public?', text: 'Only public lists can be shared. ' + PUBLIC_TEXT, confirm: 'Make public & share' });
        if (!ok) return;
        try {
          await post('/api/watchlist/lists/' + listId + '/public', { isPublic: true });
          location.href = '/watchlist?list=' + listId + '&share=1'; // the page offers a fresh "Share" tap after reload
        } catch (err) { fail(err); }
        return;
      }
      shareLink();
    }

    if (owner && page.dataset.listPublic === '1' && new URLSearchParams(location.search).get('share') === '1') {
      try { history.replaceState(null, '', location.pathname + '?list=' + listId); } catch (e) { /* ignore */ }
      toast('List is now public', [{ label: 'Share', fn: shareLink }]);
    }

    /* ----- pick something for me ----- */
    function surprise() {
      if (!grid) return;
      const pool = $$('.wl-card', grid).filter((c) => !c.hidden && (!owner || c.dataset.watched !== '1'));
      if (!pool.length) { toast(owner ? 'Nothing left to watch here. Nice work!' : 'Nothing to pick from.'); return; }
      const card = pool[Math.floor(Math.random() * pool.length)];
      $$('.wl-card.pick', grid).forEach((c) => c.classList.remove('pick'));
      card.classList.add('pick');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      clearTimeout(pickTimer);
      pickTimer = setTimeout(() => card.classList.remove('pick'), 4000);
      const link = $('.wl-poster', card);
      const name = $('.wl-title', card);
      toast('Tonight: ' + (name ? name.textContent : 'this one'), link && link.href ? [{ label: 'Open', fn: () => { location.href = link.href; } }] : []);
    }

    /* ----- save someone else's public list ----- */
    async function saveCopy(btn) {
      if (!ME) return goLogin();
      btn.disabled = true;
      try {
        const d = await post('/api/watchlist/lists/' + listId + '/save');
        toast('Saved to your lists', [{ label: 'Open', fn: () => { location.href = '/watchlist?list=' + d.list.id; } }]);
      } catch (err) { fail(err); }
      btn.disabled = false;
    }

    /* ----- owner: select mode + bulk actions ----- */
    let selecting = false;
    function setSelecting(on) {
      selecting = !!on && !!grid && owner;
      page.classList.toggle('is-selecting', selecting);
      document.documentElement.classList.toggle('wl-selecting', selecting);
      if (bulkBar) bulkBar.hidden = !selecting;
      const sb = $('[data-wl-select]', page);
      if (sb) sb.setAttribute('aria-pressed', selecting ? 'true' : 'false');
      if (!selecting && grid) $$('.wl-card.sel', grid).forEach((c) => c.classList.remove('sel'));
      syncBulk();
    }

    // long-press a title on a phone to start selecting (the cards are links, so a normal tap opens them)
    let lpTimer = 0;
    let lpFired = false;
    let lpX = 0;
    let lpY = 0;
    if (owner && grid) {
      grid.addEventListener('pointerdown', (e) => {
        if (selecting || e.pointerType === 'mouse' || e.button > 0) return;
        const card = e.target.closest('.wl-card');
        if (!card || e.target.closest('button')) return;
        lpFired = false;
        lpX = e.clientX;
        lpY = e.clientY;
        clearTimeout(lpTimer);
        lpTimer = setTimeout(() => {
          lpFired = true;
          setSelecting(true);
          card.classList.add('sel');
          syncBulk();
          if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* ignore */ } }
        }, 480);
      });
      grid.addEventListener('pointermove', (e) => {
        if (Math.abs(e.clientX - lpX) > 10 || Math.abs(e.clientY - lpY) > 10) clearTimeout(lpTimer);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => grid.addEventListener(n, () => {
        clearTimeout(lpTimer);
        setTimeout(() => { lpFired = false; }, 350);
      }));
      grid.addEventListener('contextmenu', (e) => { if (lpFired || selecting) e.preventDefault(); });
      // the finger lift after a long press would "click" the link: swallow it
      page.addEventListener('click', (e) => {
        if (!lpFired) return;
        lpFired = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      }, true);
    }

    // while selecting, tapping a card (poster, title, anywhere on it) selects it instead of opening it
    page.addEventListener('click', (e) => {
      if (!selecting) return;
      const card = e.target.closest('.wl-card');
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      card.classList.toggle('sel');
      syncBulk();
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && selecting && !$('.wl-layer.open') && !$('.wl-dd.open') && !$('.wl-sugg:not([hidden])')) setSelecting(false);
    });

    const recount = (delta) => {
      const total = $('.wl-total', page);
      if (total) total.textContent = String(Math.max(0, Number(total.textContent) + delta));
      const n = $('.wl-tab.on .wl-tab-n', page);
      if (n) n.textContent = String(Math.max(0, Number(n.textContent) + delta));
      if (!$('.wl-card', page)) {
        const empty = $('.wl-empty', page);
        if (empty) empty.hidden = false;
        const tb = $('.wl-toolbar', page);
        if (tb) tb.hidden = true;
        const nm = $('.wl-nomatch', page);
        if (nm) nm.hidden = true;
      }
      page.dataset.listCount = String($$('.wl-card', page).length);
      applyView(false);
    };

    function setSeen(card, on) {
      card.dataset.watched = on ? '1' : '0';
      card.classList.toggle('is-watched', on);
      const b = $('[data-wl-watch]', card);
      if (b) {
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.textContent = on ? '✓ Watched' : 'Mark watched';
      }
    }

    // one title: update instantly, undo the change if the server says no
    async function toggleWatched(card) {
      if (!card || card.dataset.busy === '1') return;
      card.dataset.busy = '1';
      const next = card.dataset.watched !== '1';
      setSeen(card, next);
      applyView(false);
      try {
        await post('/api/watchlist/watched', { type: card.dataset.type, id: card.dataset.id, watched: next, listId });
        bump();
        toast(next ? 'Marked as watched' : 'Moved back to To watch', [{ label: 'Undo', fn: () => toggleWatched(card) }]);
      } catch (err) {
        setSeen(card, !next);
        applyView(false);
        fail(err);
      }
      delete card.dataset.busy;
    }

    // choose another list for Move / Copy -> resolves to {id,name}, {create:true} or null
    function pickList(action) {
      return new Promise((resolve) => {
        const title = action === 'move' ? 'Move to…' : 'Copy to…';
        const L = makeLayer(title);
        let done = false;
        const finish = (v) => { if (done) return; done = true; resolve(v); L.close(); };
        L.setOnClose(() => { if (!done) { done = true; resolve(null); } });
        L.sheet.appendChild(sheetHead(title, L.close));
        const ul = el('ul', 'wl-lists');
        $$('.wl-tab[data-id]', page).forEach((tab) => {
          const id = Number(tab.dataset.id);
          if (id === listId) return;
          const li = el('li');
          const b = el('button', 'wl-row');
          b.type = 'button';
          const n = $('.wl-tab-n', tab);
          b.append(el('span', 'wl-row-name', tab.dataset.name), el('span', 'wl-row-n', n ? n.textContent : ''));
          b.addEventListener('click', () => finish({ id, name: tab.dataset.name }));
          li.appendChild(b);
          ul.appendChild(li);
        });
        L.sheet.appendChild(ul);
        const nb = el('button', 'wl-ghost wl-done', '+ New list');
        nb.type = 'button';
        nb.addEventListener('click', () => finish({ create: true }));
        L.sheet.appendChild(nb);
        const first = $('.wl-row', L.sheet);
        (first || nb).focus();
      });
    }

    let bulkBusy = false;
    async function runBulk(action) {
      if (bulkBusy) return;
      const cards = selected();
      if (!cards.length) return;
      const items = cards.map((c) => ({ type: c.dataset.type, id: c.dataset.id }));
      const n = items.length;
      const word = n === 1 ? 'title' : 'titles';
      let target = null;

      if (action === 'remove') {
        const ok = await ask({ title: 'Remove ' + n + ' ' + word + '?', text: 'They will be removed from “' + listName + '”.', confirm: 'Remove', danger: true });
        if (!ok) return;
      }
      if (action === 'move' || action === 'copy') {
        target = await pickList(action);
        if (!target) return;
        if (target.create) {
          const name = await ask({ title: 'New list', confirm: 'Create', input: true, placeholder: 'e.g. Weekend horror' });
          if (!name) return;
          try { target = (await post('/api/watchlist/lists', { name })).list; } catch (err) { return fail(err); }
        }
      }

      bulkBusy = true;
      $$('[data-wl-bulk]', bulkBar).forEach((b) => { b.disabled = true; });
      try {
        const CH = 200; // the server takes up to 200 titles per request
        let added = 0;
        for (let i = 0; i < items.length; i += CH) {
          const d = await post('/api/watchlist/bulk', { listId, action, targetId: target ? target.id : undefined, items: items.slice(i, i + CH) });
          added += d.added || 0;
        }
        bump();
        if (action === 'watched' || action === 'unwatched') {
          cards.forEach((c) => setSeen(c, action === 'watched'));
          setSelecting(false);
          applyView(false);
          toast(n + ' ' + word + (action === 'watched' ? ' marked as watched' : ' moved back to To watch'));
        } else if (action === 'remove') {
          cards.forEach((c) => c.classList.add('gone'));
          setTimeout(() => { cards.forEach((c) => c.remove()); recount(-n); }, 190);
          setSelecting(false);
          load();
          toast(n + ' ' + word + ' removed');
        } else {
          const msg = action === 'move'
            ? 'Moved ' + n + ' ' + word + ' to “' + target.name + '”'
            : 'Copied ' + added + ' ' + (added === 1 ? 'title' : 'titles') + ' to “' + target.name + '”' + (added < n ? ' (the rest were already there)' : '');
          try { sessionStorage.setItem('wl-toast', msg); } catch (e) { /* ignore */ }
          location.reload();
          return;
        }
      } catch (err) {
        fail(err);
        syncBulk();
      }
      bulkBusy = false;
    }

    /* ----- every button on the page ----- */
    page.addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t || !page.contains(t)) return;

      // buttons that exist for everyone
      if (t.hasAttribute('data-wl-filter')) {
        setFilter(t.dataset.wlFilter);
        applyView(false);
        return;
      }
      if (t.hasAttribute('data-wl-share')) { onShare(); return; }
      if (t.hasAttribute('data-wl-surprise')) { surprise(); return; }
      if (t.hasAttribute('data-wl-view')) {
        view.mode = view.mode === 'list' ? 'grid' : 'list';
        store.set('mode', view.mode);
        applyMode();
        return;
      }
      if (t.hasAttribute('data-wl-save')) { saveCopy(t); return; }
      if (t.hasAttribute('data-wl-reset')) {
        setFilter('all');
        setQuery('');
        return;
      }
      if (!owner) return;

      // owner-only buttons
      if (t.hasAttribute('data-wl-select')) {
        setSelecting(!selecting);
      } else if (t.hasAttribute('data-wl-selcancel')) {
        setSelecting(false);
      } else if (t.hasAttribute('data-wl-selall')) {
        const visible = $$('.wl-card', grid).filter((c) => !c.hidden);
        const all = visible.length > 0 && visible.every((c) => c.classList.contains('sel'));
        visible.forEach((c) => c.classList.toggle('sel', !all));
        syncBulk();
      } else if (t.hasAttribute('data-wl-bulk')) {
        runBulk(t.dataset.wlBulk);
      } else if (t.hasAttribute('data-wl-watch')) {
        toggleWatched(t.closest('.wl-card'));
      } else if (t.hasAttribute('data-wl-remove')) {
        const card = t.closest('.wl-card');
        const ref = { type: card.dataset.type, id: card.dataset.id };
        t.disabled = true;
        try {
          apply(await post('/api/watchlist/remove', { ...ref, listId }));
          card.classList.add('gone');
          setTimeout(() => { card.remove(); recount(-1); }, 190);
          toast('Removed from ' + listName, [{
            label: 'Undo',
            fn: async () => {
              try { await post('/api/watchlist/add', { ...ref, listId }); location.reload(); } catch (err) { fail(err); }
            },
          }]);
        } catch (err) { t.disabled = false; fail(err); }
      } else if (t.hasAttribute('data-wl-lists')) {
        openPicker(t, null, { onChange: () => location.reload() });
      } else if (t.hasAttribute('data-wl-new')) {
        const name = await ask({ title: 'New list', confirm: 'Create', input: true, placeholder: 'e.g. Weekend horror' });
        if (!name) return;
        try { const d = await post('/api/watchlist/lists', { name }); location.href = '/watchlist?list=' + d.list.id; } catch (err) { fail(err); }
      } else if (t.hasAttribute('data-wl-rename')) {
        const name = await ask({ title: 'Rename list', confirm: 'Save', input: true, value: listName });
        if (!name || name === listName) return;
        try { await post('/api/watchlist/lists/' + listId + '/rename', { name }); location.reload(); } catch (err) { fail(err); }
      } else if (t.hasAttribute('data-wl-delete')) {
        const count = page.dataset.listCount;
        const ok = await ask({ title: 'Delete this list?', text: '“' + listName + '” and the ' + count + ' title(s) saved in it will be removed. This can’t be undone.', confirm: 'Delete', danger: true });
        if (!ok) return;
        try { await post('/api/watchlist/lists/' + listId + '/delete'); location.href = '/watchlist'; } catch (err) { fail(err); }
      } else if (t.hasAttribute('data-wl-public')) {
        const makePublic = page.dataset.listPublic !== '1';
        if (makePublic) {
          const ok = await ask({ title: 'Make this list public?', text: PUBLIC_TEXT, confirm: 'Make public' });
          if (!ok) return;
        }
        try { await post('/api/watchlist/lists/' + listId + '/public', { isPublic: makePublic }); location.reload(); } catch (err) { fail(err); }
      } else if (t.hasAttribute('data-wl-copy')) {
        const url = location.origin + t.dataset.url;
        try { await navigator.clipboard.writeText(url); toast('Link copied'); }
        catch (err) { window.prompt('Copy this link', url); }
      }
    });

    applyMode();
    applyView(true);
  }

  /* ------------------------------ start ------------------------------ */

  let raf = 0;
  const watcher = new MutationObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; enhance(); paint(); });
  });

  function start() {
    initPage();
    enhance();
    watcher.observe(document.body, { childList: true, subtree: true });
    if (!ME) return;
    load();
    window.addEventListener('pageshow', (e) => { if (e.persisted) load(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();