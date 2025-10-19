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
    { key: "taskNumber", label: "Task Number", type: "text" },
    { key: "service", label: "Service", type: "text" },
    { key: "plannedStart", label: "Planned start date", type: "date" },
    { key: "plannedEnd", label: "Planned end date", type: "date" },
    { key: "actualStart", label: "Actual start date", type: "date" },
    { key: "actualEnd", label: "Actual end date", type: "date" },
    { key: "notes", label: "Notes", type: "freetext" }
  ],
  gridVisibleColumns: ["crNumber", "taskNumber", "title", "service", "status", "priority", "assignee", "startDate", "endDate", "tags", "notes"],
  crFolder: "Change Requests",
  crTemplateFields: [
    { key: "number", label: "CR Number", type: "text" },
    { key: "title", label: "Title", type: "text" },
    { key: "emailSubject", label: "Email Subject", type: "text" },
    { key: "solutionDesign", label: "Solution design link", type: "url" },
    { key: "description", label: "Description", type: "freetext" }
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
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        const rendered = value.map((v) => escapeYamlInline(v)).join(", ");
        lines.push(`${key}: [${rendered}]`);
      }
    } else if (typeof value === "string" && value.trim() === "") {
      lines.push(`${key}: ""`);
    } else {
      if (typeof value === "string" && value.includes("\n")) {
        lines.push(`${key}: |`);
        const textLines = value.split("\n");
        for (const line of textLines) {
          lines.push(`  ${line}`);
        }
      } else {
        const escaped = escapeYaml(value);
        lines.push(`${key}: ${escaped}`);
      }
    }
  }
  lines.push("---");
  return lines.join("\n");
}
function escapeYaml(value) {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") {
    if (value.includes("\n")) {
      const lines = value.split("\n");
      return "|\n" + lines.map((line) => "  " + line).join("\n");
    }
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
async function getAllExistingTags(app, settings) {
  const tasks = await readAllTasks(app, settings);
  const tagSet = /* @__PURE__ */ new Set();
  for (const task of tasks) {
    const tags = task.frontmatter["tags"];
    if (Array.isArray(tags)) {
      tags.forEach((tag) => tagSet.add(String(tag).trim()));
    }
  }
  return Array.from(tagSet).sort();
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
    let tasks = [...this.tasks];
    tasks.sort((a, b) => {
      const timestampA = a.frontmatter["createdAt"] ? new Date(String(a.frontmatter["createdAt"])).getTime() : 0;
      const timestampB = b.frontmatter["createdAt"] ? new Date(String(b.frontmatter["createdAt"])).getTime() : 0;
      return timestampB - timestampA;
    });
    const q = this.filterQuery;
    if (!q) return tasks;
    return tasks.filter((t) => {
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
        const td = tr.createEl("td");
        if (key === "crNumber" && val) {
          const text = String(val);
          const crLink = t.frontmatter["crLink"];
          if (crLink) {
            const link = td.createEl("a", { text });
            link.href = "#";
            link.onclick = async (e) => {
              e.preventDefault();
              const path = crLink.replace(/^\[\[/, "").replace(/\]\]$/, "");
              const file = this.app.vault.getAbstractFileByPath(path);
              if (file instanceof import_obsidian3.TFile) {
                await this.app.workspace.getLeaf(true).openFile(file);
              }
            };
          } else {
            td.textContent = text;
          }
        } else {
          const text = Array.isArray(val) ? val.join(", ") : String(val != null ? val : "");
          if (text.includes("\n")) {
            td.innerHTML = text.replace(/\n/g, "<br>");
          } else {
            td.textContent = text;
          }
        }
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
    for (const [k, arr] of Array.from(byStatus.entries())) {
      arr.sort((a, b) => {
        var _a2, _b2;
        const oa = Number((_a2 = a.frontmatter["order"]) != null ? _a2 : NaN);
        const ob = Number((_b2 = b.frontmatter["order"]) != null ? _b2 : NaN);
        if (!Number.isNaN(oa) && !Number.isNaN(ob) && oa !== ob) return oa - ob;
        const ca = a.frontmatter["createdAt"] ? new Date(String(a.frontmatter["createdAt"])).getTime() : 0;
        const cb = b.frontmatter["createdAt"] ? new Date(String(b.frontmatter["createdAt"])).getTime() : 0;
        return ca - cb;
      });
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
      const dropIndicator = document.createElement("div");
      dropIndicator.className = "kb-drop-indicator";
      const removeIndicator = () => {
        if (dropIndicator.parentElement) dropIndicator.parentElement.removeChild(dropIndicator);
      };
      const setHighlight = (on) => {
        body.classList.toggle("kb-dropzone-hover", on);
        if (!on) removeIndicator();
      };
      const allowDrop = (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      };
      const updateIndicatorPosition = (e) => {
        var _a3;
        if ((_a3 = e.dataTransfer) == null ? void 0 : _a3.types.includes("application/x-kb-col")) return;
        allowDrop(e);
        const children = Array.from(body.querySelectorAll(".kb-card"));
        let insertIndex = children.length;
        const y = e.clientY;
        for (let i = 0; i < children.length; i++) {
          const rect = children[i].getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (y < midY) {
            insertIndex = i;
            break;
          }
        }
        removeIndicator();
        if (children.length === 0) {
          body.appendChild(dropIndicator);
        } else if (insertIndex >= children.length) {
          body.appendChild(dropIndicator);
        } else {
          body.insertBefore(dropIndicator, children[insertIndex]);
        }
        setHighlight(true);
      };
      body.ondragenter = (e) => {
        var _a3;
        if (!((_a3 = e.dataTransfer) == null ? void 0 : _a3.types.includes("application/x-kb-col"))) updateIndicatorPosition(e);
      };
      body.ondragover = (e) => {
        var _a3;
        if (!((_a3 = e.dataTransfer) == null ? void 0 : _a3.types.includes("application/x-kb-col"))) updateIndicatorPosition(e);
      };
      body.ondragleave = (e) => {
        const related = e.relatedTarget;
        if (!related || !body.contains(related)) setHighlight(false);
      };
      body.ondrop = async (e) => {
        var _a3, _b3, _c2, _d2, _e2, _f, _g, _h, _i, _j, _k, _l;
        if ((_a3 = e.dataTransfer) == null ? void 0 : _a3.types.includes("application/x-kb-col")) return;
        const isCardDrag = (_b3 = e.dataTransfer) == null ? void 0 : _b3.types.includes("application/x-kb-card");
        const payloadStr = isCardDrag ? (_c2 = e.dataTransfer) == null ? void 0 : _c2.getData("application/x-kb-card") : (_d2 = e.dataTransfer) == null ? void 0 : _d2.getData("text/plain");
        if (!payloadStr) return;
        let payload = null;
        try {
          payload = JSON.parse(payloadStr);
        } catch (e2) {
          payload = { path: payloadStr };
        }
        if (!payload || !payload.path) return;
        const file = this.app.vault.getAbstractFileByPath(payload.path);
        if (!(file instanceof import_obsidian3.TFile)) return;
        try {
          const tasksInCol = (_e2 = byStatus.get(status)) != null ? _e2 : [];
          const fromStatus = (_i = payload.fromStatus) != null ? _i : String((_h = (_g = (_f = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _f.frontmatter) == null ? void 0 : _g["status"]) != null ? _h : "");
          const tasksInFromCol = (_j = byStatus.get(fromStatus)) != null ? _j : [];
          const children = Array.from(body.querySelectorAll(".kb-card"));
          let insertIndex = children.length;
          const dropY = e.clientY;
          if (children.length > 0) {
            const gaps = [];
            const firstRect = children[0].getBoundingClientRect();
            gaps.push({
              top: firstRect.top - 20,
              // Add some padding above first card
              bottom: firstRect.top + 10,
              index: 0
            });
            for (let i = 0; i < children.length - 1; i++) {
              const currentRect = children[i].getBoundingClientRect();
              const nextRect = children[i + 1].getBoundingClientRect();
              const gapMiddle = currentRect.bottom + (nextRect.top - currentRect.bottom) / 2;
              gaps.push({
                top: gapMiddle - 10,
                // 10px above middle
                bottom: gapMiddle + 10,
                // 10px below middle
                index: i + 1
              });
            }
            const lastRect = children[children.length - 1].getBoundingClientRect();
            gaps.push({
              top: lastRect.bottom - 10,
              bottom: lastRect.bottom + 20,
              // Add some padding below last card
              index: children.length
            });
            let foundGap = false;
            for (const gap of gaps) {
              if (dropY >= gap.top && dropY <= gap.bottom) {
                insertIndex = gap.index;
                foundGap = true;
                break;
              }
            }
            if (!foundGap) {
              for (let i = 0; i < children.length; i++) {
                const rect = children[i].getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (dropY < midY) {
                  insertIndex = i;
                  break;
                }
              }
            }
          }
          const draggedIndexInSource = tasksInFromCol.findIndex((t) => t.filePath === payload.path);
          if (fromStatus === status && draggedIndexInSource !== -1) {
            const adjustedInsertIndex = draggedIndexInSource < insertIndex ? insertIndex - 1 : insertIndex;
            if (draggedIndexInSource === adjustedInsertIndex) {
              setHighlight(false);
              return;
            }
          }
          const scroller = board;
          const scrollLeft = scroller.scrollLeft;
          if (draggedIndexInSource !== -1) tasksInFromCol.splice(draggedIndexInSource, 1);
          if (fromStatus === status && draggedIndexInSource !== -1) {
            if (draggedIndexInSource < insertIndex) insertIndex = Math.max(0, insertIndex - 1);
          }
          let draggedTask = tasksInCol.find((t) => t.filePath === payload.path);
          if (!draggedTask) {
            const cache = this.app.metadataCache.getFileCache(file);
            draggedTask = { filePath: payload.path, fileName: file.name.replace(/\.md$/, ""), frontmatter: (_k = cache == null ? void 0 : cache.frontmatter) != null ? _k : {} };
          }
          tasksInCol.splice(insertIndex, 0, draggedTask);
          const isCompleted = /^(completed|done)$/i.test(status);
          const isInProgress = /in\s*progress/i.test(status);
          const updates = [];
          for (let i = 0; i < tasksInCol.length; i++) {
            const t = tasksInCol[i];
            const f = this.app.vault.getAbstractFileByPath(t.filePath);
            if (!(f instanceof import_obsidian3.TFile)) continue;
            const patch = { order: i };
            if (t.filePath === payload.path) {
              if (String((_l = t.frontmatter["status"]) != null ? _l : "") !== status) {
                patch["status"] = status;
                if (isCompleted) patch["endDate"] = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
                if (isInProgress) patch["startDate"] = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
              }
            }
            updates.push(updateTaskFrontmatter(this.app, f, patch));
          }
          if (fromStatus !== status) {
            for (let i = 0; i < tasksInFromCol.length; i++) {
              const t = tasksInFromCol[i];
              const f = this.app.vault.getAbstractFileByPath(t.filePath);
              if (!(f instanceof import_obsidian3.TFile)) continue;
              const patch = { order: i };
              updates.push(updateTaskFrontmatter(this.app, f, patch));
            }
          }
          try {
            if (updates.length > 0) {
              await Promise.all(updates);
              new import_obsidian3.Notice("Moved");
              setHighlight(false);
              await this.reload();
              const newBoard = container.querySelector(".kb-kanban");
              if (newBoard) newBoard.scrollLeft = scrollLeft;
            } else {
              setHighlight(false);
            }
          } catch (err) {
            new import_obsidian3.Notice("Failed to move: " + err.message);
          }
        } catch (err) {
          new import_obsidian3.Notice("Failed to move: " + err.message);
        }
      };
      for (const task of (_c = byStatus.get(status)) != null ? _c : []) {
        if (Boolean(task.frontmatter["archived"])) continue;
        const card = body.createDiv({ cls: "kb-card", attr: { draggable: "true" } });
        card.ondragstart = (e) => {
          var _a3, _b3;
          e.stopPropagation();
          const payload = JSON.stringify({ path: task.filePath, fromStatus: status });
          (_a3 = e.dataTransfer) == null ? void 0 : _a3.setData("application/x-kb-card", payload);
          (_b3 = e.dataTransfer) == null ? void 0 : _b3.setData("text/plain", payload);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        };
        const cardHeader = card.createDiv({ cls: "kb-card-header" });
        cardHeader.createDiv({ cls: "kb-card-title", text: (_d = task.frontmatter["title"]) != null ? _d : task.fileName });
        const menuBtn2 = cardHeader.createEl("button", { text: "\u22EF" });
        menuBtn2.classList.add("kb-ellipsis", "kb-card-menu-btn");
        const meta = card.createDiv();
        meta.createSpan({ cls: "kb-chip", text: (_e = task.frontmatter["priority"]) != null ? _e : "" });
        const footer = card.createDiv({ cls: "kb-card-footer" });
        const createdAt = task.frontmatter["createdAt"] || "";
        if (createdAt) footer.createSpan({ cls: "kb-card-ts", text: new Date(createdAt).toLocaleString() });
        menuBtn2.onclick = (ev) => {
          ev.stopPropagation();
          const menu = new import_obsidian3.Menu();
          menu.addItem((i) => i.setTitle("Open").onClick(async () => {
            const file = this.app.vault.getAbstractFileByPath(task.filePath);
            if (file instanceof import_obsidian3.TFile) await this.app.workspace.getLeaf(true).openFile(file);
          }));
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
        card.onclick = async (e) => {
          const file = this.app.vault.getAbstractFileByPath(task.filePath);
          if (!(file instanceof import_obsidian3.TFile)) return;
          const modal = new EditTaskModal(this.app, this.settings, task, async (patch) => {
            try {
              await updateTaskFrontmatter(this.app, file, patch);
              new import_obsidian3.Notice("Task updated");
              await this.reload();
            } catch (err) {
              new import_obsidian3.Notice("Failed to update task: " + err.message);
            }
          });
          modal.open();
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
var EditTaskModal = class extends import_obsidian3.Modal {
  constructor(app, settings, task, onSubmit) {
    super(app);
    this.inputs = /* @__PURE__ */ new Map();
    this.settings = settings;
    this.task = task;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    var _a, _b, _c, _d, _e;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kb-container");
    contentEl.createEl("h2", { text: "Edit Task" });
    const fm = (_a = this.task.frontmatter) != null ? _a : {};
    for (const field of this.settings.templateFields) {
      const row = contentEl.createDiv({ cls: "setting-item" });
      row.createDiv({ cls: "setting-item-name", text: field.label });
      const control = row.createDiv({ cls: "setting-item-control" });
      if (field.type === "status" || field.key === "priority") {
        const select = control.createEl("select");
        select.addClass("kb-input");
        const options = field.key === "status" ? this.settings.statuses : ["Urgent", "High", "Medium", "Low"];
        for (const o of options) {
          const opt = select.createEl("option", { text: o });
          opt.value = o;
        }
        select.value = String((_c = fm[field.key]) != null ? _c : field.key === "status" ? (_b = this.settings.statuses[0]) != null ? _b : "" : "Medium");
        this.inputs.set(field.key, select);
      } else if (field.type === "tags") {
        const tagsContainer = control.createDiv({ cls: "kb-tags-input-container" });
        const tagsInput = tagsContainer.createEl("input");
        tagsInput.addClass("kb-input");
        tagsInput.type = "text";
        const tagsDisplay = tagsContainer.createDiv({ cls: "kb-selected-tags" });
        const suggestionsContainer = tagsContainer.createDiv({ cls: "kb-tags-suggestions" });
        suggestionsContainer.style.display = "none";
        const selectedTags = Array.isArray(fm[field.key]) ? fm[field.key].slice() : [];
        const renderSelected = () => {
          tagsDisplay.empty();
          for (const tag of selectedTags) {
            const tagEl = tagsDisplay.createDiv({ cls: "kb-tag" });
            tagEl.setText(tag);
            const removeBtn = tagEl.createSpan({ cls: "kb-tag-remove" });
            removeBtn.setText("\xD7");
            removeBtn.onclick = (e) => {
              e.stopPropagation();
              const idx = selectedTags.indexOf(tag);
              if (idx > -1) selectedTags.splice(idx, 1);
              renderSelected();
            };
          }
        };
        renderSelected();
        let allTags = [];
        const loadAllTags = async () => {
          allTags = await getAllExistingTags(this.app, this.settings).catch(() => []);
        };
        loadAllTags();
        const addTag = (tag) => {
          if (!selectedTags.includes(tag)) selectedTags.push(tag);
          renderSelected();
          tagsInput.value = "";
          suggestionsContainer.style.display = "none";
          tagsInput.focus();
        };
        const renderSuggestions = (q) => {
          suggestionsContainer.empty();
          const query = (q != null ? q : "").trim().toLowerCase();
          let candidates = allTags.filter((t) => !selectedTags.includes(t));
          if (query) candidates = candidates.filter((t) => t.toLowerCase().includes(query));
          if (query && !allTags.map((t) => t.toLowerCase()).includes(query)) {
            const addOption = suggestionsContainer.createDiv({ cls: "kb-tag-suggestion" });
            addOption.setText(`Add "${q}" as new tag`);
            addOption.onclick = () => addTag(q.trim());
          }
          for (const tag of candidates) {
            const opt = suggestionsContainer.createDiv({ cls: "kb-tag-suggestion" });
            opt.setText(tag);
            opt.onclick = () => addTag(tag);
          }
          suggestionsContainer.style.display = candidates.length > 0 || query && !allTags.map((t) => t.toLowerCase()).includes(query) ? "block" : "none";
        };
        tagsInput.oninput = () => renderSuggestions(tagsInput.value);
        tagsInput.onfocus = async () => {
          if (allTags.length === 0) await loadAllTags();
          renderSuggestions("");
        };
        document.addEventListener("click", (e) => {
          if (!tagsContainer.contains(e.target)) suggestionsContainer.style.display = "none";
        });
        tagsInput.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const v = tagsInput.value.trim();
            if (v) addTag(v);
          }
        };
        this.inputs.set(field.key, { getValue: () => selectedTags });
      } else if (field.type === "freetext") {
        row.style.display = "block";
        row.style.width = "100%";
        const label = row.querySelector(".setting-item-name");
        if (label) label.style.display = "block";
        control.style.width = "100%";
        control.style.marginTop = "8px";
        const textarea = control.createEl("textarea");
        textarea.addClass("kb-input");
        textarea.placeholder = field.label;
        textarea.rows = 4;
        textarea.style.resize = "vertical";
        textarea.style.minHeight = "80px";
        textarea.style.width = "100%";
        textarea.value = String((_d = fm[field.key]) != null ? _d : "");
        this.inputs.set(field.key, textarea);
      } else {
        const input = control.createEl("input");
        input.addClass("kb-input");
        input.placeholder = field.label;
        if (field.type === "date") input.type = "date";
        else if (field.type === "number") input.type = "number";
        else input.type = "text";
        input.value = String((_e = fm[field.key]) != null ? _e : "");
        this.inputs.set(field.key, input);
      }
    }
    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = footer.createEl("button", { text: "Cancel" });
    cancel.addClass("mod-warning");
    cancel.onclick = () => this.close();
    const save = footer.createEl("button", { text: "Save" });
    save.addClass("mod-cta");
    save.onclick = async () => {
      const patch = {};
      for (const [key, input] of this.inputs.entries()) {
        const anyInput = input;
        if (anyInput && typeof anyInput.getValue === "function") {
          patch[key] = anyInput.getValue();
          continue;
        }
        const el = input;
        const val = el.tagName === "TEXTAREA" ? el.value : el.value.trim();
        if (val !== "" && val != null) patch[key] = val;
        else patch[key] = val === "" ? "" : void 0;
      }
      await this.onSubmit(patch);
      this.close();
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
    const hasNotes = this.settings.templateFields.some((f) => f.key === "notes");
    if (!hasStart) {
      this.settings.templateFields.splice(5, 0, { key: "startDate", label: "Start Date", type: "date" });
      changed = true;
    }
    if (!hasEnd) {
      this.settings.templateFields.splice(6, 0, { key: "endDate", label: "End Date", type: "date" });
      changed = true;
    }
    if (!hasNotes) {
      this.settings.templateFields.push({ key: "notes", label: "Notes", type: "freetext" });
      changed = true;
    }
    const cols = (_b = this.settings.gridVisibleColumns) != null ? _b : [];
    const dueIdx = cols.indexOf("due");
    if (dueIdx !== -1) {
      cols.splice(dueIdx, 1, "startDate", "endDate");
      this.settings.gridVisibleColumns = cols;
      changed = true;
    }
    if (!cols.includes("notes")) {
      this.settings.gridVisibleColumns.push("notes");
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
    const modal = new TaskTemplateModal(this.app, this.settings.templateFields, this.settings.statuses, this.settings, async (data) => {
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
      for (const field of this.settings.templateFields) {
        if (!(field.key in clean)) {
          if (field.type === "freetext") {
            clean[field.key] = "";
          } else if (field.type === "date") {
          } else if (field.type === "number") {
            clean[field.key] = "";
          } else if (field.type === "tags") {
            clean[field.key] = [];
          } else {
            clean[field.key] = "";
          }
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
      for (const field of fields) {
        if (!(field.key in clean)) {
          if (field.type === "freetext") {
            clean[field.key] = "";
          } else if (field.type === "date") {
          } else if (field.type === "number") {
            clean[field.key] = "";
          } else if (field.type === "tags") {
            clean[field.key] = [];
          } else {
            clean[field.key] = "";
          }
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
  constructor(app, fields, statuses, settings, onSubmit) {
    super(app);
    this.inputs = /* @__PURE__ */ new Map();
    this.fields = fields;
    this.statuses = statuses;
    this.settings = settings;
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
      } else if (field.type === "tags") {
        const tagsContainer = control.createDiv({ cls: "kb-tags-input-container" });
        const tagsInput = tagsContainer.createEl("input");
        tagsInput.addClass("kb-input");
        tagsInput.placeholder = "Type to add or select tags...";
        tagsInput.type = "text";
        const tagsDisplay = tagsContainer.createDiv({ cls: "kb-selected-tags" });
        const selectedTags = [];
        const suggestionsContainer = tagsContainer.createDiv({ cls: "kb-tags-suggestions" });
        suggestionsContainer.style.display = "none";
        let allTags = [];
        const loadAllTags = async () => {
          try {
            allTags = await getAllExistingTags(this.app, this.settings);
          } catch (e) {
            allTags = [];
          }
        };
        loadAllTags();
        const renderSuggestions = (query) => {
          suggestionsContainer.empty();
          const q = (query != null ? query : "").trim().toLowerCase();
          let candidates = allTags.filter((t) => !selectedTags.includes(t));
          if (q) candidates = candidates.filter((t) => t.toLowerCase().includes(q));
          if (q && !allTags.map((t) => t.toLowerCase()).includes(q)) {
            const addOption = suggestionsContainer.createDiv({ cls: "kb-tag-suggestion" });
            addOption.setText(`Add "${query}" as new tag`);
            addOption.onclick = () => addTag(query.trim());
          }
          for (const tag of candidates) {
            const option = suggestionsContainer.createDiv({ cls: "kb-tag-suggestion" });
            option.setText(tag);
            option.onclick = () => addTag(tag);
          }
          suggestionsContainer.style.display = candidates.length > 0 || q && !allTags.map((t) => t.toLowerCase()).includes(q) ? "block" : "none";
        };
        tagsInput.oninput = () => renderSuggestions(tagsInput.value);
        tagsInput.onfocus = async () => {
          if (allTags.length === 0) await loadAllTags();
          renderSuggestions("");
        };
        document.addEventListener("click", (e) => {
          if (!tagsContainer.contains(e.target)) {
            suggestionsContainer.style.display = "none";
          }
        });
        const addTag = (tag) => {
          if (!selectedTags.includes(tag)) {
            selectedTags.push(tag);
            const tagEl = tagsDisplay.createDiv({ cls: "kb-tag" });
            tagEl.setText(tag);
            const removeBtn = tagEl.createSpan({ cls: "kb-tag-remove" });
            removeBtn.setText("\xD7");
            removeBtn.onclick = (e) => {
              e.stopPropagation();
              const index = selectedTags.indexOf(tag);
              if (index > -1) {
                selectedTags.splice(index, 1);
                tagEl.remove();
              }
            };
          }
          tagsInput.value = "";
          suggestionsContainer.style.display = "none";
          tagsInput.focus();
        };
        tagsInput.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const value = tagsInput.value.trim();
            if (value) {
              addTag(value);
            }
          }
        };
        const hiddenInput = control.createEl("input");
        hiddenInput.type = "hidden";
        hiddenInput.value = "[]";
        this.inputs.set(field.key, {
          value: "",
          getValue: () => selectedTags
        });
      } else if (field.type === "freetext") {
        row.style.display = "block";
        row.style.width = "100%";
        const label = row.querySelector(".setting-item-name");
        if (label) label.style.display = "block";
        control.style.width = "100%";
        control.style.marginTop = "8px";
        const textarea = control.createEl("textarea");
        textarea.addClass("kb-input");
        textarea.placeholder = field.label;
        textarea.rows = 4;
        textarea.style.resize = "vertical";
        textarea.style.minHeight = "80px";
        textarea.style.width = "100%";
        this.inputs.set(field.key, textarea);
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
        const anyInput = input;
        if (anyInput && typeof anyInput.getValue === "function") {
          data[key] = anyInput.getValue();
          continue;
        }
        const element = input;
        const val = element.tagName === "TEXTAREA" ? element.value : element.value.trim();
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
      if (field.type === "freetext") {
        row.style.display = "block";
        row.style.width = "100%";
        const label = row.querySelector(".setting-item-name");
        if (label) label.style.display = "block";
        control.style.width = "100%";
        control.style.marginTop = "8px";
        const textarea = control.createEl("textarea");
        textarea.addClass("kb-input");
        textarea.placeholder = field.label;
        textarea.rows = 4;
        textarea.style.resize = "vertical";
        textarea.style.minHeight = "80px";
        textarea.style.width = "100%";
        this.inputs.set(field.key, textarea);
      } else if (field.type === "status" && field.key === "priority") {
        const select = control.createEl("select");
        select.addClass("kb-input");
        const options = ["Urgent", "High", "Medium", "Low"];
        for (const o of options) {
          const opt = select.createEl("option", { text: o });
          opt.value = o;
        }
        select.value = "Medium";
        this.inputs.set(field.key, select);
      } else {
        const input = control.createEl("input");
        input.addClass("kb-input");
        input.placeholder = field.label;
        if (field.type === "date") input.type = "date";
        else if (field.type === "number") input.type = "number";
        else if (field.type === "url") input.type = "url";
        else input.type = "text";
        this.inputs.set(field.key, input);
      }
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
