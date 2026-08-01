import { getSession, DISCORD_LOGIN_URL } from "./auth.js";
import { can } from "./permissions.js";
import { $, showToast } from "./ui.js";

const WORKER_BASE_URL = DISCORD_LOGIN_URL.replace(/\/login\/?$/, "");

function canManageDiscord() {
  return can("manageDiscordIntegration");
}

export function applyDiscordPermissions() {
  const allowed = canManageDiscord();

  $("discordIntegrationNavButton")?.classList.toggle("hidden", !allowed);

  if (
    !allowed &&
    $("discordIntegrationView")?.classList.contains("active")
  ) {
    document.querySelector('[data-view="dashboard"]')?.click();
  }
}

async function authenticatedWorkerRequest(path, payload) {
  const session = getSession();

  if (!session?.user) {
    throw new Error("You must be signed in.");
  }

  const idToken = await session.user.getIdToken(true);

  const response = await fetch(`${WORKER_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });

  let result;

  try {
    result = await response.json();
  } catch {
    result = {
      success: false,
      error: `Worker returned HTTP ${response.status}.`
    };
  }

  if (!response.ok || result.success === false) {
    throw new Error(
      result.error ||
      result.message ||
      `Worker request failed with HTTP ${response.status}.`
    );
  }

  return result;
}

export async function sendDiscordNotification(route, payload) {
  try {
    return await authenticatedWorkerRequest(
      `/discord/${route}`,
      payload
    );
  } catch (error) {
    console.error(`Discord ${route} notification failed:`, error);
    return {
      success: false,
      error: error.message || "Discord notification failed."
    };
  }
}

async function testDiscordIntegration() {
  if (!canManageDiscord()) {
    showToast("Owner access is required.", true);
    return;
  }

  const button = $("discordTestButton");
  const status = $("discordIntegrationStatus");

  button.disabled = true;
  button.textContent = "Sending…";
  status.textContent = "Contacting the Worker…";
  status.className = "discord-status-card pending";

  try {
    const result = await authenticatedWorkerRequest(
      "/discord/test",
      {
        message:
          $("discordTestMessage").value.trim() ||
          "The Revenants Discord integration is online."
      }
    );

    status.textContent =
      result.message || "The Discord test message was sent.";
    status.className = "discord-status-card success";
    $("discordLastTest").textContent = new Date().toLocaleString();
    showToast("Discord test message sent.");
  } catch (error) {
    status.textContent = error.message;
    status.className = "discord-status-card error";
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Send Test Message";
  }
}

export function bindDiscordIntegrationEvents() {
  $("discordTestButton")?.addEventListener(
    "click",
    testDiscordIntegration
  );
}
