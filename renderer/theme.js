/**
 * theme.js — 主题色调工具
 * 职责：把主色 hex 解析为 RGB，派生出深色/浅色/文字色变体，并写入 :root CSS 变量。
 * 三个渲染窗口（宠物 / 对话框 / 设置）共用，主色由主进程持久化并广播。
 */
(function () {
  'use strict';

  /** #rrggbb → { r, g, b } */
  function hexToRgb(hex) {
    let h = String(hex || '').replace(/^#/, '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /** { r, g, b } → #rrggbb */
  function rgbToHex(rgb) {
    const to = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + to(rgb.r) + to(rgb.g) + to(rgb.b);
  }

  /** 按比例混合两种颜色：mix(#e8a0bf, #000000, 0.25) 加深，mix(hex, #ffffff, 0.55) 变浅 */
  function mixColor(hex, targetHex, ratio) {
    const a = hexToRgb(hex);
    const b = hexToRgb(targetHex);
    if (!a || !b) return hex;
    const t = Math.max(0, Math.min(1, ratio));
    return rgbToHex({
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t,
    });
  }

  /** 相对亮度 YIQ，用于判断主色上应使用深色还是白色文字 */
  function luminance(rgb) {
    return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  }

  /**
   * 应用主题：把主色与派生色写入 :root 变量
   * 派生规则：deep 混黑 25%（按钮渐变/强调），bright 混白 60%（浅色强调文字），
   *           text 依据亮度选深色或白色
   */
  function applyTheme(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    const root = document.documentElement.style;
    const deep = mixColor(hex, '#000000', 0.25);
    const bright = mixColor(hex, '#ffffff', 0.6);
    const deepRgb = hexToRgb(deep);
    const brightRgb = hexToRgb(bright);
    const darkText = luminance(rgb) >= 140;

    root.setProperty('--accent', hex);
    root.setProperty('--accent-rgb', rgb.r + ', ' + rgb.g + ', ' + rgb.b);
    root.setProperty('--accent-deep', deep);
    root.setProperty('--accent-deep-rgb', deepRgb.r + ', ' + deepRgb.g + ', ' + deepRgb.b);
    root.setProperty('--accent-bright', bright);
    root.setProperty('--accent-bright-rgb', brightRgb.r + ', ' + brightRgb.g + ', ' + brightRgb.b);
    root.setProperty('--accent-text', darkText ? '#3d1630' : '#ffffff');
  }

  /** 页面启动：读取已保存主题并应用；监听主进程广播的主题变化 */
  function initTheme() {
    if (window.pet && window.pet.getTheme) {
      window.pet.getTheme().then((hex) => {
        if (hex) applyTheme(hex);
      }).catch(() => { /* ignore */ });
    }
    if (window.pet && window.pet.onThemeChange) {
      window.pet.onThemeChange((hex) => {
        if (hex) applyTheme(hex);
      });
    }
  }

  window.ThemeKit = { applyTheme, hexToRgb, initTheme };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
})();
