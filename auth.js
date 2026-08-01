import {
  auth,
  signInWithCustomToken,
  onAuthStateChanged,
  signOut
} from "./firebase.js";

import { $, showToast } from "./ui.js";

export const DISCORD_LOGIN_URL =
  "https://moneywashing-discord-auth.themidnighttuner0.workers.dev/login";

let currentSession = {
  user: null,
  token: null,
  role: "viewer",
  isOwner: false,
  isAdmin: false,
  isManager: false,
  discordName: "",
  discordAvatar: ""
};

export function getSession() {
  return currentSession;
}

export async function initializeAuthentication(onReady) {
  showSignedOutState();

  const customToken = readCustomTokenFromHash();

  if (customToken) {
    try {
      $("authStatus").textContent = "Finishing Discord login…";
      await signInWithCustomToken(auth, customToken);
      clearTokenFromAddress();
    } catch (error) {
      console.error(error);
      clearTokenFromAddress();
      showToast("Discord sign-in could not be completed.", true);
    }
  }

  return new Promise((resolve) => {
    let firstCheck = true;

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tokenResult = await user.getIdTokenResult(true);
        const claims = tokenResult.claims;

        currentSession = {
          user,
          token: tokenResult.token,
          role: claims.role || "viewer",
          isOwner: claims.owner === true,
          isAdmin: claims.admin === true,
          isManager: claims.manager === true,

          discordName:
            claims.discordDisplayName ||
            claims.discordUsername ||
            "Discord User",

          discordAvatar: buildDiscordAvatar(
            claims.discordId,
            claims.discordAvatar
          )
        };

        showSignedInState();
      } else {
        currentSession = {
          user: null,
          token: null,
          role: "viewer",
          isOwner: false,
          isAdmin: false,
          isManager: false,
          discordName: "",
          discordAvatar: ""
        };

        showSignedOutState();
      }

      await onReady?.(currentSession);

      if (firstCheck) {
        firstCheck = false;
        resolve(currentSession);
      }
    });
  });
}

export async function logout() {
  try {
    await signOut(auth);
    showToast("Signed out.");
  } catch (error) {
    console.error(error);
    showToast("Could not sign out.", true);
  }
}

function readCustomTokenFromHash() {
  const hash = window.location.hash.replace(/^#/, "");

  if (!hash) {
    return null;
  }

  const parameters = new URLSearchParams(hash);

  return parameters.get("discordToken");
}

function clearTokenFromAddress() {
  history.replaceState(
    null,
    document.title,
    `${window.location.pathname}${window.location.search}`
  );
}

function showSignedOutState() {
  $("authGate").classList.remove("hidden");
  $("protectedApp").classList.add("hidden");
  $("authStatus").textContent = "Sign in with Discord to continue.";
  $("adminNavButton").classList.add("hidden");

  const roleElement = $("discordUserRole");
  if (roleElement) {
    roleElement.textContent = "SIGNED OUT";
    roleElement.className =
      "sidebar-role-badge sidebar-role-viewer";
  }
}

function showSignedInState() {
  $("authGate").classList.add("hidden");
  $("protectedApp").classList.remove("hidden");

  $("discordUserName").textContent = currentSession.discordName;

  const roleNames = {
    owner: "👑 OWNER",
    admin: "🛡 ADMINISTRATOR",
    manager: "👔 MANAGER",
    employee: "👷 EMPLOYEE",
    viewer: "👀 VIEWER"
  };

  const roleElement = $("discordUserRole");
  roleElement.textContent =
    roleNames[currentSession.role] || "UNKNOWN";
  roleElement.className = "sidebar-role-badge";
  roleElement.classList.add(
    `sidebar-role-${currentSession.role || "viewer"}`
  );

  const avatar = $("discordUserAvatar");

  if (currentSession.discordAvatar) {
    avatar.src = currentSession.discordAvatar;
    avatar.classList.remove("hidden");
    $("discordAvatarFallback").classList.add("hidden");
  } else {
    avatar.removeAttribute("src");
    avatar.classList.add("hidden");
    $("discordAvatarFallback").classList.remove("hidden");

    $("discordAvatarFallback").textContent =
      currentSession.discordName
        .slice(0, 1)
        .toUpperCase();
  }

  $("adminNavButton").classList.toggle(
    "hidden",
    !(
      currentSession.role === "owner" ||
      currentSession.role === "admin"
    )
  );
}

function buildDiscordAvatar(discordId, avatarHash) {
  if (!discordId || !avatarHash) {
    return "";
  }

  const extension =
    avatarHash.startsWith("a_")
      ? "gif"
      : "png";

  return (
    `https://cdn.discordapp.com/avatars/` +
    `${discordId}/${avatarHash}.${extension}?size=128`
  );
}
