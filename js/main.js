import { ensureSettingsDocument, startSettingsListener, bindAdminEvents } from "./admin.js";
import {
  startTransactionListener,
  bindTransactionEvents,
  resetTransactionForm
} from "./transactions.js";
import { $, showView, setConnection, showToast } from "./ui.js";

async function initialize() {
  try {
    setConnection("Connecting…", "Checking Firebase", false);

    bindNavigation();
    bindTransactionEvents();
    bindAdminEvents();

    await ensureSettingsDocument();
    startSettingsListener();
    startTransactionListener();

    resetTransactionForm();
    setConnection("Shared database", "Live updates enabled", true);
  } catch (error) {
    console.error(error);
    setConnection("Database error", "Check Firebase rules and configuration", false);
    showToast("The website could not connect to Firebase.", true);
  }
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

initialize();
