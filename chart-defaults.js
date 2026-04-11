/**
 * chart-defaults.js — LifeOS Unified Chart Configuration
 * Ładować po Chart.js, przed inicjalizacją wykresów.
 * Zapewnia spójny wygląd wszystkich wykresów w aplikacji.
 */
(function () {
  if (typeof Chart === 'undefined') return;

  /* ── Typografia ──────────────────────────────────────────── */
  Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
  Chart.defaults.font.size   = 12;
  Chart.defaults.font.weight = '500';

  /* ── Kolory ──────────────────────────────────────────────── */
  Chart.defaults.color = '#595c5e'; /* var(--muted) */

  /* ── Legenda ─────────────────────────────────────────────── */
  Chart.defaults.plugins.legend.position = 'bottom';
  Chart.defaults.plugins.legend.labels.padding      = 16;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight    = 8;

  /* ── Tooltip ─────────────────────────────────────────────── */
  Chart.defaults.plugins.tooltip.backgroundColor  = '#ffffff';
  Chart.defaults.plugins.tooltip.borderColor      = '#dadde0'; /* var(--line) */
  Chart.defaults.plugins.tooltip.borderWidth      = 1;
  Chart.defaults.plugins.tooltip.titleColor       = '#2c2f31'; /* var(--ink) */
  Chart.defaults.plugins.tooltip.bodyColor        = '#595c5e'; /* var(--muted) */
  Chart.defaults.plugins.tooltip.padding          = 10;
  Chart.defaults.plugins.tooltip.cornerRadius     = 10;
  Chart.defaults.plugins.tooltip.boxPadding       = 4;
  Chart.defaults.plugins.tooltip.titleFont        = { weight: '700', size: 12 };
  Chart.defaults.plugins.tooltip.bodyFont         = { size: 12 };

  /* ── Osie ────────────────────────────────────────────────── */
  Chart.defaults.scales.linear  = Chart.defaults.scales.linear  || {};
  Chart.defaults.scales.category = Chart.defaults.scales.category || {};

  /* Siatka osi Y */
  if (Chart.defaults.scales.linear) {
    Chart.defaults.scales.linear.grid = {
      color: 'rgba(218, 221, 224, 0.6)', /* var(--line) @ 60% */
      drawTicks: false,
    };
    Chart.defaults.scales.linear.border = { display: false };
    Chart.defaults.scales.linear.ticks  = {
      padding: 8,
      color: '#595c5e',
    };
  }

  /* Oś X — bez siatki pionowej */
  if (Chart.defaults.scales.category) {
    Chart.defaults.scales.category.grid   = { display: false };
    Chart.defaults.scales.category.border = { display: false };
    Chart.defaults.scales.category.ticks  = {
      padding: 6,
      color: '#595c5e',
    };
  }

  /* ── Elementy ────────────────────────────────────────────── */
  Chart.defaults.elements.bar.borderRadius    = 6;
  Chart.defaults.elements.bar.borderSkipped   = 'bottom';

  Chart.defaults.elements.line.tension        = 0.35;
  Chart.defaults.elements.line.borderWidth    = 2;

  Chart.defaults.elements.point.radius        = 3;
  Chart.defaults.elements.point.hoverRadius   = 5;
  Chart.defaults.elements.point.borderWidth   = 2;

  Chart.defaults.elements.arc.borderWidth     = 2;
  Chart.defaults.elements.arc.borderColor     = '#ffffff';

  /* ── Animacje ────────────────────────────────────────────── */
  Chart.defaults.animation.duration = 400;
  Chart.defaults.animation.easing   = 'easeOutQuart';

  /* ── Paleta kolorów aplikacji (eksportowana globalnie) ───── */
  window.LIFEOS_CHART_COLORS = {
    blue:   '#0057c0',
    green:  '#059669',
    red:    '#b31b25',
    orange: '#ea580c',
    purple: '#5f2bf2',
    yellow: '#facc15',
    /* wersje z przezroczystością */
    blueSoft:   'rgba(0, 87, 192, 0.12)',
    greenSoft:  'rgba(5, 150, 105, 0.12)',
    redSoft:    'rgba(179, 27, 37, 0.12)',
    orangeSoft: 'rgba(234, 88, 12, 0.12)',
    purpleSoft: 'rgba(95, 43, 242, 0.12)',
    /* seria 6 kolorów do wykresów wieloliniowych */
    palette: [
      '#0057c0', '#059669', '#ea580c', '#5f2bf2', '#b31b25', '#facc15',
    ],
    paletteAlpha: [
      'rgba(0,87,192,0.75)', 'rgba(5,150,105,0.75)', 'rgba(234,88,12,0.75)',
      'rgba(95,43,242,0.75)', 'rgba(179,27,37,0.75)', 'rgba(250,204,21,0.75)',
    ],
  };
})();
