import {
  db,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "./firebase.js";
import { getSession } from "./auth.js";
import { can } from "./permissions.js";
import { writeAuditLog } from "./audit.js";
import { $, safeText, showToast } from "./ui.js";

const COLLECTIONS = {
  announcements: "operations_announcements",
  tasks: "operations_tasks",
  objectives: "operations_objectives",
  notes: "operations_notes",
  events: "operations_events",
  users: "access_users"
};

const state = {
  announcements: [],
  tasks: [],
  objectives: [],
  notes: [],
  events: [],
  users: []
};

let unsubscribers = [];

function session() {
  return getSession();
}

function canManage() {
  return can("manageOperations");
}

function canContributeNotes() {
  return can("contributeNotes");
}

function canUpdateTasks() {
  return can("updateAssignedTasks");
}

function roleLabel(role) {
  return ({
    owner: "Owner",
    admin: "Administrator",
    manager: "Manager",
    employee: "Employee",
    viewer: "Viewer"
  })[role] || "Viewer";
}

function formatDateTime(value) {
  if (!value) return "No date";
  const date = value?.toDate?.() || new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function relativeTime(value) {
  const date = value?.toDate?.() || new Date(value || Date.now());
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function actorPayload() {
  return {
    uid: session().user.uid,
    name: session().discordName,
    role: session().role
  };
}

function currentUserCanUpdateTask(task) {
  if (canManage()) return true;
  if (!canUpdateTasks()) return false;

  return (
    task.assignedToUid === "all" ||
    task.assignedToUid === session().user?.uid
  );
}

function currentUserCanEditNote(note) {
  if (canManage()) return true;
  return canContributeNotes() && note.createdBy?.uid === session().user?.uid;
}

export function applyOperationsPermissions() {
  const view = can("viewOperations");
  const manage = canManage();
  const notes = canContributeNotes();

  $("operationsNavButton")?.classList.toggle("hidden", !view);

  document.querySelectorAll("[data-operations-manage]").forEach((element) => {
    element.classList.toggle("hidden", !manage);
  });

  $("noteForm")?.classList.toggle("hidden", !notes);

  if (!view && $("operationsView")?.classList.contains("active")) {
    document.querySelector('[data-view="dashboard"]')?.click();
  }

  renderAll();
}

function listen(collectionName, orderField, stateKey, renderFunction) {
  const itemsQuery = query(
    collection(db, collectionName),
    orderBy(orderField, "desc")
  );

  return onSnapshot(
    itemsQuery,
    (snapshot) => {
      state[stateKey] = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));
      renderFunction();
      renderHubSummary();
    },
    (error) => {
      console.error(`${stateKey} listener failed:`, error);
      showToast(`Could not load ${stateKey}.`, true);
    }
  );
}

export function startOperationsListeners() {
  stopOperationsListeners();

  unsubscribers = [
    listen(COLLECTIONS.announcements, "createdAtMs", "announcements", renderAnnouncements),
    listen(COLLECTIONS.tasks, "createdAtMs", "tasks", renderTasks),
    listen(COLLECTIONS.objectives, "createdAtMs", "objectives", renderObjectives),
    listen(COLLECTIONS.notes, "createdAtMs", "notes", renderNotes),
    listen(COLLECTIONS.events, "eventDate", "events", renderEvents),
    onSnapshot(
      collection(db, COLLECTIONS.users),
      (snapshot) => {
        state.users = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((item) => item.active === true)
          .sort((a, b) =>
            String(a.displayName || "").localeCompare(String(b.displayName || ""))
          );
        populateAssigneeOptions();
      }
    )
  ];
}

export function stopOperationsListeners() {
  unsubscribers.forEach((unsubscribe) => {
    if (typeof unsubscribe === "function") unsubscribe();
  });
  unsubscribers = [];
}

async function createRecord(collectionName, payload) {
  return addDoc(collection(db, collectionName), {
    ...payload,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
    createdBy: actorPayload(),
    updatedAt: new Date().toISOString(),
    updatedBy: actorPayload()
  });
}

async function updateRecord(collectionName, id, payload) {
  return updateDoc(doc(db, collectionName, id), {
    ...payload,
    updatedAt: new Date().toISOString(),
    updatedBy: actorPayload()
  });
}

async function removeRecord(collectionName, id) {
  return deleteDoc(doc(db, collectionName, id));
}

function populateAssigneeOptions() {
  const select = $("taskAssignee");
  if (!select) return;

  const selected = select.value || "all";
  select.innerHTML = '<option value="all">All team members</option>';

  state.users.forEach((user) => {
    const option = new Option(
      `${user.displayName || user.discordId} · ${roleLabel(user.role)}`,
      `discord:${user.discordId || user.id}`
    );
    option.dataset.displayName = user.displayName || user.discordId || user.id;
    select.add(option);
  });

  const hasSelected = [...select.options].some(
    (option) => option.value === selected
  );
  select.value = hasSelected ? selected : "all";
}

async function saveAnnouncement(event) {
  event.preventDefault();

  if (!canManage()) {
    showToast("Manager access is required.", true);
    return;
  }

  const title = $("announcementTitle").value.trim();
  const message = $("announcementMessage").value.trim();
  const priority = $("announcementPriority").value;
  const pinned = $("announcementPinned").checked;

  if (!title || !message) {
    showToast("Enter an announcement title and message.", true);
    return;
  }

  try {
    const reference = await createRecord(COLLECTIONS.announcements, {
      title,
      message,
      priority,
      pinned
    });

    await writeAuditLog({
      action: "Announcement Created",
      category: "general",
      severity: priority === "critical" ? "critical" : "action",
      targetType: "announcement",
      targetId: reference.id,
      targetName: title,
      summary: `${session().discordName} created the announcement ${title}.`,
      details: { title, message, priority, pinned }
    });

    $("announcementForm").reset();
    showToast("Announcement published.");
  } catch (error) {
    console.error(error);
    showToast("Announcement could not be published.", true);
  }
}

async function deleteAnnouncement(id) {
  if (!canManage()) return;

  const announcement = state.announcements.find((item) => item.id === id);
  if (!announcement) return;
  if (!window.confirm(`Delete "${announcement.title}"?`)) return;

  await removeRecord(COLLECTIONS.announcements, id);
  await writeAuditLog({
    action: "Announcement Deleted",
    category: "general",
    severity: "warning",
    targetType: "announcement",
    targetId: id,
    targetName: announcement.title,
    summary: `${session().discordName} deleted the announcement ${announcement.title}.`,
    details: announcement
  });
}

async function saveTask(event) {
  event.preventDefault();

  if (!canManage()) {
    showToast("Manager access is required.", true);
    return;
  }

  const assignedToUid = $("taskAssignee").value;
  const selectedOption = $("taskAssignee").selectedOptions[0];
  const assignedToName =
    assignedToUid === "all"
      ? "All team members"
      : selectedOption?.dataset.displayName || selectedOption?.textContent || "Assigned User";

  const payload = {
    title: $("taskTitle").value.trim(),
    description: $("taskDescription").value.trim(),
    priority: $("taskPriority").value,
    status: "todo",
    dueDate: $("taskDueDate").value,
    assignedToUid,
    assignedToName
  };

  if (!payload.title) {
    showToast("Enter a task title.", true);
    return;
  }

  try {
    const reference = await createRecord(COLLECTIONS.tasks, payload);

    await writeAuditLog({
      action: "Task Created",
      category: "general",
      severity: "action",
      targetType: "task",
      targetId: reference.id,
      targetName: payload.title,
      summary: `${session().discordName} assigned ${payload.title} to ${assignedToName}.`,
      details: payload
    });

    $("taskForm").reset();
    showToast("Task created.");
  } catch (error) {
    console.error(error);
    showToast("Task could not be created.", true);
  }
}

async function updateTaskStatus(id, status) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || !currentUserCanUpdateTask(task)) {
    showToast("You cannot update this task.", true);
    return;
  }

  try {
    const payload = {
      status,
      completedAt: status === "completed" ? new Date().toISOString() : "",
      completedBy: status === "completed" ? actorPayload() : null
    };

    await updateRecord(COLLECTIONS.tasks, id, payload);

    await writeAuditLog({
      action: "Task Status Updated",
      category: "general",
      severity: status === "completed" ? "info" : "action",
      targetType: "task",
      targetId: id,
      targetName: task.title,
      summary: `${session().discordName} changed ${task.title} to ${status}.`,
      details: { before: task.status, after: status }
    });

    showToast("Task updated.");
  } catch (error) {
    console.error(error);
    showToast("Task could not be updated.", true);
  }
}

async function deleteTask(id) {
  if (!canManage()) return;

  const task = state.tasks.find((item) => item.id === id);
  if (!task || !window.confirm(`Delete task "${task.title}"?`)) return;

  await removeRecord(COLLECTIONS.tasks, id);
  await writeAuditLog({
    action: "Task Deleted",
    category: "general",
    severity: "warning",
    targetType: "task",
    targetId: id,
    targetName: task.title,
    summary: `${session().discordName} deleted task ${task.title}.`,
    details: task
  });
}

async function saveObjective(event) {
  event.preventDefault();

  if (!canManage()) {
    showToast("Manager access is required.", true);
    return;
  }

  const payload = {
    title: $("objectiveTitle").value.trim(),
    target: Number($("objectiveTarget").value) || 0,
    current: Number($("objectiveCurrent").value) || 0,
    unit: $("objectiveUnit").value.trim() || "units",
    dueDate: $("objectiveDueDate").value
  };

  if (!payload.title || payload.target <= 0) {
    showToast("Enter an objective title and target.", true);
    return;
  }

  const reference = await createRecord(COLLECTIONS.objectives, payload);
  await writeAuditLog({
    action: "Objective Created",
    category: "general",
    severity: "action",
    targetType: "objective",
    targetId: reference.id,
    targetName: payload.title,
    summary: `${session().discordName} created objective ${payload.title}.`,
    details: payload
  });

  $("objectiveForm").reset();
  showToast("Objective created.");
}

async function adjustObjective(id, delta) {
  if (!canManage()) return;

  const objective = state.objectives.find((item) => item.id === id);
  if (!objective) return;

  const current = Math.max(
    0,
    Math.min(Number(objective.target || 0), Number(objective.current || 0) + delta)
  );

  await updateRecord(COLLECTIONS.objectives, id, { current });
  showToast("Objective updated.");
}

async function deleteObjective(id) {
  if (!canManage()) return;

  const objective = state.objectives.find((item) => item.id === id);
  if (!objective || !window.confirm(`Delete objective "${objective.title}"?`)) return;

  await removeRecord(COLLECTIONS.objectives, id);
  await writeAuditLog({
    action: "Objective Deleted",
    category: "general",
    severity: "warning",
    targetType: "objective",
    targetId: id,
    targetName: objective.title,
    summary: `${session().discordName} deleted objective ${objective.title}.`,
    details: objective
  });
}

async function saveNote(event) {
  event.preventDefault();

  if (!canContributeNotes()) {
    showToast("You do not have permission to add notes.", true);
    return;
  }

  const payload = {
    title: $("noteTitle").value.trim(),
    content: $("noteContent").value.trim(),
    pinned: $("notePinned").checked
  };

  if (!payload.title || !payload.content) {
    showToast("Enter a note title and content.", true);
    return;
  }

  const reference = await createRecord(COLLECTIONS.notes, payload);
  await writeAuditLog({
    action: "Shared Note Created",
    category: "general",
    severity: "info",
    targetType: "note",
    targetId: reference.id,
    targetName: payload.title,
    summary: `${session().discordName} added shared note ${payload.title}.`,
    details: payload
  });

  $("noteForm").reset();
  showToast("Note added.");
}

async function deleteNote(id) {
  const note = state.notes.find((item) => item.id === id);
  if (!note || !currentUserCanEditNote(note)) {
    showToast("You cannot delete this note.", true);
    return;
  }

  if (!window.confirm(`Delete note "${note.title}"?`)) return;

  await removeRecord(COLLECTIONS.notes, id);
  await writeAuditLog({
    action: "Shared Note Deleted",
    category: "general",
    severity: "warning",
    targetType: "note",
    targetId: id,
    targetName: note.title,
    summary: `${session().discordName} deleted shared note ${note.title}.`,
    details: note
  });
}

async function saveEvent(event) {
  event.preventDefault();

  if (!canManage()) {
    showToast("Manager access is required.", true);
    return;
  }

  const payload = {
    title: $("eventTitle").value.trim(),
    eventDate: $("eventDate").value,
    location: $("eventLocation").value.trim(),
    description: $("eventDescription").value.trim()
  };

  if (!payload.title || !payload.eventDate) {
    showToast("Enter an event title and date.", true);
    return;
  }

  const reference = await createRecord(COLLECTIONS.events, payload);
  await writeAuditLog({
    action: "Event Created",
    category: "general",
    severity: "action",
    targetType: "event",
    targetId: reference.id,
    targetName: payload.title,
    summary: `${session().discordName} created event ${payload.title}.`,
    details: payload
  });

  $("eventForm").reset();
  showToast("Event scheduled.");
}

async function deleteEvent(id) {
  if (!canManage()) return;

  const item = state.events.find((event) => event.id === id);
  if (!item || !window.confirm(`Delete event "${item.title}"?`)) return;

  await removeRecord(COLLECTIONS.events, id);
  await writeAuditLog({
    action: "Event Deleted",
    category: "general",
    severity: "warning",
    targetType: "event",
    targetId: id,
    targetName: item.title,
    summary: `${session().discordName} deleted event ${item.title}.`,
    details: item
  });
}

function priorityClass(priority) {
  return `priority-${priority || "normal"}`;
}

function renderAnnouncements() {
  const container = $("announcementList");
  if (!container) return;

  const sorted = [...state.announcements].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
  });

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state">No announcements yet.</div>';
    return;
  }

  container.innerHTML = sorted.map((item) => `
    <article class="operations-card announcement-card ${priorityClass(item.priority)}">
      <div class="operations-card-heading">
        <div>
          <span class="operations-tag">${safeText(item.priority || "normal")}</span>
          ${item.pinned ? '<span class="operations-tag pinned">Pinned</span>' : ""}
        </div>
        ${canManage() ? `<button class="icon-danger" data-delete-announcement="${item.id}">Delete</button>` : ""}
      </div>
      <h4>${safeText(item.title)}</h4>
      <p>${safeText(item.message)}</p>
      <small>
        ${safeText(item.createdBy?.name || "Unknown")} ·
        ${relativeTime(item.createdAtMs)}
      </small>
    </article>
  `).join("");
}

function renderTasks() {
  const container = $("taskList");
  if (!container) return;

  if (!state.tasks.length) {
    container.innerHTML = '<div class="empty-state">No tasks yet.</div>';
    return;
  }

  container.innerHTML = state.tasks.map((task) => {
    const canUpdate = currentUserCanUpdateTask(task);
    return `
      <article class="operations-card task-card ${priorityClass(task.priority)}">
        <div class="operations-card-heading">
          <div>
            <span class="operations-tag">${safeText(task.priority || "normal")}</span>
            <span class="operations-tag">${safeText(task.status || "todo")}</span>
          </div>
          ${canManage() ? `<button class="icon-danger" data-delete-task="${task.id}">Delete</button>` : ""}
        </div>
        <h4>${safeText(task.title)}</h4>
        <p>${safeText(task.description || "No description.")}</p>
        <div class="task-meta">
          <span>Assigned: ${safeText(task.assignedToName || "All team members")}</span>
          <span>Due: ${safeText(task.dueDate || "No due date")}</span>
        </div>
        ${canUpdate ? `
          <select data-task-status="${task.id}">
            <option value="todo" ${task.status === "todo" ? "selected" : ""}>To Do</option>
            <option value="in-progress" ${task.status === "in-progress" ? "selected" : ""}>In Progress</option>
            <option value="completed" ${task.status === "completed" ? "selected" : ""}>Completed</option>
            <option value="cancelled" ${task.status === "cancelled" ? "selected" : ""}>Cancelled</option>
          </select>
        ` : ""}
      </article>
    `;
  }).join("");
}

function renderObjectives() {
  const container = $("objectiveList");
  if (!container) return;

  if (!state.objectives.length) {
    container.innerHTML = '<div class="empty-state">No active objectives.</div>';
    return;
  }

  container.innerHTML = state.objectives.map((objective) => {
    const target = Number(objective.target || 0);
    const current = Number(objective.current || 0);
    const percent = target ? Math.min(100, Math.round((current / target) * 100)) : 0;

    return `
      <article class="objective-card">
        <div class="operations-card-heading">
          <div>
            <h4>${safeText(objective.title)}</h4>
            <small>${safeText(objective.dueDate || "No due date")}</small>
          </div>
          ${canManage() ? `<button class="icon-danger" data-delete-objective="${objective.id}">Delete</button>` : ""}
        </div>
        <div class="objective-numbers">
          <strong>${safeText(current)} / ${safeText(target)} ${safeText(objective.unit || "")}</strong>
          <span>${percent}%</span>
        </div>
        <div class="progress">
          <span style="width:${percent}%"></span>
        </div>
        ${canManage() ? `
          <div class="objective-actions">
            <button data-objective-adjust="${objective.id}" data-delta="-1">−1</button>
            <button data-objective-adjust="${objective.id}" data-delta="1">+1</button>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
}

function renderNotes() {
  const container = $("noteList");
  if (!container) return;

  const sorted = [...state.notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
  });

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state">No shared notes.</div>';
    return;
  }

  container.innerHTML = sorted.map((note) => `
    <article class="operations-card note-card">
      <div class="operations-card-heading">
        <div>
          ${note.pinned ? '<span class="operations-tag pinned">Pinned</span>' : ""}
        </div>
        ${currentUserCanEditNote(note) ? `<button class="icon-danger" data-delete-note="${note.id}">Delete</button>` : ""}
      </div>
      <h4>${safeText(note.title)}</h4>
      <p>${safeText(note.content)}</p>
      <small>
        ${safeText(note.createdBy?.name || "Unknown")} ·
        ${relativeTime(note.createdAtMs)}
      </small>
    </article>
  `).join("");
}

function renderEvents() {
  const container = $("eventList");
  if (!container) return;

  const events = [...state.events]
    .sort((a, b) => String(a.eventDate || "").localeCompare(String(b.eventDate || "")));

  if (!events.length) {
    container.innerHTML = '<div class="empty-state">No upcoming events.</div>';
    return;
  }

  container.innerHTML = events.map((item) => `
    <article class="operations-card event-card">
      <div class="operations-card-heading">
        <span class="operations-tag">${safeText(formatDateTime(item.eventDate))}</span>
        ${canManage() ? `<button class="icon-danger" data-delete-event="${item.id}">Delete</button>` : ""}
      </div>
      <h4>${safeText(item.title)}</h4>
      <p>${safeText(item.description || "No description.")}</p>
      <small>${safeText(item.location || "Location not set")}</small>
    </article>
  `).join("");
}

function renderHubSummary() {
  const openTasks = state.tasks.filter(
    (task) => !["completed", "cancelled"].includes(task.status)
  ).length;

  $("hubAnnouncementCount").textContent = state.announcements.length;
  $("hubOpenTaskCount").textContent = openTasks;
  $("hubObjectiveCount").textContent = state.objectives.length;
  $("hubEventCount").textContent = state.events.length;
}

function renderAll() {
  renderAnnouncements();
  renderTasks();
  renderObjectives();
  renderNotes();
  renderEvents();
  renderHubSummary();
}

export function bindOperationsEvents() {
  $("announcementForm")?.addEventListener("submit", saveAnnouncement);
  $("taskForm")?.addEventListener("submit", saveTask);
  $("objectiveForm")?.addEventListener("submit", saveObjective);
  $("noteForm")?.addEventListener("submit", saveNote);
  $("eventForm")?.addEventListener("submit", saveEvent);

  document.addEventListener("change", (event) => {
    const select = event.target.closest("[data-task-status]");
    if (select) {
      updateTaskStatus(select.dataset.taskStatus, select.value);
    }
  });

  document.addEventListener("click", (event) => {
    const deleteAnnouncementButton = event.target.closest("[data-delete-announcement]");
    const deleteTaskButton = event.target.closest("[data-delete-task]");
    const deleteObjectiveButton = event.target.closest("[data-delete-objective]");
    const deleteNoteButton = event.target.closest("[data-delete-note]");
    const deleteEventButton = event.target.closest("[data-delete-event]");
    const objectiveAdjustButton = event.target.closest("[data-objective-adjust]");

    if (deleteAnnouncementButton) deleteAnnouncement(deleteAnnouncementButton.dataset.deleteAnnouncement);
    if (deleteTaskButton) deleteTask(deleteTaskButton.dataset.deleteTask);
    if (deleteObjectiveButton) deleteObjective(deleteObjectiveButton.dataset.deleteObjective);
    if (deleteNoteButton) deleteNote(deleteNoteButton.dataset.deleteNote);
    if (deleteEventButton) deleteEvent(deleteEventButton.dataset.deleteEvent);
    if (objectiveAdjustButton) {
      adjustObjective(
        objectiveAdjustButton.dataset.objectiveAdjust,
        Number(objectiveAdjustButton.dataset.delta || 0)
      );
    }
  });
}
