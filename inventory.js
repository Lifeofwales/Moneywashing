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
import {
  $,
  safeText,
  showToast,
  formatNumber
} from "./ui.js";

const ITEMS_COLLECTION = "inventory_items";
const HISTORY_COLLECTION = "inventory_history";

let inventoryItems = [];
let inventoryHistory = [];
let stopItemsListener = null;
let stopHistoryListener = null;
let editingItemId = null;

function session() {
  return getSession();
}

function canManageInventory() {
  return can("manageInventory");
}

function canAdjustInventory() {
  return can("adjustInventory");
}

function canViewInventory() {
  return can("viewInventory");
}

function actorPayload() {
  return {
    uid: session().user.uid,
    name: session().discordName || "Discord User",
    role: session().role || "viewer"
  };
}

function nowIso() {
  return new Date().toISOString();
}

function itemIsLow(item) {
  return Number(item.quantity || 0) <= Number(item.lowStockThreshold || 0);
}

function formatDate(value) {
  const date = value?.toDate?.() || new Date(value || Date.now());

  if (Number.isNaN(date.getTime())) return "Unknown";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function applyInventoryPermissions() {
  const view = canViewInventory();
  const manage = canManageInventory();
  const adjust = canAdjustInventory();

  $("inventoryNavButton")?.classList.toggle("hidden", !view);
  $("inventoryItemForm")?.classList.toggle("hidden", !manage);

  document
    .querySelectorAll("[data-inventory-adjust-form]")
    .forEach((element) => {
      element.classList.toggle("hidden", !adjust);
    });

  if (!view && $("inventoryView")?.classList.contains("active")) {
    document.querySelector('[data-view="dashboard"]')?.click();
  }

  renderInventory();
  renderInventoryHistory();
}

export function startInventoryListeners() {
  stopInventoryListeners();

  stopItemsListener = onSnapshot(
    query(
      collection(db, ITEMS_COLLECTION),
      orderBy("name", "asc")
    ),
    (snapshot) => {
      inventoryItems = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      refreshInventoryFilters();
      renderInventory();
      renderInventoryStats();
    },
    (error) => {
      console.error("Inventory listener failed:", error);
      showToast("Could not load inventory.", true);
    }
  );

  stopHistoryListener = onSnapshot(
    query(
      collection(db, HISTORY_COLLECTION),
      orderBy("createdAtMs", "desc")
    ),
    (snapshot) => {
      inventoryHistory = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      renderInventoryHistory();
    },
    (error) => {
      console.error("Inventory history listener failed:", error);
      showToast("Could not load inventory history.", true);
    }
  );
}

export function stopInventoryListeners() {
  if (typeof stopItemsListener === "function") {
    stopItemsListener();
  }

  if (typeof stopHistoryListener === "function") {
    stopHistoryListener();
  }

  stopItemsListener = null;
  stopHistoryListener = null;
  inventoryItems = [];
  inventoryHistory = [];
}

function filteredItems() {
  const search = ($("inventorySearch")?.value || "")
    .trim()
    .toLowerCase();

  const category = $("inventoryCategoryFilter")?.value || "all";
  const location = $("inventoryLocationFilter")?.value || "all";
  const stock = $("inventoryStockFilter")?.value || "all";

  return inventoryItems.filter((item) => {
    const haystack = [
      item.name,
      item.category,
      item.location,
      item.description,
      item.sku
    ].join(" ").toLowerCase();

    const stockMatches =
      stock === "all" ||
      (stock === "low" && itemIsLow(item)) ||
      (stock === "in-stock" && !itemIsLow(item));

    return (
      (!search || haystack.includes(search)) &&
      (category === "all" || item.category === category) &&
      (location === "all" || item.location === location) &&
      stockMatches
    );
  });
}

function refreshInventoryFilters() {
  const categoryFilter = $("inventoryCategoryFilter");
  const locationFilter = $("inventoryLocationFilter");

  if (!categoryFilter || !locationFilter) return;

  const selectedCategory = categoryFilter.value || "all";
  const selectedLocation = locationFilter.value || "all";

  const categories = [...new Set(
    inventoryItems.map((item) => item.category).filter(Boolean)
  )].sort();

  const locations = [...new Set(
    inventoryItems.map((item) => item.location).filter(Boolean)
  )].sort();

  categoryFilter.innerHTML =
    '<option value="all">All categories</option>';

  categories.forEach((category) => {
    categoryFilter.add(new Option(category, category));
  });

  locationFilter.innerHTML =
    '<option value="all">All locations</option>';

  locations.forEach((location) => {
    locationFilter.add(new Option(location, location));
  });

  if (categories.includes(selectedCategory)) {
    categoryFilter.value = selectedCategory;
  }

  if (locations.includes(selectedLocation)) {
    locationFilter.value = selectedLocation;
  }
}

function renderInventoryStats() {
  const totalItems = inventoryItems.length;
  const totalQuantity = inventoryItems.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );

  const lowStock = inventoryItems.filter(itemIsLow).length;
  const locations = new Set(
    inventoryItems.map((item) => item.location).filter(Boolean)
  ).size;

  $("inventoryTotalItems").textContent = formatNumber(totalItems);
  $("inventoryTotalQuantity").textContent = formatNumber(totalQuantity);
  $("inventoryLowStockCount").textContent = formatNumber(lowStock);
  $("inventoryLocationCount").textContent = formatNumber(locations);
}

function resetInventoryForm() {
  editingItemId = null;
  $("inventoryItemForm")?.reset();
  $("inventoryItemId").value = "";
  $("inventoryItemQuantity").value = "0";
  $("inventoryLowStockThreshold").value = "5";
  $("inventoryItemSaveButton").textContent = "Add Item";
  $("inventoryCancelEditButton").classList.add("hidden");
}

async function saveInventoryItem(event) {
  event.preventDefault();

  if (!canManageInventory()) {
    showToast("Manager access is required.", true);
    return;
  }

  const payload = {
    name: $("inventoryItemName").value.trim(),
    sku: $("inventoryItemSku").value.trim(),
    category: $("inventoryItemCategory").value.trim(),
    location: $("inventoryItemLocation").value.trim(),
    description: $("inventoryItemDescription").value.trim(),
    quantity: Number($("inventoryItemQuantity").value) || 0,
    lowStockThreshold:
      Number($("inventoryLowStockThreshold").value) || 0,
    unit: $("inventoryItemUnit").value.trim() || "units"
  };

  if (!payload.name || !payload.category || !payload.location) {
    showToast(
      "Enter an item name, category, and storage location.",
      true
    );
    return;
  }

  if (payload.quantity < 0 || payload.lowStockThreshold < 0) {
    showToast("Inventory values cannot be negative.", true);
    return;
  }

  try {
    if (editingItemId) {
      const previous = inventoryItems.find(
        (item) => item.id === editingItemId
      );

      await updateDoc(doc(db, ITEMS_COLLECTION, editingItemId), {
        ...payload,
        updatedAt: nowIso(),
        updatedBy: actorPayload()
      });

      await addInventoryHistory({
        itemId: editingItemId,
        itemName: payload.name,
        action: "item-updated",
        change: 0,
        quantityBefore: Number(previous?.quantity || 0),
        quantityAfter: payload.quantity,
        reason: "Item details updated"
      });

      await writeAuditLog({
        action: "Inventory Item Updated",
        category: "general",
        severity: "action",
        targetType: "inventory-item",
        targetId: editingItemId,
        targetName: payload.name,
        summary:
          `${session().discordName} updated inventory item ${payload.name}.`,
        details: {
          before: previous || null,
          after: payload
        }
      });

      showToast("Inventory item updated.");
    } else {
      const reference = await addDoc(
        collection(db, ITEMS_COLLECTION),
        {
          ...payload,
          createdAt: serverTimestamp(),
          createdAtMs: Date.now(),
          createdBy: actorPayload(),
          updatedAt: nowIso(),
          updatedBy: actorPayload()
        }
      );

      await addInventoryHistory({
        itemId: reference.id,
        itemName: payload.name,
        action: "item-created",
        change: payload.quantity,
        quantityBefore: 0,
        quantityAfter: payload.quantity,
        reason: "Initial inventory"
      });

      await writeAuditLog({
        action: "Inventory Item Created",
        category: "general",
        severity: "action",
        targetType: "inventory-item",
        targetId: reference.id,
        targetName: payload.name,
        summary:
          `${session().discordName} created inventory item ${payload.name}.`,
        details: payload
      });

      showToast("Inventory item added.");
    }

    resetInventoryForm();
  } catch (error) {
    console.error(error);
    showToast("Inventory item could not be saved.", true);
  }
}

function editInventoryItem(id) {
  if (!canManageInventory()) return;

  const item = inventoryItems.find((entry) => entry.id === id);
  if (!item) return;

  editingItemId = id;
  $("inventoryItemId").value = id;
  $("inventoryItemName").value = item.name || "";
  $("inventoryItemSku").value = item.sku || "";
  $("inventoryItemCategory").value = item.category || "";
  $("inventoryItemLocation").value = item.location || "";
  $("inventoryItemDescription").value = item.description || "";
  $("inventoryItemQuantity").value = Number(item.quantity || 0);
  $("inventoryLowStockThreshold").value =
    Number(item.lowStockThreshold || 0);
  $("inventoryItemUnit").value = item.unit || "units";
  $("inventoryItemSaveButton").textContent = "Save Item";
  $("inventoryCancelEditButton").classList.remove("hidden");
  $("inventoryItemName").focus();
}

async function deleteInventoryItem(id) {
  if (!canManageInventory()) return;

  const item = inventoryItems.find((entry) => entry.id === id);
  if (!item) return;

  if (!window.confirm(`Delete inventory item "${item.name}"?`)) {
    return;
  }

  try {
    await deleteDoc(doc(db, ITEMS_COLLECTION, id));

    await addInventoryHistory({
      itemId: id,
      itemName: item.name,
      action: "item-deleted",
      change: -Number(item.quantity || 0),
      quantityBefore: Number(item.quantity || 0),
      quantityAfter: 0,
      reason: "Item deleted"
    });

    await writeAuditLog({
      action: "Inventory Item Deleted",
      category: "general",
      severity: "warning",
      targetType: "inventory-item",
      targetId: id,
      targetName: item.name,
      summary:
        `${session().discordName} deleted inventory item ${item.name}.`,
      details: item
    });

    showToast("Inventory item deleted.");
  } catch (error) {
    console.error(error);
    showToast("Inventory item could not be deleted.", true);
  }
}

async function adjustInventory(id, direction) {
  if (!canAdjustInventory()) {
    showToast("You cannot adjust inventory.", true);
    return;
  }

  const item = inventoryItems.find((entry) => entry.id === id);
  if (!item) return;

  const amount = Number(
    window.prompt(
      `${direction === "add" ? "Add" : "Remove"} how many ${item.unit || "units"}?`,
      "1"
    )
  );

  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Enter a valid positive amount.", true);
    return;
  }

  const reason =
    window.prompt("Reason for this adjustment:", "")?.trim() || "";

  const before = Number(item.quantity || 0);
  const change = direction === "add" ? amount : -amount;
  const after = before + change;

  if (after < 0) {
    showToast("You cannot remove more stock than is available.", true);
    return;
  }

  try {
    await updateDoc(doc(db, ITEMS_COLLECTION, id), {
      quantity: after,
      updatedAt: nowIso(),
      updatedBy: actorPayload()
    });

    await addInventoryHistory({
      itemId: id,
      itemName: item.name,
      action: direction === "add" ? "stock-added" : "stock-removed",
      change,
      quantityBefore: before,
      quantityAfter: after,
      reason
    });

    await writeAuditLog({
      action:
        direction === "add"
          ? "Inventory Stock Added"
          : "Inventory Stock Removed",
      category: "general",
      severity:
        after <= Number(item.lowStockThreshold || 0)
          ? "warning"
          : "action",
      targetType: "inventory-item",
      targetId: id,
      targetName: item.name,
      summary:
        `${session().discordName} ${direction === "add" ? "added" : "removed"} ${amount} ${item.unit || "units"} ${direction === "add" ? "to" : "from"} ${item.name}.`,
      details: {
        before,
        change,
        after,
        reason
      }
    });

    showToast("Inventory adjusted.");
  } catch (error) {
    console.error(error);
    showToast("Inventory could not be adjusted.", true);
  }
}

async function addInventoryHistory({
  itemId,
  itemName,
  action,
  change,
  quantityBefore,
  quantityAfter,
  reason
}) {
  await addDoc(collection(db, HISTORY_COLLECTION), {
    itemId,
    itemName,
    action,
    change,
    quantityBefore,
    quantityAfter,
    reason,
    actor: actorPayload(),
    createdAt: serverTimestamp(),
    createdAtMs: Date.now()
  });
}

function renderInventory() {
  const container = $("inventoryItemList");
  const count = $("inventoryResultCount");

  if (!container || !count) return;

  const items = filteredItems();
  count.textContent =
    `${items.length} item${items.length === 1 ? "" : "s"}`;

  if (!items.length) {
    container.innerHTML =
      '<div class="empty-state">No inventory items match your filters.</div>';
    return;
  }

  container.innerHTML = items.map((item) => {
    const low = itemIsLow(item);

    return `
      <article class="inventory-item-card ${low ? "low-stock" : ""}">
        <div class="inventory-item-heading">
          <div>
            <span class="inventory-category">
              ${safeText(item.category || "Uncategorized")}
            </span>
            ${low ? '<span class="inventory-warning">Low Stock</span>' : ""}
          </div>

          <div class="inventory-item-actions">
            ${canAdjustInventory() ? `
              <button data-inventory-add="${item.id}">+ Stock</button>
              <button data-inventory-remove="${item.id}">− Stock</button>
            ` : ""}
            ${canManageInventory() ? `
              <button data-inventory-edit="${item.id}">Edit</button>
              <button
                class="danger-action"
                data-inventory-delete="${item.id}"
              >
                Delete
              </button>
            ` : ""}
          </div>
        </div>

        <h4>${safeText(item.name)}</h4>

        <p>${safeText(item.description || "No description.")}</p>

        <div class="inventory-item-grid">
          <div>
            <span>Quantity</span>
            <strong>
              ${formatNumber(item.quantity)}
              ${safeText(item.unit || "units")}
            </strong>
          </div>

          <div>
            <span>Location</span>
            <strong>${safeText(item.location || "Unknown")}</strong>
          </div>

          <div>
            <span>Low Stock At</span>
            <strong>${formatNumber(item.lowStockThreshold)}</strong>
          </div>

          <div>
            <span>SKU</span>
            <strong>${safeText(item.sku || "—")}</strong>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderInventoryHistory() {
  const container = $("inventoryHistoryList");
  if (!container) return;

  const itemFilter = $("inventoryHistoryItemFilter")?.value || "all";

  const entries = inventoryHistory
    .filter((entry) => itemFilter === "all" || entry.itemId === itemFilter)
    .slice(0, 100);

  refreshHistoryItemFilter();

  if (!entries.length) {
    container.innerHTML =
      '<div class="empty-state">No inventory history yet.</div>';
    return;
  }

  container.innerHTML = entries.map((entry) => `
    <article class="inventory-history-row">
      <div class="inventory-history-main">
        <strong>${safeText(entry.itemName || "Unknown Item")}</strong>
        <small>
          ${safeText(entry.actor?.name || "Unknown User")}
          · ${safeText(formatDate(entry.createdAt || entry.createdAtMs))}
        </small>
      </div>

      <span class="inventory-history-action">
        ${safeText(entry.action || "updated")}
      </span>

      <strong class="${Number(entry.change || 0) < 0 ? "negative-change" : "positive-change"}">
        ${Number(entry.change || 0) > 0 ? "+" : ""}
        ${formatNumber(entry.change || 0)}
      </strong>

      <small>
        ${formatNumber(entry.quantityBefore || 0)}
        →
        ${formatNumber(entry.quantityAfter || 0)}
      </small>

      <small>${safeText(entry.reason || "No reason provided")}</small>
    </article>
  `).join("");
}

function refreshHistoryItemFilter() {
  const select = $("inventoryHistoryItemFilter");
  if (!select) return;

  const selected = select.value || "all";

  select.innerHTML =
    '<option value="all">All inventory items</option>';

  inventoryItems.forEach((item) => {
    select.add(new Option(item.name, item.id));
  });

  if (inventoryItems.some((item) => item.id === selected)) {
    select.value = selected;
  }
}

export function bindInventoryEvents() {
  $("inventoryItemForm")?.addEventListener(
    "submit",
    saveInventoryItem
  );

  $("inventoryCancelEditButton")?.addEventListener(
    "click",
    resetInventoryForm
  );

  [
    "inventorySearch",
    "inventoryCategoryFilter",
    "inventoryLocationFilter",
    "inventoryStockFilter"
  ].forEach((id) => {
    $(id)?.addEventListener("input", renderInventory);
    $(id)?.addEventListener("change", renderInventory);
  });

  $("inventoryHistoryItemFilter")?.addEventListener(
    "change",
    renderInventoryHistory
  );

  document.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-inventory-add]");
    const removeButton = event.target.closest("[data-inventory-remove]");
    const editButton = event.target.closest("[data-inventory-edit]");
    const deleteButton = event.target.closest("[data-inventory-delete]");

    if (addButton) {
      adjustInventory(addButton.dataset.inventoryAdd, "add");
    }

    if (removeButton) {
      adjustInventory(removeButton.dataset.inventoryRemove, "remove");
    }

    if (editButton) {
      editInventoryItem(editButton.dataset.inventoryEdit);
    }

    if (deleteButton) {
      deleteInventoryItem(deleteButton.dataset.inventoryDelete);
    }
  });

  resetInventoryForm();
}
