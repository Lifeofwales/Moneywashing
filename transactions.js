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
import { state, TRANSACTIONS_COLLECTION } from "./state.js";
import { getSession } from "./auth.js";
import { transactionPermissions } from "./permissions.js";
import { writeAuditLog } from "./audit.js";
import { renderAnalytics } from "./analytics.js";
import { sendDiscordNotification } from "./discord-integration.js";
import {
  $,
  showView,
  showToast,
  formatCurrency,
  formatNumber,
  safeText,
  groupColor,
  updatePriceForSelectedGang
} from "./ui.js";


export function applyTransactionPermissions() {
  const access = transactionPermissions();

  $("newEntryNavButton")?.classList.toggle("hidden", !access.create);
  $("quickAddButton")?.classList.toggle("hidden", !access.create);

  const form = $("entryForm");
  if (form) {
    form.classList.toggle("permission-locked", !access.create);
    form.querySelectorAll("input, select, textarea, button").forEach((element) => {
      element.disabled = !access.create;
    });
  }

  renderTable();
  renderRecent();
}

export function startTransactionListener() {
  const recordsQuery = query(
    collection(db, TRANSACTIONS_COLLECTION),
    orderBy("transactionDate", "desc")
  );

  return onSnapshot(recordsQuery, (snapshot) => {
    state.records = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));
    renderAll();
  }, (error) => {
    console.error(error);
    showToast("Could not load transaction records.", true);
  });
}

export function calculateTotal() {
  const amount = Number($("amount").value) || 0;
  const unitPrice = Number($("unitPrice").value) || 0;
  $("calculatedTotal").textContent = formatCurrency(amount * unitPrice);
}

export function resetTransactionForm() {
  $("entryForm").reset();
  state.editingRecordId = null;
  $("recordId").value = "";
  $("transactionDate").value = new Date().toISOString().slice(0, 10);
  $("formHeading").textContent = "New Transaction";
  $("saveButton").textContent = "Save Entry";
  $("cancelEditButton").classList.add("hidden");
  updatePriceForSelectedGang(true);
  calculateTotal();
}

export async function saveEntry(event) {
  event.preventDefault();

  const access = transactionPermissions();

  if (state.editingRecordId ? !access.edit : !access.create) {
    showToast(
      state.editingRecordId
        ? "Your role cannot edit transactions."
        : "Your role cannot add transactions.",
      true
    );
    return;
  }

  const amount = Number($("amount").value);
  const unitPrice = Number($("unitPrice").value);

  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
    showToast("Enter a valid amount and unit price.", true);
    return;
  }

  const session = getSession();

  if (!session.user) {
    showToast("Sign in before saving an entry.", true);
    return;
  }

  const entry = {
    group: $("group").value,
    buyer: $("buyer").value.trim(),
    amount,
    unitPrice,
    total: amount * unitPrice,
    accountUsed: $("accountUsed").value.trim(),
    transactionDate: $("transactionDate").value,
    notes: $("notes").value.trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: {
      uid: session.user.uid,
      discordName: session.discordName
    }
  };

  try {
    if (state.editingRecordId) {
      const previousRecord = state.records.find(
        (item) => item.id === state.editingRecordId
      );

      await updateDoc(
        doc(db, TRANSACTIONS_COLLECTION, state.editingRecordId),
        entry
      );

      await writeAuditLog({
        action: "Transaction Updated",
        category: "transaction",
        severity: "action",
        targetType: "transaction",
        targetId: state.editingRecordId,
        targetName: entry.buyer,
        summary: `${session.discordName} updated a ${entry.group} transaction for ${entry.buyer}.`,
        details: {
          before: previousRecord || null,
          after: entry
        }
      });

      showToast("Entry updated.");
    } else {
      const createdReference = await addDoc(
        collection(db, TRANSACTIONS_COLLECTION),
        {
          ...entry,
          createdAt: serverTimestamp(),
          createdBy: {
            uid: session.user.uid,
            discordName: session.discordName
          }
        }
      );

      await writeAuditLog({
        action: "Transaction Created",
        category: "transaction",
        severity: "action",
        targetType: "transaction",
        targetId: createdReference.id,
        targetName: entry.buyer,
        summary: `${session.discordName} created a ${entry.group} transaction for ${entry.buyer}.`,
        details: {
          amount: entry.amount,
          unitPrice: entry.unitPrice,
          total: entry.total,
          group: entry.group
        }
      });

      await sendDiscordNotification("transaction", {
        gang: entry.group,
        buyer: entry.buyer,
        amount: entry.amount,
        unitPrice: entry.unitPrice,
        total: entry.total,
        accountUsed: entry.accountUsed || "Not provided",
        transactionDate: entry.transactionDate,
        notes: entry.notes || "None"
      });

      showToast("Entry saved.");
    }

    resetTransactionForm();
    showView("records");
  } catch (error) {
    console.error(error);
    showToast("The entry could not be saved.", true);
  }
}

export function editRecord(id) {
  if (!transactionPermissions().edit) {
    showToast("Your role cannot edit transactions.", true);
    return;
  }

  const record = state.records.find((item) => item.id === id);
  if (!record) return;

  state.editingRecordId = record.id;
  $("recordId").value = record.id;
  $("group").value = record.group;
  $("buyer").value = record.buyer || "";
  $("amount").value = record.amount ?? "";
  $("unitPrice").value = record.unitPrice ?? "";
  $("accountUsed").value = record.accountUsed || "";
  $("transactionDate").value = record.transactionDate || "";
  $("notes").value = record.notes || "";
  $("formHeading").textContent = "Edit Transaction";
  $("saveButton").textContent = "Update Entry";
  $("cancelEditButton").classList.remove("hidden");
  calculateTotal();
  showView("new-entry");
}

export async function removeRecord(id) {
  if (!transactionPermissions().delete) {
    showToast("Your role cannot delete transactions.", true);
    return;
  }

  if (!window.confirm("Delete this entry? This cannot be undone.")) return;

  try {
    const record = state.records.find((item) => item.id === id);

    await deleteDoc(doc(db, TRANSACTIONS_COLLECTION, id));

    await writeAuditLog({
      action: "Transaction Deleted",
      category: "transaction",
      severity: "warning",
      targetType: "transaction",
      targetId: id,
      targetName: record?.buyer || "Unknown Transaction",
      summary: `${getSession().discordName} deleted a transaction${record?.buyer ? ` for ${record.buyer}` : ""}.`,
      details: record || {}
    });

    showToast("Entry deleted.");
  } catch (error) {
    console.error(error);
    showToast("The entry could not be deleted.", true);
  }
}

function filteredRecords() {
  const search = $("searchInput").value.trim().toLowerCase();
  const selectedGroup = $("groupFilter").value;

  return state.records.filter((record) => {
    const matchesGroup = selectedGroup === "all" || record.group === selectedGroup;
    const haystack = `${record.buyer || ""} ${record.accountUsed || ""} ${record.notes || ""}`.toLowerCase();
    return matchesGroup && (!search || haystack.includes(search));
  });
}

export function renderAll() {
  renderStats();
  renderGroupBreakdown();
  renderRecent();
  renderTable();
  renderAnalytics();

  const access = transactionPermissions();
  $("newEntryNavButton")?.classList.toggle("hidden", !access.create);
  $("quickAddButton")?.classList.toggle("hidden", !access.create);
}

function renderStats() {
  const totalAmount = state.records.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const totalValue = state.records.reduce((sum, record) => sum + Number(record.total || 0), 0);
  const gangTotals = state.records.reduce((totals, record) => {
    totals[record.group] = (totals[record.group] || 0) + Number(record.total || 0);
    return totals;
  }, {});
  const topGang = Object.entries(gangTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  $("totalAmount").textContent = formatNumber(totalAmount);
  $("totalValue").textContent = formatCurrency(totalValue);
  $("transactionCount").textContent = state.records.length;
  $("topGroup").textContent = topGang;
}

function renderGroupBreakdown() {
  const container = $("groupBreakdown");
  const overall = state.records.reduce((sum, record) => sum + Number(record.total || 0), 0);

  container.innerHTML = state.settings.gangs.map((gang) => {
    const gangRecords = state.records.filter((record) => record.group === gang.name);
    const total = gangRecords.reduce((sum, record) => sum + Number(record.total || 0), 0);
    const percentage = overall ? Math.round((total / overall) * 100) : 0;

    return `<div class="group-row">
      <div class="group-row-top">
        <strong>${safeText(gang.name)}</strong>
        <span>${formatCurrency(total)}</span>
      </div>
      <div class="progress">
        <span style="width:${percentage}%;background:${gang.accent}"></span>
      </div>
      <small>${gangRecords.length} entries · ${percentage}% of total · ${formatCurrency(gang.unitPrice)} per unit</small>
    </div>`;
  }).join("");
}

function renderRecent() {
  const container = $("recentEntries");

  if (!state.records.length) {
    container.innerHTML = '<div class="empty-state">No entries have been saved yet.</div>';
    return;
  }

  const canEdit = transactionPermissions().edit;

  container.innerHTML = state.records.slice(0, 5).map((record) => `
    <${canEdit ? "button" : "div"}
      class="recent-item ${canEdit ? "" : "recent-item-readonly"}"
      ${canEdit ? `data-edit-id="${record.id}"` : ""}
    >
      <span class="group-badge" style="--badge-color:${groupColor(record.group)}">${safeText(record.group)}</span>
      <span>
        <strong>${safeText(record.buyer)}</strong>
        <small>${safeText(record.transactionDate)}</small>
      </span>
      <strong>${formatCurrency(record.total)}</strong>
    </${canEdit ? "button" : "div"}>
  `).join("");
}

function renderTable() {
  const body = $("recordsTableBody");
  const visibleRecords = filteredRecords();

  $("emptyRecords").classList.toggle("hidden", visibleRecords.length > 0);

  body.innerHTML = visibleRecords.map((record) => `
    <tr>
      <td>${safeText(record.transactionDate)}</td>
      <td><span class="group-badge" style="--badge-color:${groupColor(record.group)}">${safeText(record.group)}</span></td>
      <td>
        <strong>${safeText(record.buyer)}</strong>
        ${record.createdBy?.discordName ? `<small class="table-note">Added by ${safeText(record.createdBy.discordName)}</small>` : ""}
        ${record.notes ? `<small class="table-note">${safeText(record.notes)}</small>` : ""}
      </td>
      <td>${formatNumber(record.amount)}</td>
      <td>${formatCurrency(record.unitPrice)}</td>
      <td><strong>${formatCurrency(record.total)}</strong></td>
      <td>${safeText(record.accountUsed || "—")}</td>
      <td>
        ${transactionPermissions().edit || transactionPermissions().delete ? `
          <div class="table-actions">
            ${transactionPermissions().edit
              ? `<button data-edit-id="${record.id}">Edit</button>`
              : ""}
            ${transactionPermissions().delete
              ? `<button class="danger-action" data-delete-id="${record.id}">Delete</button>`
              : ""}
          </div>
        ` : '<span class="permission-note">View only</span>'}
      </td>
    </tr>
  `).join("");
}

export function bindTransactionEvents() {
  $("entryForm").addEventListener("submit", saveEntry);

  $("entryForm").querySelector('button[type="reset"]').addEventListener("click", (event) => {
    event.preventDefault();
    resetTransactionForm();
  });

  $("cancelEditButton").addEventListener("click", resetTransactionForm);
  $("group").addEventListener("change", () => {
    updatePriceForSelectedGang(true);
    calculateTotal();
  });
  $("amount").addEventListener("input", calculateTotal);
  $("unitPrice").addEventListener("input", calculateTotal);
  $("searchInput").addEventListener("input", renderTable);
  $("groupFilter").addEventListener("change", renderTable);

  document.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-id]");
    const deleteButton = event.target.closest("[data-delete-id]");

    if (editButton) editRecord(editButton.dataset.editId);
    if (deleteButton) removeRecord(deleteButton.dataset.deleteId);
  });
}
