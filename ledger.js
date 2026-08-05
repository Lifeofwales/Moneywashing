import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy
} from "./firebase.js";
import { state } from "./state.js";
import {
  $,
  formatCurrency,
  formatNumber,
  safeText
} from "./ui.js";

const RUNS_COLLECTION = "successful_runs";
const FAILED_RUNS_COLLECTION = "unsuccessful_runs";

let successfulRuns = [];
let unsuccessfulRuns = [];
let stopRunsLedgerListener = null;
let stopFailedRunsLedgerListener = null;
let successfulRunsReady = false;
let unsuccessfulRunsReady = false;

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
  return normalizeAccountType(
    run.destinationAccount,
    "personal"
  );
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

  return (
    !Number.isNaN(date.getTime()) &&
    date >= start &&
    date <= end
  );
}

function startOfWeek(now) {
  const date = new Date(now);
  const day = date.getDay();

  date.setDate(
    date.getDate() + (day === 0 ? -6 : 1 - day)
  );

  date.setHours(0, 0, 0, 0);

  return date;
}

export function getFinancialLedgerSummary() {
  const gangTransactions = state.records.filter(
    (record) => transactionAccountType(record) === "gang"
  );

  const gangRuns = successfulRuns.filter(
    (run) => runAccountType(run) === "gang"
  );

  const failedRuns = unsuccessfulRuns;

  const purchasedRolls = sum(
    gangTransactions,
    "amount"
  );

  const purchasedDirtyValue = sum(
    gangTransactions,
    "total"
  );

  const successfullyWashedRolls = sum(
    gangRuns,
    "amountRolls"
  );

  const lifetimeRollsLost = sum(
    failedRuns,
    "rollsLost"
  );

  const failedRollsAttempted = sum(
    failedRuns,
    "numbersWashed"
  );

  const failedRollsReturned = sum(
    failedRuns,
    "rollsReturned"
  );

  const dirtyRollsRemaining = Math.max(
    0,
    purchasedRolls -
      successfullyWashedRolls -
      lifetimeRollsLost
  );

  const averageDirtyCost =
    purchasedRolls > 0
      ? purchasedDirtyValue / purchasedRolls
      : 0;

  const dirtyValueRemaining =
    dirtyRollsRemaining * averageDirtyCost;

  const estimatedLossValue =
    lifetimeRollsLost * averageDirtyCost;

  const gangAccountBalance = sum(
    gangRuns,
    "totalAtEnd"
  );

  const gangCutsTaken = sum(
    gangRuns,
    "cutTaken"
  );

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
    gangRuns
      .filter((run) =>
        dateInRange(run.runDate, start, end)
      )
      .reduce(
        (total, run) =>
          total + Number(run.totalAtEnd || 0),
        0
      );

  const averagePayoutPerRoll =
    successfullyWashedRolls > 0
      ? gangAccountBalance /
        successfullyWashedRolls
      : 0;

  const estimatedGangProfit =
    gangAccountBalance -
    (successfullyWashedRolls * averageDirtyCost) -
    gangCutsTaken -
    estimatedLossValue;

  const recoveryRate =
    failedRollsAttempted > 0
      ? (failedRollsReturned / failedRollsAttempted) * 100
      : 0;

  return {
    purchasedRolls,
    purchasedDirtyValue,
    successfullyWashedRolls,
    lifetimeRollsLost,
    failedRollsAttempted,
    failedRollsReturned,
    failedRunCount: failedRuns.length,
    recoveryRate,
    dirtyRollsRemaining,
    dirtyValueRemaining,
    estimatedLossValue,
    gangAccountBalance,
    lifetimeGangWashed: gangAccountBalance,
    todayDeposits: depositsForRange(
      todayStart,
      todayEnd
    ),
    weekDeposits: depositsForRange(
      weekStart,
      todayEnd
    ),
    monthDeposits: depositsForRange(
      monthStart,
      todayEnd
    ),
    averagePayoutPerRoll,
    estimatedGangProfit,
    gangRunCount: gangRuns.length,
    averageDirtyCost
  };
}

function buildInventoryTimeline(summary) {
  const events = [];

  state.records
    .filter(
      (record) =>
        transactionAccountType(record) === "gang"
    )
    .forEach((record) => {
      events.push({
        date:
          record.transactionDate ||
          record.createdAt ||
          "",
        sortValue:
          record.transactionDate ||
          record.createdAt ||
          "",
        type: "purchase",
        title: "Dirty Rolls Purchased",
        amount: Number(record.amount || 0),
        detail:
          `${record.group || "Gang"} · ${record.buyer || "Unknown buyer"}`
      });
    });

  successfulRuns
    .filter((run) => runAccountType(run) === "gang")
    .forEach((run) => {
      events.push({
        date: run.runDate || run.createdAt || "",
        sortValue: run.runDate || run.createdAt || "",
        type: "success",
        title: "Successful Gang Run",
        amount: -Number(run.amountRolls || 0),
        detail:
          `${run.washer || "Unknown washer"} · +${formatCurrency(run.totalAtEnd)}`
      });
    });

  unsuccessfulRuns.forEach((run) => {
    events.push({
      date: run.runDate || run.createdAt || "",
      sortValue: run.runDate || run.createdAt || "",
      type: "failure",
      title: "Rolls Lost",
      amount: -Number(run.rollsLost || 0),
      detail:
        `${run.washer || "Unknown washer"} · ${run.reason || "Dealer kept half"}`
    });
  });

  return events
    .sort((a, b) =>
      String(b.sortValue).localeCompare(
        String(a.sortValue)
      )
    )
    .slice(0, 12);
}

function renderInventoryTimeline(summary) {
  const container = $("dirtyInventoryTimeline");
  if (!container) return;

  const events = buildInventoryTimeline(summary);

  if (!events.length) {
    container.innerHTML =
      '<div class="empty-state">No dirty-roll activity yet.</div>';
    return;
  }

  container.innerHTML = events.map((event) => `
    <article class="ledger-timeline-item ${event.type}">
      <div class="ledger-timeline-icon">
        ${
          event.type === "purchase"
            ? "+"
            : event.type === "success"
              ? "✓"
              : "!"
        }
      </div>

      <div class="ledger-timeline-main">
        <strong>${safeText(event.title)}</strong>
        <small>
          ${safeText(event.date || "Unknown date")} ·
          ${safeText(event.detail)}
        </small>
      </div>

      <strong class="ledger-timeline-amount">
        ${event.amount > 0 ? "+" : ""}
        ${formatNumber(event.amount)}
      </strong>
    </article>
  `).join("");
}

export function renderFinancialLedger() {
  const summary = getFinancialLedgerSummary();

  const values = {
    dirtyRollsRemaining:
      formatNumber(summary.dirtyRollsRemaining),

    dirtyValueRemaining:
      formatCurrency(summary.dirtyValueRemaining),

    gangAccountBalance:
      formatCurrency(summary.gangAccountBalance),

    lifetimeGangWashed:
      formatCurrency(summary.lifetimeGangWashed),

    gangDepositsToday:
      formatCurrency(summary.todayDeposits),

    gangDepositsWeek:
      formatCurrency(summary.weekDeposits),

    gangDepositsMonth:
      formatCurrency(summary.monthDeposits),

    gangAveragePayoutPerRoll:
      formatCurrency(summary.averagePayoutPerRoll),

    gangEstimatedProfit:
      formatCurrency(summary.estimatedGangProfit),

    gangRunCount:
      formatNumber(summary.gangRunCount),

    lifetimeRollsLost:
      formatNumber(summary.lifetimeRollsLost),

    failedRunCount:
      formatNumber(summary.failedRunCount),

    failedRollsReturned:
      formatNumber(summary.failedRollsReturned),

    failedLossValue:
      formatCurrency(summary.estimatedLossValue),

    failedRecoveryRate:
      `${formatNumber(summary.recoveryRate)}%`
  };

  Object.entries(values).forEach(([id, value]) => {
    const element = $(id);

    if (element) {
      element.textContent = value;
    }
  });

  renderInventoryTimeline(summary);
}

export function startFinancialLedgerListener() {
  stopFinancialLedgerListener();

  successfulRunsReady = false;
  unsuccessfulRunsReady = false;

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

      successfulRunsReady = true;
      renderFinancialLedger();
    },
    (error) => {
      console.error(
        "Successful-runs ledger listener failed:",
        error
      );
    }
  );

  stopFailedRunsLedgerListener = onSnapshot(
    query(
      collection(db, FAILED_RUNS_COLLECTION),
      orderBy("runDate", "desc")
    ),
    (snapshot) => {
      unsuccessfulRuns = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      unsuccessfulRunsReady = true;
      renderFinancialLedger();
    },
    (error) => {
      console.error(
        "Unsuccessful-runs ledger listener failed:",
        error
      );
    }
  );
}

export function stopFinancialLedgerListener() {
  if (typeof stopRunsLedgerListener === "function") {
    stopRunsLedgerListener();
  }

  if (
    typeof stopFailedRunsLedgerListener ===
    "function"
  ) {
    stopFailedRunsLedgerListener();
  }

  stopRunsLedgerListener = null;
  stopFailedRunsLedgerListener = null;
  successfulRuns = [];
  unsuccessfulRuns = [];
  successfulRunsReady = false;
  unsuccessfulRunsReady = false;
}

export function refreshFinancialLedger() {
  renderFinancialLedger();
}
