import {
  db,
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot
} from "./firebase.js";
import {
  state,
  fallbackSettings,
  normalizeSettings,
  normalizeHex,
  slugify,
  SETTINGS_COLLECTION,
  SETTINGS_DOCUMENT,
  DEFAULT_NAVIGATION_ORDER
} from "./state.js";
import {
  $,
  applyBranding,
  applyNavigationOrder,
  refreshGangOptions,
  showToast,
  formatCurrency,
  safeText
} from "./ui.js";
import { renderAll, resetTransactionForm } from "./transactions.js";
import { getSession } from "./auth.js";
import { isOwner, isAdministrator, can } from "./permissions.js";
import { writeAuditLog } from "./audit.js";
import {
  renderHiddenRankingEmployees,
  bindRankingManagementEvents
} from "./rankings.js";

const ACCESS_USERS_COLLECTION = "access_users";
let accessUsers = [];
let stopUsersListener = null;

const NAVIGATION_LABELS = {
  dashboard: "⌂ Dashboard",
  intro: "❔ Start Here",
  "new-entry": "＋ New Entry",
  records: "▤ All Records",
  audit: "📜 Audit Center",
  analytics: "🧠 Intelligence Center",
  operations: "🏠 Operations Hub",
  inventory: "📦 Inventory Center",
  "successful-runs": "🏁 Successful Runs",
  "discord-integration": "🔗 Discord Integration",
  admin: "⚙ Admin Panel"
};

let navigationDraft = [...DEFAULT_NAVIGATION_ORDER];
let draggedNavigationItem = null;

function settingsReference() {
  return doc(db, SETTINGS_COLLECTION, SETTINGS_DOCUMENT);
}

export async function ensureSettingsDocument() {
  const reference = settingsReference();
  const snapshot = await getDoc(reference);

  if (!snapshot.exists()) {
    await setDoc(reference, {
      ...fallbackSettings,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
}

export function startSettingsListener() {
  return onSnapshot(settingsReference(), (snapshot) => {
    if (!snapshot.exists()) return;

    state.settings = normalizeSettings(snapshot.data());
    navigationDraft = [...state.settings.navigationOrder];
    applyBranding();
    applyNavigationOrder();
    refreshGangOptions();
    populateBrandingForm();
    renderGangList();
    renderNavigationLayoutManager();
    renderHiddenRankingEmployees();
    renderAll();

    if (!state.editingRecordId) {
      resetTransactionForm();
    }
  }, (error) => {
    console.error(error);
    showToast("Could not load website settings.", true);
  });
}

async function saveSettings(nextSettings, successMessage) {
  if (!isAdministrator()) {
    showToast("Administrator access is required.", true);
    return;
  }

  try {
    const normalized = normalizeSettings(nextSettings);
    await setDoc(settingsReference(), {
      ...normalized,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    showToast(successMessage);
  } catch (error) {
    console.error(error);
    showToast("Settings could not be saved.", true);
  }
}

function populateBrandingForm() {
  $("adminSiteTitle").value = state.settings.siteTitle;
  $("adminSiteSubtitle").value = state.settings.siteSubtitle;
  $("adminPrimaryColor").value = state.settings.primaryColor;
  $("adminPrimaryColorText").value = state.settings.primaryColor;
  $("adminDefaultPrice").value = state.settings.defaultUnitPrice;
}

async function saveBranding(event) {
  event.preventDefault();

  const previousSettings = { ...state.settings };

  const primaryColor = normalizeHex(
    $("adminPrimaryColorText").value,
    $("adminPrimaryColor").value
  );

  const nextSettings = {
    ...state.settings,
    siteTitle: $("adminSiteTitle").value.trim(),
    siteSubtitle: $("adminSiteSubtitle").value.trim(),
    primaryColor,
    defaultUnitPrice: Number($("adminDefaultPrice").value) || 0
  };

  await saveSettings(nextSettings, "Website settings saved.");

  await writeAuditLog({
    action: "Website Settings Updated",
    category: "settings",
    severity: "action",
    targetType: "settings",
    targetId: SETTINGS_DOCUMENT,
    targetName: "Website Settings",
    summary: `${getSession().discordName} updated website settings.`,
    details: {
      before: previousSettings,
      after: nextSettings
    }
  });
}

export function renderGangList() {
  const container = $("gangList");

  if (!state.settings.gangs.length) {
    container.innerHTML = '<div class="empty-state">No gangs have been added.</div>';
    return;
  }

  container.innerHTML = state.settings.gangs.map((gang) => `
    <article class="gang-admin-item">
      <span class="gang-color-dot" style="background:${gang.accent}"></span>
      <div>
        <strong>${safeText(gang.name)}</strong>
        <small>${formatCurrency(gang.unitPrice)} per unit</small>
      </div>
      <span class="group-badge" style="--badge-color:${gang.accent}">${gang.accent}</span>
      <div class="gang-admin-actions">
        <button data-gang-edit="${gang.id}">Edit</button>
        <button class="danger-action" data-gang-delete="${gang.id}">Delete</button>
      </div>
    </article>
  `).join("");
}

function resetGangForm() {
  $("gangForm").reset();
  $("gangEditId").value = "";
  $("gangColor").value = "#16a34a";
  $("gangColorText").value = "#16a34a";
  $("gangPrice").value = state.settings.defaultUnitPrice;
  $("gangSaveButton").textContent = "Add Gang";
  $("gangCancelButton").classList.add("hidden");
}

function editGang(id) {
  if (!isAdministrator()) {
    showToast("Administrator access is required.", true);
    return;
  }

  const gang = state.settings.gangs.find((item) => item.id === id);
  if (!gang) return;

  $("gangEditId").value = gang.id;
  $("gangName").value = gang.name;
  $("gangPrice").value = gang.unitPrice;
  $("gangColor").value = gang.accent;
  $("gangColorText").value = gang.accent;
  $("gangSaveButton").textContent = "Save Gang";
  $("gangCancelButton").classList.remove("hidden");
  $("gangName").focus();
}

async function saveGang(event) {
  event.preventDefault();

  if (!isAdministrator()) {
    showToast("Administrator access is required.", true);
    return;
  }

  const editId = $("gangEditId").value;
  const name = $("gangName").value.trim();
  const unitPrice = Number($("gangPrice").value);
  const accent = normalizeHex($("gangColorText").value, $("gangColor").value);

  if (!name) {
    showToast("Enter a gang name.", true);
    return;
  }

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    showToast("Enter a valid unit price.", true);
    return;
  }

  const duplicate = state.settings.gangs.some((gang) =>
    gang.name.toLowerCase() === name.toLowerCase() && gang.id !== editId
  );

  if (duplicate) {
    showToast("A gang with that name already exists.", true);
    return;
  }

  let gangs;

  if (editId) {
    gangs = state.settings.gangs.map((gang) =>
      gang.id === editId ? { ...gang, name, unitPrice, accent } : gang
    );
  } else {
    let id = slugify(name);
    while (state.settings.gangs.some((gang) => gang.id === id)) {
      id = `${id}-${Date.now()}`;
    }
    gangs = [...state.settings.gangs, { id, name, unitPrice, accent }];
  }

  await saveSettings(
    { ...state.settings, gangs },
    editId ? "Gang updated." : "Gang added."
  );

  await writeAuditLog({
    action: editId ? "Gang Updated" : "Gang Added",
    category: "gang",
    severity: "action",
    targetType: "gang",
    targetId: editId || id,
    targetName: name,
    summary: `${getSession().discordName} ${editId ? "updated" : "added"} the gang ${name}.`,
    details: {
      name,
      unitPrice,
      accent
    }
  });

  resetGangForm();
}

async function deleteGang(id) {
  if (!isAdministrator()) {
    showToast("Administrator access is required.", true);
    return;
  }

  const gang = state.settings.gangs.find((item) => item.id === id);
  if (!gang) return;

  if (state.settings.gangs.length === 1) {
    showToast("You must keep at least one gang.", true);
    return;
  }

  const usedByRecords = state.records.some((record) => record.group === gang.name);
  const message = usedByRecords
    ? `${gang.name} is used by existing records. Removing it hides it from new entries but does not delete those records. Continue?`
    : `Delete ${gang.name}?`;

  if (!window.confirm(message)) return;

  const gangs = state.settings.gangs.filter((item) => item.id !== id);
  await saveSettings({ ...state.settings, gangs }, "Gang deleted.");

  await writeAuditLog({
    action: "Gang Deleted",
    category: "gang",
    severity: "warning",
    targetType: "gang",
    targetId: gang.id,
    targetName: gang.name,
    summary: `${getSession().discordName} deleted the gang ${gang.name}.`,
    details: gang
  });
}

function syncColorPicker(pickerId, textId) {
  $(pickerId).addEventListener("input", () => {
    $(textId).value = $(pickerId).value;
  });

  $(textId).addEventListener("input", () => {
    const normalized = normalizeHex($(textId).value, "");
    if (normalized) $(pickerId).value = normalized;
  });
}




function renderNavigationLayoutManager() {
  const container = $("navigationLayoutList");
  if (!container) return;

  if (!isOwner()) {
    container.innerHTML =
      '<div class="empty-state">Only the Owner can change the shared sidebar layout.</div>';
    return;
  }

  const order = navigationDraft.length
    ? navigationDraft
    : [...DEFAULT_NAVIGATION_ORDER];

  container.innerHTML = order.map((viewName, index) => {
    const locked = viewName === "dashboard";

    return `
      <article
        class="navigation-layout-item ${locked ? "locked" : ""}"
        draggable="${locked ? "false" : "true"}"
        data-navigation-item="${viewName}"
      >
        <span class="navigation-drag-handle">
          ${locked ? "🔒" : "☰"}
        </span>

        <div class="navigation-layout-main">
          <strong>${safeText(NAVIGATION_LABELS[viewName] || viewName)}</strong>
          <small>
            ${locked
              ? "Dashboard is locked at the top."
              : "Drag this row or use the arrow buttons."}
          </small>
        </div>

        <div class="navigation-layout-actions">
          <button
            type="button"
            data-navigation-up="${viewName}"
            ${locked || index <= 1 ? "disabled" : ""}
            aria-label="Move up"
          >
            ↑
          </button>

          <button
            type="button"
            data-navigation-down="${viewName}"
            ${locked || index === order.length - 1 ? "disabled" : ""}
            aria-label="Move down"
          >
            ↓
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function moveNavigationItem(viewName, direction) {
  if (!isOwner() || viewName === "dashboard") return;

  const currentIndex = navigationDraft.indexOf(viewName);
  if (currentIndex < 0) return;

  const targetIndex = currentIndex + direction;

  if (
    targetIndex < 1 ||
    targetIndex >= navigationDraft.length
  ) {
    return;
  }

  const next = [...navigationDraft];
  [next[currentIndex], next[targetIndex]] =
    [next[targetIndex], next[currentIndex]];

  navigationDraft = next;
  renderNavigationLayoutManager();
  previewNavigationLayout();
}

function previewNavigationLayout() {
  const previous = state.settings.navigationOrder;
  state.settings.navigationOrder = [...navigationDraft];
  applyNavigationOrder();
  state.settings.navigationOrder = previous;
}

async function saveNavigationLayout() {
  if (!isOwner()) {
    showToast("Owner access is required.", true);
    return;
  }

  const previousOrder = [...state.settings.navigationOrder];

  await saveSettings(
    {
      ...state.settings,
      navigationOrder: [...navigationDraft]
    },
    "Sidebar layout saved for everyone."
  );

  await writeAuditLog({
    action: "Sidebar Layout Updated",
    category: "settings",
    severity: "action",
    targetType: "settings",
    targetId: SETTINGS_DOCUMENT,
    targetName: "Sidebar Layout",
    summary: `${getSession().discordName} updated the shared sidebar order.`,
    details: {
      before: previousOrder,
      after: navigationDraft
    }
  });
}

function resetNavigationLayout() {
  if (!isOwner()) return;

  navigationDraft = [...DEFAULT_NAVIGATION_ORDER];
  renderNavigationLayoutManager();
  previewNavigationLayout();
  showToast("Default order restored in preview. Click Save Layout to publish it.");
}

function handleNavigationDragStart(event) {
  const item = event.target.closest("[data-navigation-item]");
  if (!item || item.dataset.navigationItem === "dashboard") return;

  draggedNavigationItem = item.dataset.navigationItem;
  item.classList.add("dragging");

  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedNavigationItem);
}

function handleNavigationDragOver(event) {
  const target = event.target.closest("[data-navigation-item]");
  if (
    !target ||
    target.dataset.navigationItem === "dashboard" ||
    !draggedNavigationItem
  ) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  target.classList.add("drag-over");
}

function handleNavigationDragLeave(event) {
  event.target
    .closest("[data-navigation-item]")
    ?.classList.remove("drag-over");
}

function handleNavigationDrop(event) {
  const target = event.target.closest("[data-navigation-item]");
  if (
    !target ||
    target.dataset.navigationItem === "dashboard" ||
    !draggedNavigationItem
  ) {
    return;
  }

  event.preventDefault();

  const targetName = target.dataset.navigationItem;
  const next = navigationDraft.filter(
    (item) => item !== draggedNavigationItem
  );

  const targetIndex = next.indexOf(targetName);
  next.splice(targetIndex, 0, draggedNavigationItem);

  navigationDraft = next;
  draggedNavigationItem = null;

  renderNavigationLayoutManager();
  previewNavigationLayout();
}

function handleNavigationDragEnd(event) {
  draggedNavigationItem = null;

  document
    .querySelectorAll(".navigation-layout-item")
    .forEach((item) => {
      item.classList.remove("dragging", "drag-over");
    });
}

export function applyAdminPermissions() {
  const manageSettings = can("manageSettings");
  const manageGangs = can("manageGangs");
  const manageUsers = can("manageUsers");

  $("brandingForm")?.classList.toggle("permission-locked", !manageSettings);
  $("gangForm")?.classList.toggle("permission-locked", !manageGangs);
  $("userManagementPanel")?.classList.toggle("hidden", !manageUsers);
  $("navigationLayoutPanel")?.classList.toggle("hidden", !isOwner());
  $("employeeRankingManagerPanel")?.classList.toggle("hidden", !isOwner());

  $("brandingForm")
    ?.querySelectorAll("input, select, textarea, button")
    .forEach((element) => {
      element.disabled = !manageSettings;
    });

  $("gangForm")
    ?.querySelectorAll("input, select, textarea, button")
    .forEach((element) => {
      element.disabled = !manageGangs;
    });
}

function startUsersListener() {
  if (stopUsersListener) {
    stopUsersListener();
  }

  stopUsersListener = onSnapshot(
    collection(db, ACCESS_USERS_COLLECTION),
    (snapshot) => {
      accessUsers = snapshot.docs
        .map((item) => ({
          id: item.id,
          ...item.data()
        }))
        .sort((a, b) =>
          String(a.displayName || a.discordId || "")
            .localeCompare(String(b.displayName || b.discordId || ""))
        );

      renderUsers();
    },
    (error) => {
      console.error(error);
      showToast("Could not load approved users.", true);
    }
  );
}

function roleLabel(role) {
  const labels = {
    owner: "👑 Owner",
    admin: "🛡 Administrator",
    manager: "👔 Manager",
    employee: "👷 Employee",
    viewer: "👀 Viewer"
  };

  return labels[role] || "Unknown";
}

function renderUsers() {
  const container = $("userList");

  if (!container) return;

  if (!isOwner()) {
    container.innerHTML =
      '<div class="empty-state">Only the Owner can manage users.</div>';
    $("userForm")?.classList.add("hidden");
    return;
  }

  $("userForm")?.classList.remove("hidden");

  if (!accessUsers.length) {
    container.innerHTML =
      '<div class="empty-state">No approved users have been added.</div>';
    return;
  }

  container.innerHTML = accessUsers.map((user) => `
    <article class="user-admin-item">
      <div class="user-admin-main">
        <strong>${safeText(user.displayName || "Unnamed User")}</strong>
        <small>${safeText(user.discordId || user.id)}</small>
      </div>

      <span class="role-badge role-${safeText(user.role || "viewer")}">
        ${roleLabel(user.role)}
      </span>

      <span class="status-badge ${user.active === true ? "active" : "disabled"}">
        ${user.active === true ? "Active" : "Disabled"}
      </span>

      <div class="user-admin-actions">
        <button data-user-edit="${user.id}">Edit</button>
        <button
          class="danger-action"
          data-user-delete="${user.id}"
          ${user.id === getSession().user?.uid?.replace("discord:", "") ? "disabled" : ""}
        >
          Delete
        </button>
      </div>
    </article>
  `).join("");
}

function resetUserForm() {
  $("userForm").reset();
  $("userEditId").value = "";
  $("userActive").checked = true;
  $("userRole").value = "employee";
  $("userSaveButton").textContent = "Add User";
  $("userCancelButton").classList.add("hidden");
}

function editUser(id) {
  if (!isOwner()) {
    showToast("Owner access is required.", true);
    return;
  }

  const user = accessUsers.find((item) => item.id === id);
  if (!user) return;

  $("userEditId").value = user.id;
  $("userDiscordId").value = user.discordId || user.id;
  $("userDisplayName").value = user.displayName || "";
  $("userRole").value = user.role || "viewer";
  $("userActive").checked = user.active === true;
  $("userSaveButton").textContent = "Save User";
  $("userCancelButton").classList.remove("hidden");
  $("userDisplayName").focus();
}

async function saveUser(event) {
  event.preventDefault();

  if (!isOwner()) {
    showToast("Owner access is required.", true);
    return;
  }

  const editId = $("userEditId").value.trim();

  // Copy User ID may include hidden formatting. Keep digits only.
  const rawDiscordId = $("userDiscordId").value;
  const discordId = rawDiscordId.replace(/\D/g, "");

  const displayName = $("userDisplayName").value.trim();
  const role = $("userRole").value;
  const active = $("userActive").checked;

  $("userDiscordId").value = discordId;

  if (discordId.length < 15 || discordId.length > 25) {
    showToast(
      `Invalid Discord User ID (${discordId.length} digits found).`,
      true
    );
    return;
  }

  if (!displayName) {
    showToast("Enter a display name.", true);
    return;
  }

  const allowedRoles = ["owner", "admin", "manager", "employee", "viewer"];

  if (!allowedRoles.includes(role)) {
    showToast("Choose a valid role.", true);
    return;
  }

  if (editId && editId !== discordId) {
    showToast("Discord ID cannot be changed while editing. Delete and re-add the user instead.", true);
    return;
  }

  try {
    await setDoc(
      doc(db, ACCESS_USERS_COLLECTION, discordId),
      {
        discordId,
        displayName,
        role,
        active,
        updatedAt: new Date().toISOString(),
        updatedBy: getSession().discordName || "Owner"
      },
      { merge: true }
    );

    await writeAuditLog({
      action: editId ? "User Updated" : "User Added",
      category: "user",
      severity: role === "owner" ? "critical" : "action",
      targetType: "user",
      targetId: discordId,
      targetName: displayName,
      summary: `${getSession().discordName} ${editId ? "updated" : "added"} ${displayName} as ${role}.`,
      details: {
        discordId,
        displayName,
        role,
        active
      }
    });

    showToast(editId ? "User updated." : "User added.");
    resetUserForm();
  } catch (error) {
    console.error(error);
    showToast("The user could not be saved.", true);
  }
}

async function deleteUser(id) {
  if (!isOwner()) {
    showToast("Owner access is required.", true);
    return;
  }

  const currentDiscordId =
    getSession().user?.uid?.replace("discord:", "");

  if (id === currentDiscordId) {
    showToast("You cannot delete your own Owner record.", true);
    return;
  }

  const user = accessUsers.find((item) => item.id === id);
  if (!user) return;

  if (!window.confirm(`Remove access for ${user.displayName || user.discordId}?`)) {
    return;
  }

  try {
    await deleteDoc(doc(db, ACCESS_USERS_COLLECTION, id));

    await writeAuditLog({
      action: "User Access Removed",
      category: "user",
      severity: "critical",
      targetType: "user",
      targetId: id,
      targetName: user.displayName || user.discordId,
      summary: `${getSession().discordName} removed access for ${user.displayName || user.discordId}.`,
      details: user
    });

    showToast("User access removed.");
  } catch (error) {
    console.error(error);
    showToast("The user could not be deleted.", true);
  }
}


export function bindAdminEvents() {
  $("brandingForm").addEventListener("submit", saveBranding);
  $("gangForm").addEventListener("submit", saveGang);
  $("gangCancelButton").addEventListener("click", resetGangForm);

  $("userForm").addEventListener("submit", saveUser);
  $("userCancelButton").addEventListener("click", resetUserForm);

  $("saveNavigationLayoutButton")?.addEventListener(
    "click",
    saveNavigationLayout
  );

  $("resetNavigationLayoutButton")?.addEventListener(
    "click",
    resetNavigationLayout
  );

  $("navigationLayoutList")?.addEventListener(
    "dragstart",
    handleNavigationDragStart
  );

  $("navigationLayoutList")?.addEventListener(
    "dragover",
    handleNavigationDragOver
  );

  $("navigationLayoutList")?.addEventListener(
    "dragleave",
    handleNavigationDragLeave
  );

  $("navigationLayoutList")?.addEventListener(
    "drop",
    handleNavigationDrop
  );

  $("navigationLayoutList")?.addEventListener(
    "dragend",
    handleNavigationDragEnd
  );

  bindRankingManagementEvents();

  syncColorPicker("adminPrimaryColor", "adminPrimaryColorText");
  syncColorPicker("gangColor", "gangColorText");

  document.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-gang-edit]");
    const deleteButton = event.target.closest("[data-gang-delete]");
    const userEditButton = event.target.closest("[data-user-edit]");
    const userDeleteButton = event.target.closest("[data-user-delete]");
    const navigationUpButton = event.target.closest("[data-navigation-up]");
    const navigationDownButton = event.target.closest("[data-navigation-down]");

    if (editButton) editGang(editButton.dataset.gangEdit);
    if (deleteButton) deleteGang(deleteButton.dataset.gangDelete);
    if (userEditButton) editUser(userEditButton.dataset.userEdit);
    if (userDeleteButton) deleteUser(userDeleteButton.dataset.userDelete);

    if (navigationUpButton) {
      moveNavigationItem(
        navigationUpButton.dataset.navigationUp,
        -1
      );
    }

    if (navigationDownButton) {
      moveNavigationItem(
        navigationDownButton.dataset.navigationDown,
        1
      );
    }
  });

  resetGangForm();
  resetUserForm();
  navigationDraft = [
    ...(state.settings.navigationOrder || DEFAULT_NAVIGATION_ORDER)
  ];
  renderNavigationLayoutManager();
  renderHiddenRankingEmployees();
  startUsersListener();
  applyAdminPermissions();
}
