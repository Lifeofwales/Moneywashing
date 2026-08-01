import {
  ensureSettingsDocument,
  startSettingsListener,
  bindAdminEvents,
  applyAdminPermissions
} from "./admin.js";
import {
  startTransactionListener,
  bindTransactionEvents,
  resetTransactionForm,
  applyTransactionPermissions
} from "./transactions.js";
import {
  initializeAuthentication,
  logout,
  DISCORD_LOGIN_URL
} from "./auth.js";
import {
  $,
  showView,
  setConnection,
  showToast
} from "./ui.js";
import {
  startPresence,
  stopPresence,
  startActiveUsersListener,
  stopActiveUsersListener
} from "./presence.js";

let unsubscribeSettings = null;
let unsubscribeTransactions = null;
let appEventsBound = false;

async function initialize() {
  bindAuthenticationButtons();

  await initializeAuthentication(async (session) => {
    if (!session.user) {
      stopPresence();
      stopActiveUsersListener();
      stopLiveListeners();
      setConnection("Signed out", "Discord login required", false);
      return;
    }

    try {
      setConnection("Connecting…", "Checking Firebase", false);

      if (!appEventsBound) {
        bindNavigation();
        bindTransactionEvents();
        bindAdminEvents();
        appEventsBound = true;
      }

      // Refresh role-based controls every time authentication changes.
      applyAdminPermissions();
      applyTransactionPermissions();

      await startPresence(session);
      startActiveUsersListener();

      await ensureSettingsDocument();

      stopLiveListeners();
      unsubscribeSettings = startSettingsListener();
      unsubscribeTransactions = startTransactionListener();

      resetTransactionForm();
      showView("dashboard");
      setConnection("Shared database", "Discord authenticated", true);
    } catch (error) {
      console.error(error);
      setConnection(
        "Database error",
        "Check authentication and Firestore rules",
        false
      );
      showToast("The website could not connect to Firebase.", true);
    }
  });
}

function bindAuthenticationButtons() {
  $("discordLoginButton").addEventListener("click", () => {
    window.location.href = DISCORD_LOGIN_URL;
  });

  $("logoutButton").addEventListener("click", logout);
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => showView(item.dataset.view));
  });

  document.querySelectorAll("[data-go-view]").forEach((item) => {
    item.addEventListener("click", () => showView(item.dataset.goView));
  });

  $("quickAddButton").addEventListener("click", () => {
    resetTransactionForm();
    showView("new-entry");
  });
}

function stopLiveListeners() {
  if (typeof unsubscribeSettings === "function") {
    unsubscribeSettings();
    unsubscribeSettings = null;
  }

  if (typeof unsubscribeTransactions === "function") {
    unsubscribeTransactions();
    unsubscribeTransactions = null;
  }
}

initialize();
