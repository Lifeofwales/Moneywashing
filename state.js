export const TRANSACTIONS_COLLECTION = "rp_transactions";
export const SETTINGS_COLLECTION = "app_settings";
export const SETTINGS_DOCUMENT = "config";

export const fallbackSettings = {
  siteTitle: "Money Washing Tracker",
  siteSubtitle: "Shared transaction records",
  primaryColor: "#5ba8ff",
  defaultUnitPrice: 60,
  gangs: [
    { id: "bv", name: "BV", accent: "#5ba8ff", unitPrice: 60 },
    { id: "dreaded", name: "Dreaded", accent: "#a879ff", unitPrice: 60 },
    { id: "lssr", name: "LSSR", accent: "#16a34a", unitPrice: 60 }
  ]
};

export const state = {
  records: [],
  settings: structuredClone(fallbackSettings),
  editingRecordId: null
};

export function normalizeHex(value, fallback = "#5ba8ff") {
  const candidate = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toLowerCase() : fallback;
}

export function slugify(value) {
  const result = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return result || `gang-${Date.now()}`;
}

export function normalizeSettings(data = {}) {
  const gangs = Array.isArray(data.gangs) && data.gangs.length
    ? data.gangs.map((gang, index) => ({
        id: String(gang.id || slugify(gang.name || `gang-${index + 1}`)),
        name: String(gang.name || `Gang ${index + 1}`).trim(),
        accent: normalizeHex(gang.accent, "#5ba8ff"),
        unitPrice: Number(gang.unitPrice ?? data.defaultUnitPrice ?? 60) || 0
      }))
    : structuredClone(fallbackSettings.gangs);

  return {
    siteTitle: String(data.siteTitle || fallbackSettings.siteTitle),
    siteSubtitle: String(data.siteSubtitle || fallbackSettings.siteSubtitle),
    primaryColor: normalizeHex(data.primaryColor, fallbackSettings.primaryColor),
    defaultUnitPrice: Number(data.defaultUnitPrice ?? fallbackSettings.defaultUnitPrice) || 0,
    gangs
  };
}
