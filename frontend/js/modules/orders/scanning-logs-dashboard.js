// js/modules/orders/scanning-logs-dashboard.js
// Scanning Logs Hub — line chart of log counts per branch over time

import { get } from '../../services/api/http.js';
import { initDatePicker } from '../../ui/datePicker.js';

// ── State ────────────────────────────────────────────────────
let chartInstance = null;
let fromPicker = null;
let toPicker   = null;

const activeBranches = new Set(['uk-birmingham', 'uk-london', 'fr-paris']);

const BRANCH_COLORS = {
  'uk-birmingham': { border: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  'uk-london':     { border: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  'fr-paris':      { border: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
};

const BRANCH_LABELS = {
  'uk-birmingham': 'Birmingham',
  'uk-london':     'London',
  'fr-paris':      'Paris',
};

// ── Helpers ──────────────────────────────────────────────────
function mondayOfWeek(d = new Date()) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function dateRange(from, to) {
  const dates = [];
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    dates.push(toISODate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ── Data fetching ────────────────────────────────────────────
async function fetchChartData() {
  const dateFrom = document.getElementById('chartDateFrom')?.value;
  const dateTo   = document.getElementById('chartDateTo')?.value;
  if (!dateFrom || !dateTo) return null;

  const branches = [...activeBranches].join(',');
  // Include all reasons so we count every log
  const reasons = 'Order,Return,Stock Re-evaluation';

  const params = new URLSearchParams({
    date_from: `${dateFrom}T00:00:00`,
    date_to:   `${dateTo}T23:59:59`,
    branches,
    reasons,
  });

  try {
    return await get(`/v1/inventory/scanning-logs/chart/daily-counts?${params}`);
  } catch (e) {
    console.error('[ScanningLogsHub] Chart data fetch failed:', e);
    return null;
  }
}

// ── Chart rendering ──────────────────────────────────────────
function renderChart(apiResponse) {
  const canvas = document.getElementById('logsActivityChart');
  if (!canvas) return;

  const Chart = window.Chart;
  if (!Chart) { console.warn('[ScanningLogsHub] Chart.js not loaded'); return; }

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const dateFrom = document.getElementById('chartDateFrom')?.value;
  const dateTo   = document.getElementById('chartDateTo')?.value;

  if (!apiResponse || !apiResponse.data) {
    const labels = dateFrom && dateTo ? dateRange(dateFrom, dateTo) : [];
    chartInstance = new Chart(canvas, { type: 'line', data: { labels, datasets: [] }, options: chartOptions(labels) });
    updateStatCards({});
    return;
  }

  const from = apiResponse.date_from?.slice(0, 10);
  const to   = apiResponse.date_to?.slice(0, 10);
  const labels = dateRange(from, to);

  // Aggregate log count per branch per day (sum across all reasons)
  const branchDayMap = {};  // 'branch|date' → count
  const reasonTotals = {}; // 'reason' → total count
  for (const row of apiResponse.data) {
    const key = `${row.branch}|${row.date}`;
    branchDayMap[key] = (branchDayMap[key] || 0) + (row.count || 0);
    reasonTotals[row.reason] = (reasonTotals[row.reason] || 0) + (row.count || 0);
  }

  updateStatCards(reasonTotals);

  // One dataset per active branch
  const datasets = [];
  for (const branch of activeBranches) {
    const colors = BRANCH_COLORS[branch] || { border: '#888', bg: 'rgba(136,136,136,0.12)' };
    datasets.push({
      label: BRANCH_LABELS[branch] || branch,
      data: labels.map(date => branchDayMap[`${branch}|${date}`] || 0),
      borderColor: colors.border,
      backgroundColor: colors.bg,
      fill: true,
      tension: 0.35,
      pointRadius: 4,
      pointHoverRadius: 6,
      borderWidth: 2,
    });
  }

  chartInstance = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: chartOptions(labels),
  });
}

function updateStatCards(reasonTotals) {
  const orderEl  = document.getElementById('orderLogCount');
  const returnEl = document.getElementById('returnLogCount');
  const reevalEl = document.getElementById('reevalLogCount');
  if (orderEl)  orderEl.textContent  = reasonTotals['Order']                ?? 0;
  if (returnEl) returnEl.textContent = reasonTotals['Return']               ?? 0;
  if (reevalEl) reevalEl.textContent = reasonTotals['Stock Re-evaluation']  ?? 0;
}

function chartOptions(labels) {
  const isDark = document.documentElement.classList.contains('dark-mode');
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#a1a1aa' : '#71717a';

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: textColor, usePointStyle: true, pointStyle: 'circle', padding: 16 },
      },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          callback(val) {
            const label = labels[val];
            if (!label) return val;
            const d = new Date(label + 'T00:00:00');
            return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
          },
        },
      },
      y: {
        beginAtZero: true,
        grid: { color: gridColor },
        ticks: { color: textColor, precision: 0 },
        title: { display: true, text: 'Logs', color: textColor },
      },
    },
  };
}

// ── Refresh ──────────────────────────────────────────────────
async function refreshChart() {
  const res = await fetchChartData();
  renderChart(res);
}

// ── Event wiring ─────────────────────────────────────────────
function wireControls() {
  // Branch toggles
  document.querySelectorAll('#branchToggles .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const branch = btn.dataset.branch;
      if (activeBranches.has(branch)) {
        if (activeBranches.size > 1) { activeBranches.delete(branch); btn.classList.remove('active'); }
      } else {
        activeBranches.add(branch); btn.classList.add('active');
      }
      refreshChart();
    });
  });

  // Date pickers — set defaults then init nui calendar
  const fromEl = document.getElementById('chartDateFrom');
  const toEl   = document.getElementById('chartDateTo');

  const mon = mondayOfWeek();
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);

  if (fromEl) { fromEl.value = toISODate(mon); }
  if (toEl)   { toEl.value   = toISODate(sun); }

  fromPicker = initDatePicker('#chartDateFrom', { onSelect: () => refreshChart() });
  toPicker   = initDatePicker('#chartDateTo',   { onSelect: () => refreshChart() });

  if (fromEl) fromEl.addEventListener('change', refreshChart);
  if (toEl)   toEl.addEventListener('change', refreshChart);
}

// ── Module lifecycle ─────────────────────────────────────────
export async function init() {
  wireControls();
  await refreshChart();
}

export function cleanup() {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  if (fromPicker) { fromPicker.destroy(); fromPicker = null; }
  if (toPicker)   { toPicker.destroy();   toPicker   = null; }
}
