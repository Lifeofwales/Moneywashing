import {
  db,
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from "./firebase.js";
import {
  state,
  fallbackSettings,
  normalizeSettings,
  normalizeHex,
  slugify,
  SETTINGS_COLLECTION,
  SETTINGS_DOCUMENT
} from "./state.js";
import {
  $,
  applyBranding,
  refreshGangOptions,
  showToast,
  formatCurrency,
  safeText
} from "./ui.js";
import { renderAll, resetTransactionForm } from "./transactions.js";
import { getSession } from "./auth.js";

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
    applyBranding();
    refreshGangOptions();
    populateBrandingForm();
    renderGangList();
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
  if (!getSession().isAdmin) {
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

  const primaryColor = normalizeHex(
    $("adminPrimaryColorText").value,
    $("adminPrimaryColor").value
  );

  await saveSettings({
    ...state.settings,
    siteTitle: $("adminSiteTitle").value.trim(),
    siteSubtitle: $("adminSiteSubtitle").value.trim(),
    primaryColor,
    defaultUnitPrice: Number($("adminDefaultPrice").value) || 0
  }, "Website settings saved.");
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
  resetGangForm();
}

async function deleteGang(id) {
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

export function bindAdminEvents() {
  $("brandingForm").addEventListener("submit", saveBranding);
  $("gangForm").addEventListener("submit", saveGang);
  $("gangCancelButton").addEventListener("click", resetGangForm);

  syncColorPicker("adminPrimaryColor", "adminPrimaryColorText");
  syncColorPicker("gangColor", "gangColorText");

  document.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-gang-edit]");
    const deleteButton = event.target.closest("[data-gang-delete]");

    if (editButton) editGang(editButton.dataset.gangEdit);
    if (deleteButton) deleteGang(deleteButton.dataset.gangDelete);
  });

  resetGangForm();
}
