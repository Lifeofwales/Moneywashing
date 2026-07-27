import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const settings = window.SITE_SETTINGS;
const COLLECTION_NAME = "rp_transactions";
let records = [];
let db = null;
let sharedMode = false;

const $ = (id) => document.getElementById(id);
const views = {
  dashboard: $("dashboardView"),
  "new-entry": $("newEntryView"),
  records: $("recordsView"),
  settings: $("settingsView")
};

function applyCustomization() {
  $("siteTitle").textContent = settings.siteTitle;
  $("siteSubtitle").textContent = settings.siteSubtitle;
  document.title = settings.siteTitle;
  $("unitPrice").value = settings.defaultUnitPrice;

  Object.entries(settings.colors).forEach(([name, value]) => {
    document.documentElement.style.setProperty(`--${name}`, value);
  });

  const groupSelect = $("group");
  const groupFilter = $("groupFilter");
  settings.groups.forEach((group) => {
    groupSelect.add(new Option(group.name, group.name));
    groupFilter.add(new Option(group.name, group.name));
  });
}

function firebaseIsConfigured() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("PASTE_") &&
    firebaseConfig.projectId && !firebaseConfig.projectId.includes("YOUR_");
}

function setConnection(isShared, label, help) {
  sharedMode = isShared;
  $("connectionLabel").textContent = label;
  $("connectionHelp").textContent = help;
  $("connectionDot").classList.toggle("online", isShared);
}

function initializeData() {
  if (!firebaseIsConfigured()) {
    setConnection(false, "Demo mode", "Saved only on this device");
    records = loadLocalRecords();
    renderAll();
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    setConnection(true, "Shared database", "Live updates enabled");

    const recordsQuery = query(collection(db, COLLECTION_NAME), orderBy("transactionDate", "desc"));
    onSnapshot(recordsQuery, (snapshot) => {
      records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderAll();
    }, (error) => {
      console.error(error);
      setConnection(false, "Database error", "Check Firebase setup and rules");
      showToast("Could not load Firebase records.", true);
    });
  } catch (error) {
    console.error(error);
    setConnection(false, "Setup error", "Check firebase-config.js");
    showToast("Firebase configuration could not be loaded.", true);
  }
}

function loadLocalRecords() {
  try {
    return JSON.parse(localStorage.getItem(COLLECTION_NAME) || "[]");
  } catch {
    return [];
  }
}

function saveLocalRecords() {
  localStorage.setItem(COLLECTION_NAME, JSON.stringify(records));
}

function showView(name) {
  Object.values(views).forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  views[name].classList.add("active");
  document.querySelector(`[data-view="${name}"]`)?.classList.add("active");
  $("pageTitle").textContent = name === "new-entry" ? "New Entry" : name.charAt(0).toUpperCase() + name.slice(1).replace("-", " ");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function calculateTotal() {
  const amount = Number($("amount").value) || 0;
  const unitPrice = Number($("unitPrice").value) || 0;
  $("calculatedTotal").textContent = formatCurrency(amount * unitPrice);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function safeText(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function groupColor(groupName) {
  return settings.groups.find((group) => group.name === groupName)?.accent || settings.colors.primary;
}

async function saveEntry(event) {
  event.preventDefault();
  const recordId = $("recordId").value;
  const amount = Number($("amount").value);
  const unitPrice = Number($("unitPrice").value);
  const entry = {
    group: $("group").value,
    buyer: $("buyer").value.trim(),
    amount,
    unitPrice,
    total: amount * unitPrice,
    accountUsed: $("accountUsed").value.trim(),
    transactionDate: $("transactionDate").value,
    notes: $("notes").value.trim(),
    updatedAt: new Date().toISOString()
  };

  try {
    if (sharedMode) {
      if (recordId) {
        await updateDoc(doc(db, COLLECTION_NAME, recordId), entry);
      } else {
        await addDoc(collection(db, COLLECTION_NAME), { ...entry, createdAt: serverTimestamp() });
      }
    } else {
      if (recordId) {
        const index = records.findIndex((record) => record.id === recordId);
        records[index] = { ...records[index], ...entry };
      } else {
        records.unshift({ ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
      }
      saveLocalRecords();
      renderAll();
    }

    showToast(recordId ? "Entry updated." : "Entry saved.");
    resetForm();
    showView("records");
  } catch (error) {
    console.error(error);
    showToast("The entry could not be saved.", true);
  }
}

function editRecord(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;
  $("recordId").value = record.id;
  $("group").value = record.group;
  $("buyer").value = record.buyer;
  $("amount").value = record.amount;
  $("unitPrice").value = record.unitPrice;
  $("accountUsed").value = record.accountUsed || "";
  $("transactionDate").value = record.transactionDate;
  $("notes").value = record.notes || "";
  $("formHeading").textContent = "Edit Transaction";
  $("saveButton").textContent = "Update Entry";
  $("cancelEditButton").classList.remove("hidden");
  calculateTotal();
  showView("new-entry");
}

async function removeRecord(id) {
  if (!confirm("Delete this entry? This cannot be undone.")) return;
  try {
    if (sharedMode) {
      await deleteDoc(doc(db, COLLECTION_NAME, id));
    } else {
      records = records.filter((record) => record.id !== id);
      saveLocalRecords();
      renderAll();
    }
    showToast("Entry deleted.");
  } catch (error) {
    console.error(error);
    showToast("The entry could not be deleted.", true);
  }
}

function resetForm() {
  $("entryForm").reset();
  $("recordId").value = "";
  $("unitPrice").value = settings.defaultUnitPrice;
  $("transactionDate").value = new Date().toISOString().slice(0, 10);
  $("formHeading").textContent = "New Transaction";
  $("saveButton").textContent = "Save Entry";
  $("cancelEditButton").classList.add("hidden");
  calculateTotal();
}

function renderAll() {
  renderStats();
  renderGroupBreakdown();
  renderRecent();
  renderTable();
}

function renderStats() {
  const totalAmount = records.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const totalValue = records.reduce((sum, record) => sum + Number(record.total || 0), 0);
  const groupTotals = records.reduce((totals, record) => {
    totals[record.group] = (totals[record.group] || 0) + Number(record.total || 0);
    return totals;
  }, {});
  const topGroup = Object.entries(groupTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  $("totalAmount").textContent = formatNumber(totalAmount);
  $("totalValue").textContent = formatCurrency(totalValue);
  $("transactionCount").textContent = records.length;
  $("topGroup").textContent = topGroup;
}

function renderGroupBreakdown() {
  const container = $("groupBreakdown");
  const overall = records.reduce((sum, record) => sum + Number(record.total || 0), 0);
  container.innerHTML = settings.groups.map((group) => {
    const groupRecords = records.filter((record) => record.group === group.name);
    const total = groupRecords.reduce((sum, record) => sum + Number(record.total || 0), 0);
    const percentage = overall ? Math.round((total / overall) * 100) : 0;
    return `<div class="group-row">
      <div class="group-row-top"><strong>${safeText(group.name)}</strong><span>${formatCurrency(total)}</span></div>
      <div class="progress"><span style="width:${percentage}%;background:${group.accent}"></span></div>
      <small>${groupRecords.length} entries · ${percentage}% of total</small>
    </div>`;
  }).join("");
}

function renderRecent() {
  const container = $("recentEntries");
  if (!records.length) {
    container.innerHTML = '<div class="empty-state">No entries have been saved yet.</div>';
    return;
  }
  container.innerHTML = records.slice(0, 5).map((record) => `
    <button class="recent-item" data-edit-id="${record.id}">
      <span class="group-badge" style="--badge-color:${groupColor(record.group)}">${safeText(record.group)}</span>
      <span><strong>${safeText(record.buyer)}</strong><small>${safeText(record.transactionDate)}</small></span>
      <strong>${formatCurrency(record.total)}</strong>
    </button>`).join("");
}

function filteredRecords() {
  const search = $("searchInput").value.trim().toLowerCase();
  const selectedGroup = $("groupFilter").value;
  return records.filter((record) => {
    const matchesGroup = selectedGroup === "all" || record.group === selectedGroup;
    const haystack = `${record.buyer} ${record.accountUsed || ""} ${record.notes || ""}`.toLowerCase();
    return matchesGroup && (!search || haystack.includes(search));
  });
}

function renderTable() {
  const body = $("recordsTableBody");
  const visibleRecords = filteredRecords();
  $("emptyRecords").classList.toggle("hidden", visibleRecords.length > 0);
  body.innerHTML = visibleRecords.map((record) => `
    <tr>
      <td>${safeText(record.transactionDate)}</td>
      <td><span class="group-badge" style="--badge-color:${groupColor(record.group)}">${safeText(record.group)}</span></td>
      <td><strong>${safeText(record.buyer)}</strong>${record.notes ? `<small class="table-note">${safeText(record.notes)}</small>` : ""}</td>
      <td>${formatNumber(record.amount)}</td>
      <td>${formatCurrency(record.unitPrice)}</td>
      <td><strong>${formatCurrency(record.total)}</strong></td>
      <td>${safeText(record.accountUsed || "—")}</td>
      <td><div class="table-actions"><button data-edit-id="${record.id}">Edit</button><button class="danger-action" data-delete-id="${record.id}">Delete</button></div></td>
    </tr>`).join("");
}

function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2800);
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => showView(item.dataset.view)));
  document.querySelectorAll("[data-go-view]").forEach((item) => item.addEventListener("click", () => showView(item.dataset.goView)));
  $("quickAddButton").addEventListener("click", () => { resetForm(); showView("new-entry"); });
  $("entryForm").addEventListener("submit", saveEntry);
$("entryForm").querySelector('button[type="reset"]').addEventListener("click", (event) => {
  event.preventDefault();
  resetForm();
});
  $("cancelEditButton").addEventListener("click", resetForm);
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

applyCustomization();
bindEvents();
resetForm();
initializeData();
