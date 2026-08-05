import {
  db,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "./firebase.js";
import { getSession } from "./auth.js";
import { can } from "./permissions.js";
import { writeAuditLog } from "./audit.js";
import { sendDiscordNotification } from "./discord-integration.js";
import { refreshFinancialLedger } from "./ledger.js";
import {
  $,
  safeText,
  showToast,
  formatNumber,
  formatCurrency
} from "./ui.js";

const FAILED_RUNS_COLLECTION = "unsuccessful_runs";

let failedRuns = [];
let stopFailedRunsListener = null;
let editingFailedRunId = null;

function session() {
  return getSession();
}

function canCreateFailedRuns() {
  return can("createFailedRuns");
}

function canManageFailedRuns() {
  return can("manageFailedRuns");
}

function actorPayload() {
  return {
    uid: session().user.uid,
    name: session().discordName || "Discord User",
    role: session().role || "viewer"
  };
}

function calculateReturned(attempted, lost) {
  return Math.max(0, Number(attempted || 0) - Number(lost || 0));
}

export function applyFailedRunsPermissions() {
  const view = can("viewFailedRuns");
  const create = canCreateFailedRuns();

  $("unsuccessfulRunsNavButton")?.classList.toggle("hidden", !view);
  $("unsuccessfulRunForm")?.classList.toggle("hidden", !create);

  if (
    !view &&
    $("unsuccessfulRunsView")?.classList.contains("active")
  ) {
    document.querySelector('[data-view="dashboard"]')?.click();
  }

  renderFailedRuns();
}

export function startFailedRunsListener() {
  stopFailedRuns();

  stopFailedRunsListener = onSnapshot(
    query(
      collection(db, FAILED_RUNS_COLLECTION),
      orderBy("runDate", "desc")
    ),
    (snapshot) => {
      failedRuns = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      renderFailedRuns();
      renderFailedRunStats();
      refreshFinancialLedger();
    },
    (error) => {
      console.error("Unsuccessful runs listener failed:", error);
      showToast("Could not load unsuccessful runs.", true);
    }
  );

  return stopFailedRunsListener;
}

export function stopFailedRuns() {
  if (typeof stopFailedRunsListener === "function") {
    stopFailedRunsListener();
  }

  stopFailedRunsListener = null;
  failedRuns = [];
}

function filteredFailedRuns() {
  const search = ($("unsuccessfulRunsSearch")?.value || "")
    .trim()
    .toLowerCase();

  return failedRuns.filter((run) => {
    const haystack = [
      run.washer,
      run.reason,
      run.notes,
      run.createdBy?.name
    ].join(" ").toLowerCase();

    return !search || haystack.includes(search);
  });
}

function renderFailedRunStats() {
  const totalRuns = failedRuns.length;
  const attempted = failedRuns.reduce(
    (sum, run) => sum + Number(run.numbersWashed || 0),
    0
  );
  const lost = failedRuns.reduce(
    (sum, run) => sum + Number(run.rollsLost || 0),
    0
  );
  const returned = failedRuns.reduce(
    (sum, run) => sum + Number(run.rollsReturned || 0),
    0
  );

  $("unsuccessfulRunsCount").textContent = formatNumber(totalRuns);
  $("unsuccessfulRunsAttempted").textContent = formatNumber(attempted);
  $("unsuccessfulRunsLost").textContent = formatNumber(lost);
  $("unsuccessfulRunsReturned").textContent = formatNumber(returned);
}

function updateReturnedPreview() {
  const attempted =
    Number($("unsuccessfulRunNumbersWashed")?.value) || 0;
  const lost =
    Number($("unsuccessfulRunRollsLost")?.value) || 0;

  const returned = calculateReturned(attempted, lost);

  $("unsuccessfulRunRollsReturned").value = returned;
  $("unsuccessfulRunReturnedPreview").textContent =
    `${formatNumber(returned)} rolls returned`;
}

function resetFailedRunForm() {
  editingFailedRunId = null;
  $("unsuccessfulRunForm")?.reset();
  $("unsuccessfulRunId").value = "";
  $("unsuccessfulRunReason").value = "Dealer kept half";
  $("unsuccessfulRunDate").value =
    new Date().toISOString().slice(0, 10);
  $("unsuccessfulRunRollsReturned").value = 0;
  $("unsuccessfulRunReturnedPreview").textContent =
    "0 rolls returned";
  $("unsuccessfulRunSaveButton").textContent =
    "Save Unsuccessful Run";
  $("unsuccessfulRunCancelEdit").classList.add("hidden");
}

async function saveFailedRun(event) {
  event.preventDefault();

  if (!canCreateFailedRuns()) {
    showToast(
      "Your role cannot submit unsuccessful runs.",
      true
    );
    return;
  }

  const numbersWashed =
    Number($("unsuccessfulRunNumbersWashed").value) || 0;

  const rollsLost =
    Number($("unsuccessfulRunRollsLost").value) || 0;

  if (
    numbersWashed <= 0 ||
    rollsLost < 0 ||
    rollsLost > numbersWashed
  ) {
    showToast(
      "Rolls lost must be between 0 and the number washed.",
      true
    );
    return;
  }

  const payload = {
    washer: $("unsuccessfulRunWasher").value.trim(),
    numbersWashed,
    rollsLost,
    rollsReturned: calculateReturned(
      numbersWashed,
      rollsLost
    ),
    reason:
      $("unsuccessfulRunReason").value.trim() ||
      "Dealer kept half",
    runDate: $("unsuccessfulRunDate").value,
    notes: $("unsuccessfulRunNotes").value.trim(),
    accountType: "gang",
    updatedAt: new Date().toISOString(),
    updatedBy: actorPayload()
  };

  if (!payload.washer || !payload.runDate) {
    showToast("Complete all required fields.", true);
    return;
  }

  try {
    if (editingFailedRunId) {
      if (!canManageFailedRuns()) {
        showToast("Manager access is required.", true);
        return;
      }

      const previous = failedRuns.find(
        (run) => run.id === editingFailedRunId
      );

      await updateDoc(
        doc(
          db,
          FAILED_RUNS_COLLECTION,
          editingFailedRunId
        ),
        payload
      );

      await writeAuditLog({
        action: "Unsuccessful Run Updated",
        category: "general",
        severity: "warning",
        targetType: "unsuccessful-run",
        targetId: editingFailedRunId,
        targetName: payload.washer,
        summary:
          `${session().discordName} updated an unsuccessful run for ${payload.washer}.`,
        details: {
          before: previous || null,
          after: payload
        }
      });

      showToast("Unsuccessful run updated.");
    } else {
      const reference = await addDoc(
        collection(db, FAILED_RUNS_COLLECTION),
        {
          ...payload,
          createdAt: serverTimestamp(),
          createdAtMs: Date.now(),
          createdBy: actorPayload()
        }
      );

      await writeAuditLog({
        action: "Unsuccessful Run Created",
        category: "general",
        severity: "warning",
        targetType: "unsuccessful-run",
        targetId: reference.id,
        targetName: payload.washer,
        summary:
          `${session().discordName} recorded an unsuccessful run for ${payload.washer}.`,
        details: payload
      });

      await sendDiscordNotification("failed-run", {
        washer: payload.washer,
        numbersWashed: payload.numbersWashed,
        rollsLost: payload.rollsLost,
        rollsReturned: payload.rollsReturned,
        reason: payload.reason,
        runDate: payload.runDate,
        notes: payload.notes || "None"
      });

      showToast("Unsuccessful run saved.");
    }

    refreshFinancialLedger();
    resetFailedRunForm();
  } catch (error) {
    console.error(error);
    showToast(
      "The unsuccessful run could not be saved.",
      true
    );
  }
}

function editFailedRun(id) {
  if (!canManageFailedRuns()) {
    showToast("Manager access is required.", true);
    return;
  }

  const run = failedRuns.find((item) => item.id === id);
  if (!run) return;

  editingFailedRunId = id;
  $("unsuccessfulRunId").value = id;
  $("unsuccessfulRunWasher").value = run.washer || "";
  $("unsuccessfulRunNumbersWashed").value =
    run.numbersWashed ?? 0;
  $("unsuccessfulRunRollsLost").value =
    run.rollsLost ?? 0;
  $("unsuccessfulRunRollsReturned").value =
    run.rollsReturned ?? 0;
  $("unsuccessfulRunReason").value =
    run.reason || "Dealer kept half";
  $("unsuccessfulRunDate").value = run.runDate || "";
  $("unsuccessfulRunNotes").value = run.notes || "";
  $("unsuccessfulRunSaveButton").textContent =
    "Save Changes";
  $("unsuccessfulRunCancelEdit").classList.remove("hidden");
  updateReturnedPreview();
  $("unsuccessfulRunWasher").focus();
}

async function deleteFailedRun(id) {
  if (!canManageFailedRuns()) {
    showToast("Manager access is required.", true);
    return;
  }

  const run = failedRuns.find((item) => item.id === id);
  if (!run) return;

  if (
    !window.confirm(
      `Delete the unsuccessful run for "${run.washer}"?`
    )
  ) {
    return;
  }

  try {
    await deleteDoc(
      doc(db, FAILED_RUNS_COLLECTION, id)
    );

    await writeAuditLog({
      action: "Unsuccessful Run Deleted",
      category: "general",
      severity: "critical",
      targetType: "unsuccessful-run",
      targetId: id,
      targetName: run.washer,
      summary:
        `${session().discordName} deleted an unsuccessful run for ${run.washer}.`,
      details: run
    });

    refreshFinancialLedger();
    showToast("Unsuccessful run deleted.");
  } catch (error) {
    console.error(error);
    showToast(
      "The unsuccessful run could not be deleted.",
      true
    );
  }
}

function renderFailedRuns() {
  const container = $("unsuccessfulRunsList");
  const count = $("unsuccessfulRunsResultCount");

  if (!container || !count) return;

  const visible = filteredFailedRuns();

  count.textContent =
    `${visible.length} run${visible.length === 1 ? "" : "s"}`;

  if (!visible.length) {
    container.innerHTML =
      '<div class="empty-state">No unsuccessful runs match your search.</div>';
    return;
  }

  container.innerHTML = visible.map((run) => `
    <article class="unsuccessful-run-card">
      <div class="successful-run-heading">
        <div>
          <span class="operations-tag">Gang Account</span>
          <span class="operations-tag">${safeText(run.runDate)}</span>
        </div>

        ${canManageFailedRuns() ? `
          <div class="successful-run-actions">
            <button data-failed-run-edit="${run.id}">Edit</button>
            <button
              class="danger-action"
              data-failed-run-delete="${run.id}"
            >
              Delete
            </button>
          </div>
        ` : ""}
      </div>

      <h4>${safeText(run.washer)}</h4>

      <div class="successful-run-grid">
        <div>
          <span>Attempted</span>
          <strong>${formatNumber(run.numbersWashed)} Rolls</strong>
        </div>

        <div>
          <span>Lost</span>
          <strong>${formatNumber(run.rollsLost)} Rolls</strong>
        </div>

        <div>
          <span>Returned</span>
          <strong>${formatNumber(run.rollsReturned)} Rolls</strong>
        </div>

        <div>
          <span>Submitted By</span>
          <strong>${safeText(run.createdBy?.name || "Unknown")}</strong>
        </div>
      </div>

      <div class="successful-run-mistakes">
        <span>Reason</span>
        <p>${safeText(run.reason || "Dealer kept half")}</p>
      </div>

      ${run.notes ? `
        <div class="successful-run-mistakes">
          <span>Notes</span>
          <p>${safeText(run.notes)}</p>
        </div>
      ` : ""}
    </article>
  `).join("");
}

export function bindFailedRunsEvents() {
  $("unsuccessfulRunForm")?.addEventListener(
    "submit",
    saveFailedRun
  );

  $("unsuccessfulRunCancelEdit")?.addEventListener(
    "click",
    resetFailedRunForm
  );

  $("unsuccessfulRunNumbersWashed")?.addEventListener(
    "input",
    updateReturnedPreview
  );

  $("unsuccessfulRunRollsLost")?.addEventListener(
    "input",
    updateReturnedPreview
  );

  $("unsuccessfulRunsSearch")?.addEventListener(
    "input",
    renderFailedRuns
  );

  document.addEventListener("click", (event) => {
    const editButton = event.target.closest(
      "[data-failed-run-edit]"
    );

    const deleteButton = event.target.closest(
      "[data-failed-run-delete]"
    );

    if (editButton) {
      editFailedRun(editButton.dataset.failedRunEdit);
    }

    if (deleteButton) {
      deleteFailedRun(deleteButton.dataset.failedRunDelete);
    }
  });

  resetFailedRunForm();
}
