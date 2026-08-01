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
import {
  $,
  safeText,
  showToast,
  formatCurrency,
  formatNumber
} from "./ui.js";

const RUNS_COLLECTION = "successful_runs";

let runs = [];
let stopRunsListener = null;
let editingRunId = null;

function session() {
  return getSession();
}

function canCreateRuns() {
  return can("createRuns");
}

function canManageRuns() {
  return can("manageRuns");
}

function actorPayload() {
  return {
    uid: session().user.uid,
    name: session().discordName || "Discord User",
    role: session().role || "viewer"
  };
}

export function applyRunsPermissions() {
  const view = can("viewRuns");
  const create = canCreateRuns();

  $("successfulRunsNavButton")?.classList.toggle("hidden", !view);
  $("successfulRunForm")?.classList.toggle("hidden", !create);

  if (!view && $("successfulRunsView")?.classList.contains("active")) {
    document.querySelector('[data-view="dashboard"]')?.click();
  }

  renderRuns();
}

export function startRunsListener() {
  stopRuns();

  stopRunsListener = onSnapshot(
    query(
      collection(db, RUNS_COLLECTION),
      orderBy("runDate", "desc")
    ),
    (snapshot) => {
      runs = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      renderRuns();
      renderRunStats();
    },
    (error) => {
      console.error("Successful runs listener failed:", error);
      showToast("Could not load successful runs.", true);
    }
  );

  return stopRunsListener;
}

export function stopRuns() {
  if (typeof stopRunsListener === "function") {
    stopRunsListener();
  }

  stopRunsListener = null;
  runs = [];
}

function filteredRuns() {
  const search = ($("successfulRunsSearch")?.value || "")
    .trim()
    .toLowerCase();

  const route = $("successfulRunsRouteFilter")?.value || "all";

  return runs.filter((run) => {
    const haystack = [
      run.washer,
      run.route,
      run.mistakes,
      run.createdBy?.name
    ].join(" ").toLowerCase();

    return (
      (!search || haystack.includes(search)) &&
      (route === "all" || run.route === route)
    );
  });
}

function renderRunStats() {
  const totalRuns = runs.length;
  const totalRolls = runs.reduce(
    (sum, run) => sum + Number(run.amountRolls || 0),
    0
  );
  const totalCuts = runs.reduce(
    (sum, run) => sum + Number(run.cutTaken || 0),
    0
  );
  const totalEnd = runs.reduce(
    (sum, run) => sum + Number(run.totalAtEnd || 0),
    0
  );

  $("successfulRunsCount").textContent = formatNumber(totalRuns);
  $("successfulRunsRolls").textContent = formatNumber(totalRolls);
  $("successfulRunsCuts").textContent = formatCurrency(totalCuts);
  $("successfulRunsEndingTotal").textContent = formatCurrency(totalEnd);
}

function resetRunForm() {
  editingRunId = null;
  $("successfulRunForm")?.reset();
  $("successfulRunId").value = "";
  $("successfulRunDate").value =
    new Date().toISOString().slice(0, 10);
  $("successfulRunSaveButton").textContent = "Save Successful Run";
  $("successfulRunCancelEdit").classList.add("hidden");
}

async function saveRun(event) {
  event.preventDefault();

  if (!canCreateRuns()) {
    showToast("Your role cannot submit successful runs.", true);
    return;
  }

  const payload = {
    washer: $("successfulRunWasher").value.trim(),
    amountRolls:
      Number($("successfulRunAmountRolls").value) || 0,
    route: $("successfulRunRoute").value,
    mistakes: $("successfulRunMistakes").value.trim(),
    cutTaken:
      Number($("successfulRunCutTaken").value) || 0,
    totalAtEnd:
      Number($("successfulRunTotalAtEnd").value) || 0,
    runDate: $("successfulRunDate").value,
    updatedAt: new Date().toISOString(),
    updatedBy: actorPayload()
  };

  if (
    !payload.washer ||
    payload.amountRolls < 0 ||
    payload.cutTaken < 0 ||
    payload.totalAtEnd < 0 ||
    !payload.runDate
  ) {
    showToast("Complete all required run fields.", true);
    return;
  }

  try {
    if (editingRunId) {
      if (!canManageRuns()) {
        showToast("Manager access is required to edit runs.", true);
        return;
      }

      const previous = runs.find((run) => run.id === editingRunId);

      await updateDoc(
        doc(db, RUNS_COLLECTION, editingRunId),
        payload
      );

      await writeAuditLog({
        action: "Successful Run Updated",
        category: "general",
        severity: "action",
        targetType: "successful-run",
        targetId: editingRunId,
        targetName: payload.washer,
        summary:
          `${session().discordName} updated a successful run for ${payload.washer}.`,
        details: {
          before: previous || null,
          after: payload
        }
      });

      showToast("Successful run updated.");
    } else {
      const reference = await addDoc(
        collection(db, RUNS_COLLECTION),
        {
          ...payload,
          createdAt: serverTimestamp(),
          createdAtMs: Date.now(),
          createdBy: actorPayload()
        }
      );

      await writeAuditLog({
        action: "Successful Run Created",
        category: "general",
        severity: "action",
        targetType: "successful-run",
        targetId: reference.id,
        targetName: payload.washer,
        summary:
          `${session().discordName} recorded a successful ${payload.route} run for ${payload.washer}.`,
        details: payload
      });

      await sendDiscordNotification("run", {
        washer: payload.washer,
        amountRolls: payload.amountRolls,
        route: payload.route,
        mistakes: payload.mistakes || "None",
        cutTaken: payload.cutTaken,
        totalAtEnd: payload.totalAtEnd,
        runDate: payload.runDate
      });

      showToast("Successful run saved.");
    }

    resetRunForm();
  } catch (error) {
    console.error(error);
    showToast("Successful run could not be saved.", true);
  }
}

function editRun(id) {
  if (!canManageRuns()) {
    showToast("Manager access is required.", true);
    return;
  }

  const run = runs.find((item) => item.id === id);
  if (!run) return;

  editingRunId = id;
  $("successfulRunId").value = id;
  $("successfulRunWasher").value = run.washer || "";
  $("successfulRunAmountRolls").value = run.amountRolls ?? 0;
  $("successfulRunRoute").value = run.route || "Liquor";
  $("successfulRunMistakes").value = run.mistakes || "";
  $("successfulRunCutTaken").value = run.cutTaken ?? 0;
  $("successfulRunTotalAtEnd").value = run.totalAtEnd ?? 0;
  $("successfulRunDate").value = run.runDate || "";
  $("successfulRunSaveButton").textContent = "Save Changes";
  $("successfulRunCancelEdit").classList.remove("hidden");
  $("successfulRunWasher").focus();
}

async function deleteRun(id) {
  if (!canManageRuns()) {
    showToast("Manager access is required.", true);
    return;
  }

  const run = runs.find((item) => item.id === id);
  if (!run) return;

  if (!window.confirm(`Delete the run for "${run.washer}"?`)) {
    return;
  }

  try {
    await deleteDoc(doc(db, RUNS_COLLECTION, id));

    await writeAuditLog({
      action: "Successful Run Deleted",
      category: "general",
      severity: "warning",
      targetType: "successful-run",
      targetId: id,
      targetName: run.washer,
      summary:
        `${session().discordName} deleted a successful run for ${run.washer}.`,
      details: run
    });

    showToast("Successful run deleted.");
  } catch (error) {
    console.error(error);
    showToast("Successful run could not be deleted.", true);
  }
}

function renderRuns() {
  const container = $("successfulRunsList");
  const count = $("successfulRunsResultCount");

  if (!container || !count) return;

  const visible = filteredRuns();

  count.textContent =
    `${visible.length} run${visible.length === 1 ? "" : "s"}`;

  if (!visible.length) {
    container.innerHTML =
      '<div class="empty-state">No successful runs match your filters.</div>';
    return;
  }

  container.innerHTML = visible.map((run) => `
    <article class="successful-run-card">
      <div class="successful-run-heading">
        <div>
          <span class="operations-tag">${safeText(run.route)}</span>
          <span class="operations-tag">${safeText(run.runDate)}</span>
        </div>

        ${canManageRuns() ? `
          <div class="successful-run-actions">
            <button data-run-edit="${run.id}">Edit</button>
            <button class="danger-action" data-run-delete="${run.id}">
              Delete
            </button>
          </div>
        ` : ""}
      </div>

      <h4>${safeText(run.washer)}</h4>

      <div class="successful-run-grid">
        <div>
          <span>Amount</span>
          <strong>${formatNumber(run.amountRolls)} Rolls</strong>
        </div>

        <div>
          <span>Cut Taken</span>
          <strong>${formatCurrency(run.cutTaken)}</strong>
        </div>

        <div>
          <span>Total at End</span>
          <strong>${formatCurrency(run.totalAtEnd)}</strong>
        </div>

        <div>
          <span>Submitted By</span>
          <strong>${safeText(run.createdBy?.name || "Unknown")}</strong>
        </div>
      </div>

      <div class="successful-run-mistakes">
        <span>Mistakes</span>
        <p>${safeText(run.mistakes || "None")}</p>
      </div>
    </article>
  `).join("");
}

export function bindRunsEvents() {
  $("successfulRunForm")?.addEventListener("submit", saveRun);
  $("successfulRunCancelEdit")?.addEventListener(
    "click",
    resetRunForm
  );

  $("successfulRunsSearch")?.addEventListener("input", renderRuns);
  $("successfulRunsRouteFilter")?.addEventListener(
    "change",
    renderRuns
  );

  document.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-run-edit]");
    const deleteButton = event.target.closest("[data-run-delete]");

    if (editButton) {
      editRun(editButton.dataset.runEdit);
    }

    if (deleteButton) {
      deleteRun(deleteButton.dataset.runDelete);
    }
  });

  resetRunForm();
}
