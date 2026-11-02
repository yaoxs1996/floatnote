/*
 * 浮笺 · 页面悬浮备注
 * Chrome 102 / Manifest V3 内容脚本。
 * 面板使用 Shadow DOM 隔离页面样式，备注仅写入 chrome.storage.local。
 */
(function () {
  'use strict';

  if (window.top !== window.self) {
    return;
  }
  if (window.__FLOATNOTE_CONTENT_V1__) {
    return;
  }
  window.__FLOATNOTE_CONTENT_V1__ = true;

  var FN = window.FloatNote;
  if (!FN) {
    return;
  }

  var POSITION_MARGIN = 20;
  var SAVE_DEBOUNCE = 450;

  var state = {
    settings: FN.normalizeSettings(null),
    notes: {},
    note: null,
    url: '',
    editing: false,
    collapsed: false,
    visible: false,
    dirty: false,
    saving: false,
    saveRequested: false,
    saveTimer: null,
    saveWaiters: [],
    editorItems: [],
    editorTitle: '',
    listStyle: 'bullet',
    activeItemId: '',
    rowSeq: 0,
    foldedSections: Object.create(null),
    lastSavedAt: 0,
    ready: false,
    switchingUrl: false,
    pendingReveal: null
  };

  var host = null;
  var shadow = null;
  var els = {};

  var CSS = [
    ':host {',
    '  all: initial;',
    '  position: fixed !important;',
    '  z-index: 2147483647 !important;',
    '  display: block !important;',
    '  width: var(--fn-width, 360px) !important;',
    '  max-width: calc(100vw - 16px) !important;',
    '  color-scheme: light;',
    '  --fn-bg: rgba(255, 255, 255, 0.985);',
    '  --fn-bg-solid: #ffffff;',
    '  --fn-text: #202433;',
    '  --fn-muted: #73798c;',
    '  --fn-faint: #9ba1b2;',
    '  --fn-border: rgba(32, 36, 51, 0.11);',
    '  --fn-border-strong: rgba(32, 36, 51, 0.17);',
    '  --fn-soft: #f4f5fa;',
    '  --fn-soft-hover: #eceefa;',
    '  --fn-accent: #4f63e7;',
    '  --fn-accent-strong: #3f51d1;',
    '  --fn-accent-soft: #eef0ff;',
    '  --fn-danger: #d9495f;',
    '  --fn-shadow: 0 18px 50px rgba(28, 32, 55, 0.18), 0 4px 14px rgba(28, 32, 55, 0.09);',
    '  --fn-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;',
    '  --fn-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;',
    '}',
    ':host([data-theme="dark"]) {',
    '  color-scheme: dark;',
    '  --fn-bg: rgba(26, 29, 42, 0.985);',
    '  --fn-bg-solid: #1a1d2a;',
    '  --fn-text: #eef0f8;',
    '  --fn-muted: #a5aabc;',
    '  --fn-faint: #7f8598;',
    '  --fn-border: rgba(255, 255, 255, 0.11);',
    '  --fn-border-strong: rgba(255, 255, 255, 0.18);',
    '  --fn-soft: #242838;',
    '  --fn-soft-hover: #2c3144;',
    '  --fn-accent: #8c9cff;',
    '  --fn-accent-strong: #a6b2ff;',
    '  --fn-accent-soft: rgba(124, 143, 255, 0.16);',
    '  --fn-danger: #ff8b9d;',
    '  --fn-shadow: 0 20px 55px rgba(0, 0, 0, 0.48), 0 5px 16px rgba(0, 0, 0, 0.3);',
    '}',
    ':host([hidden]) { display: none !important; }',
    '*, *::before, *::after { box-sizing: border-box; }',
    'button, input { font: inherit; color: inherit; }',
    'button { -webkit-tap-highlight-color: transparent; }',
    '.fn-card {',
    '  position: relative;',
    '  display: flex;',
    '  flex-direction: column;',
    '  width: 100%;',
    '  max-height: var(--fn-max-height, calc(100vh - 24px));',
    '  overflow: hidden;',
    '  color: var(--fn-text);',
    '  background: var(--fn-bg);',
    '  border: 1px solid var(--fn-border);',
    '  border-radius: 17px;',
    '  box-shadow: var(--fn-shadow);',
    '  font-family: var(--fn-font);',
    '  font-size: 14px;',
    '  line-height: 1.5;',
    '  letter-spacing: 0.002em;',
    '  -webkit-font-smoothing: antialiased;',
    '  animation: fn-card-in 180ms ease-out both;',
    '}',
    '@supports (backdrop-filter: blur(2px)) {',
    '  .fn-card { backdrop-filter: blur(18px) saturate(130%); }',
    '}',
    '.fn-card::before {',
    '  content: "";',
    '  position: absolute;',
    '  z-index: 2;',
    '  inset: 0 0 auto;',
    '  height: 2px;',
    '  background: linear-gradient(90deg, #5b6cff, #9a6bff 55%, #ff7aa8);',
    '  pointer-events: none;',
    '}',
    '.fn-header {',
    '  display: flex;',
    '  flex: 0 0 auto;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  gap: 8px;',
    '  padding: 12px 12px 10px 14px;',
    '}',
    '.fn-brand {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 10px;',
    '  min-width: 0;',
    '  cursor: grab;',
    '  user-select: none;',
    '  touch-action: none;',
    '}',
    '.fn-card.fn-dragging .fn-brand { cursor: grabbing; }',
    '.fn-mark {',
    '  position: relative;',
    '  display: flex;',
    '  flex: 0 0 auto;',
    '  flex-direction: column;',
    '  justify-content: center;',
    '  gap: 3px;',
    '  width: 31px;',
    '  height: 31px;',
    '  padding: 0 8px;',
    '  overflow: hidden;',
    '  border-radius: 9px;',
    '  background: linear-gradient(145deg, #6475ff, #8b5ee8);',
    '  box-shadow: 0 4px 10px rgba(83, 99, 235, 0.28);',
    '}',
    '.fn-mark::after {',
    '  content: "";',
    '  position: absolute;',
    '  width: 18px;',
    '  height: 18px;',
    '  right: -8px;',
    '  top: -7px;',
    '  border-radius: 50%;',
    '  background: rgba(255, 255, 255, 0.22);',
    '}',
    '.fn-mark i {',
    '  display: block;',
    '  height: 2px;',
    '  border-radius: 2px;',
    '  background: rgba(255, 255, 255, 0.94);',
    '}',
    '.fn-mark i:nth-child(2) { width: 78%; }',
    '.fn-mark i:nth-child(3) { width: 52%; }',
    '.fn-headings { min-width: 0; }',
    '.fn-kicker {',
    '  color: var(--fn-accent);',
    '  font-size: 9.5px;',
    '  font-weight: 700;',
    '  line-height: 1.2;',
    '  letter-spacing: 0.14em;',
    '}',
    '.fn-site {',
    '  max-width: 205px;',
    '  margin-top: 2px;',
    '  overflow: hidden;',
    '  color: var(--fn-muted);',
    '  font-family: var(--fn-mono);',
    '  font-size: 10.5px;',
    '  line-height: 1.3;',
    '  text-overflow: ellipsis;',
    '  white-space: nowrap;',
    '}',
    '.fn-header-actions {',
    '  display: flex;',
    '  flex: 0 0 auto;',
    '  align-items: center;',
    '  gap: 2px;',
    '}',
    '.fn-icon-btn, .fn-tool-btn {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  padding: 0;',
    '  color: var(--fn-muted);',
    '  background: transparent;',
    '  border: 0;',
    '  border-radius: 8px;',
    '  cursor: pointer;',
    '}',
    '.fn-icon-btn {',
    '  width: 29px;',
    '  height: 29px;',
    '}',
    '.fn-icon-btn:hover { color: var(--fn-text); background: var(--fn-soft); }',
    '.fn-icon-btn:active { background: var(--fn-soft-hover); }',
    '#fn-close:hover { color: var(--fn-danger); background: var(--fn-soft-hover); }',
    '.fn-icon-btn svg, .fn-tool-btn svg {',
    '  width: 16px;',
    '  height: 16px;',
    '  fill: none;',
    '  stroke: currentColor;',
    '  stroke-width: 1.8;',
    '  stroke-linecap: round;',
    '  stroke-linejoin: round;',
    '}',
    '.fn-icon-btn:focus-visible, .fn-tool-btn:focus-visible, .fn-primary:focus-visible, .fn-done:focus-visible, .fn-row-del:focus-visible, .fn-fold-toggle:focus-visible {',
    '  outline: 2px solid var(--fn-accent);',
    '  outline-offset: 2px;',
    '}',
    '.fn-main {',
    '  flex: 1 1 auto;',
    '  min-height: 0;',
    '  overflow: auto;',
    '  overscroll-behavior: contain;',
    '  scrollbar-color: var(--fn-border-strong) transparent;',
    '  scrollbar-width: thin;',
    '}',
    '.fn-main::-webkit-scrollbar { width: 8px; }',
    '.fn-main::-webkit-scrollbar-thumb {',
    '  border: 2px solid transparent;',
    '  border-radius: 8px;',
    '  background: var(--fn-border-strong);',
    '  background-clip: padding-box;',
    '}',
    '.fn-main::-webkit-scrollbar-track { background: transparent; }',
    '.fn-view { padding: 2px 16px 13px; }',
    '.fn-empty {',
    '  display: flex;',
    '  flex-direction: column;',
    '  align-items: flex-start;',
    '  padding: 20px 2px 14px;',
    '}',
    '.fn-empty-art {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 4px;',
    '  width: 45px;',
    '  padding: 11px 9px;',
    '  margin-bottom: 13px;',
    '  border: 1px solid var(--fn-border);',
    '  border-radius: 11px;',
    '  background: var(--fn-soft);',
    '  transform: rotate(-2deg);',
    '}',
    '.fn-empty-art i {',
    '  display: block;',
    '  height: 2px;',
    '  border-radius: 2px;',
    '  background: var(--fn-border-strong);',
    '}',
    '.fn-empty-art i:nth-child(2) { width: 84%; }',
    '.fn-empty-art i:nth-child(3) { width: 58%; }',
    '.fn-empty-art i:nth-child(4) { width: 72%; }',
    '.fn-empty h2 {',
    '  margin: 0;',
    '  font-size: 15px;',
    '  font-weight: 700;',
    '  line-height: 1.4;',
    '}',
    '.fn-empty p {',
    '  margin: 5px 0 14px;',
    '  color: var(--fn-muted);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '}',
    '.fn-primary {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: 6px;',
    '  min-height: 32px;',
    '  padding: 6px 13px;',
    '  color: #fff;',
    '  background: linear-gradient(135deg, #5769ec, #7658db);',
    '  border: 0;',
    '  border-radius: 9px;',
    '  box-shadow: 0 4px 10px rgba(79, 99, 231, 0.22);',
    '  font-size: 12px;',
    '  font-weight: 650;',
    '  cursor: pointer;',
    '}',
    '.fn-primary:hover { filter: brightness(1.05); }',
    '.fn-note { padding: 2px 0 3px; }',
    '.fn-note-title {',
    '  margin: 3px 0 8px;',
    '  color: var(--fn-text);',
    '  font-size: 16px;',
    '  font-weight: 720;',
    '  line-height: 1.45;',
    '  letter-spacing: -0.01em;',
    '  overflow-wrap: anywhere;',
    '  white-space: pre-wrap;',
    '}',
    '.fn-list { margin: 0; padding: 0; }',
    '.fn-view-row {',
    '  display: flex;',
    '  align-items: flex-start;',
    '  gap: 6px;',
    '  padding: 3px 0 3px calc(var(--fn-depth, 0) * 19px);',
    '}',
    '.fn-view-marker {',
    '  flex: 0 0 auto;',
    '  min-width: 14px;',
    '  padding-top: 1px;',
    '  color: var(--fn-accent);',
    '  font-family: var(--fn-mono);',
    '  font-size: 12px;',
    '  font-weight: 600;',
    '  line-height: 1.55;',
    '  text-align: right;',
    '  user-select: none;',
    '}',
    '.fn-view-text {',
    '  flex: 1 1 auto;',
    '  min-width: 0;',
    '  color: var(--fn-text);',
    '  font-size: 13.5px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '  white-space: pre-wrap;',
    '}',
    '.fn-view-row.is-deep .fn-view-text { color: var(--fn-muted); }',
    '.fn-fold-toggle {',
    '  display: inline-flex;',
    '  flex: 0 0 auto;',
    '  align-items: center;',
    '  justify-content: center;',
    '  gap: 2px;',
    '  min-width: 28px;',
    '  height: 21px;',
    '  padding: 0 4px;',
    '  margin-top: 1px;',
    '  color: var(--fn-faint);',
    '  background: transparent;',
    '  border: 0;',
    '  border-radius: 6px;',
    '  font-family: var(--fn-mono);',
    '  font-size: 9.5px;',
    '  line-height: 1;',
    '  cursor: pointer;',
    '  opacity: 0.72;',
    '}',
    '.fn-fold-toggle:hover { color: var(--fn-accent); background: var(--fn-soft); opacity: 1; }',
    '.fn-fold-toggle.is-collapsed { color: var(--fn-accent); background: var(--fn-accent-soft); opacity: 1; }',
    '.fn-fold-toggle svg {',
    '  width: 11px;',
    '  height: 11px;',
    '  fill: none;',
    '  stroke: currentColor;',
    '  stroke-width: 1.9;',
    '  stroke-linecap: round;',
    '  stroke-linejoin: round;',
    '  transition: transform 140ms ease;',
    '}',
    '.fn-fold-toggle.is-collapsed svg { transform: rotate(-90deg); }',
    '.fn-fold-count { font-size: 9.5px; line-height: 1; }',
    '.fn-view-row.is-folded .fn-view-text { color: var(--fn-muted); }',
    '.fn-empty-list {',
    '  margin: 8px 0 0;',
    '  color: var(--fn-muted);',
    '  font-size: 12px;',
    '}',
    '.fn-editor { padding: 2px 16px 12px; }',
    '.fn-title-input {',
    '  display: block;',
    '  width: 100%;',
    '  padding: 4px 0 9px;',
    '  color: var(--fn-text);',
    '  background: transparent;',
    '  border: 0;',
    '  outline: 0;',
    '  font-size: 16px;',
    '  font-weight: 720;',
    '  line-height: 1.45;',
    '  letter-spacing: -0.01em;',
    '}',
    '.fn-title-input::placeholder { color: var(--fn-faint); font-weight: 600; }',
    '.fn-toolbar {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 2px;',
    '  padding: 4px;',
    '  margin-bottom: 8px;',
    '  background: var(--fn-soft);',
    '  border: 1px solid var(--fn-border);',
    '  border-radius: 10px;',
    '}',
    '.fn-tool-btn { width: 28px; height: 28px; border-radius: 7px; }',
    '.fn-tool-btn:hover { color: var(--fn-text); background: var(--fn-bg-solid); }',
    '.fn-tool-btn[aria-pressed="true"] {',
    '  color: var(--fn-accent);',
    '  background: var(--fn-accent-soft);',
    '}',
    '.fn-tool-btn:disabled { opacity: 0.35; cursor: default; }',
    '.fn-tool-btn:disabled:hover { color: var(--fn-muted); background: transparent; }',
    '.fn-tool-sep {',
    '  width: 1px;',
    '  height: 16px;',
    '  margin: 0 3px;',
    '  background: var(--fn-border);',
    '}',
    '.fn-spacer { flex: 1 1 auto; }',
    '.fn-outline {',
    '  min-height: 86px;',
    '  padding: 1px 0 3px;',
    '  outline: none;',
    '}',
    '.fn-edit-row {',
    '  display: flex;',
    '  align-items: flex-start;',
    '  gap: 5px;',
    '  padding: 1px 0 1px calc(var(--fn-depth, 0) * 18px);',
    '  border-radius: 7px;',
    '}',
    '.fn-edit-row.is-active { background: var(--fn-soft); }',
    '.fn-edit-marker {',
    '  flex: 0 0 auto;',
    '  min-width: 17px;',
    '  padding-top: 5px;',
    '  color: var(--fn-accent);',
    '  font-family: var(--fn-mono);',
    '  font-size: 12px;',
    '  font-weight: 600;',
    '  line-height: 1.45;',
    '  text-align: right;',
    '  user-select: none;',
    '}',
    '.fn-edit-text {',
    '  flex: 1 1 auto;',
    '  min-width: 0;',
    '  min-height: 29px;',
    '  padding: 4px 4px;',
    '  color: var(--fn-text);',
    '  border-radius: 5px;',
    '  outline: none;',
    '  font-size: 13.5px;',
    '  line-height: 1.55;',
    '  overflow-wrap: anywhere;',
    '  white-space: pre-wrap;',
    '  caret-color: var(--fn-accent);',
    '}',
    '.fn-edit-text.is-empty::before {',
    '  content: attr(data-placeholder);',
    '  color: var(--fn-faint);',
    '  pointer-events: none;',
    '}',
    '.fn-row-del {',
    '  display: inline-flex;',
    '  flex: 0 0 auto;',
    '  align-items: center;',
    '  justify-content: center;',
    '  width: 22px;',
    '  height: 24px;',
    '  padding: 0;',
    '  margin-top: 3px;',
    '  color: var(--fn-faint);',
    '  background: transparent;',
    '  border: 0;',
    '  border-radius: 5px;',
    '  opacity: 0;',
    '  cursor: pointer;',
    '  transition: opacity 100ms ease, color 100ms ease, background 100ms ease;',
    '}',
    '.fn-edit-row:hover .fn-row-del, .fn-edit-row.is-active .fn-row-del, .fn-row-del:focus-visible { opacity: 1; }',
    '.fn-row-del:hover { color: var(--fn-danger); background: var(--fn-soft-hover); }',
    '.fn-row-del svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }',
    '.fn-hint {',
    '  margin: 7px 0 0;',
    '  color: var(--fn-faint);',
    '  font-size: 10.5px;',
    '  line-height: 1.5;',
    '}',
    '.fn-hint kbd {',
    '  padding: 0 3px;',
    '  color: var(--fn-muted);',
    '  font-family: var(--fn-mono);',
    '  font-size: 9.5px;',
    '}',
    '.fn-footer {',
    '  display: flex;',
    '  flex: 0 0 auto;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  gap: 10px;',
    '  min-height: 41px;',
    '  padding: 8px 14px;',
    '  border-top: 1px solid var(--fn-border);',
    '  background: var(--fn-bg-solid);',
    '}',
    '.fn-status {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: 6px;',
    '  min-width: 0;',
    '  color: var(--fn-faint);',
    '  font-size: 10.5px;',
    '  line-height: 1.4;',
    '}',
    '.fn-status-dot {',
    '  flex: 0 0 auto;',
    '  width: 5px;',
    '  height: 5px;',
    '  border-radius: 50%;',
    '  background: var(--fn-faint);',
    '}',
    '.fn-status.is-saved .fn-status-dot { background: #38b27a; }',
    '.fn-status.is-saving .fn-status-dot { background: #d79b36; animation: fn-pulse 900ms ease-in-out infinite; }',
    '.fn-status.is-error { color: var(--fn-danger); }',
    '.fn-status.is-error .fn-status-dot { background: var(--fn-danger); }',
    '.fn-footer-actions { display: flex; align-items: center; gap: 6px; }',
    '.fn-done {',
    '  min-height: 27px;',
    '  padding: 4px 10px;',
    '  border-radius: 7px;',
    '  font-size: 11px;',
    '  font-weight: 650;',
    '  cursor: pointer;',
    '  color: #fff;',
    '  background: var(--fn-accent);',
    '  border: 1px solid transparent;',
    '}',
    '.fn-done:hover { background: var(--fn-accent-strong); }',
    '.fn-done:disabled { opacity: 0.55; cursor: wait; }',
    '.fn-card.is-collapsed .fn-main, .fn-card.is-collapsed .fn-footer { display: none; }',
    '.fn-card.is-collapsed .fn-header { padding-bottom: 12px; }',
    '.fn-card.is-collapsed .fn-mark { width: 28px; height: 28px; }',
    '.fn-card.is-collapsed #fn-collapse svg { transform: rotate(180deg); }',
    '.fn-card.fn-flash { animation: fn-flash 800ms ease-out; }',
    '[hidden] { display: none !important; }',
    '@keyframes fn-card-in {',
    '  from { opacity: 0; transform: translateY(-5px) scale(0.985); }',
    '  to { opacity: 1; transform: translateY(0) scale(1); }',
    '}',
    '@keyframes fn-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }',
    '@keyframes fn-flash {',
    '  0% { box-shadow: var(--fn-shadow), 0 0 0 0 rgba(91, 108, 255, 0.55); }',
    '  55% { box-shadow: var(--fn-shadow), 0 0 0 7px rgba(91, 108, 255, 0); }',
    '  100% { box-shadow: var(--fn-shadow), 0 0 0 0 rgba(91, 108, 255, 0); }',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  .fn-card, .fn-card.fn-flash { animation: none !important; }',
    '  .fn-status.is-saving .fn-status-dot { animation: none; }',
    '  .fn-fold-toggle svg { transition: none; }',
    '}',
    '@media (hover: none) {',
    '  .fn-row-del { opacity: 0.55; }',
    '}',
    '@media print { :host { display: none !important; } }'
  ].join('\n');

  var TEMPLATE = [
    '<div class="fn-card" role="complementary" aria-label="网页悬浮备注">',
    '  <header class="fn-header">',
    '    <div class="fn-brand" id="fn-drag-handle" title="拖动调整位置">',
    '      <span class="fn-mark" aria-hidden="true"><i></i><i></i><i></i></span>',
    '      <span class="fn-headings">',
    '        <span class="fn-kicker">本页备注</span>',
    '        <span class="fn-site" id="fn-site"></span>',
    '      </span>',
    '    </div>',
    '    <div class="fn-header-actions">',
    '      <button type="button" class="fn-icon-btn" id="fn-edit" title="编辑备注" aria-label="编辑备注">',
    '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m13.5 6.5 3 3"/></svg>',
    '      </button>',
    '      <button type="button" class="fn-icon-btn" id="fn-collapse" title="收起备注" aria-label="收起备注">',
    '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    '      </button>',
    '      <button type="button" class="fn-icon-btn" id="fn-close" title="关闭悬浮栏（点击工具栏浮笺图标可重新打开）" aria-label="关闭悬浮栏">',
    '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    '      </button>',
    '    </div>',
    '  </header>',
    '  <div class="fn-main">',
    '    <div class="fn-view" id="fn-view">',
    '      <div class="fn-empty" id="fn-empty">',
    '        <span class="fn-empty-art" aria-hidden="true"><i></i><i></i><i></i><i></i></span>',
    '        <h2>还没有本页备注</h2>',
    '        <p>记录这一页的要点。按 Tab 缩进，即可创建多级列表。</p>',
    '        <button type="button" class="fn-primary" id="fn-start">开始记录</button>',
    '      </div>',
    '      <div class="fn-note" id="fn-note" hidden>',
    '        <h2 class="fn-note-title" id="fn-note-title"></h2>',
    '        <div class="fn-list" id="fn-list" role="list"></div>',
    '        <p class="fn-empty-list" id="fn-empty-list" hidden>列表还是空的，点击右上角编辑。</p>',
    '      </div>',
    '    </div>',
    '    <div class="fn-editor" id="fn-editor" hidden>',
    '      <input class="fn-title-input" id="fn-title" type="text" maxlength="120" placeholder="备注标题（可选）" autocomplete="off">',
    '      <div class="fn-toolbar" role="toolbar" aria-label="列表格式">',
    '        <button type="button" class="fn-tool-btn" id="fn-style-bullet" title="项目符号列表" aria-label="项目符号列表" aria-pressed="true">',
    '          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h10M9 12h10M9 18h10"/><circle cx="5" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.3" fill="currentColor" stroke="none"/></svg>',
    '        </button>',
    '        <button type="button" class="fn-tool-btn" id="fn-style-number" title="编号列表" aria-label="编号列表" aria-pressed="false">',
    '          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h9M10 12h9M10 18h9"/><path d="M4.2 5.2 5.5 4.5v3.2M4.2 10.6c.2-.5.8-.8 1.3-.5.7.4.7 1.2 0 1.7l-1.3.8h2.1M4.2 16.1h1.9l-1.1 1.2c.8 0 1.2.4 1.2.9 0 .6-.5 1-1.2 1-.5 0-.9-.2-1.1-.6"/></svg>',
    '        </button>',
    '        <span class="fn-tool-sep" aria-hidden="true"></span>',
    '        <button type="button" class="fn-tool-btn" id="fn-outdent" title="减少缩进 (Shift+Tab)" aria-label="减少缩进">',
    '          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 6h9M11 18h9M3 12l4-4M3 12l4 4"/><path d="M7 12h5"/></svg>',
    '        </button>',
    '        <button type="button" class="fn-tool-btn" id="fn-indent" title="增加缩进 (Tab)" aria-label="增加缩进">',
    '          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 6h9M11 18h9M3 12l4-4M3 12l4 4"/><path d="M7 12h5"/></svg>',
    '        </button>',
    '        <span class="fn-spacer"></span>',
    '        <button type="button" class="fn-tool-btn" id="fn-add" title="新增一行 (Enter)" aria-label="新增一行">',
    '          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    '        </button>',
    '      </div>',
    '      <div class="fn-outline" id="fn-outline" role="list" aria-label="备注列表"></div>',
    '      <p class="fn-hint"><kbd>Enter</kbd> 新增一行 · <kbd>Tab</kbd> 缩进 · <kbd>Shift</kbd>+<kbd>Tab</kbd> 减少层级</p>',
    '    </div>',
    '  </div>',
    '  <footer class="fn-footer">',
    '    <span class="fn-status" id="fn-status"><span class="fn-status-dot"></span><span id="fn-status-text">按网址自动保存</span></span>',
    '    <span class="fn-footer-actions">',
    '      <button type="button" class="fn-done" id="fn-done" hidden>完成</button>',
    '    </span>',
    '  </footer>',
    '</div>'
  ].join('\n');

  function createPanel() {
    host = document.createElement('div');
    host.id = 'floatnote-root';
    host.setAttribute('data-floatnote-root', 'v1');
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('box-sizing', 'border-box', 'important');
    host.hidden = true;
    host.setAttribute('aria-hidden', 'true');
    (document.documentElement || document.body).appendChild(host);

    shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    var wrap = document.createElement('div');
    wrap.innerHTML = TEMPLATE;
    while (wrap.firstChild) {
      shadow.appendChild(wrap.firstChild);
    }

    els.card = shadow.querySelector('.fn-card');
    els.dragHandle = shadow.getElementById('fn-drag-handle');
    els.site = shadow.getElementById('fn-site');
    els.edit = shadow.getElementById('fn-edit');
    els.collapse = shadow.getElementById('fn-collapse');
    els.close = shadow.getElementById('fn-close');
    els.view = shadow.getElementById('fn-view');
    els.empty = shadow.getElementById('fn-empty');
    els.note = shadow.getElementById('fn-note');
    els.noteTitle = shadow.getElementById('fn-note-title');
    els.list = shadow.getElementById('fn-list');
    els.emptyList = shadow.getElementById('fn-empty-list');
    els.editor = shadow.getElementById('fn-editor');
    els.title = shadow.getElementById('fn-title');
    els.outline = shadow.getElementById('fn-outline');
    els.status = shadow.getElementById('fn-status');
    els.statusText = shadow.getElementById('fn-status-text');
    els.done = shadow.getElementById('fn-done');
    els.start = shadow.getElementById('fn-start');
    els.styleBullet = shadow.getElementById('fn-style-bullet');
    els.styleNumber = shadow.getElementById('fn-style-number');
    els.indent = shadow.getElementById('fn-indent');
    els.outdent = shadow.getElementById('fn-outdent');
    els.add = shadow.getElementById('fn-add');
    els.card.hidden = true;

    bindEvents();
  }

  function bindEvents() {
    els.start.addEventListener('click', function () {
      startEditing();
    });
    els.edit.addEventListener('click', function () {
      if (state.editing) {
        finishEditing();
      } else {
        startEditing();
      }
    });
    els.close.addEventListener('click', closePanel);
    els.collapse.addEventListener('click', function () {
      state.collapsed = !state.collapsed;
      applyCollapsed();
      if (!state.collapsed && state.editing) {
        focusActiveRow();
      }
    });
    els.done.addEventListener('click', function () {
      finishEditing();
    });
    els.title.addEventListener('input', function () {
      state.editorTitle = els.title.value;
      markDirty();
    });
    els.title.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        if (state.editorItems.length === 0) {
          state.editorItems.push(newEditorItem('', 0));
          renderEditorRows();
        }
        focusRow(state.editorItems[0].id, 'end');
      }
    });
    els.title.addEventListener('paste', function (event) {
      // 标题只允许单行纯文本。
      event.preventDefault();
      var text = (event.clipboardData || window.clipboardData).getData('text/plain');
      var value = (els.title.value + ' ' + text).replace(/\s+/g, ' ').trim().slice(0, 120);
      els.title.value = value;
      state.editorTitle = value;
      markDirty();
    });

    els.styleBullet.addEventListener('click', function () {
      setListStyle('bullet');
    });
    els.styleNumber.addEventListener('click', function () {
      setListStyle('number');
    });
    els.indent.addEventListener('click', function () {
      moveActiveDepth(1);
    });
    els.outdent.addEventListener('click', function () {
      moveActiveDepth(-1);
    });
    els.add.addEventListener('click', function () {
      addItemAfterActive();
    });
    els.outline.addEventListener('mousedown', function (event) {
      if (event.target.closest('.fn-row-del')) {
        return;
      }
      var row = event.target.closest('.fn-edit-text');
      if (row) {
        setActiveItem(row.closest('.fn-edit-row').getAttribute('data-id'));
      }
    });
    // 点击工具栏时保持列表焦点，避免“当前行”丢失。
    shadow.querySelector('.fn-toolbar').addEventListener('mousedown', function (event) {
      event.preventDefault();
    });
    els.outline.addEventListener('input', function (event) {
      var row = event.target.closest('.fn-edit-text');
      if (!row) {
        return;
      }
      var item = findItem(row.closest('.fn-edit-row').getAttribute('data-id'));
      if (!item) {
        return;
      }
      item.t = readEditableText(row);
      syncEmptyState(row, item);
      markDirty();
    });
    els.outline.addEventListener('focusin', function (event) {
      var row = event.target.closest('.fn-edit-row');
      if (row) {
        setActiveItem(row.getAttribute('data-id'));
      }
    });
    els.outline.addEventListener('keydown', handleOutlineKeydown);
    els.outline.addEventListener('paste', handleOutlinePaste);
    els.outline.addEventListener('click', function (event) {
      var del = event.target.closest('.fn-row-del');
      if (!del) {
        return;
      }
      event.preventDefault();
      removeItem(del.closest('.fn-edit-row').getAttribute('data-id'));
    });
    els.list.addEventListener('click', function (event) {
      var toggle = event.target.closest('.fn-fold-toggle');
      if (!toggle) {
        return;
      }
      event.preventDefault();
      toggleSection(toggle.getAttribute('data-fold-key'));
    });
    els.note.addEventListener('dblclick', function (event) {
      if (state.editing || event.target.closest('.fn-fold-toggle')) {
        return;
      }
      event.preventDefault();
      startEditing();
    });

    bindDrag();
    bindUrlWatcher();
  }

  function bindDrag() {
    var drag = null;
    els.dragHandle.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || event.isPrimary === false) {
        return;
      }
      if (event.target.closest('button')) {
        return;
      }
      var rect = host.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        moved: false,
        startX: event.clientX,
        startY: event.clientY
      };
      try {
        els.dragHandle.setPointerCapture(event.pointerId);
      } catch (error) {
        // 某些合成事件不支持 pointer capture，window 监听仍然有效。
      }
      event.preventDefault();
      els.card.classList.add('fn-dragging');
    });

    function onMove(event) {
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      if (!drag.moved) {
        if (Math.abs(event.clientX - drag.startX) < 3 && Math.abs(event.clientY - drag.startY) < 3) {
          return;
        }
        drag.moved = true;
      }
      var maxX = Math.max(8, window.innerWidth - drag.width - 8);
      var visibleHeight = Math.min(drag.height, window.innerHeight - 16);
      var maxY = Math.max(8, window.innerHeight - visibleHeight - 8);
      var x = Math.min(maxX, Math.max(8, event.clientX - drag.offsetX));
      var y = Math.min(maxY, Math.max(8, event.clientY - drag.offsetY));
      setHostCustomPosition(x, y);
    }

    function onUp(event) {
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      var moved = drag.moved;
      var rect = host.getBoundingClientRect();
      drag = null;
      els.card.classList.remove('fn-dragging');
      try {
        els.dragHandle.releasePointerCapture(event.pointerId);
      } catch (error) {
        // 忽略不支持或已释放的 capture。
      }
      if (moved) {
        state.settings.customX = Math.round(rect.left);
        state.settings.customY = Math.round(rect.top);
        FN.saveSettings(state.settings, function (error, saved) {
          if (!error) {
            state.settings = saved;
          }
        });
      }
    }

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }

  function bindUrlWatcher() {
    var lastHref = location.href;
    setInterval(function () {
      if (location.href !== lastHref) {
        lastHref = location.href;
        handlePossibleNavigation();
      }
    }, 650);
    window.addEventListener('popstate', handlePossibleNavigation);
    window.addEventListener('hashchange', handlePossibleNavigation);
    window.addEventListener('pageshow', handlePossibleNavigation);
  }

  function handlePossibleNavigation() {
    var nextUrl = FN.normalizeUrl(location.href);
    if (!nextUrl || nextUrl === state.url || state.switchingUrl) {
      return;
    }
    if (state.editing) {
      state.switchingUrl = true;
      flushSave(function (error) {
        state.switchingUrl = false;
        if (error) {
          setStatus('保存失败，请重试', 'error');
          return;
        }
        state.editing = false;
        state.dirty = false;
        setUrlState(FN.normalizeUrl(location.href) || nextUrl);
        render();
      });
      return;
    }
    setUrlState(nextUrl);
    render();
  }

  function setUrlState(url) {
    state.url = url;
    state.note = state.notes[url] || null;
    state.editorItems = [];
    state.activeItemId = '';
  }

  function render() {
    if (!host) {
      return;
    }
    applyTheme();
    applyWidth();
    applyPosition();
    applyCollapsed();
    els.site.textContent = FN.getUrlLabel(state.url);
    els.site.title = state.url;

    if (state.editing) {
      els.view.hidden = true;
      els.editor.hidden = false;
      els.edit.title = '完成编辑';
      els.edit.setAttribute('aria-label', '完成编辑');
      els.edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
      els.done.hidden = false;
      renderEditor();
    } else {
      els.view.hidden = false;
      els.editor.hidden = true;
      els.edit.title = '编辑备注';
      els.edit.setAttribute('aria-label', '编辑备注');
      els.edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m13.5 6.5 3 3"/></svg>';
      els.done.hidden = true;
      renderView();
      updateIdleStatus();
    }
  }

  function applyTheme() {
    var theme = FN.effectiveTheme(state.settings.theme);
    host.setAttribute('data-theme', theme);
  }

  function applyWidth() {
    // 通过自定义属性驱动 :host 的宽度。Shadow DOM 内 !important 规则的优先级
    // 高于宿主元素的行内 !important，直接写 width 会被 360px 的默认值压住。
    host.style.setProperty('--fn-width', state.settings.width + 'px', 'important');
    host.style.setProperty('max-width', 'calc(100vw - 16px)', 'important');
  }

  function applyCollapsed() {
    els.card.classList.toggle('is-collapsed', state.collapsed);
    els.collapse.title = state.collapsed ? '展开备注' : '收起备注';
    els.collapse.setAttribute('aria-label', state.collapsed ? '展开备注' : '收起备注');
    els.collapse.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
  }

  function applyPosition() {
    if (!host) {
      return;
    }
    var settings = state.settings;
    if (settings.customX !== null && settings.customY !== null) {
      host.style.setProperty('right', 'auto', 'important');
      host.style.setProperty('bottom', 'auto', 'important');
      setHostCustomPosition(settings.customX, settings.customY);
      return;
    }
    host.style.setProperty('left', 'auto', 'important');
    host.style.setProperty('top', 'auto', 'important');
    host.style.setProperty('--fn-max-height', 'calc(100vh - 24px)');
    var corner = settings.corner;
    if (corner === 'top-left' || corner === 'bottom-left') {
      host.style.setProperty('left', POSITION_MARGIN + 'px', 'important');
      host.style.setProperty('right', 'auto', 'important');
    } else {
      host.style.setProperty('right', POSITION_MARGIN + 'px', 'important');
      host.style.setProperty('left', 'auto', 'important');
    }
    if (corner === 'top-left' || corner === 'top-right') {
      host.style.setProperty('top', POSITION_MARGIN + 'px', 'important');
      host.style.setProperty('bottom', 'auto', 'important');
    } else {
      host.style.setProperty('bottom', POSITION_MARGIN + 'px', 'important');
      host.style.setProperty('top', 'auto', 'important');
    }
  }

  function setHostCustomPosition(x, y) {
    var rect = host.getBoundingClientRect();
    var width = rect.width || state.settings.width;
    var maxX = Math.max(8, window.innerWidth - width - 8);
    var visibleHeight = Math.min(rect.height || 54, window.innerHeight - 16);
    var maxY = Math.max(8, window.innerHeight - visibleHeight - 8);
    var left = Math.round(Math.min(maxX, Math.max(8, x)));
    var top = Math.round(Math.min(maxY, Math.max(8, y)));
    // 自定义位置若靠下，需要同步压缩最大高度，否则展开长备注时底部会跑出视口。
    host.style.setProperty('--fn-max-height', Math.max(150, window.innerHeight - top - 8) + 'px');
    host.style.setProperty('left', left + 'px', 'important');
    host.style.setProperty('top', top + 'px', 'important');
    host.style.setProperty('right', 'auto', 'important');
    host.style.setProperty('bottom', 'auto', 'important');
  }

  function foldHash(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function foldKeyFor(text, occurrence) {
    return occurrence + '-' + foldHash(text);
  }

  function foldedSectionsForUrl() {
    if (!state.foldedSections[state.url]) {
      state.foldedSections[state.url] = Object.create(null);
    }
    return state.foldedSections[state.url];
  }

  function annotateViewSections(items) {
    var occurrences = Object.create(null);
    var folded = foldedSectionsForUrl();
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (item.d !== 0) {
        continue;
      }
      var base = String(item.t || '').trim();
      var occurrence = occurrences[base] || 0;
      occurrences[base] = occurrence + 1;
      var end = i + 1;
      while (end < items.length && items[end].d > 0) {
        end += 1;
      }
      item.foldKey = foldKeyFor(base, occurrence);
      item.childCount = end - i - 1;
      item.hasChildren = item.childCount > 0;
      item.folded = item.hasChildren && !!folded[item.foldKey];
      item.subtreeEnd = end;
    }
    return items;
  }

  function toggleSection(key) {
    if (!key) {
      return;
    }
    var folded = foldedSectionsForUrl();
    var main = els.list.closest('.fn-main');
    var scrollTop = main ? main.scrollTop : 0;
    if (folded[key]) {
      delete folded[key];
    } else {
      folded[key] = true;
    }
    renderView();
    if (main) {
      main.scrollTop = scrollTop;
    }
    var nextToggle = els.list.querySelector('.fn-fold-toggle[data-fold-key="' + key + '"]');
    if (nextToggle) {
      nextToggle.focus({ preventScroll: true });
    }
  }

  function renderView() {
    var note = state.note;
    if (!note || !FN.noteHasContent(note)) {
      els.empty.hidden = false;
      els.note.hidden = true;
      els.list.textContent = '';
      return;
    }
    els.empty.hidden = true;
    els.note.hidden = false;

    var title = String(note.title || '').trim();
    els.noteTitle.textContent = title;
    els.noteTitle.hidden = !title;

    var items = annotateViewSections((note.items || []).filter(function (item) {
      return String(item.t || '').trim().length > 0;
    }));
    els.list.textContent = '';
    var counters = [];
    var skipUntil = -1;
    for (var index = 0; index < items.length; index += 1) {
      if (index < skipUntil) {
        continue;
      }
      var item = items[index];
      var isFolded = item.d === 0 && item.hasChildren && item.folded;
      var row = document.createElement('div');
      row.className = 'fn-view-row' + (item.d >= 2 ? ' is-deep' : '') + (isFolded ? ' is-folded' : '');
      row.setAttribute('role', 'listitem');
      row.style.setProperty('--fn-depth', String(item.d));

      var marker = document.createElement('span');
      marker.className = 'fn-view-marker';
      marker.setAttribute('aria-hidden', 'true');
      if (note.listStyle === 'number') {
        marker.textContent = FN.formatOrderedMarker(nextNumber(counters, item.d), item.d);
      } else {
        marker.textContent = bulletForDepth(item.d);
      }

      var text = document.createElement('span');
      text.className = 'fn-view-text';
      text.textContent = item.t;

      row.appendChild(marker);
      row.appendChild(text);

      if (item.d === 0 && item.hasChildren) {
        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'fn-fold-toggle' + (isFolded ? ' is-collapsed' : '');
        toggle.setAttribute('data-fold-key', item.foldKey);
        toggle.setAttribute('aria-expanded', isFolded ? 'false' : 'true');
        toggle.setAttribute('aria-label',
          (isFolded ? '展开' : '收起') + '子项，共 ' + item.childCount + ' 项');
        toggle.title = (isFolded ? '展开' : '收起') + ' ' + item.childCount + ' 个子项';
        toggle.innerHTML = '<span class="fn-fold-count">' + item.childCount + '</span>' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
        row.appendChild(toggle);
      }

      els.list.appendChild(row);
      if (isFolded) {
        skipUntil = item.subtreeEnd;
      }
    }
    els.emptyList.hidden = items.length > 0;
  }

  function renderEditor() {
    els.title.value = state.editorTitle;
    els.styleBullet.setAttribute('aria-pressed', state.listStyle === 'bullet' ? 'true' : 'false');
    els.styleNumber.setAttribute('aria-pressed', state.listStyle === 'number' ? 'true' : 'false');
    els.outdent.disabled = !canOutdentActive();
    els.indent.disabled = !canIndentActive();
    renderEditorRows();
  }

  function renderEditorRows(focusId, caret) {
    els.outline.textContent = '';
    if (!state.editorItems.length) {
      state.editorItems.push(newEditorItem('', 0));
    }
    var counters = [];
    state.editorItems.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'fn-edit-row';
      row.setAttribute('role', 'listitem');
      row.setAttribute('data-id', item.id);
      row.style.setProperty('--fn-depth', String(item.d));
      if (item.id === state.activeItemId) {
        row.classList.add('is-active');
      }

      var marker = document.createElement('span');
      marker.className = 'fn-edit-marker';
      marker.setAttribute('aria-hidden', 'true');
      if (state.listStyle === 'number') {
        marker.textContent = FN.formatOrderedMarker(nextNumber(counters, item.d), item.d);
      } else {
        marker.textContent = bulletForDepth(item.d);
      }

      var editable = document.createElement('div');
      editable.className = 'fn-edit-text';
      editable.setAttribute('contenteditable', 'plaintext-only');
      editable.setAttribute('role', 'textbox');
      editable.setAttribute('aria-label', '备注内容，第 ' + (state.editorItems.indexOf(item) + 1) + ' 行');
      editable.setAttribute('spellcheck', 'false');
      editable.setAttribute('data-placeholder', item.d === 0 ? '输入备注…' : '输入子项…');
      editable.textContent = item.t;
      syncEmptyState(editable, item);

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'fn-row-del';
      del.title = '删除这一行';
      del.setAttribute('aria-label', '删除这一行');
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

      row.appendChild(marker);
      row.appendChild(editable);
      row.appendChild(del);
      els.outline.appendChild(row);
    });
    els.outdent.disabled = !canOutdentActive();
    els.indent.disabled = !canIndentActive();
    if (focusId) {
      focusRow(focusId, caret || 'end');
    }
  }

  function syncEmptyState(editable, item) {
    var empty = !String(item.t || '').replace(/\u200b/g, '').length;
    editable.classList.toggle('is-empty', empty);
  }

  function newEditorItem(text, depth) {
    state.rowSeq += 1;
    return {
      id: 'fn-row-' + Date.now().toString(36) + '-' + state.rowSeq,
      t: text || '',
      d: depth || 0
    };
  }

  function findItem(id) {
    for (var i = 0; i < state.editorItems.length; i += 1) {
      if (state.editorItems[i].id === id) {
        return state.editorItems[i];
      }
    }
    return null;
  }

  function indexOfItem(id) {
    for (var i = 0; i < state.editorItems.length; i += 1) {
      if (state.editorItems[i].id === id) {
        return i;
      }
    }
    return -1;
  }

  function activeRowElement() {
    var active = shadow.activeElement;
    if (active && active.classList && active.classList.contains('fn-edit-text')) {
      return active;
    }
    if (state.activeItemId) {
      var row = els.outline.querySelector('.fn-edit-row[data-id="' + cssEscape(state.activeItemId) + '"]');
      if (row) {
        return row.querySelector('.fn-edit-text');
      }
    }
    return null;
  }

  function activeId() {
    var editable = activeRowElement();
    if (editable) {
      var row = editable.closest('.fn-edit-row');
      if (row) {
        return row.getAttribute('data-id');
      }
    }
    return state.activeItemId || (state.editorItems[0] && state.editorItems[0].id) || '';
  }

  function setActiveItem(id) {
    state.activeItemId = id || '';
    var rows = els.outline.querySelectorAll('.fn-edit-row');
    for (var i = 0; i < rows.length; i += 1) {
      rows[i].classList.toggle('is-active', rows[i].getAttribute('data-id') === id);
    }
    els.outdent.disabled = !canOutdentActive();
    els.indent.disabled = !canIndentActive();
  }

  function readEditableText(element) {
    return String(element.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\u200b/g, '')
      .replace(/\r\n?/g, '\n');
  }

  function focusRow(id, caret) {
    var row = els.outline.querySelector('.fn-edit-row[data-id="' + cssEscape(id) + '"]');
    if (!row) {
      return;
    }
    var editable = row.querySelector('.fn-edit-text');
    if (!editable) {
      return;
    }
    setActiveItem(id);
    editable.focus();
    var range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(caret === 'start');
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (row.getBoundingClientRect) {
      var rowRect = row.getBoundingClientRect();
      var mainRect = els.editor.closest('.fn-main').getBoundingClientRect();
      if (rowRect.top < mainRect.top + 8 || rowRect.bottom > mainRect.bottom - 8) {
        row.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function focusActiveRow() {
    var id = activeId();
    if (id) {
      focusRow(id, 'end');
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function bulletForDepth(depth) {
    var bullets = ['•', '◦', '▪'];
    return bullets[depth % bullets.length];
  }

  function nextNumber(counters, depth) {
    for (var i = depth + 1; i < counters.length; i += 1) {
      counters[i] = 0;
    }
    counters[depth] = (counters[depth] || 0) + 1;
    return counters[depth];
  }

  function startEditing() {
    if (state.editing) {
      return;
    }
    var source = state.note || FN.createNote(state.url);
    if (!source) {
      return;
    }
    state.editorTitle = source.title || '';
    state.listStyle = source.listStyle === 'number' ? 'number' : 'bullet';
    state.editorItems = (source.items || []).map(function (item) {
      return newEditorItem(item.t || '', item.d || 0);
    });
    if (!state.editorItems.length) {
      state.editorItems.push(newEditorItem('', 0));
    }
    state.editing = true;
    state.dirty = false;
    state.activeItemId = state.editorItems[0].id;
    state.collapsed = false;
    render();
    requestAnimationFrame(function () {
      focusRow(state.editorItems[0].id, 'end');
    });
  }

  function finishEditing(callback) {
    if (!state.editing) {
      if (typeof callback === 'function') {
        callback(null);
      }
      return;
    }
    els.done.disabled = true;
    flushSave(function (error) {
      els.done.disabled = false;
      if (error) {
        setStatus('保存失败，请重试', 'error');
        if (typeof callback === 'function') {
          callback(error);
        }
        return;
      }
      state.editing = false;
      state.note = state.notes[state.url] || null;
      state.editorItems = [];
      state.activeItemId = '';
      state.foldedSections[state.url] = Object.create(null);
      render();
      if (typeof callback === 'function') {
        callback(null);
      }
    });
  }

  function hidePanel() {
    if (!state.visible) {
      return;
    }
    state.visible = false;
    state.collapsed = false;
    els.card.hidden = true;
    host.hidden = true;
    host.setAttribute('aria-hidden', 'true');
    var active = shadow.activeElement;
    if (active && typeof active.blur === 'function') {
      active.blur();
    }
  }

  function closePanel() {
    if (!state.visible) {
      return;
    }
    if (state.editing) {
      els.close.disabled = true;
      finishEditing(function (error) {
        els.close.disabled = false;
        if (!error) {
          hidePanel();
        }
      });
      return;
    }
    hidePanel();
  }

  function markDirty() {
    state.dirty = true;
    setStatus('正在编辑…', 'saving');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      flushSave();
    }, SAVE_DEBOUNCE);
  }

  function buildNoteSnapshot() {
    var source = state.note;
    var now = Date.now();
    return {
      url: state.url,
      title: els.title ? els.title.value : state.editorTitle,
      items: state.editorItems.map(function (item) {
        return { t: item.t, d: item.d };
      }),
      listStyle: state.listStyle,
      createdAt: source && source.createdAt ? source.createdAt : now,
      updatedAt: now
    };
  }

  function flushSave(callback) {
    if (typeof callback === 'function') {
      state.saveWaiters.push(callback);
    }
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (!state.editing) {
      finishWaiters(null);
      return;
    }
    if (state.saving) {
      if (state.dirty) {
        state.saveRequested = true;
      }
      return;
    }
    if (!state.dirty) {
      finishWaiters(null);
      return;
    }
    runSave();
  }

  function runSave() {
    if (!state.editing) {
      finishWaiters(null);
      return;
    }
    state.saving = true;
    state.saveRequested = false;
    state.dirty = false;
    setStatus('保存中…', 'saving');
    var snapshot = buildNoteSnapshot();
    FN.saveNote(snapshot, function (error, saved) {
      state.saving = false;
      if (error) {
        state.dirty = true;
        setStatus('保存失败，请重试', 'error');
        finishWaiters(error);
        return;
      }
      state.lastSavedAt = Date.now();
      if (saved && FN.noteHasContent(saved)) {
        state.note = saved;
        state.notes[saved.url] = saved;
      } else {
        state.note = null;
        delete state.notes[state.url];
      }
      if (state.saveRequested || state.dirty) {
        runSave();
        return;
      }
      setStatus('已保存 · ' + timeOnly(state.lastSavedAt), 'saved');
      finishWaiters(null);
    });
  }

  function finishWaiters(error) {
    var waiters = state.saveWaiters.slice();
    state.saveWaiters = [];
    waiters.forEach(function (callback) {
      try {
        callback(error || null);
      } catch (callbackError) {
        // 回调错误不应中断保存队列。
      }
    });
  }

  function setStatus(text, kind) {
    els.statusText.textContent = text;
    els.status.className = 'fn-status' + (kind ? ' is-' + kind : '');
  }

  function updateIdleStatus() {
    if (!state.note || !FN.noteHasContent(state.note)) {
      setStatus('按网址自动保存', '');
      return;
    }
    var items = FN.countItems(state.note);
    var prefix = items ? items + ' 项 · ' : '';
    setStatus(prefix + FN.formatRelative(state.note.updatedAt), 'saved');
  }

  function timeOnly(timestamp) {
    var date = new Date(timestamp);
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  function setListStyle(style) {
    if (state.listStyle === style) {
      return;
    }
    state.listStyle = style;
    els.styleBullet.setAttribute('aria-pressed', style === 'bullet' ? 'true' : 'false');
    els.styleNumber.setAttribute('aria-pressed', style === 'number' ? 'true' : 'false');
    renderEditorRows(state.activeItemId, 'end');
    markDirty();
  }

  function subtreeEnd(index) {
    var base = state.editorItems[index];
    if (!base) {
      return index;
    }
    var end = index;
    for (var i = index + 1; i < state.editorItems.length; i += 1) {
      if (state.editorItems[i].d > base.d) {
        end = i;
      } else {
        break;
      }
    }
    return end;
  }

  function maxDepthInSubtree(index) {
    var base = state.editorItems[index];
    if (!base) {
      return 0;
    }
    var max = base.d;
    for (var i = index + 1; i < state.editorItems.length; i += 1) {
      if (state.editorItems[i].d > base.d) {
        max = Math.max(max, state.editorItems[i].d);
      } else {
        break;
      }
    }
    return max;
  }

  function canIndentActive() {
    var id = activeId();
    var index = indexOfItem(id);
    if (index <= 0) {
      return false;
    }
    var item = state.editorItems[index];
    var previous = state.editorItems[index - 1];
    return item.d < FN.LIMITS.depth && item.d < previous.d + 1 && maxDepthInSubtree(index) < FN.LIMITS.depth;
  }

  function canOutdentActive() {
    var index = indexOfItem(activeId());
    return index >= 0 && state.editorItems[index].d > 0;
  }

  function moveActiveDepth(delta) {
    var id = activeId();
    var index = indexOfItem(id);
    if (index < 0) {
      return;
    }
    if (delta > 0 && !canIndentActive()) {
      return;
    }
    if (delta < 0 && !canOutdentActive()) {
      return;
    }
    var item = state.editorItems[index];
    var subtree = subtreeEnd(index);
    for (var i = index; i <= subtree; i += 1) {
      state.editorItems[i].d = Math.min(FN.LIMITS.depth, Math.max(0, state.editorItems[i].d + delta));
    }
    renderEditorRows(id, 'end');
    markDirty();
  }

  function addItemAfterActive() {
    if (state.editorItems.length >= FN.LIMITS.items) {
      setStatus('最多支持 ' + FN.LIMITS.items + ' 行', 'error');
      return;
    }
    var id = activeId();
    var index = indexOfItem(id);
    if (index < 0) {
      state.editorItems.push(newEditorItem('', 0));
      renderEditorRows(state.editorItems[state.editorItems.length - 1].id, 'end');
      markDirty();
      return;
    }
    var insertAt = subtreeEnd(index) + 1;
    var item = newEditorItem('', state.editorItems[index].d);
    state.editorItems.splice(insertAt, 0, item);
    renderEditorRows(item.id, 'end');
    markDirty();
  }

  function removeItem(id) {
    var index = indexOfItem(id);
    if (index < 0) {
      return;
    }
    var depth = state.editorItems[index].d;
    state.editorItems.splice(index, 1);
    // 子项提升一级，避免删除父项时层级断裂。
    for (var i = index; i < state.editorItems.length; i += 1) {
      if (state.editorItems[i].d > depth) {
        state.editorItems[i].d = Math.max(0, state.editorItems[i].d - 1);
      } else {
        break;
      }
    }
    if (!state.editorItems.length) {
      state.editorItems.push(newEditorItem('', 0));
    }
    var nextIndex = Math.min(index, state.editorItems.length - 1);
    var nextId = state.editorItems[nextIndex].id;
    renderEditorRows(nextId, 'end');
    markDirty();
  }

  function handleOutlineKeydown(event) {
    if (event.isComposing || event.keyCode === 229) {
      return;
    }
    var editable = event.target.closest('.fn-edit-text');
    if (!editable) {
      return;
    }
    var row = editable.closest('.fn-edit-row');
    var id = row.getAttribute('data-id');
    var index = indexOfItem(id);

    if (event.key === 'Tab') {
      event.preventDefault();
      moveActiveDepth(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      insertNewRow(id, index);
      return;
    }

    if (event.key === 'Backspace') {
      var item = state.editorItems[index];
      if (item && item.t === '' && state.editorItems.length > 1) {
        var selection = window.getSelection();
        if (selection && selection.rangeCount) {
          var range = selection.getRangeAt(0);
          if (range.collapsed && range.startOffset === 0) {
            event.preventDefault();
            var previousId = state.editorItems[Math.max(0, index - 1)].id;
            removeItem(id);
            focusRow(previousId, 'end');
          }
        }
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      finishEditing();
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      var selection2 = window.getSelection();
      if (!selection2 || !selection2.rangeCount) {
        return;
      }
      var range2 = selection2.getRangeAt(0);
      var atEdge = false;
      if (event.key === 'ArrowUp') {
        atEdge = range2.collapsed && range2.startOffset === 0;
      } else {
        var textLength = readEditableText(editable).length;
        atEdge = range2.collapsed && range2.startOffset >= textLength;
      }
      if (atEdge) {
        var target = state.editorItems[index + (event.key === 'ArrowUp' ? -1 : 1)];
        if (target) {
          event.preventDefault();
          focusRow(target.id, event.key === 'ArrowUp' ? 'end' : 'start');
        }
      }
    }
  }

  function insertNewRow(id, index) {
    if (state.editorItems.length >= FN.LIMITS.items) {
      setStatus('最多支持 ' + FN.LIMITS.items + ' 行', 'error');
      return;
    }
    var current = state.editorItems[index];
    if (!current) {
      return;
    }
    if (current.t === '' && current.d > 0) {
      moveActiveDepth(-1);
      return;
    }
    var insertAt = subtreeEnd(index) + 1;
    var item = newEditorItem('', current.d);
    state.editorItems.splice(insertAt, 0, item);
    renderEditorRows(item.id, 'end');
    markDirty();
  }

  function handleOutlinePaste(event) {
    var editable = event.target.closest('.fn-edit-text');
    if (!editable) {
      return;
    }
    var clipboard = event.clipboardData || window.clipboardData;
    if (!clipboard) {
      return;
    }
    var text = clipboard.getData('text/plain');
    if (!text) {
      return;
    }
    event.preventDefault();
    text = text.replace(/\r\n?/g, '\n');
    var lines = text.split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    if (lines.length <= 1) {
      insertPlainText(editable, text.replace(/\n/g, ' '));
      return;
    }

    var id = editable.closest('.fn-edit-row').getAttribute('data-id');
    var index = indexOfItem(id);
    var current = state.editorItems[index];
    if (!current) {
      return;
    }

    var parsed = [];
    var minIndent = Infinity;
    lines.forEach(function (line) {
      if (!line.trim()) {
        return;
      }
      var match = /^([ \t]*)(.*)$/.exec(line);
      var indentRaw = match[1];
      var indent = 0;
      for (var i = 0; i < indentRaw.length; i += 1) {
        indent += indentRaw[i] === '\t' ? 2 : 1;
      }
      minIndent = Math.min(minIndent, indent);
      var content = match[2]
        .replace(/^[-*+•]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trimEnd();
      if (!content) {
        return;
      }
      parsed.push({ indent: indent, text: content });
    });
    if (!parsed.length) {
      return;
    }
    if (!Number.isFinite(minIndent)) {
      minIndent = 0;
    }

    var baseDepth = current.t === '' ? current.d : current.d + 1;
    var available = FN.LIMITS.items - state.editorItems.length + (current.t === '' ? 1 : 0);
    if (available <= 0) {
      setStatus('最多支持 ' + FN.LIMITS.items + ' 行', 'error');
      return;
    }
    parsed = parsed.slice(0, available);
    var items = [];
    var previousDepth = current.d;
    parsed.forEach(function (part) {
      var depth = Math.min(FN.LIMITS.depth, baseDepth + Math.floor((part.indent - minIndent) / 2));
      depth = Math.min(depth, previousDepth + 1);
      previousDepth = depth;
      items.push(newEditorItem(part.text, depth));
    });

    if (current.t === '') {
      state.editorItems.splice.apply(state.editorItems, [index, 1].concat(items));
    } else {
      var insertAt = subtreeEnd(index) + 1;
      state.editorItems.splice.apply(state.editorItems, [insertAt, 0].concat(items));
    }
    var last = items[items.length - 1];
    renderEditorRows(last.id, 'end');
    markDirty();
  }

  function insertPlainText(editable, text) {
    editable.focus();
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) {
      return;
    }
    var range = selection.getRangeAt(0);
    if (!editable.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== editable) {
      return;
    }
    range.deleteContents();
    var node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    var item = findItem(editable.closest('.fn-edit-row').getAttribute('data-id'));
    if (item) {
      item.t = readEditableText(editable);
      syncEmptyState(editable, item);
      markDirty();
    }
  }

  function onStorageChanged(changes, areaName) {
    if (areaName !== 'local') {
      return;
    }
    if (changes[FN.STORAGE_KEYS.settings]) {
      state.settings = FN.normalizeSettings(changes[FN.STORAGE_KEYS.settings].newValue);
      if (state.ready) {
        applyTheme();
        applyWidth();
        applyPosition();
      }
    }
    if (changes[FN.STORAGE_KEYS.notes]) {
      state.notes = FN.normalizeNotes(changes[FN.STORAGE_KEYS.notes].newValue);
      if (!state.editing) {
        state.note = state.notes[state.url] || null;
        if (state.ready) {
          renderView();
          updateIdleStatus();
        }
      }
    }
  }

  function revealPanel(message) {
    var wasVisible = state.visible;
    state.visible = true;
    els.card.hidden = false;
    host.hidden = false;
    host.removeAttribute('aria-hidden');
    state.collapsed = false;
    applyCollapsed();
    applyWidth();
    applyPosition();
    if (!wasVisible) {
      els.card.classList.remove('fn-flash');
      // 强制重启动画。
      void els.card.offsetWidth;
      els.card.classList.add('fn-flash');
      setTimeout(function () {
        els.card.classList.remove('fn-flash');
      }, 900);
    }
    if (message && message.action === 'edit' && !state.editing) {
      startEditing();
    }
    if (state.editing) {
      requestAnimationFrame(focusActiveRow);
    }
    return {
      ok: true,
      visible: true,
      hasNote: !!(state.note && FN.noteHasContent(state.note)),
      editing: state.editing
    };
  }

  function onRuntimeMessage(message, sender, sendResponse) {
    if (!message || typeof message.type !== 'string') {
      return;
    }
    if (message.type === 'FLOATNOTE_PING') {
      sendResponse({
        ok: true,
        url: state.url,
        visible: state.visible,
        hasNote: !!(state.note && FN.noteHasContent(state.note)),
        editing: state.editing
      });
      return;
    }
    if (message.type === 'FLOATNOTE_REVEAL') {
      if (!state.ready) {
        state.pendingReveal = { action: message.action || 'reveal' };
        sendResponse({ ok: true, pending: true });
        return;
      }
      sendResponse(revealPanel(message));
      return;
    }
    if (message.type === 'FLOATNOTE_EDIT') {
      if (!state.ready) {
        state.pendingReveal = { action: 'edit' };
        sendResponse({ ok: true, pending: true });
        return;
      }
      var result = revealPanel({ action: 'edit' });
      sendResponse(result);
    }
  }

  function initialize() {
    state.url = FN.normalizeUrl(location.href);
    if (!state.url) {
      return;
    }
    createPanel();
    setStatus('正在载入…', 'saving');
    FN.loadAll(function (error, data) {
      state.ready = true;
      if (error) {
        setStatus('载入失败，刷新页面重试', 'error');
        render();
        return;
      }
      state.settings = data.settings;
      state.notes = data.notes;
      state.note = state.notes[state.url] || null;
      render();
      if (state.pendingReveal) {
        var pending = state.pendingReveal;
        state.pendingReveal = null;
        revealPanel(pending);
      }
    });

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(onStorageChanged);
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
    }
    if (window.matchMedia) {
      try {
        var media = window.matchMedia('(prefers-color-scheme: dark)');
        var onChange = function () {
          if (state.settings.theme === 'auto') {
            applyTheme();
          }
        };
        if (media.addEventListener) {
          media.addEventListener('change', onChange);
        } else if (media.addListener) {
          media.addListener(onChange);
        }
      } catch (error) {
        // 忽略不支持媒体查询监听的旧环境。
      }
    }
    window.addEventListener('resize', function () {
      if (state.settings.customX !== null && state.settings.customY !== null) {
        setHostCustomPosition(state.settings.customX, state.settings.customY);
      }
    });
    window.addEventListener('pagehide', function () {
      if (state.editing && state.dirty) {
        flushSave();
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && state.editing && state.dirty) {
        flushSave();
      }
    });
    setInterval(function () {
      if (!state.editing && state.note) {
        updateIdleStatus();
      }
    }, 60000);
  }

  if (document.documentElement) {
    initialize();
  } else {
    window.addEventListener('DOMContentLoaded', initialize, { once: true });
  }
})();
