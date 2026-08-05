import { state } from "./state.js";

export const $ = (id) => document.getElementById(id);

const views = {
  dashboard: $("dashboardView"),
  intro: $("introView"),
  "new-entry": $("newEntryView"),
  records: $("recordsView"),
  audit: $("auditView"),
  analytics: $("analyticsView"),
  operations: $("operationsView"),
  inventory: $("inventoryView"),
  "successful-runs": $("successfulRunsView"),
  "unsuccessful-runs": $("unsuccessfulRunsView"),
  "discord-integration": $("discordIntegrationView"),
  admin: $("adminView")
};

export function showView(name) {
  Object.values(views).forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));

  views[name]?.classList.add("active");
  document.querySelector(`[data-view="${name}"]`)?.classList.add("active");

  const labels = {
    dashboard: "Dashboard",
    intro: "Start Here",
    "new-entry": "New Entry",
    records: "All Records",
    audit: "Audit Center",
    analytics: "Intelligence Center",
    operations: "Operations Hub",
    inventory: "Inventory Center",
    "successful-runs": "Successful Runs",
    "unsuccessful-runs": "Unsuccessful Runs",
    "discord-integration": "Discord Integration",
    admin: "Admin Panel"
  };
  $("pageTitle").textContent = labels[name] || "Dashboard";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function setConnection(label, help, online = false) {
  $("connectionLabel").textContent = label;
  $("connectionHelp").textContent = help;
  $("connectionDot").classList.toggle("online", online);
}

export function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");

  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2800);
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

export function safeText(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function hexToRgb(hex) {
  const clean = String(hex).replace("#", "");
  const number = Number.parseInt(clean, 16);
  return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
}

export function applyNavigationOrder() {
  const navigation = document.querySelector(".nav-list");
  if (!navigation) return;

  const order = Array.isArray(state.settings.navigationOrder)
    ? state.settings.navigationOrder
    : [];

  order.forEach((viewName) => {
    const button = navigation.querySelector(
      `[data-view="${viewName}"]`
    );

    if (button) {
      navigation.appendChild(button);
    }
  });

  window.dispatchEvent(
    new CustomEvent("sharedNavigationOrderApplied")
  );
}

export function applyBranding() {
  const { siteTitle, siteSubtitle, primaryColor } = state.settings;
  $("siteTitle").textContent = siteTitle;
  $("siteSubtitle").textContent = siteSubtitle;
  document.title = siteTitle;
  document.documentElement.style.setProperty("--primary", primaryColor);
  document.documentElement.style.setProperty("--primary-rgb", hexToRgb(primaryColor));

  window.dispatchEvent(
    new CustomEvent("brandingApplied")
  );
}

export function refreshGangOptions(selectedGang = null) {
  const groupSelect = $("group");
  const groupFilter = $("groupFilter");
  const previousSelection = selectedGang || groupSelect.value;

  groupSelect.innerHTML = "";
  groupFilter.innerHTML = '<option value="all">All gangs</option>';

  state.settings.gangs.forEach((gang) => {
    groupSelect.add(new Option(gang.name, gang.name));
    groupFilter.add(new Option(gang.name, gang.name));
  });

  if (state.settings.gangs.some((gang) => gang.name === previousSelection)) {
    groupSelect.value = previousSelection;
  }

  updatePriceForSelectedGang(false);
}

export function updatePriceForSelectedGang(force = true) {
  const selected = state.settings.gangs.find((gang) => gang.name === $("group").value);
  if (selected && (force || !$("unitPrice").value)) {
    $("unitPrice").value = selected.unitPrice;
  } else if (!selected && (force || !$("unitPrice").value)) {
    $("unitPrice").value = state.settings.defaultUnitPrice;
  }
}

export function groupColor(groupName) {
  return state.settings.gangs.find((gang) => gang.name === groupName)?.accent
    || state.settings.primaryColor;
}
