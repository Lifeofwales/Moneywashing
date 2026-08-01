import { state } from "./state.js";
import { $, formatCurrency, formatNumber, safeText, groupColor, showToast } from "./ui.js";
import { currentRole, isOwner } from "./permissions.js";
import {
  rankingEmployeeName,
  isEmployeeHidden
} from "./rankings.js";

let filteredRecords = [];

function canViewAnalytics() {
  return ["owner", "admin", "manager"].includes(currentRole());
}

export function applyAnalyticsPermissions() {
  const allowed = canViewAnalytics();

  $("analyticsNavButton")?.classList.toggle("hidden", !allowed);

  if (!allowed && $("analyticsView")?.classList.contains("active")) {
    document.querySelector('[data-view="dashboard"]')?.click();
  }
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function recordDate(record) {
  return parseDate(record.transactionDate);
}

function applyDateFilter(records) {
  const from = parseDate($("analyticsDateFrom")?.value);
  const to = parseDate($("analyticsDateTo")?.value);

  return records.filter((record) => {
    const date = recordDate(record);
    if (!date) return false;
    if (from && date < from) return false;
    if (to) {
      const inclusiveTo = new Date(to);
      inclusiveTo.setHours(23, 59, 59, 999);
      if (date > inclusiveTo) return false;
    }
    return true;
  });
}

function sum(records, field = "total") {
  return records.reduce(
    (total, record) => total + Number(record[field] || 0),
    0
  );
}

function groupBy(records, getKey) {
  return records.reduce((groups, record) => {
    const key = getKey(record) || "Unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
    return groups;
  }, {});
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function dailySeries(records) {
  const totals = {};

  records.forEach((record) => {
    const key = record.transactionDate || "Unknown";
    totals[key] = (totals[key] || 0) + Number(record.total || 0);
  });

  return Object.entries(totals)
    .filter(([key]) => key !== "Unknown")
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([label, value]) => ({ label, value }));
}

function employeeName(record) {
  return rankingEmployeeName(record);
}

function visibleEmployeeRecords(records) {
  return records.filter(
    (record) => !isEmployeeHidden(employeeName(record))
  );
}

function calculateOverview(records) {
  const now = new Date();
  const today = todayKey();
  const weekStart = startOfWeek(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const todayRecords = records.filter(
    (record) => record.transactionDate === today
  );

  const weekRecords = records.filter((record) => {
    const date = recordDate(record);
    return date && date >= weekStart;
  });

  const monthRecords = records.filter((record) => {
    const date = recordDate(record);
    return date && date >= monthStart;
  });

  const lifetimeValue = sum(records);
  const average = records.length ? lifetimeValue / records.length : 0;
  const largest = records.reduce(
    (max, record) => Math.max(max, Number(record.total || 0)),
    0
  );

  setText("analyticsLifetimeRevenue", formatCurrency(lifetimeValue));
  setText("analyticsTodayRevenue", formatCurrency(sum(todayRecords)));
  setText("analyticsWeekRevenue", formatCurrency(sum(weekRecords)));
  setText("analyticsMonthRevenue", formatCurrency(sum(monthRecords)));
  setText("analyticsAverageTransaction", formatCurrency(average));
  setText("analyticsLargestTransaction", formatCurrency(largest));
  setText("analyticsTransactionCount", formatNumber(records.length));

  const uniqueEmployees = new Set(
    visibleEmployeeRecords(records)
      .map(employeeName)
      .filter((name) => name && name !== "Legacy Records")
  );

  setText("analyticsEmployeeCount", formatNumber(uniqueEmployees.size));
}

function renderGangAnalytics(records) {
  const container = $("analyticsGangList");
  if (!container) return;

  const grouped = groupBy(records, (record) => record.group);
  const rows = Object.entries(grouped)
    .map(([name, groupRecords]) => {
      const total = sum(groupRecords);
      const amount = sum(groupRecords, "amount");
      const average = groupRecords.length ? total / groupRecords.length : 0;
      const largest = groupRecords.reduce(
        (max, record) => Math.max(max, Number(record.total || 0)),
        0
      );

      return {
        name,
        records: groupRecords.length,
        total,
        amount,
        average,
        largest
      };
    })
    .sort((a, b) => b.total - a.total);

  if (!rows.length) {
    container.innerHTML =
      '<div class="empty-state">No gang analytics for this date range.</div>';
    return;
  }

  container.innerHTML = rows.map((row, index) => `
    <article class="analytics-ranking-row">
      <span class="analytics-rank">${index + 1}</span>
      <span
        class="gang-color-dot"
        style="background:${groupColor(row.name)}"
      ></span>
      <div class="analytics-ranking-main">
        <strong>${safeText(row.name)}</strong>
        <small>
          ${formatNumber(row.records)} transactions ·
          ${formatNumber(row.amount)} units
        </small>
      </div>
      <div class="analytics-ranking-metric">
        <strong>${formatCurrency(row.total)}</strong>
        <small>Average ${formatCurrency(row.average)}</small>
      </div>
      <div class="analytics-ranking-metric">
        <strong>${formatCurrency(row.largest)}</strong>
        <small>Largest</small>
      </div>
    </article>
  `).join("");
}

function renderEmployeeAnalytics(records) {
  const container = $("analyticsEmployeeList");
  if (!container) return;

  const grouped = groupBy(
    visibleEmployeeRecords(records),
    employeeName
  );

  const rows = Object.entries(grouped)
    .map(([name, employeeRecords]) => {
      const total = sum(employeeRecords);
      const average = employeeRecords.length
        ? total / employeeRecords.length
        : 0;

      const sortedDates = employeeRecords
        .map((record) => record.transactionDate)
        .filter(Boolean)
        .sort();

      return {
        name,
        records: employeeRecords.length,
        total,
        average,
        lastActive: sortedDates.at(-1) || "—"
      };
    })
    .sort((a, b) => b.total - a.total);

  if (!rows.length) {
    container.innerHTML =
      '<div class="empty-state">No employee analytics for this date range.</div>';
    return;
  }

  container.innerHTML = rows.map((row, index) => `
    <article class="analytics-ranking-row">
      <span class="analytics-rank">${index + 1}</span>
      <div class="analytics-avatar">
        ${safeText(row.name.slice(0, 1).toUpperCase())}
      </div>
      <div class="analytics-ranking-main">
        <strong>${safeText(row.name)}</strong>
        <small>
          ${formatNumber(row.records)} transactions ·
          Last active ${safeText(row.lastActive)}
        </small>
      </div>
      <div class="analytics-ranking-metric">
        <strong>${formatCurrency(row.total)}</strong>
        <small>Total revenue</small>
      </div>
      <div class="analytics-ranking-metric">
        <strong>${formatCurrency(row.average)}</strong>
        <small>Average</small>
      </div>
      ${isOwner() ? `
        <button
          class="analytics-hide-employee"
          type="button"
          data-hide-ranking-employee="${safeText(row.name)}"
        >
          Hide
        </button>
      ` : ""}
    </article>
  `).join("");
}

function renderLeaderboards(records) {
  const gangGroups = groupBy(records, (record) => record.group);
  const employeeGroups = groupBy(
    visibleEmployeeRecords(records),
    employeeName
  );

  const topGang = Object.entries(gangGroups)
    .map(([name, items]) => ({ name, value: sum(items) }))
    .sort((a, b) => b.value - a.value)[0];

  const topEmployee = Object.entries(employeeGroups)
    .map(([name, items]) => ({ name, value: sum(items) }))
    .sort((a, b) => b.value - a.value)[0];

  const mostTransactions = Object.entries(employeeGroups)
    .map(([name, items]) => ({ name, value: items.length }))
    .sort((a, b) => b.value - a.value)[0];

  const largestRecord = [...records]
    .sort((a, b) => Number(b.total || 0) - Number(a.total || 0))[0];

  setText("leaderboardTopGang", topGang?.name || "—");
  setText(
    "leaderboardTopGangValue",
    topGang ? formatCurrency(topGang.value) : "$0"
  );

  setText("leaderboardTopEmployee", topEmployee?.name || "—");
  setText(
    "leaderboardTopEmployeeValue",
    topEmployee ? formatCurrency(topEmployee.value) : "$0"
  );

  setText("leaderboardMostTransactions", mostTransactions?.name || "—");
  setText(
    "leaderboardMostTransactionsValue",
    mostTransactions
      ? `${formatNumber(mostTransactions.value)} transactions`
      : "0 transactions"
  );

  setText("leaderboardLargestBuyer", largestRecord?.buyer || "—");
  setText(
    "leaderboardLargestBuyerValue",
    largestRecord ? formatCurrency(largestRecord.total) : "$0"
  );
}

function prepareCanvas(canvas) {
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));

  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  return {
    context,
    width: rect.width,
    height: rect.height
  };
}

function drawEmptyChart(canvas, message) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;

  const { context, width, height } = prepared;
  context.clearRect(0, 0, width, height);
  context.font = "12px sans-serif";
  context.textAlign = "center";
  context.fillStyle = "#94a0b8";
  context.fillText(message, width / 2, height / 2);
}

function drawLineChart(canvas, series) {
  if (!series.length) {
    drawEmptyChart(canvas, "No trend data");
    return;
  }

  const prepared = prepareCanvas(canvas);
  if (!prepared) return;

  const { context, width, height } = prepared;
  const padding = { top: 20, right: 20, bottom: 38, left: 58 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const max = Math.max(...series.map((item) => item.value), 1);

  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#26314a";
  context.fillStyle = "#94a0b8";
  context.font = "10px sans-serif";

  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + (chartHeight / 4) * index;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();

    const value = max - (max / 4) * index;
    context.textAlign = "right";
    context.fillText(
      new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1
      }).format(value),
      padding.left - 8,
      y + 3
    );
  }

  const step = series.length > 1
    ? chartWidth / (series.length - 1)
    : chartWidth;

  context.strokeStyle = "#5ba8ff";
  context.lineWidth = 2.5;
  context.beginPath();

  series.forEach((item, index) => {
    const x = padding.left + step * index;
    const y = padding.top + chartHeight - (item.value / max) * chartHeight;

    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });

  context.stroke();

  series.forEach((item, index) => {
    const x = padding.left + step * index;
    const y = padding.top + chartHeight - (item.value / max) * chartHeight;

    context.fillStyle = "#5ba8ff";
    context.beginPath();
    context.arc(x, y, 3.5, 0, Math.PI * 2);
    context.fill();

    if (
      series.length <= 7 ||
      index === 0 ||
      index === series.length - 1 ||
      index % 2 === 0
    ) {
      context.fillStyle = "#94a0b8";
      context.textAlign = "center";
      context.fillText(
        item.label.slice(5),
        x,
        height - 14
      );
    }
  });
}

function drawBarChart(canvas, rows) {
  if (!rows.length) {
    drawEmptyChart(canvas, "No comparison data");
    return;
  }

  const prepared = prepareCanvas(canvas);
  if (!prepared) return;

  const { context, width, height } = prepared;
  const padding = { top: 16, right: 25, bottom: 24, left: 110 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const max = Math.max(...rows.map((row) => row.value), 1);
  const gap = 10;
  const barHeight = Math.max(
    14,
    (chartHeight - gap * (rows.length - 1)) / rows.length
  );

  context.clearRect(0, 0, width, height);
  context.font = "10px sans-serif";

  rows.forEach((row, index) => {
    const y = padding.top + index * (barHeight + gap);
    const barWidth = (row.value / max) * chartWidth;

    context.fillStyle = "#202940";
    context.fillRect(padding.left, y, chartWidth, barHeight);

    context.fillStyle = row.color || "#5ba8ff";
    context.fillRect(padding.left, y, barWidth, barHeight);

    context.fillStyle = "#f6f8ff";
    context.textAlign = "right";
    context.fillText(
      row.label.slice(0, 16),
      padding.left - 8,
      y + barHeight / 2 + 3
    );

    context.textAlign = "left";
    context.fillText(
      new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1
      }).format(row.value),
      Math.min(padding.left + barWidth + 7, width - 42),
      y + barHeight / 2 + 3
    );
  });
}

function renderCharts(records) {
  drawLineChart(
    $("analyticsRevenueChart"),
    dailySeries(records)
  );

  const gangRows = Object.entries(
    groupBy(records, (record) => record.group)
  )
    .map(([name, items]) => ({
      label: name,
      value: sum(items),
      color: groupColor(name)
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  drawBarChart($("analyticsGangChart"), gangRows);

  const employeeRows = Object.entries(
    groupBy(visibleEmployeeRecords(records), employeeName)
  )
    .map(([name, items]) => ({
      label: name,
      value: sum(items),
      color: "#69c8ff"
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  drawBarChart($("analyticsEmployeeChart"), employeeRows);
}

export function renderAnalytics() {
  if (!canViewAnalytics()) return;

  filteredRecords = applyDateFilter(state.records);

  calculateOverview(filteredRecords);
  renderGangAnalytics(filteredRecords);
  renderEmployeeAnalytics(filteredRecords);
  renderLeaderboards(filteredRecords);
  renderCharts(filteredRecords);

  setText(
    "analyticsFilterCount",
    `${filteredRecords.length} matching transaction${filteredRecords.length === 1 ? "" : "s"}`
  );
}

export function exportAnalyticsCsv() {
  if (!canViewAnalytics()) {
    showToast("You do not have access to analytics exports.", true);
    return;
  }

  const headers = [
    "Date",
    "Gang",
    "Buyer",
    "Amount",
    "Unit Price",
    "Total",
    "Account Used",
    "Created By",
    "Notes"
  ];

  const rows = filteredRecords.map((record) => [
    record.transactionDate || "",
    record.group || "",
    record.buyer || "",
    record.amount ?? "",
    record.unitPrice ?? "",
    record.total ?? "",
    record.accountUsed || "",
    employeeName(record),
    record.notes || ""
  ]);

  const csv = [headers, ...rows]
    .map((row) =>
      row.map((value) => {
        const text = String(value ?? "");
        return `"${text.replaceAll('"', '""')}"`;
      }).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `revenants-analytics-${todayKey()}.csv`;
  link.click();
  URL.revokeObjectURL(url);

  showToast("Analytics CSV exported.");
}

export function resetAnalyticsFilters() {
  $("analyticsDateFrom").value = "";
  $("analyticsDateTo").value = "";
  renderAnalytics();
}

export function bindAnalyticsEvents() {
  $("analyticsDateFrom")?.addEventListener("change", renderAnalytics);
  $("analyticsDateTo")?.addEventListener("change", renderAnalytics);
  $("analyticsResetFilters")?.addEventListener(
    "click",
    resetAnalyticsFilters
  );
  $("analyticsExportCsv")?.addEventListener(
    "click",
    exportAnalyticsCsv
  );

  window.addEventListener("resize", () => {
    if ($("analyticsView")?.classList.contains("active")) {
      renderCharts(filteredRecords);
    }
  });
}
