import { getSession } from "./auth.js";

const ROLE_PERMISSIONS = {
  owner: {
    view: true,
    createTransaction: true,
    editTransaction: true,
    deleteTransaction: true,
    manageSettings: true,
    manageGangs: true,
    manageUsers: true,
    viewAnalytics: true,
    viewAudit: true,
    viewOperations: true,
    manageOperations: true,
    contributeNotes: true,
    updateAssignedTasks: true
  },
  admin: {
    view: true,
    createTransaction: true,
    editTransaction: true,
    deleteTransaction: true,
    manageSettings: true,
    manageGangs: true,
    manageUsers: false,
    viewAnalytics: true,
    viewAudit: true,
    viewOperations: true,
    manageOperations: true,
    contributeNotes: true,
    updateAssignedTasks: true
  },
  manager: {
    view: true,
    createTransaction: true,
    editTransaction: true,
    deleteTransaction: false,
    manageSettings: false,
    manageGangs: false,
    manageUsers: false,
    viewAnalytics: true,
    viewAudit: true,
    viewOperations: true,
    manageOperations: true,
    contributeNotes: true,
    updateAssignedTasks: true
  },
  employee: {
    view: true,
    createTransaction: true,
    editTransaction: false,
    deleteTransaction: false,
    manageSettings: false,
    manageGangs: false,
    manageUsers: false,
    viewAnalytics: false,
    viewAudit: false,
    viewOperations: true,
    manageOperations: false,
    contributeNotes: true,
    updateAssignedTasks: true
  },
  viewer: {
    view: true,
    createTransaction: false,
    editTransaction: false,
    deleteTransaction: false,
    manageSettings: false,
    manageGangs: false,
    manageUsers: false,
    viewAnalytics: false,
    viewAudit: false,
    viewOperations: true,
    manageOperations: false,
    contributeNotes: false,
    updateAssignedTasks: false
  }
};

export function currentRole() {
  const role = String(getSession().role || "viewer").toLowerCase();
  return ROLE_PERMISSIONS[role] ? role : "viewer";
}

export function permissions() {
  return ROLE_PERMISSIONS[currentRole()];
}

export function can(permissionName) {
  return permissions()[permissionName] === true;
}

export function isOwner() {
  return currentRole() === "owner";
}

export function isAdministrator() {
  return currentRole() === "owner" || currentRole() === "admin";
}

export function transactionPermissions() {
  const current = permissions();

  return {
    create: current.createTransaction,
    edit: current.editTransaction,
    delete: current.deleteTransaction
  };
}
