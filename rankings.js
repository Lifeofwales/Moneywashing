import {
  db,
  doc,
  setDoc
} from "./firebase.js";
import {
  state,
  SETTINGS_COLLECTION,
  SETTINGS_DOCUMENT
} from "./state.js";
import { getSession } from "./auth.js";
import { isOwner } from "./permissions.js";
import { writeAuditLog } from "./audit.js";
import {
  $,
  safeText,
  showToast
} from "./ui.js";

export function rankingEmployeeName(record) {
  const rawName =
    record.createdBy?.discordName ||
    record.createdBy?.name ||
    record.updatedBy?.discordName ||
    record.updatedBy?.name ||
    "Legacy Records";

  return rawName === "Unknown User"
    ? "Legacy Records"
    : String(rawName).trim() || "Legacy Records";
}

export function rankingEmployeeKey(name) {
  return String(name || "Legacy Records")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function hiddenRankingEmployees() {
  return Array.isArray(state.settings.hiddenRankingEmployees)
    ? state.settings.hiddenRankingEmployees
    : [];
}

export function isEmployeeHidden(name) {
  const key = rankingEmployeeKey(name);

  return hiddenRankingEmployees().some(
    (employee) => employee.key === key
  );
}

function settingsReference() {
  return doc(
    db,
    SETTINGS_COLLECTION,
    SETTINGS_DOCUMENT
  );
}

async function saveHiddenEmployees(nextEmployees) {
  await setDoc(
    settingsReference(),
    {
      hiddenRankingEmployees: nextEmployees,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
}

export async function hideEmployeeFromRankings(name) {
  if (!isOwner()) {
    showToast("Owner access is required.", true);
    return;
  }

  const displayName =
    String(name || "Legacy Records").trim() ||
    "Legacy Records";

  const key = rankingEmployeeKey(displayName);

  if (isEmployeeHidden(displayName)) {
    showToast(`${displayName} is already hidden.`);
    return;
  }

  if (
    !window.confirm(
      `Hide ${displayName} from all employee rankings and charts? Their transaction records will remain unchanged.`
    )
  ) {
    return;
  }

  const nextEmployees = [
    ...hiddenRankingEmployees(),
    {
      key,
      name: displayName,
      hiddenAt: new Date().toISOString(),
      hiddenBy: getSession().discordName || "Owner"
    }
  ];

  try {
    await saveHiddenEmployees(nextEmployees);

    await writeAuditLog({
      action: "Employee Hidden From Rankings",
      category: "settings",
      severity: "warning",
      targetType: "ranking-employee",
      targetId: key,
      targetName: displayName,
      summary:
        `${getSession().discordName} hid ${displayName} from employee rankings.`,
      details: {
        employee: displayName,
        transactionRecordsDeleted: false
      }
    });

    showToast(`${displayName} hidden from rankings.`);
  } catch (error) {
    console.error(error);
    showToast("The employee could not be hidden.", true);
  }
}

export async function restoreEmployeeToRankings(key) {
  if (!isOwner()) {
    showToast("Owner access is required.", true);
    return;
  }

  const employee = hiddenRankingEmployees().find(
    (item) => item.key === key
  );

  if (!employee) return;

  try {
    const nextEmployees = hiddenRankingEmployees().filter(
      (item) => item.key !== key
    );

    await saveHiddenEmployees(nextEmployees);

    await writeAuditLog({
      action: "Employee Restored To Rankings",
      category: "settings",
      severity: "action",
      targetType: "ranking-employee",
      targetId: key,
      targetName: employee.name,
      summary:
        `${getSession().discordName} restored ${employee.name} to employee rankings.`,
      details: employee
    });

    showToast(`${employee.name} restored to rankings.`);
  } catch (error) {
    console.error(error);
    showToast("The employee could not be restored.", true);
  }
}

export function renderHiddenRankingEmployees() {
  const container = $("hiddenRankingEmployeesList");
  if (!container) return;

  if (!isOwner()) {
    container.innerHTML =
      '<div class="empty-state">Only the Owner can manage hidden ranking employees.</div>';
    return;
  }

  const employees = hiddenRankingEmployees();

  if (!employees.length) {
    container.innerHTML =
      '<div class="empty-state">No employees are hidden from rankings.</div>';
    return;
  }

  container.innerHTML = employees.map((employee) => `
    <article class="hidden-ranking-employee">
      <div>
        <strong>${safeText(employee.name)}</strong>
        <small>
          Hidden by ${safeText(employee.hiddenBy || "Owner")}
          ${employee.hiddenAt
            ? ` · ${safeText(new Date(employee.hiddenAt).toLocaleString())}`
            : ""}
        </small>
      </div>

      <button
        class="secondary-button"
        type="button"
        data-restore-ranking-employee="${safeText(employee.key)}"
      >
        Restore
      </button>
    </article>
  `).join("");
}

export function bindRankingManagementEvents() {
  document.addEventListener("click", (event) => {
    const hideButton = event.target.closest(
      "[data-hide-ranking-employee]"
    );

    const restoreButton = event.target.closest(
      "[data-restore-ranking-employee]"
    );

    if (hideButton) {
      hideEmployeeFromRankings(
        hideButton.dataset.hideRankingEmployee
      );
    }

    if (restoreButton) {
      restoreEmployeeToRankings(
        restoreButton.dataset.restoreRankingEmployee
      );
    }
  });
}
