import {
  db,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "./firebase.js";
import { getSession } from "./auth.js";
import { $, safeText, showToast } from "./ui.js";
import { currentRole } from "./permissions.js";

export const AUDIT_COLLECTION = "audit_logs";

let auditEntries = [];
let stopAuditListener = null;
let refreshTimer = null;

function canViewAudit() {
  return ["owner", "admin", "manager"].includes(currentRole());
}

export async function writeAuditLog({
  action,
  category = "general",
  severity = "info",
  targetType = "",
  targetId = "",
  targetName = "",
  summary = "",
  details = {}
}) {
  const session = getSession();

  if (!session?.user?.uid) return;

  try {
    await addDoc(collection(db, AUDIT_COLLECTION), {
      action,
      category,
      severity,
      targetType,
      targetId,
      targetName,
      summary,
      details,
      actor: {
        uid: session.user.uid,
        discordId: session.discordId || "",
        name: session.discordName || "Discord User",
        role: session.role || "viewer"
      },
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    });
  } catch (error) {
    console.error("Audit log write failed:", error);
  }
}

export function applyAuditPermissions() {
  const allowed = canViewAudit();

  $("auditNavButton")?.classList.toggle("hidden", !allowed);
  $("dashboardAuditPanel")?.classList.toggle("hidden", !allowed);

  if (!allowed && $("auditView")?.classList.contains("active")) {
    document.querySelector('[data-view="dashboard"]')?.click();
  }
}

export function startAuditListener() {
  stopAuditLogs();

  if (!canViewAudit()) return null;

  const auditQuery = query(
    collection(db, AUDIT_COLLECTION),
    orderBy("createdAtMs", "desc")
  );

  stopAuditListener = onSnapshot(
    auditQuery,
    (snapshot) => {
      auditEntries = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      refreshAuditFilters();
      renderAuditLogs();
      renderRecentAudit();
    },
    (error) => {
      console.error("Audit listener failed:", error);
      showToast("Could not load audit logs.", true);

      const container = $("auditLogList");
      if (container) {
        container.innerHTML =
          '<div class="empty-state">Audit logs could not be loaded. Check Firestore permissions.</div>';
      }
    }
  );

  refreshTimer = window.setInterval(() => {
    renderAuditLogs();
    renderRecentAudit();
  }, 30000);

  return stopAuditListener;
}

export function stopAuditLogs() {
  if (typeof stopAuditListener === "function") {
    stopAuditListener();
  }

  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }

  stopAuditListener = null;
  refreshTimer = null;
  auditEntries = [];
}

function roleLabel(role) {
  const labels = {
    owner: "Owner",
    admin: "Administrator",
    manager: "Manager",
    employee: "Employee",
    viewer: "Viewer"
  };

  return labels[role] || "Unknown";
}

function categoryLabel(category) {
  const labels = {
    transaction: "Transaction",
    user: "User",
    gang: "Gang",
    settings: "Settings",
    security: "Security",
    general: "General"
  };

  return labels[category] || "General";
}

function severityLabel(severity) {
  const labels = {
    info: "Information",
    action: "Action",
    warning: "Warning",
    critical: "Critical"
  };

  return labels[severity] || "Information";
}

function eventDate(entry) {
  return (
    entry.createdAt?.toDate?.() ||
    (entry.createdAtMs ? new Date(entry.createdAtMs) : null)
  );
}

function relativeTime(entry) {
  const date = eventDate(entry);
  if (!date) return "Just now";

  const seconds = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 1000)
  );

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function fullTime(entry) {
  const date = eventDate(entry);
  if (!date) return "Just now";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function matchingEntries() {
  const search = ($("auditSearch")?.value || "").trim().toLowerCase();
  const category = $("auditCategoryFilter")?.value || "all";
  const actor = $("auditUserFilter")?.value || "all";
  const severity = $("auditSeverityFilter")?.value || "all";

  return auditEntries.filter((entry) => {
    const haystack = [
      entry.action,
      entry.summary,
      entry.targetName,
      entry.actor?.name,
      entry.actor?.role,
      JSON.stringify(entry.details || {})
    ].join(" ").toLowerCase();

    return (
      (!search || haystack.includes(search)) &&
      (category === "all" || entry.category === category) &&
      (actor === "all" || entry.actor?.uid === actor) &&
      (severity === "all" || entry.severity === severity)
    );
  });
}

function refreshAuditFilters() {
  const userFilter = $("auditUserFilter");
  if (!userFilter) return;

  const selected = userFilter.value || "all";
  const users = new Map();

  auditEntries.forEach((entry) => {
    if (entry.actor?.uid) {
      users.set(entry.actor.uid, entry.actor.name || "Discord User");
    }
  });

  userFilter.innerHTML = '<option value="all">All users</option>';

  [...users.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([uid, name]) => {
      userFilter.add(new Option(name, uid));
    });

  if (users.has(selected)) {
    userFilter.value = selected;
  }
}

function detailsMarkup(details) {
  if (!details || typeof details !== "object") return "";

  const text = JSON.stringify(details, null, 2);

  return `
    <details class="audit-details">
      <summary>View details</summary>
      <pre>${safeText(text)}</pre>
    </details>
  `;
}

export function renderAuditLogs() {
  const container = $("auditLogList");
  const count = $("auditResultCount");

  if (!container || !count) return;

  const visible = matchingEntries();

  count.textContent =
    `${visible.length} event${visible.length === 1 ? "" : "s"}`;

  if (!visible.length) {
    container.innerHTML =
      '<div class="empty-state">No audit events match your filters.</div>';
    return;
  }

  container.innerHTML = visible.map((entry) => `
    <article class="audit-item severity-${safeText(entry.severity || "info")}">
      <div class="audit-icon"></div>

      <div class="audit-content">
        <div class="audit-title-row">
          <div class="audit-title-group">
            <strong>${safeText(entry.action || "Activity")}</strong>
            <span class="audit-category">
              ${safeText(categoryLabel(entry.category))}
            </span>
          </div>

          <span class="audit-severity">
            ${safeText(severityLabel(entry.severity))}
          </span>
        </div>

        <p>${safeText(entry.summary || "No additional details.")}</p>

        <div class="audit-meta">
          <span>
            ${safeText(entry.actor?.name || "Unknown User")}
            · ${safeText(roleLabel(entry.actor?.role))}
          </span>

          <span title="${safeText(fullTime(entry))}">
            ${safeText(relativeTime(entry))}
          </span>
        </div>

        ${entry.targetName ? `
          <div class="audit-target">
            Target: ${safeText(entry.targetName)}
          </div>
        ` : ""}

        ${detailsMarkup(entry.details)}
      </div>
    </article>
  `).join("");
}

export function renderRecentAudit() {
  const container = $("recentAuditActivity");
  if (!container) return;

  if (!canViewAudit()) {
    container.innerHTML =
      '<div class="empty-state">Audit access is unavailable.</div>';
    return;
  }

  const recent = auditEntries.slice(0, 5);

  if (!recent.length) {
    container.innerHTML =
      '<div class="empty-state">No activity has been recorded yet.</div>';
    return;
  }

  container.innerHTML = recent.map((entry) => `
    <div class="recent-audit-item">
      <span class="recent-audit-dot severity-${safeText(entry.severity || "info")}"></span>
      <div>
        <strong>${safeText(entry.action || "Activity")}</strong>
        <small>
          ${safeText(entry.actor?.name || "Unknown User")}
          · ${safeText(relativeTime(entry))}
        </small>
      </div>
    </div>
  `).join("");
}

export function bindAuditEvents() {
  $("auditSearch")?.addEventListener("input", renderAuditLogs);
  $("auditCategoryFilter")?.addEventListener("change", renderAuditLogs);
  $("auditUserFilter")?.addEventListener("change", renderAuditLogs);
  $("auditSeverityFilter")?.addEventListener("change", renderAuditLogs);
  $("auditClearFilters")?.addEventListener("click", () => {
    $("auditSearch").value = "";
    $("auditCategoryFilter").value = "all";
    $("auditUserFilter").value = "all";
    $("auditSeverityFilter").value = "all";
    renderAuditLogs();
  });
}
