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
      await updateDoc(doc(db, TRANSACTIONS_COLLECTION, state.editingRecordId), entry);
      showToast("Entry updated.");
    } else {
      await addDoc(collection(db, TRANSACTIONS_COLLECTION), {
        ...entry,
        createdAt: serverTimestamp(),
        createdBy: {
          uid: session.user.uid,
          discordName: session.discordName
        }
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
  if (!window.confirm("Delete this entry? This cannot be undone.")) return;

  try {
    await deleteDoc(doc(db, TRANSACTIONS_COLLECTION, id));
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

  container.innerHTML = state.records.slice(0, 5).map((record) => `
    <button class="recent-item" data-edit-id="${record.id}">
      <span class="group-badge" style="--badge-color:${groupColor(record.group)}">${safeText(record.group)}</span>
      <span>
        <strong>${safeText(record.buyer)}</strong>
        <small>${safeText(record.transactionDate)}</small>
      </span>
      <strong>${formatCurrency(record.total)}</strong>
    </button>
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
        ${getSession().isAdmin ? `
          <div class="table-actions">
            <button data-edit-id="${record.id}">Edit</button>
            <button class="danger-action" data-delete-id="${record.id}">Delete</button>
          </div>
        ` : '<span class="permission-note">Admin only</span>'}
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
