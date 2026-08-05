import {
  db,
  doc,
  onSnapshot,
  setDoc
} from "./firebase.js";
import { getSession } from "./auth.js";
import { state } from "./state.js";
import {
  $,
  safeText,
  showToast,
  showView
} from "./ui.js";

const PREFERENCES_COLLECTION = "user_preferences";

const DEFAULT_PREFERENCES = {
  hiddenTabs: [],
  favorites: [],
  compactMode: false,
  landingPage: "dashboard",
  theme: "default"
};

const TAB_LABELS = {
  dashboard: "⌂ Dashboard",
  intro: "❔ Start Here",
  "new-entry": "＋ New Entry",
  records: "▤ All Records",
  audit: "📜 Audit Center",
  analytics: "🧠 Intelligence Center",
  operations: "🏠 Operations Hub",
  inventory: "📦 Inventory Center",
  "successful-runs": "🏁 Successful Runs",
  "unsuccessful-runs": "🔴 Unsuccessful Runs",
  "discord-integration": "🔗 Discord Integration",
  admin: "⚙ Admin Panel"
};

const THEME_COLORS = {
  default: null,
  blue: "#5ba8ff",
  orange: "#ff9f43",
  purple: "#a879ff",
  green: "#46d39a"
};

let preferences = { ...DEFAULT_PREFERENCES };
let stopPreferencesListener = null;
let firstSnapshotResolver = null;
let eventsBound = false;

function preferenceReference() {
  const uid = getSession().user?.uid;

  if (!uid) {
    throw new Error("A signed-in Firebase user is required.");
  }

  return doc(db, PREFERENCES_COLLECTION, uid);
}

function normalizeTabs(value) {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value
      .map((item) => String(item))
      .filter((item) => Object.hasOwn(TAB_LABELS, item))
  )];
}

function normalizePreferences(data = {}) {
  const hiddenTabs = normalizeTabs(data.hiddenTabs)
    .filter((tab) => tab !== "dashboard");

  const favorites = normalizeTabs(data.favorites)
    .filter((tab) => !hiddenTabs.includes(tab));

  const landingPage = Object.hasOwn(
    TAB_LABELS,
    String(data.landingPage)
  )
    ? String(data.landingPage)
    : "dashboard";

  const theme = Object.hasOwn(
    THEME_COLORS,
    String(data.theme)
  )
    ? String(data.theme)
    : "default";

  return {
    hiddenTabs,
    favorites,
    compactMode: data.compactMode === true,
    landingPage,
    theme
  };
}

export function getWorkspacePreferences() {
  return {
    hiddenTabs: [...preferences.hiddenTabs],
    favorites: [...preferences.favorites],
    compactMode: preferences.compactMode,
    landingPage: preferences.landingPage,
    theme: preferences.theme
  };
}

function userCanSeeButton(button) {
  return button && !button.classList.contains("hidden");
}

function visibleNavigationButtons() {
  return [...document.querySelectorAll(".nav-list .nav-item")]
    .filter(userCanSeeButton);
}

function applyTheme() {
  const selectedColor = THEME_COLORS[preferences.theme];

  if (selectedColor) {
    document.documentElement.style.setProperty(
      "--primary",
      selectedColor
    );

    const clean = selectedColor.replace("#", "");
    const number = Number.parseInt(clean, 16);
    const rgb =
      `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;

    document.documentElement.style.setProperty(
      "--primary-rgb",
      rgb
    );
  }
}

function applyCompactMode() {
  $("protectedApp")?.classList.toggle(
    "workspace-compact",
    preferences.compactMode
  );
}

function applyPersonalVisibility() {
  document.querySelectorAll(".nav-list .nav-item").forEach((button) => {
    const viewName = button.dataset.view;
    const personallyHidden =
      viewName !== "dashboard" &&
      preferences.hiddenTabs.includes(viewName);

    button.classList.toggle(
      "workspace-personally-hidden",
      personallyHidden
    );
  });
}

function applyFavorites() {
  const navigation = document.querySelector(".nav-list");
  if (!navigation) return;

  const sharedOrder = Array.isArray(state.settings.navigationOrder)
    ? state.settings.navigationOrder
    : [];

  const buttons = new Map(
    [...navigation.querySelectorAll(".nav-item")]
      .map((button) => [button.dataset.view, button])
  );

  const orderedNames = [
    "dashboard",
    ...preferences.favorites.filter(
      (name) => name !== "dashboard"
    ),
    ...sharedOrder.filter(
      (name) =>
        name !== "dashboard" &&
        !preferences.favorites.includes(name)
    )
  ];

  orderedNames.forEach((name) => {
    const button = buttons.get(name);
    if (button) navigation.appendChild(button);
  });
}

function applySearchFilter() {
  const search = ($("sidebarSearchInput")?.value || "")
    .trim()
    .toLowerCase();

  document.querySelectorAll(".nav-list .nav-item").forEach((button) => {
    const label = button.textContent.toLowerCase();

    button.classList.toggle(
      "workspace-search-hidden",
      Boolean(search) && !label.includes(search)
    );
  });
}

export function applyWorkspacePreferences() {
  applyPersonalVisibility();
  applyFavorites();
  applyCompactMode();
  applyTheme();
  applySearchFilter();
  renderWorkspaceControls();
}

function availableTabs() {
  return [...document.querySelectorAll(".nav-list .nav-item")]
    .filter((button) => !button.classList.contains("hidden"))
    .map((button) => button.dataset.view)
    .filter(Boolean);
}

function renderWorkspaceControls() {
  const container = $("workspaceTabSettings");
  const landingPageSelect = $("workspaceLandingPage");
  const themeSelect = $("workspaceTheme");
  const compactCheckbox = $("workspaceCompactMode");

  if (!container || !landingPageSelect) return;

  const tabs = availableTabs();

  container.innerHTML = tabs.map((viewName) => {
    const isDashboard = viewName === "dashboard";
    const hidden = preferences.hiddenTabs.includes(viewName);
    const favorite = preferences.favorites.includes(viewName);

    return `
      <article class="workspace-tab-setting">
        <div class="workspace-tab-setting-main">
          <strong>${safeText(TAB_LABELS[viewName] || viewName)}</strong>
          <small>
            ${isDashboard
              ? "Dashboard is always visible."
              : "These settings only affect your account."}
          </small>
        </div>

        <label class="workspace-mini-toggle">
          <input
            type="checkbox"
            data-workspace-visible="${safeText(viewName)}"
            ${hidden ? "" : "checked"}
            ${isDashboard ? "disabled" : ""}
          >
          <span>Visible</span>
        </label>

        <label class="workspace-mini-toggle">
          <input
            type="checkbox"
            data-workspace-favorite="${safeText(viewName)}"
            ${favorite ? "checked" : ""}
            ${hidden ? "disabled" : ""}
          >
          <span>Favorite</span>
        </label>
      </article>
    `;
  }).join("");

  landingPageSelect.innerHTML = "";

  tabs
    .filter((viewName) => !preferences.hiddenTabs.includes(viewName))
    .forEach((viewName) => {
      landingPageSelect.add(
        new Option(
          TAB_LABELS[viewName] || viewName,
          viewName
        )
      );
    });

  const landingStillAvailable = [
    ...landingPageSelect.options
  ].some((option) => option.value === preferences.landingPage);

  landingPageSelect.value = landingStillAvailable
    ? preferences.landingPage
    : "dashboard";

  compactCheckbox.checked = preferences.compactMode;
  themeSelect.value = preferences.theme;
}

function readWorkspaceForm() {
  const hiddenTabs = [];
  const favorites = [];

  document.querySelectorAll("[data-workspace-visible]")
    .forEach((input) => {
      if (!input.checked && input.dataset.workspaceVisible !== "dashboard") {
        hiddenTabs.push(input.dataset.workspaceVisible);
      }
    });

  document.querySelectorAll("[data-workspace-favorite]")
    .forEach((input) => {
      if (input.checked && !input.disabled) {
        favorites.push(input.dataset.workspaceFavorite);
      }
    });

  return normalizePreferences({
    hiddenTabs,
    favorites,
    compactMode: $("workspaceCompactMode").checked,
    landingPage: $("workspaceLandingPage").value,
    theme: $("workspaceTheme").value
  });
}

async function saveWorkspacePreferences() {
  if (!getSession().user) {
    showToast("Sign in before saving workspace settings.", true);
    return;
  }

  const nextPreferences = readWorkspaceForm();

  try {
    await setDoc(
      preferenceReference(),
      {
        ...nextPreferences,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );

    showToast("Your workspace preferences were saved.");
    closeWorkspacePanel();
  } catch (error) {
    console.error(error);
    showToast("Your workspace preferences could not be saved.", true);
  }
}

async function resetWorkspacePreferences() {
  if (
    !window.confirm(
      "Reset your personal workspace to the default layout?"
    )
  ) {
    return;
  }

  try {
    await setDoc(
      preferenceReference(),
      {
        ...DEFAULT_PREFERENCES,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );

    $("sidebarSearchInput").value = "";
    showToast("Your workspace was reset.");
  } catch (error) {
    console.error(error);
    showToast("Your workspace could not be reset.", true);
  }
}

function openWorkspacePanel() {
  $("workspaceOverlay")?.classList.remove("hidden");
  $("workspacePanel")?.classList.remove("hidden");
  $("profileMenu")?.classList.add("hidden");
  renderWorkspaceControls();
}

function closeWorkspacePanel() {
  $("workspaceOverlay")?.classList.add("hidden");
  $("workspacePanel")?.classList.add("hidden");
}

function toggleProfileMenu() {
  $("profileMenu")?.classList.toggle("hidden");
}

function closeProfileMenuWhenOutside(event) {
  if (
    event.target.closest("#profileMenu") ||
    event.target.closest("#profileMenuButton")
  ) {
    return;
  }

  $("profileMenu")?.classList.add("hidden");
}

function handleWorkspaceToggleChange(event) {
  const visibleInput = event.target.closest(
    "[data-workspace-visible]"
  );

  if (visibleInput) {
    const tabName = visibleInput.dataset.workspaceVisible;
    const favoriteInput = document.querySelector(
      `[data-workspace-favorite="${CSS.escape(tabName)}"]`
    );

    if (favoriteInput) {
      favoriteInput.disabled = !visibleInput.checked;

      if (!visibleInput.checked) {
        favoriteInput.checked = false;
      }
    }

    const preview = readWorkspaceForm();
    preferences = preview;
    applyWorkspacePreferences();
    openWorkspacePanel();
    return;
  }

  const favoriteInput = event.target.closest(
    "[data-workspace-favorite]"
  );

  if (favoriteInput) {
    const preview = readWorkspaceForm();
    preferences = preview;
    applyWorkspacePreferences();
    openWorkspacePanel();
  }
}

export function resolveWorkspaceLandingPage() {
  const requested = preferences.landingPage || "dashboard";
  const button = document.querySelector(
    `.nav-list [data-view="${CSS.escape(requested)}"]`
  );

  if (
    !button ||
    button.classList.contains("hidden") ||
    button.classList.contains("workspace-personally-hidden")
  ) {
    return "dashboard";
  }

  return requested;
}

export async function startWorkspacePreferences() {
  stopWorkspacePreferences();

  if (!getSession().user) {
    preferences = { ...DEFAULT_PREFERENCES };
    applyWorkspacePreferences();
    return preferences;
  }

  const readyPromise = new Promise((resolve) => {
    firstSnapshotResolver = resolve;
  });

  stopPreferencesListener = onSnapshot(
    preferenceReference(),
    async (snapshot) => {
      if (!snapshot.exists()) {
        await setDoc(
          preferenceReference(),
          {
            ...DEFAULT_PREFERENCES,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          { merge: true }
        );

        preferences = { ...DEFAULT_PREFERENCES };
      } else {
        preferences = normalizePreferences(snapshot.data());
      }

      applyWorkspacePreferences();

      if (firstSnapshotResolver) {
        firstSnapshotResolver(preferences);
        firstSnapshotResolver = null;
      }
    },
    (error) => {
      console.error("Workspace preferences listener failed:", error);
      preferences = { ...DEFAULT_PREFERENCES };
      applyWorkspacePreferences();

      if (firstSnapshotResolver) {
        firstSnapshotResolver(preferences);
        firstSnapshotResolver = null;
      }

      showToast("Personal workspace settings could not be loaded.", true);
    }
  );

  return readyPromise;
}

export function stopWorkspacePreferences() {
  if (typeof stopPreferencesListener === "function") {
    stopPreferencesListener();
  }

  stopPreferencesListener = null;
  firstSnapshotResolver = null;
  preferences = { ...DEFAULT_PREFERENCES };

  $("protectedApp")?.classList.remove("workspace-compact");

  document.querySelectorAll(".nav-list .nav-item").forEach((button) => {
    button.classList.remove(
      "workspace-personally-hidden",
      "workspace-search-hidden"
    );
  });
}

export function bindWorkspaceEvents() {
  if (eventsBound) return;
  eventsBound = true;

  $("profileMenuButton")?.addEventListener(
    "click",
    toggleProfileMenu
  );

  $("customizeWorkspaceButton")?.addEventListener(
    "click",
    openWorkspacePanel
  );

  $("workspaceCloseButton")?.addEventListener(
    "click",
    closeWorkspacePanel
  );

  $("workspaceOverlay")?.addEventListener(
    "click",
    closeWorkspacePanel
  );

  $("workspaceSaveButton")?.addEventListener(
    "click",
    saveWorkspacePreferences
  );

  $("workspaceResetButton")?.addEventListener(
    "click",
    resetWorkspacePreferences
  );

  $("workspaceTabSettings")?.addEventListener(
    "change",
    handleWorkspaceToggleChange
  );

  $("workspaceCompactMode")?.addEventListener("change", () => {
    preferences = readWorkspaceForm();
    applyWorkspacePreferences();
    openWorkspacePanel();
  });

  $("workspaceLandingPage")?.addEventListener("change", () => {
    preferences = readWorkspaceForm();
  });

  $("workspaceTheme")?.addEventListener("change", () => {
    preferences = readWorkspaceForm();
    applyWorkspacePreferences();
    openWorkspacePanel();
  });

  $("sidebarSearchInput")?.addEventListener(
    "input",
    applySearchFilter
  );

  document.addEventListener(
    "click",
    closeProfileMenuWhenOutside
  );

  window.addEventListener(
    "sharedNavigationOrderApplied",
    applyWorkspacePreferences
  );

  window.addEventListener(
    "brandingApplied",
    applyWorkspacePreferences
  );
}
