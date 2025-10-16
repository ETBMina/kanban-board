"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => KanbanPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/models.ts
var DEFAULT_SETTINGS = {
  taskFolder: "Tasks",
  statuses: ["Backlog", "In Progress", "Blocked", "Review", "Done"],
  templateFields: [
    { key: "title", label: "Title", type: "text" },
    { key: "status", label: "Status", type: "status" },
    { key: "priority", label: "Priority", type: "status" },
    { key: "assignee", label: "Assignee", type: "people" },
    { key: "startDate", label: "Start Date", type: "date" },
    { key: "endDate", label: "End Date", type: "date" },
    { key: "tags", label: "Tags", type: "tags" },
    { key: "crNumber", label: "CR Number", type: "text" },
    { key: "plannedStart", label: "Planned start date", type: "date" },
    { key: "plannedEnd", label: "Planned end date", type: "date" },
    { key: "actualStart", label: "Actual start date", type: "date" },
    { key: "actualEnd", label: "Actual end date", type: "date" },
    { key: "notes", label: "Notes", type: "text" }
  ],
  gridVisibleColumns: ["title", "status", "priority", "assignee", "startDate", "endDate", "tags"],
  crFolder: "Change Requests",
  crTemplateFields: [
    { key: "number", label: "CR Number", type: "text" },
    { key: "title", label: "Title", type: "text" },
    { key: "emailSubject", label: "Email Subject", type: "text" },
    { key: "solutionDesign", label: "Solution design link", type: "url" },
    { key: "description", label: "Description", type: "text" }
  ]
};

// src/settings.ts
var import_obsidian = require("obsidian");
var KanbanSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Kanban Board & Task Grid" });
    new import_obsidian.Setting(containerEl).setName("Task folder").setDesc("Folder where task notes are stored").addText((text) => {
      text.setPlaceholder("Tasks").setValue(this.plugin.settings.taskFolder).onChange(async (value) => {
        this.plugin.settings.taskFolder = value || "Tasks";
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Statuses (comma-separated)").setDesc("Columns shown in the Kanban view").addText((text) => {
      text.setPlaceholder("Backlog, In Progress, Blocked, Review, Done").setValue(this.plugin.settings.statuses.join(", ")).onChange(async (value) => {
        this.plugin.settings.statuses = value.split(",").map((s) => s.trim()).filter(Boolean);
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Grid visible columns (keys, comma-separated)").setDesc("Which fields to display in the grid").addText((text) => {
      text.setPlaceholder("title, status, priority, assignee, due, tags").setValue(this.plugin.settings.gridVisibleColumns.join(", ")).onChange(async (value) => {
        this.plugin.settings.gridVisibleColumns = value.split(",").map((s) => s.trim()).filter(Boolean);
        await this.plugin.saveSettings();
      });
    });
    containerEl.createEl("p", { text: "Template fields can be edited in JSON within your data.json for now. A richer editor will be added." });
  }
};

// src/utils.ts
var import_obsidian2 = require("obsidian");
async function ensureFolder(app, folderPath) {
  const path = (0, import_obsidian2.normalizePath)(folderPath);
  try {
    await app.vault.createFolder(path);
  } catch (e) {
  }
}
function buildFrontmatterYAML(frontmatter) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === void 0 || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const rendered = value.map((v) => escapeYamlInline(v)).join(", ");
      lines.push(`${key}: [${rendered}]`);
    } else if (typeof value === "string" && value.trim() === "") {
      continue;
    } else {
      lines.push(`${key}: ${escapeYaml(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}
function escapeYaml(value) {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") {
    if (/[:#\-]|^\s|\s$/.test(value)) return JSON.stringify(value);
    return value;
  }
  return String(value);
}
function escapeYamlInline(value) {
  if (value === null || value === void 0) return "";
  const s = String(value);
  if (/[",\[\]:\n]/.test(s) || /^\s|\s$/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
async function readAllTasks(app, settings) {
  var _a;
  const folder = (0, import_obsidian2.normalizePath)(settings.taskFolder);
  const results = [];
  const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/"));
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const fm = (_a = cache == null ? void 0 : cache.frontmatter) != null ? _a : {};
    results.push({ filePath: file.path, fileName: file.name.replace(/\.md$/, ""), frontmatter: fm });
  }
  return results;
}
async function updateTaskFrontmatter(app, file, patch) {
  var _a, _b, _c, _d, _e, _f, _g;
  const content = await app.vault.read(file);
  const cache = app.metadataCache.getFileCache(file);
  const start = (_c = (_b = (_a = cache == null ? void 0 : cache.frontmatterPosition) == null ? void 0 : _a.start) == null ? void 0 : _b.offset) != null ? _c : -1;
  const end = (_f = (_e = (_d = cache == null ? void 0 : cache.frontmatterPosition) == null ? void 0 : _d.end) == null ? void 0 : _e.offset) != null ? _f : -1;
  const current = (_g = cache == null ? void 0 : cache.frontmatter) != null ? _g : {};
  const merged = { ...current, ...patch };
  const yaml = buildFrontmatterYAML(merged);
  let next;
  if (start >= 0 && end > start) {
    const after = content.slice(end);
    const needsNewline = after.startsWith("\n") ? "" : "\n";
    next = content.slice(0, start) + yaml + needsNewline + after;
  } else {
    const body = content;
    const sep = body.length === 0 ? "\n" : body.startsWith("\n") ? "\n" : "\n\n";
    next = yaml + sep + body;
  }
  await app.vault.modify(file, next);
}
function buildWikiLink(path) {
  const p = (0, import_obsidian2.normalizePath)(path);
  return `[[${p}]]`;
}
async function findCrFileByNumber(app, settings, crNumber) {
  var _a;
  const folder = (0, import_obsidian2.normalizePath)(settings.crFolder || "Change Requests");
  const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/"));
  for (const file of files) {
    const fm = (_a = app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
    if (fm && String(fm["number"] || fm["crNumber"] || "").toLowerCase() === crNumber.toLowerCase()) {
      return file;
    }
    if (file.name.toLowerCase().startsWith(crNumber.toLowerCase() + " ")) return file;
  }
  return null;
}
async function generateNextCrNumber(app, settings) {
  var _a;
  const folder = (0, import_obsidian2.normalizePath)(settings.crFolder || "Change Requests");
  const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/"));
  let max = 0;
  const rx = /^CR-(\d+)/i;
  for (const file of files) {
    const fm = (_a = app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
    const fromFm = String((fm == null ? void 0 : fm["number"]) || (fm == null ? void 0 : fm["crNumber"]) || "");
    const m1 = rx.exec(fromFm);
    if (m1) {
      const n = parseInt(m1[1], 10);
      if (!Number.isNaN(n)) max = Math.max(max, n);
    }
    const m2 = rx.exec(file.name);
    if (m2) {
      const n = parseInt(m2[1], 10);
      if (!Number.isNaN(n)) max = Math.max(max, n);
    }
  }
  const next = max + 1;
  return `CR-${next}`;
}

// src/views/boardTabsView.ts
var import_obsidian3 = require("obsidian");
var BOARD_TABS_VIEW_TYPE = "kb-board-tabs-view";
var BoardTabsView = class extends import_obsidian3.ItemView {
  constructor(leaf, settings, persistSettings) {
    super(leaf);
    this.tasks = [];
    this.filterQuery = "";
    this.active = "grid";
    this.settings = settings;
    this.persistSettings = persistSettings;
  }
  async promptText(title, placeholder = "", initial = "") {
    return new Promise((resolve) => {
      const self = this;
      class TextPrompt extends import_obsidian3.Modal {
        constructor() {
          super(self.app);
          this.value = initial;
          this.setTitle(title);
          const content = this.contentEl.createDiv({ cls: "kb-prompt" });
          const input = content.createEl("input", { type: "text" });
          input.placeholder = placeholder;
          input.value = initial;
          input.oninput = () => {
            this.value = input.value.trim();
          };
          const actions = content.createDiv({ cls: "kb-prompt-actions" });
          const ok = actions.createEl("button", { text: "OK" });
          const cancel = actions.createEl("button", { text: "Cancel" });
          ok.onclick = () => {
            this.close();
            resolve(this.value || void 0);
          };
          cancel.onclick = () => {
            this.close();
            resolve(void 0);
          };
          input.onkeydown = (e) => {
            if (e.key === "Enter") {
              ok.click();
            }
          };
          setTimeout(() => input.focus(), 0);
        }
      }
      const modal = new TextPrompt();
      modal.open();
    });
  }
  getViewType() {
    return BOARD_TABS_VIEW_TYPE;
  }
  getDisplayText() {
    return "Tasks";
  }
  getIcon() {
    return "layout-grid";
  }
  async onOpen() {
    this.contentEl.addClass("kb-container");
    this.registerEvent(this.app.metadataCache.on("changed", (0, import_obsidian3.debounce)(() => this.reload(), 300)));
    this.registerEvent(this.app.vault.on("modify", (0, import_obsidian3.debounce)(() => this.reload(), 300)));
    await this.reload();
  }
  async reload() {
    this.tasks = await readAllTasks(this.app, this.settings);
    this.render();
  }
  render() {
    const c = this.contentEl;
    c.empty();
    const tabs = c.createDiv({ cls: "kb-tabs" });
    const gridBtn = tabs.createEl("button", { text: "Grid" });
    gridBtn.addClass("kb-tab");
    if (this.active === "grid") gridBtn.addClass("is-active");
    gridBtn.onclick = () => {
      this.active = "grid";
      this.render();
    };
    const boardBtn = tabs.createEl("button", { text: "Board" });
    boardBtn.addClass("kb-tab");
    if (this.active === "board") boardBtn.addClass("is-active");
    boardBtn.onclick = () => {
      this.active = "board";
      this.render();
    };
    const bar = c.createDiv({ cls: "kb-toolbar" });
    const search = bar.createEl("input", { type: "search" });
    search.addClass("kb-input");
    search.placeholder = "Filter...";
    search.value = this.filterQuery;
    search.oninput = (ev) => {
      const target = ev.target;
      this.filterQuery = target.value.trim().toLowerCase();
      if (this.active === "grid") this.renderGrid(c);
      else this.renderBoard(c);
    };
    if (this.active === "grid") this.renderGrid(c);
    else this.renderBoard(c);
  }
  // GRID
  getFilteredTasks() {
    const q = this.filterQuery;
    if (!q) return this.tasks;
    return this.tasks.filter((t) => {
      if (t.fileName.toLowerCase().includes(q)) return true;
      return this.settings.gridVisibleColumns.some((key) => {
        var _a;
        return String((_a = t.frontmatter[key]) != null ? _a : "").toLowerCase().includes(q);
      });
    });
  }
  renderGrid(container) {
    const old = container.querySelector(".kb-grid-wrap");
    if (old) old.remove();
    const wrap = container.createDiv({ cls: "kb-grid-wrap" });
    const table = wrap.createEl("table");
    table.addClass("kb-table");
    const thead = table.createEl("thead");
    const trh = thead.createEl("tr");
    for (const key of this.settings.gridVisibleColumns) trh.createEl("th", { text: key });
    trh.createEl("th", { text: "Archived" });
    trh.createEl("th", { text: "Open" });
    const tbody = table.createEl("tbody");
    for (const t of this.getFilteredTasks()) {
      const tr = tbody.createEl("tr");
      const isArchived = Boolean(t.frontmatter["archived"]);
      if (isArchived) tr.addClass("kb-row-archived");
      for (const key of this.settings.gridVisibleColumns) {
        const val = t.frontmatter[key];
        tr.createEl("td", { text: Array.isArray(val) ? val.join(", ") : String(val != null ? val : "") });
      }
      const archivedTd = tr.createEl("td");
      archivedTd.createSpan({ text: isArchived ? "Yes" : "No" });
      const openTd = tr.createEl("td");
      const btn = openTd.createEl("button", { text: "Open" });
      btn.addClass("kb-card-btn");
      btn.onclick = async () => {
        const file = this.app.vault.getAbstractFileByPath(t.filePath);
        if (file instanceof import_obsidian3.TFile) await this.app.workspace.getLeaf(true).openFile(file);
      };
    }
  }
  // BOARD
  renderBoard(container) {
    var _a, _b;
    const existing = container.querySelector(".kb-kanban");
    if (existing) existing.remove();
    const board = container.createDiv({ cls: "kb-kanban kb-kanban-horizontal", attr: { draggable: "false" } });
    const byStatus = /* @__PURE__ */ new Map();
    for (const status of this.settings.statuses) byStatus.set(status, []);
    for (const t of this.getFilteredTasks()) {
      const status = (_a = t.frontmatter["status"]) != null ? _a : this.settings.statuses[0];
      ((_b = byStatus.get(status)) != null ? _b : byStatus.get(this.settings.statuses[0])).push(t);
    }
    const handleColumnDrag = {
      dragIndex: -1,
      onDragStart: (idx, e) => {
        var _a2;
        (_a2 = e.dataTransfer) == null ? void 0 : _a2.setData("application/x-kb-col", String(idx));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        handleColumnDrag.dragIndex = idx;
      },
      onDropOnIndex: async (idx) => {
        var _a2;
        const from = handleColumnDrag.dragIndex;
        const to = idx;
        if (from < 0 || to < 0 || from === to) return;
        const arr = this.settings.statuses;
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        await ((_a2 = this.persistSettings) == null ? void 0 : _a2.call(this));
        this.renderBoard(container);
      }
    };
    this.settings.statuses.forEach((status, idx) => {
      var _a2, _b2, _c, _d, _e;
      const col = board.createDiv({ cls: "kb-column", attr: { "data-col-index": String(idx) } });
      col.ondragover = (e) => {
        var _a3;
        const isColDrag = (_a3 = e.dataTransfer) == null ? void 0 : _a3.types.includes("application/x-kb-col");
        if (isColDrag) {
          e.preventDefault();
          e.currentTarget.classList.add("kb-col-hover");
        } else {
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          e.preventDefault();
          body.classList.add("kb-dropzone-hover");
        }
      };
      col.ondragleave = (e) => {
        e.currentTarget.classList.remove("kb-col-hover");
        body.classList.remove("kb-dropzone-hover");
      };
      col.ondrop = async (e) => {
        var _a3, _b3;
        const isColDrag = (_a3 = e.dataTransfer) == null ? void 0 : _a3.types.includes("application/x-kb-col");
        if (isColDrag) {
          e.preventDefault();
          e.currentTarget.classList.remove("kb-col-hover");
          await handleColumnDrag.onDropOnIndex(idx);
        } else {
          await ((_b3 = body.ondrop) == null ? void 0 : _b3.call(body, e));
        }
      };
      const header = col.createDiv({ cls: "kb-column-header" });
      header.draggable = true;
      header.ondragstart = (e) => handleColumnDrag.onDragStart(idx, e);
      header.createSpan({ text: status });
      header.createSpan({ text: String((_b2 = (_a2 = byStatus.get(status)) == null ? void 0 : _a2.length) != null ? _b2 : 0) });
      const menuBtn = header.createEl("button", { text: "\u22EF" });
      menuBtn.classList.add("kb-ellipsis");
      menuBtn.onclick = (ev) => {
        const menu = new import_obsidian3.Menu();
        menu.addItem((i) => i.setTitle("Rename").onClick(async () => {
          var _a3, _b3, _c2;
          const newName = (_a3 = await this.promptText("Rename column", "Column name", status)) == null ? void 0 : _a3.trim();
          if (!newName || newName === status) return;
          this.settings.statuses[idx] = newName;
          await ((_b3 = this.persistSettings) == null ? void 0 : _b3.call(this));
          const tasksInCol = (_c2 = byStatus.get(status)) != null ? _c2 : [];
          const updates = [];
          for (const t of tasksInCol) {
            const f = this.app.vault.getAbstractFileByPath(t.filePath);
            if (f instanceof import_obsidian3.TFile) {
              updates.push(updateTaskFrontmatter(this.app, f, { status: newName }));
            }
          }
          try {
            await Promise.all(updates);
          } catch (e2) {
            new import_obsidian3.Notice("Some tasks failed to update");
          }
          await this.reload();
        }));
        menu.addItem((i) => i.setTitle("Delete").onClick(async () => {
          var _a3;
          this.settings.statuses.splice(idx, 1);
          await ((_a3 = this.persistSettings) == null ? void 0 : _a3.call(this));
          this.renderBoard(container);
        }));
        menu.addItem((i) => i.setTitle("Move right").onClick(async () => {
          var _a3;
          const arr = this.settings.statuses;
          if (idx >= arr.length - 1) return;
          [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
          await ((_a3 = this.persistSettings) == null ? void 0 : _a3.call(this));
          this.renderBoard(container);
        }));
        menu.addItem((i) => i.setTitle("Move left").onClick(async () => {
          var _a3;
          const arr = this.settings.statuses;
          if (idx === 0) return;
          [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
          await ((_a3 = this.persistSettings) == null ? void 0 : _a3.call(this));
          this.renderBoard(container);
        }));
        const e = ev;
        menu.showAtPosition({ x: e.clientX, y: e.clientY });
      };
      const body = col.createDiv({ cls: "kb-column-body kb-dropzone" });
      const setHighlight = (on) => {
        body.classList.toggle("kb-dropzone-hover", on);
      };
      const allowDrop = (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      };
      body.ondragenter = (e) => {
        var _a3;
        if (!((_a3 = e.dataTransfer) == null ? void 0 : _a3.types.includes("application/x-kb-col"))) {
          allowDrop(e);
          setHighlight(true);
        }
      };
      body.ondragover = (e) => {
        var _a3;
        if (!((_a3 = e.dataTransfer) == null ? void 0 : _a3.types.includes("application/x-kb-col"))) {
          allowDrop(e);
        }
      };
      body.ondragleave = () => {
        setHighlight(false);
      };
      body.ondrop = async (e) => {
        var _a3, _b3, _c2, _d2;
        if ((_a3 = e.dataTransfer) == null ? void 0 : _a3.types.includes("application/x-kb-col")) return;
        const path = (_b3 = e.dataTransfer) == null ? void 0 : _b3.getData("text/plain");
        if (!path) return;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof import_obsidian3.TFile)) return;
        try {
          const cache = this.app.metadataCache.getFileCache(file);
          const currentStatus = String((_d2 = (_c2 = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _c2["status"]) != null ? _d2 : "");
          if (currentStatus === status) {
            setHighlight(false);
            return;
          }
          const scroller = board;
          const scrollLeft = scroller.scrollLeft;
          const isCompleted = /^(completed|done)$/i.test(status);
          const isInProgress = /in\s*progress/i.test(status);
          const patch = { status };
          if (isCompleted) patch["endDate"] = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
          if (isInProgress) patch["startDate"] = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
          await updateTaskFrontmatter(this.app, file, patch);
          new import_obsidian3.Notice("Moved to " + status);
          setHighlight(false);
          await this.reload();
          const newBoard = container.querySelector(".kb-kanban");
          if (newBoard) newBoard.scrollLeft = scrollLeft;
        } catch (err) {
          new import_obsidian3.Notice("Failed to move: " + err.message);
        }
      };
      for (const task of (_c = byStatus.get(status)) != null ? _c : []) {
        if (Boolean(task.frontmatter["archived"])) continue;
        const card = body.createDiv({ cls: "kb-card", attr: { draggable: "true" } });
        card.ondragstart = (e) => {
          var _a3;
          e.stopPropagation();
          (_a3 = e.dataTransfer) == null ? void 0 : _a3.setData("text/plain", task.filePath);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        };
        card.createDiv({ cls: "kb-card-title", text: (_d = task.frontmatter["title"]) != null ? _d : task.fileName });
        const meta = card.createDiv();
        meta.createSpan({ cls: "kb-chip", text: (_e = task.frontmatter["priority"]) != null ? _e : "" });
        const footer = card.createDiv({ cls: "kb-card-footer" });
        const createdAt = task.frontmatter["createdAt"] || "";
        if (createdAt) footer.createSpan({ cls: "kb-card-ts", text: new Date(createdAt).toLocaleString() });
        const menuBtn2 = footer.createEl("button", { text: "\u22EF" });
        menuBtn2.classList.add("kb-ellipsis");
        menuBtn2.onclick = (ev) => {
          const menu = new import_obsidian3.Menu();
          menu.addItem((i) => i.setTitle("Archive").onClick(async () => {
            try {
              await updateTaskFrontmatter(this.app, this.app.vault.getAbstractFileByPath(task.filePath), { archived: true });
              new import_obsidian3.Notice("Task archived");
              await this.reload();
            } catch (e2) {
              new import_obsidian3.Notice("Failed to archive task");
            }
          }));
          menu.addItem((i) => i.setTitle("Delete").onClick(async () => {
            try {
              await this.app.vault.delete(this.app.vault.getAbstractFileByPath(task.filePath));
              new import_obsidian3.Notice("Task deleted");
              await this.reload();
            } catch (e2) {
              new import_obsidian3.Notice("Failed to delete task");
            }
          }));
          const e = ev;
          menu.showAtPosition({ x: e.clientX, y: e.clientY });
        };
        const open = footer.createEl("button", { text: "Open" });
        open.addClass("kb-card-btn");
        open.onclick = async () => {
          const file = this.app.vault.getAbstractFileByPath(task.filePath);
          if (file instanceof import_obsidian3.TFile) await this.app.workspace.getLeaf(true).openFile(file);
        };
      }
    });
    const addCol = board.createDiv({ cls: "kb-column kb-column-add" });
    const addBtn = addCol.createEl("button", { text: "+ Add column" });
    addBtn.classList.add("kb-button");
    addBtn.onclick = async () => {
      var _a2, _b2;
      const name = (_a2 = await this.promptText("New column", "Column name")) == null ? void 0 : _a2.trim();
      if (!name) return;
      this.settings.statuses.push(name);
      await ((_b2 = this.persistSettings) == null ? void 0 : _b2.call(this));
      this.renderBoard(container);
    };
  }
};

// src/main.ts
var KanbanPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    await this.migrateSettingsIfNeeded();
    this.addSettingTab(new KanbanSettingTab(this.app, this));
    this.registerView(BOARD_TABS_VIEW_TYPE, (leaf) => new BoardTabsView(leaf, this.settings, () => this.saveSettings()));
    this.addCommand({
      id: "open-tasks-pane",
      name: "Open Tasks (Grid/Board Tabs)",
      callback: () => this.activateTabsView()
    });
    this.addCommand({
      id: "create-task",
      name: "Create Task from Template",
      callback: () => this.createTaskFromTemplate()
    });
    this.addCommand({
      id: "create-cr",
      name: "Create Change Request (CR) from Template",
      callback: () => this.createCrFromTemplate()
    });
    this.addRibbonIcon("sheets-in-box", "Open Tasks (Tabs)", () => this.activateTabsView());
    this.registerEvent(this.app.metadataCache.on("changed", async (file) => {
      var _a;
      if (!(file instanceof import_obsidian4.TFile)) return;
      const folder = this.settings.taskFolder || "Tasks";
      if (!file.path.startsWith(folder + "/")) return;
      const fm = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
      if (!fm) return;
      const status = String(fm["status"] || "");
      const isCompleted = /^(completed|done)$/i.test(status);
      const isInProgress = /in\s*progress/i.test(status);
      const endDate = String(fm["endDate"] || "");
      const startDate = String(fm["startDate"] || "");
      if (isCompleted && !endDate) {
        try {
          await updateTaskFrontmatter(this.app, file, { endDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) });
        } catch (e) {
        }
      }
      if (isInProgress && !startDate) {
        try {
          await updateTaskFrontmatter(this.app, file, { startDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) });
        } catch (e) {
        }
      }
    }));
  }
  async migrateSettingsIfNeeded() {
    var _a, _b;
    let changed = false;
    const tf = (_a = this.settings.templateFields) != null ? _a : [];
    const beforeLen = tf.length;
    this.settings.templateFields = tf.filter((f) => f.key !== "due");
    if (this.settings.templateFields.length !== beforeLen) changed = true;
    const hasStart = this.settings.templateFields.some((f) => f.key === "startDate");
    const hasEnd = this.settings.templateFields.some((f) => f.key === "endDate");
    if (!hasStart) {
      this.settings.templateFields.splice(5, 0, { key: "startDate", label: "Start Date", type: "date" });
      changed = true;
    }
    if (!hasEnd) {
      this.settings.templateFields.splice(6, 0, { key: "endDate", label: "End Date", type: "date" });
      changed = true;
    }
    const cols = (_b = this.settings.gridVisibleColumns) != null ? _b : [];
    const dueIdx = cols.indexOf("due");
    if (dueIdx !== -1) {
      cols.splice(dueIdx, 1, "startDate", "endDate");
      this.settings.gridVisibleColumns = cols;
      changed = true;
    }
    if (changed) await this.saveSettings();
  }
  onunload() {
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async activateTabsView() {
    const leaf = this.getRightLeaf();
    await leaf.setViewState({ type: BOARD_TABS_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  getRightLeaf() {
    var _a;
    const leaves = this.app.workspace.getLeavesOfType(BOARD_TABS_VIEW_TYPE);
    if (leaves.length > 0) return leaves[0];
    return (_a = this.app.workspace.getRightLeaf(false)) != null ? _a : this.app.workspace.getLeaf(true);
  }
  async createTaskFromTemplate() {
    const modal = new TaskTemplateModal(this.app, this.settings.templateFields, this.settings.statuses, async (data) => {
      var _a, _b;
      const folder = this.settings.taskFolder || "Tasks";
      await ensureFolder(this.app, folder);
      const crNumInput = String(data["crNumber"] || "").trim();
      const taskNumInput = String(data["taskNumber"] || "").trim();
      const serviceInput = String(data["service"] || "").trim();
      let crTitle = "";
      if (crNumInput) {
        const crFile = await findCrFileByNumber(this.app, this.settings, crNumInput);
        if (crFile) {
          const fm2 = (_a = this.app.metadataCache.getFileCache(crFile)) == null ? void 0 : _a.frontmatter;
          crTitle = String((_b = fm2 == null ? void 0 : fm2["title"]) != null ? _b : "");
          if (!crTitle) {
            const name = crFile.name.replace(/\.md$/i, "");
            crTitle = name.replace(/^CR-\d+\s*-\s*/i, "");
          }
        }
      }
      const prefixParts = [crNumInput, taskNumInput].filter(Boolean).join(" ");
      const serviceBracket = serviceInput ? ` - [${serviceInput}]` : "";
      const coreTitle = crTitle.trim() || `Task ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`;
      const title = prefixParts ? `[${prefixParts}] ${coreTitle}${serviceBracket}` : `${coreTitle}${serviceBracket}`;
      const fileName = `${title}.md`;
      const path = `${folder}/${fileName}`;
      const clean = {};
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) {
          if (v.length > 0) clean[k] = v;
        } else if (typeof v === "string") {
          if (v.trim() !== "") clean[k] = v.trim();
        } else if (v !== null && v !== void 0) {
          clean[k] = v;
        }
      }
      clean["title"] = title;
      clean["createdAt"] = (/* @__PURE__ */ new Date()).toISOString();
      const crNum = clean["crNumber"];
      if (crNum) {
        try {
          const crFile = await findCrFileByNumber(this.app, this.settings, crNum);
          if (crFile) clean["crLink"] = buildWikiLink(crFile.path);
        } catch (e) {
        }
      }
      const fm = buildFrontmatterYAML(clean);
      await this.app.vault.create(path, `${fm}

`);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof import_obsidian4.TFile) await this.app.workspace.getLeaf(true).openFile(file);
    });
    modal.open();
  }
  async createCrFromTemplate() {
    var _a;
    const fields = (_a = this.settings.crTemplateFields) != null ? _a : [
      { key: "number", label: "CR Number", type: "text" },
      { key: "title", label: "Title", type: "text" },
      { key: "emailSubject", label: "Email Subject", type: "text" },
      { key: "solutionDesign", label: "Solution design link", type: "url" },
      { key: "description", label: "Description", type: "text" }
    ];
    const modal = new CrTemplateModal(this.app, fields, async (data) => {
      const folder = this.settings.crFolder || "Change Requests";
      await ensureFolder(this.app, folder);
      let crNumber = (data["number"] || "").trim();
      if (!crNumber) crNumber = await generateNextCrNumber(this.app, this.settings);
      if (!/^CR-\d+$/i.test(crNumber)) crNumber = "CR-" + crNumber.replace(/[^0-9]/g, "");
      const title = (data["title"] || "").trim() || crNumber;
      const fileName = `${crNumber} - ${title}.md`;
      const path = `${folder}/${fileName}`;
      const clean = {};
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) {
          if (v.length > 0) clean[k] = v;
        } else if (typeof v === "string") {
          if (v.trim() !== "") clean[k] = v.trim();
        } else if (v !== null && v !== void 0) {
          clean[k] = v;
        }
      }
      clean["number"] = crNumber;
      clean["title"] = title;
      const fm = buildFrontmatterYAML(clean);
      await this.app.vault.create(path, `${fm}

`);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof import_obsidian4.TFile) await this.app.workspace.getLeaf(true).openFile(file);
    });
    modal.open();
  }
};
var TaskTemplateModal = class extends import_obsidian4.Modal {
  constructor(app, fields, statuses, onSubmit) {
    super(app);
    this.inputs = /* @__PURE__ */ new Map();
    this.fields = fields;
    this.statuses = statuses;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    var _a, _b;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kb-container");
    contentEl.createEl("h2", { text: "New Task" });
    const statusRow = contentEl.createDiv({ cls: "setting-item" });
    statusRow.createDiv({ cls: "setting-item-name", text: "Status" });
    const statusControl = statusRow.createDiv({ cls: "setting-item-control" });
    const statusSelect = statusControl.createEl("select");
    for (const s of this.statuses) {
      const opt = statusSelect.createEl("option", { text: s });
      opt.value = s;
    }
    statusSelect.value = (_a = this.statuses[0]) != null ? _a : "";
    this.inputs.set("status", statusSelect);
    const crRow = contentEl.createDiv({ cls: "setting-item" });
    crRow.createDiv({ cls: "setting-item-name", text: "CR Number" });
    const crControl = crRow.createDiv({ cls: "setting-item-control" });
    const crInput = crControl.createEl("input");
    crInput.addClass("kb-input");
    crInput.placeholder = "e.g. CR-6485";
    crInput.type = "text";
    this.inputs.set("crNumber", crInput);
    const tnRow = contentEl.createDiv({ cls: "setting-item" });
    tnRow.createDiv({ cls: "setting-item-name", text: "Task Number" });
    const tnControl = tnRow.createDiv({ cls: "setting-item-control" });
    const tnInput = tnControl.createEl("input");
    tnInput.addClass("kb-input");
    tnInput.placeholder = "e.g. T-01";
    tnInput.type = "text";
    this.inputs.set("taskNumber", tnInput);
    const svcRow = contentEl.createDiv({ cls: "setting-item" });
    svcRow.createDiv({ cls: "setting-item-name", text: "Service Name" });
    const svcControl = svcRow.createDiv({ cls: "setting-item-control" });
    const svcInput = svcControl.createEl("input");
    svcInput.addClass("kb-input");
    svcInput.placeholder = "Service name";
    svcInput.type = "text";
    this.inputs.set("service", svcInput);
    for (const field of this.fields) {
      if (field.key === "status" || field.key === "title" || field.key === "due" || field.key === "crNumber" || field.key === "taskNumber" || field.key === "service") continue;
      const row = contentEl.createDiv({ cls: "setting-item" });
      row.createDiv({ cls: "setting-item-name", text: field.label });
      const control = row.createDiv({ cls: "setting-item-control" });
      if (field.type === "status" || field.key === "priority") {
        const select = control.createEl("select");
        select.addClass("kb-input");
        const options = field.key === "status" ? this.statuses : ["Urgent", "High", "Medium", "Low"];
        for (const o of options) {
          const opt = select.createEl("option", { text: o });
          opt.value = o;
        }
        select.value = field.key === "status" ? (_b = this.statuses[0]) != null ? _b : "" : "Medium";
        this.inputs.set(field.key, select);
      } else {
        const input = control.createEl("input");
        input.addClass("kb-input");
        input.placeholder = field.label;
        if (field.type === "date") input.type = "date";
        else if (field.type === "number") input.type = "number";
        else input.type = "text";
        this.inputs.set(field.key, input);
      }
    }
    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = footer.createEl("button", { text: "Cancel" });
    cancel.addClass("mod-warning");
    cancel.onclick = () => this.close();
    const create = footer.createEl("button", { text: "Create Task" });
    create.addClass("mod-cta");
    create.onclick = async () => {
      var _a2;
      const data = {};
      for (const [key, input] of this.inputs.entries()) {
        const val = input.value.trim();
        data[key] = val;
      }
      if (!data["status"]) data["status"] = (_a2 = this.statuses[0]) != null ? _a2 : "Backlog";
      data["priority"] = data["priority"] || "Medium";
      await this.onSubmit(data);
      this.close();
    };
  }
};
var CrTemplateModal = class extends import_obsidian4.Modal {
  constructor(app, fields, onSubmit) {
    super(app);
    this.inputs = /* @__PURE__ */ new Map();
    this.fields = fields;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kb-container");
    contentEl.createEl("h2", { text: "New Change Request" });
    for (const field of this.fields) {
      const row = contentEl.createDiv({ cls: "setting-item" });
      row.createDiv({ cls: "setting-item-name", text: field.label });
      const control = row.createDiv({ cls: "setting-item-control" });
      const input = control.createEl("input");
      input.addClass("kb-input");
      input.placeholder = field.label;
      if (field.type === "date") input.type = "date";
      else if (field.type === "number") input.type = "number";
      else if (field.type === "url") input.type = "url";
      else input.type = "text";
      this.inputs.set(field.key, input);
    }
    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = footer.createEl("button", { text: "Cancel" });
    cancel.addClass("mod-warning");
    cancel.onclick = () => this.close();
    const create = footer.createEl("button", { text: "Create CR" });
    create.addClass("mod-cta");
    create.onclick = async () => {
      const data = {};
      for (const [key, input] of this.inputs.entries()) {
        const val = input.value.trim();
        data[key] = val;
      }
      if (!data["title"]) data["title"] = "Untitled CR";
      if (!data["priority"]) data["priority"] = "Medium";
      await this.onSubmit(data);
      this.close();
    };
  }
};
//# sourceMappingURL=main.js.map
