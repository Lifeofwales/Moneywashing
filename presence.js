import {
  db,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot
} from "./firebase.js";
import { $, safeText } from "./ui.js";

const PRESENCE_COLLECTION = "active_sessions";
const HEARTBEAT_INTERVAL_MS = 30000;
const ONLINE_WINDOW_MS = 90000;

let heartbeatTimer = null;
let currentPresenceId = null;
let stopPresenceListener = null;
let latestPresenceUsers = [];

function roleLabel(role) {
  const labels = {
    owner: "Owner",
    admin: "Administrator",
    manager: "Manager",
    employee: "Employee",
    viewer: "Viewer"
  };

  return labels[role] || "Viewer";
}

function presenceReference(uid) {
  return doc(db, PRESENCE_COLLECTION, uid);
}

async function writePresence(session) {
  if (!session?.user?.uid) return;

  currentPresenceId = session.user.uid;

  await setDoc(
    presenceReference(currentPresenceId),
    {
      uid: currentPresenceId,
      discordId: session.discordId || "",
      displayName: session.discordName || "Discord User",
      role: session.role || "viewer",
      lastSeenMs: Date.now()
    },
    { merge: true }
  );
}

export async function startPresence(session) {
  stopPresence();

  if (!session?.user?.uid) return;

  try {
    await writePresence(session);
  } catch (error) {
    console.error("Could not start presence:", error);
  }

  heartbeatTimer = window.setInterval(async () => {
    try {
      await writePresence(session);
    } catch (error) {
      console.error("Presence heartbeat failed:", error);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

export function stopPresence() {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (currentPresenceId) {
    deleteDoc(presenceReference(currentPresenceId)).catch(() => {});
    currentPresenceId = null;
  }
}

export function startActiveUsersListener() {
  if (stopPresenceListener) {
    stopPresenceListener();
  }

  stopPresenceListener = onSnapshot(
    collection(db, PRESENCE_COLLECTION),
    (snapshot) => {
      latestPresenceUsers = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      renderActiveUsers();
    },
    (error) => {
      console.error("Could not load active users:", error);
      renderPresenceMessage("Active users unavailable");
    }
  );

  return stopPresenceListener;
}

export function stopActiveUsersListener() {
  if (typeof stopPresenceListener === "function") {
    stopPresenceListener();
  }

  stopPresenceListener = null;
  latestPresenceUsers = [];
  renderPresenceMessage("Sign in to view");
}

export function renderActiveUsers() {
  const container = $("activeUsersList");
  const count = $("activeUsersCount");

  if (!container || !count) return;

  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  const activeUsers = latestPresenceUsers
    .filter((user) => Number(user.lastSeenMs || 0) >= cutoff)
    .sort((a, b) =>
      String(a.displayName || "").localeCompare(String(b.displayName || ""))
    );

  count.textContent = String(activeUsers.length);

  if (!activeUsers.length) {
    container.innerHTML =
      '<div class="active-users-empty">No active users</div>';
    return;
  }

  container.innerHTML = activeUsers.map((user) => `
    <div class="active-user-row">
      <span class="active-user-dot"></span>
      <div>
        <strong>${safeText(user.displayName || "Discord User")}</strong>
        <small>${safeText(roleLabel(user.role))}</small>
      </div>
    </div>
  `).join("");
}

function renderPresenceMessage(message) {
  const container = $("activeUsersList");
  const count = $("activeUsersCount");

  if (count) count.textContent = "0";
  if (container) {
    container.innerHTML =
      `<div class="active-users-empty">${safeText(message)}</div>`;
  }
}

window.addEventListener("beforeunload", () => {
  if (currentPresenceId) {
    deleteDoc(presenceReference(currentPresenceId)).catch(() => {});
  }
});
