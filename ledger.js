import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy
} from "./firebase.js";
import { state } from "./state.js";
import { $, formatCurrency, formatNumber } from "./ui.js";

const RUNS_COLLECTION = "successful_runs";

let successfulRuns = [];
let stopRunsLedgerListener = null;

function normalizeAccountType(value, fallback = "gang") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("personal")) return "personal";
  if (normalized.includes("gang")) return "gang";
  return fallback;
}

function transactionAccountType(record) {
  return normalizeAccountType(record.accountType, "gang");
}

function runAccountType(run) {
  return normalizeAccountType(run.destinationAccount, "personal");
}

function sum(items, field) {
  return items.reduce(
    (total, item) => total + Number(item[field] || 0),
    0
  );
}

function dateInRange(dateValue, start, end) {
  if (!dateValue) return false;
  const date = new Date(`${dateValue}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date >= start && date <= end;
}

function startOfWeek(now) {
  const date = new Date(now);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  date.setHours(0, 0, 0, 0);
  return date;
}

export function getFinancialLedgerSummary() {
  const transactions = state.records.filter(
    (record) => transactionAccountType(record) === "gang"
  );

  const runs = successfulRuns.filter(
    (run) => runAccountType(run) === "gang"
  );

  const purchasedRolls = sum(transactions, "amount");
  const purchasedDirtyValue = sum(transactions, "total");
  const washedRolls = sum(runs, "amountRolls");

  const dirtyRollsRemaining = Math.max(
    0,
    purchasedRolls - washedRolls
  );

  const averageDirtyCost =
    purchasedRolls > 0
      ? purchasedDirtyValue / purchasedRolls
      : 0;

  const dirtyValueRemaining =
    dirtyRollsRemaining * averageDirtyCost;

  const gangAccountBalance = sum(runs, "totalAtEnd");
  const gangCutsTaken = sum(runs, "cutTaken");

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const weekStart = startOfWeek(now);
  const monthStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  );

  const depositsForRange = (start, end) =>
    runs
      .filter((run) => dateInRange(run.runDate, start, end))
      .reduce(
        (total, run) => total + Number(run.totalAtEnd || 0),
        0
      );

  const averagePayoutPerRoll =
    washedRolls > 0
      ? gangAccountBalance / washedRolls
      : 0;

  const estimatedGangProfit =
    gangAccountBalance -
    (washedRolls * averageDirtyCost) -
    gangCutsTaken;

  return {
    purchasedRolls,
    purchasedDirtyValue,
    washedRolls,
    dirtyRollsRemaining,
    dirtyValueRemaining,
    gangAccountBalance,
    lifetimeGangWashed: gangAccountBalance,
    todayDeposits: depositsForRange(todayStart, todayEnd),
    weekDeposits: depositsForRange(weekStart, todayEnd),
    monthDeposits: depositsForRange(monthStart, todayEnd),
    averagePayoutPerRoll,
    estimatedGangProfit,
    gangRunCount: runs.length
  };
}

export function renderFinancialLedger() {
  const summary = getFinancialLedgerSummary();

  const values = {
    dirtyRollsRemaining: formatNumber(summary.dirtyRollsRemaining),
    dirtyValueRemaining: formatCurrency(summary.dirtyValueRemaining),
    gangAccountBalance: formatCurrency(summary.gangAccountBalance),
    lifetimeGangWashed: formatCurrency(summary.lifetimeGangWashed),
    gangDepositsToday: formatCurrency(summary.todayDeposits),
    gangDepositsWeek: formatCurrency(summary.weekDeposits),
    gangDepositsMonth: formatCurrency(summary.monthDeposits),
    gangAveragePayoutPerRoll:
      formatCurrency(summary.averagePayoutPerRoll),
    gangEstimatedProfit: formatCurrency(summary.estimatedGangProfit),
    gangRunCount: formatNumber(summary.gangRunCount)
  };

  Object.entries(values).forEach(([id, value]) => {
    const element = $(id);
    if (element) element.textContent = value;
  });
}

export function startFinancialLedgerListener() {
  stopFinancialLedgerListener();

  stopRunsLedgerListener = onSnapshot(
    query(
      collection(db, RUNS_COLLECTION),
      orderBy("runDate", "desc")
    ),
    (snapshot) => {
      successfulRuns = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));
      renderFinancialLedger();
    },
    (error) => {
      console.error("Financial ledger listener failed:", error);
    }
  );
}

export function stopFinancialLedgerListener() {
  if (typeof stopRunsLedgerListener === "function") {
    stopRunsLedgerListener();
  }
  stopRunsLedgerListener = null;
  successfulRuns = [];
}

export function refreshFinancialLedger() {
  renderFinancialLedger();
}
