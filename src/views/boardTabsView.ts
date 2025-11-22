import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, debounce, Modal, App, normalizePath } from 'obsidian';
import * as XLSX from 'xlsx';
import { PluginConfiguration, Subtask, TaskNoteMeta, ActiveTab, TaskFieldDefinition, FieldType } from '../models';
import { readAllTasks, updateTaskFrontmatter, getAllExistingTags, readAllItems, buildFrontmatterYAML, sanitizeFileName, findCrFileByNumber, findTaskFileByNumber } from '../utils';
import KanbanPlugin from '../main';
import { FilterPanel } from './filterModal';

export const BOARD_TABS_VIEW_TYPE = 'kb-board-tabs-view';

export class BoardTabsView extends ItemView {
  private plugin: KanbanPlugin;
  private settings: PluginConfiguration;
  private tasks: TaskNoteMeta[] = [];
  private filterQuery = '';
  private active: ActiveTab;
  private persistSettings?: () => void | Promise<void>;
  private filterState: Record<string, any> = {};
  private async promptText(title: string, placeholder = '', initial = ''): Promise<string | undefined> {
    return new Promise((resolve) => {
      const self = this;
      class TextPrompt extends Modal {
        private value = initial;
        constructor() {
          // Use the view's app instance
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          super((self as any).app);
          this.setTitle(title);
          const content = this.contentEl.createDiv({ cls: 'kb-prompt' });
          const input = content.createEl('input', { type: 'text' });
          input.placeholder = placeholder;
          input.value = initial;
          input.oninput = () => { this.value = input.value.trim(); };
          const actions = content.createDiv({ cls: 'kb-prompt-actions' });
          const ok = actions.createEl('button', { text: 'OK' });
          const cancel = actions.createEl('button', { text: 'Cancel' });
          ok.onclick = () => { this.close(); resolve(this.value || undefined); };
          cancel.onclick = () => { this.close(); resolve(undefined); };
          input.onkeydown = (e) => { if ((e as KeyboardEvent).key === 'Enter') { ok.click(); } };
          setTimeout(() => input.focus(), 0);
        }
      }
      const modal = new TextPrompt();
      modal.open();
    });
  }
  constructor(leaf: WorkspaceLeaf, plugin: KanbanPlugin, settings: PluginConfiguration, persistSettings?: () => void | Promise<void>) {
    super(leaf);
    this.plugin = plugin;
    this.settings = settings;
    this.active = this.settings.lastActiveTab ?? 'grid';
    this.persistSettings = persistSettings;
    this.render();
  }

  getViewType(): string { return BOARD_TABS_VIEW_TYPE; }
  getDisplayText(): string { return 'Tasks'; }
  getIcon(): string { return 'layout-grid'; }

  async onOpen() {
    this.contentEl.addClass('kb-container');
    this.registerEvent(this.app.metadataCache.on('changed', debounce(() => this.reload(), 300)));
    this.registerEvent(this.app.vault.on('modify', debounce(() => this.reload(), 300)));

    // Prevent Esc from navigating back
    this.scope?.register([], 'Esc', () => {
      return false;
    });

    await this.reload();
  }

  async reload() {
    this.tasks = await readAllItems(this.app, this.settings);
    this.filterState = this.settings.filterState ?? {};
    this.render();
  }

  private render() {
    const c = this.contentEl;
    c.empty();

    // Tabs bar
    const tabs = c.createDiv({ cls: 'kb-tabs' });
    const gridBtn = tabs.createEl('button', { text: 'Grid' });
    gridBtn.addClass('kb-tab');
    if (this.active === 'grid') gridBtn.addClass('is-active');
    gridBtn.onclick = () => { this.active = 'grid'; this.settings.lastActiveTab = 'grid'; this.persistSettings?.(); this.render(); };
    const boardBtn = tabs.createEl('button', { text: 'Board' });
    boardBtn.addClass('kb-tab');
    if (this.active === 'board') boardBtn.addClass('is-active');
    boardBtn.onclick = () => { this.active = 'board'; this.settings.lastActiveTab = 'board'; this.persistSettings?.(); this.render(); };


    const menuBtn = tabs.createEl('button', { text: '⋯' });
    menuBtn.addClass('kb-ellipsis');
    menuBtn.onclick = (ev) => {
      const menu = new Menu();
      menu.addItem((i) => i.setTitle('Export to CSV').onClick(() => this.exportToCsv()));
      menu.addItem((i) => i.setTitle('Export to Excel').onClick(() => this.exportToExcel()));
      menu.addItem((i) => i.setTitle('Export to JSON').onClick(() => this.exportToJson()));
      menu.addItem((i) => i.setTitle('Import from CSV').onClick(() => this.importFromCsv()));
      menu.addItem((i) => i.setTitle('Import from Excel').onClick(() => this.importFromExcel()));
      menu.addItem((i) => i.setTitle('Import from JSON').onClick(() => this.importFromJson()));
      const e = ev as MouseEvent;
      menu.showAtPosition({ x: e.clientX, y: e.clientY });
    };

    // Toolbar
    const bar = c.createDiv({ cls: 'kb-toolbar' });
    const search = bar.createEl('input', { type: 'search' });
    search.addClass('kb-input');
    search.placeholder = 'Filter...';
    search.value = this.filterQuery;
    search.oninput = (ev: Event) => {
      const target = ev.target as HTMLInputElement;
      this.filterQuery = target.value.trim().toLowerCase();
      if (this.active === 'grid') this.renderGrid(c);
      else this.renderBoard(c);
    };

    const rightGroup = bar.createDiv({ cls: 'kb-toolbar-right-group' });

    if (this.active === 'grid') {
      // Archived toggle (left of filter button)
      const archivedToggle = rightGroup.createEl('label');
      archivedToggle.addClass('kb-switch');
      archivedToggle.createSpan({ text: 'Show archived', cls: 'kb-switch-text' });
      const archivedInput = archivedToggle.createEl('input');
      archivedInput.type = 'checkbox';
      archivedInput.checked = this.settings.gridConfig.showArchived ?? false;
      archivedInput.onchange = async () => {
        this.settings.gridConfig.showArchived = archivedInput.checked;
        await this.persistSettings?.();
        this.render();
      };
      archivedToggle.createSpan({ cls: 'kb-slider round' });
    }

    // Filter button (right side)
    const filterBtn = rightGroup.createEl('button');
    filterBtn.addClass('kb-filter-btn');
    // Icon (funnel-like)
    const iconWrap = filterBtn.createDiv({ cls: 'kb-filter-icon' });
    iconWrap.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 5h18v2H3V5zM6 11h12v2H6v-2zM10 17h4v2h-4v-2z" fill="currentColor"/></svg>';
    filterBtn.createDiv({ text: 'Filter' });
    const filterCount = this.getActiveFilterCount();
    if (filterCount > 0) {
      filterBtn.addClass('is-active');
      const badge = filterBtn.createEl('span', { text: String(filterCount) });
      badge.addClass('kb-filter-badge');
    }
    filterBtn.onclick = () => {
      const panel = new FilterPanel(this.app, this.settings, this.filterState, async (newFilterState) => {
        this.filterState = newFilterState;
        await this.saveFilterState();
        this.render();
      });
      panel.open();
    };


    if (this.active === 'grid') this.renderGrid(c); else this.renderBoard(c);
  }

  public async importFromJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          if (data.tasks) {
            await this.processImportData(data.tasks, 'task');
          }
          if (data.crs) {
            await this.processImportData(data.crs, 'cr');
          }
          new Notice('Import complete');
          await this.reload();
        } catch (error) {
          new Notice('Failed to import file: ' + (error as Error).message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  public async exportToJson() {
    const allItems = await readAllItems(this.app, this.settings);
    const taskFolder = normalizePath(this.settings.paths.taskFolder);
    const crFolder = this.settings.paths.crFolder ? normalizePath(this.settings.paths.crFolder) : null;

    const tasksData = allItems
      .filter(t => t.filePath.startsWith(taskFolder + '/'))
      .map(t => t.frontmatter);

    let crData: any[] = [];
    if (crFolder) {
      crData = allItems
        .filter(t => t.filePath.startsWith(crFolder + '/'))
        .map(t => t.frontmatter);
    }

    const data = { tasks: tasksData, crs: crData };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const fileName = `Kanban-Export-${new Date().toISOString().slice(0, 10)}.json`;

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  public async importFromCsv() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = event.target?.result as string;
          const workbook = XLSX.read(data, { type: 'string' });

          // Process Tasks
          const taskSheet = workbook.Sheets[workbook.SheetNames[0]];
          if (taskSheet) {
            const taskData = XLSX.utils.sheet_to_json(taskSheet);
            await this.processImportData(taskData, 'task');
          }

          // Process Change Requests
          const crSheet = workbook.Sheets[workbook.SheetNames[1]];
          if (crSheet) {
            const crData = XLSX.utils.sheet_to_json(crSheet);
            await this.processImportData(crData, 'cr');
          }

          new Notice('Import complete');
          await this.reload();
        } catch (error) {
          new Notice('Failed to import file: ' + (error as Error).message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  public async importFromExcel() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = event.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });

          // Process Change Requests first
          const crSheet = workbook.Sheets['Change Requests'];
          if (crSheet) {
            const crData = XLSX.utils.sheet_to_json(crSheet);
            await this.processImportData(crData, 'cr');
          }

          // Then Process Tasks
          const taskSheet = workbook.Sheets['Tasks'];
          if (taskSheet) {
            const taskData = XLSX.utils.sheet_to_json(taskSheet);
            await this.processImportData(taskData, 'task');
          }

          new Notice('Import complete');
          await this.reload();
        } catch (error) {
          new Notice('Failed to import file: ' + (error as Error).message);
        }
      };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  }

  public async exportToExcel() {
    const allItems = await readAllItems(this.app, this.settings);
    const taskFolder = normalizePath(this.settings.paths.taskFolder);
    const crFolder = this.settings.paths.crFolder ? normalizePath(this.settings.paths.crFolder) : null;

    const tasksData = allItems
      .filter(t => t.filePath.startsWith(taskFolder + '/'))
      .map(t => {
        const fm = Object.assign({}, t.frontmatter) as Record<string, any>;
        if (fm && Array.isArray(fm.tags)) fm.tags = fm.tags.join(', ');
        fm.subtasks = t.subtasks.map(st => `[${st.completed ? 'x' : ' '}] ${st.text}`).join('\n');
        fm.archived = Boolean(fm.archived);
        return fm;
      });

    let crData: any[] = [];
    if (crFolder) {
      crData = allItems
        .filter(t => t.filePath.startsWith(crFolder + '/'))
        .map(t => {
          const fm = Object.assign({}, t.frontmatter) as Record<string, any>;
          if (fm && Array.isArray(fm.tags)) fm.tags = fm.tags.join(', ');
          fm.archived = Boolean(fm.archived);
          return fm;
        });
    }

    const wb = XLSX.utils.book_new();
    const wsTasks = XLSX.utils.json_to_sheet(tasksData);
    const wsCr = XLSX.utils.json_to_sheet(crData);

    XLSX.utils.book_append_sheet(wb, wsTasks, 'Tasks');
    XLSX.utils.book_append_sheet(wb, wsCr, 'Change Requests');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const fileName = `Kanban-Export-${new Date().toISOString().slice(0, 10)}.xlsx`;

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  public async exportToCsv() {
    const allItems = await readAllItems(this.app, this.settings);
    const taskFolder = normalizePath(this.settings.paths.taskFolder);
    const crFolder = this.settings.paths.crFolder ? normalizePath(this.settings.paths.crFolder) : null;

    const tasksData = allItems
      .filter(t => t.filePath.startsWith(taskFolder + '/'))
      .map(t => {
        const fm = Object.assign({}, t.frontmatter) as Record<string, any>;
        if (fm && Array.isArray(fm.tags)) fm.tags = fm.tags.join(', ');
        fm.subtasks = t.subtasks.map(st => `[${st.completed ? 'x' : ' '}] ${st.text}`).join('\n');
        fm.archived = Boolean(fm.archived);
        return fm;
      });

    let crData: any[] = [];
    if (crFolder) {
      crData = allItems
        .filter(t => t.filePath.startsWith(crFolder + '/'))
        .map(t => {
          const fm = Object.assign({}, t.frontmatter) as Record<string, any>;
          if (fm && Array.isArray(fm.tags)) fm.tags = fm.tags.join(', ');
          fm.archived = Boolean(fm.archived);
          return fm;
        });
    }

    const wb = XLSX.utils.book_new();
    const wsTasks = XLSX.utils.json_to_sheet(tasksData);
    const wsCr = XLSX.utils.json_to_sheet(crData);

    XLSX.utils.book_append_sheet(wb, wsTasks, 'Tasks');
    XLSX.utils.book_append_sheet(wb, wsCr, 'Change Requests');

    const wbout = XLSX.write(wb, { bookType: 'csv', type: 'array' });
    const blob = new Blob([wbout], { type: 'text/csv;charset=utf-8;' });
    const fileName = `Kanban-Export-${new Date().toISOString().slice(0, 10)}.csv`;

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  private async processImportData(data: any[], type: 'task' | 'cr') {
    const allItems = await readAllItems(this.app, this.settings);
    const folder = type === 'cr' ? this.settings.paths.crFolder : this.settings.paths.taskFolder;
    if (!folder) {
      new Notice(`Folder for ${type}s is not configured.`);
      return;
    }

    for (const item of data) {
      const numberField = type === 'cr' ? 'number' : 'taskNumber';
      const number = item[numberField];
      if (!number) continue;

      // Normalize tags from CSV/Excel string into array
      if (item.tags && typeof item.tags === 'string') {
        item.tags = item.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
      }

      // Normalize archived value coming from various export formats
      if (item.hasOwnProperty('Archived') || item.hasOwnProperty('archived')) {
        const raw = item.hasOwnProperty('Archived') ? item['Archived'] : item['archived'];
        const parsed = (v: any) => {
          if (v === undefined || v === null) return undefined;
          if (typeof v === 'boolean') return v;
          const s = String(v).trim().toLowerCase();
          if (['yes', 'y', 'true', '1'].includes(s)) return true;
          if (['no', 'n', 'false', '0'].includes(s)) return false;
          return Boolean(s);
        };
        const val = parsed(raw);
        if (val !== undefined) item.archived = val;
      }

      // Prefer to auto-link CR if crLink missing but crNumber provided
      if (type === 'task' && !item.crLink && item.crNumber) {
        const cr = allItems.find(i => i.frontmatter.number === item.crNumber);
        if (cr) {
          item.crLink = `[[${cr.filePath}]]`;
        }
      }

      if (type === 'task' && !item.priority) {
        item.priority = this.settings.defaultPriority;
      }

      const existingFile = allItems.find(i => i.frontmatter[numberField] === number);

      if (existingFile) {
        // Update existing: remove any human-friendly 'Archived' column key to avoid creating extraneous frontmatter keys
        const patch = Object.assign({}, item) as Record<string, any>;
        if (patch.hasOwnProperty('Archived')) delete patch['Archived'];
        // ensure archived is boolean if present
        if (patch.hasOwnProperty('archived')) patch.archived = Boolean(patch.archived);
        await updateTaskFrontmatter(this.app, existingFile.file, patch);

      } else {
        // Create new
        let fileName = '';
        if (type === 'cr') {
          const format = this.settings.crFilenameFormat || '{{number}} - {{title}}.md';
          const title = item.title || `CR-${number}`;
          fileName = format.replace('{{number}}', number).replace('{{title}}', title);
          fileName = `${folder}/${sanitizeFileName(fileName)}`;
        } else {
          const format = this.settings.taskFilenameFormat || '{{crNumber}} {{taskNumber}}.md';
          const crNumber = item.crNumber || '';
          const taskNumber = item.taskNumber || '';
          const title = item.title || '';
          const service = item.service || '';

          fileName = format
            .replace('{{crNumber}}', crNumber)
            .replace('{{taskNumber}}', taskNumber)
            .replace('{{title}}', title)
            .replace('{{service}}', service);

          fileName = `${folder}/${sanitizeFileName(fileName)}`;
        }

        // Prepare frontmatter for new file
        const frontmatter = Object.assign({}, item) as Record<string, any>;
        if (frontmatter.hasOwnProperty('Archived')) delete frontmatter['Archived'];
        if (frontmatter.hasOwnProperty('archived')) frontmatter.archived = Boolean(frontmatter.archived);

        let content = buildFrontmatterYAML(frontmatter);
        if (item.subtasks) {
          content += '\n### Subtasks\n';
          content += item.subtasks;
        }
        try {
          await this.app.vault.create(fileName, content);
        } catch (error) {
          new Notice(`Failed to create file: "${fileName}". Please check for unsupported characters.`);
        }
      }
    }
  }

  private getActiveFilterCount(): number {
    return Object.values(this.filterState).filter(v => {
      if (v === null || v === undefined || v === '') return false;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    }).length;
  }

  private matchesFilter(task: TaskNoteMeta): boolean {
    const fm = task.frontmatter;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const [fieldKey, filterValue] of Object.entries(this.filterState)) {
      if (filterValue === null || filterValue === undefined || filterValue === '') continue;

      const field = this.settings.templateConfig.fields.find(f => f.key === fieldKey);
      if (!field) continue;

      const taskValue = fm[fieldKey];

      if (field.type === 'date') {
        // Handle date range filters
        if (fieldKey === 'startDate') {
          // Include tasks with startDate from filterValue to today, and empty startDates
          if (taskValue) {
            const taskDate = new Date(taskValue);
            taskDate.setHours(0, 0, 0, 0);
            const filterDate = new Date(filterValue);
            filterDate.setHours(0, 0, 0, 0);
            if (taskDate < filterDate || taskDate > now) {
              return false; // Task doesn't match start date filter
            }
          }
          // Empty startDate is allowed
        } else if (fieldKey === 'endDate') {
          // Include tasks with endDate until filterValue, and empty endDates
          if (taskValue) {
            const taskDate = new Date(taskValue);
            taskDate.setHours(0, 0, 0, 0);
            const filterDate = new Date(filterValue);
            filterDate.setHours(0, 0, 0, 0);
            if (taskDate > filterDate) {
              return false; // Task doesn't match end date filter
            }
          }
          // Empty endDate is allowed
        } else {
          // Generic date filter (exact match or range)
          if (!taskValue) return false;
          const taskDate = new Date(taskValue);
          taskDate.setHours(0, 0, 0, 0);
          const filterDate = new Date(filterValue);
          filterDate.setHours(0, 0, 0, 0);
          if (taskDate.getTime() !== filterDate.getTime()) {
            return false;
          }
        }
      } else if (field.type === 'tags') {
        // Match if task contains ANY of the selected tags
        if (!Array.isArray(filterValue) || filterValue.length === 0) continue;
        if (!Array.isArray(taskValue)) return false;
        const hasMatch = filterValue.some(tag => taskValue.includes(tag));
        if (!hasMatch) return false;
      } else if (field.type === 'people') {
        // Match if task contains ANY of the selected people
        if (!Array.isArray(filterValue) || filterValue.length === 0) continue;
        if (!Array.isArray(taskValue)) return false;
        const hasMatch = filterValue.some(person => taskValue.includes(person));
        if (!hasMatch) return false;
      } else if (field.type === 'status') {
        // Exact match for status
        if (String(taskValue).toLowerCase() !== String(filterValue).toLowerCase()) {
          return false;
        }
      } else {
        // Text, number, url: exact or contains
        const taskStr = String(taskValue || '').toLowerCase();
        const filterStr = String(filterValue || '').toLowerCase();
        if (taskStr !== filterStr) {
          return false;
        }
      }
    }

    return true;
  }

  private async saveFilterState() {
    this.settings.filterState = this.filterState;
    await this.persistSettings?.();
  }

  // GRID
  private getFilteredTasks(): TaskNoteMeta[] {
    const taskFolder = normalizePath(this.settings.paths.taskFolder);
    let tasks = this.tasks.filter(t => t.filePath.startsWith(taskFolder + '/')); // Create a copy to sort

    // Filter archived tasks if the toggle is off
    if (!this.settings.gridConfig.showArchived) {
      tasks = tasks.filter(t => !t.frontmatter.archived);
    }

    // Sort by createdAt timestamp in descending order (newest first)
    tasks.sort((a, b) => {
      const timestampA = a.frontmatter['createdAt'] ? new Date(String(a.frontmatter['createdAt'])).getTime() : 0;
      const timestampB = b.frontmatter['createdAt'] ? new Date(String(b.frontmatter['createdAt'])).getTime() : 0;
      return timestampB - timestampA; // Descending order
    });

    // Apply search filter
    const q = this.filterQuery;
    if (q) {
      tasks = tasks.filter(t => {
        if (t.fileName.toLowerCase().includes(q)) return true;
        return this.settings.gridConfig.visibleColumns.some((key: string) => String(t.frontmatter[key] ?? '').toLowerCase().includes(q));
      });
    }

    // Apply advanced filters
    tasks = tasks.filter(t => this.matchesFilter(t));

    return tasks;
  }

  private renderGrid(container: HTMLElement) {
    const old = container.querySelector('.kb-grid-wrap');
    if (old) old.remove();
    const wrap = container.createDiv({ cls: 'kb-grid-wrap' });
    const table = wrap.createEl('table');
    table.addClass('kb-table');

    const thead = table.createEl('thead');
    const trh = thead.createEl('tr');

    // Track resize state
    let isResizing = false;
    let currentTh: HTMLElement | null = null;
    let startX = 0;
    let startWidth = 0;

    const setupColumnResize = (th: HTMLElement, key: string) => {
      // Set initial width from settings or compute based on content
      const savedWidth = this.settings.gridConfig.columnWidths[key] ?? this.settings.gridConfig.defaultColumnWidth;
      if (savedWidth) {
        th.style.width = `${savedWidth}px`;
      }

      th.onmousedown = (e: MouseEvent) => {
        // Only start resize if clicking near the right edge
        const rect = th.getBoundingClientRect();
        if (e.clientX >= rect.right - 10) {
          isResizing = true;
          currentTh = th;
          startX = e.clientX;
          startWidth = rect.width;
          table.addClass('kb-resizing');

          const onMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            const width = startWidth + (e.clientX - startX);
            if (width >= 50) { // Minimum width
              currentTh!.style.width = `${width}px`;
              // Store the new width in settings
              this.settings.gridConfig.columnWidths[key] = width;
            }
          };

          const onMouseUp = () => {
            isResizing = false;
            currentTh = null;
            table.removeClass('kb-resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            // Persist settings when done resizing
            this.persistSettings?.();
          };

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
          e.preventDefault();
        }
      };
    };

    // Calculate initial widths for status and priority columns if not set
    const calculateMaxWidth = (key: string): number => {
      // Get field definition to know the type
      const fieldDef = this.settings.templateConfig.fields.find(f => f.key === key);
      if (!fieldDef) return 120; // Default width

      let maxContent = key; // Start with header text
      if (fieldDef.type === 'status' && key === 'status') {
        // For status, check all possible status values
        maxContent = this.settings.statusConfig.statuses.reduce((a: string, b: string) => a.length > b.length ? a : b);
      } else if (fieldDef.type === 'status' && key === 'priority') {
        // For priority, check all tasks' priority values
        const allPriorities = new Set(this.tasks.map(t => String(t.frontmatter['priority'] ?? '')).filter(Boolean));
        if (allPriorities.size > 0) {
          maxContent = Array.from(allPriorities).reduce((a, b) => a.length > b.length ? a : b);
        }
      }

      // Calculate width based on content (roughly 8px per character plus padding)
      return Math.max(120, maxContent.length * 8 + 40);
    };

    // Create headers with resize handlers
    for (const key of this.settings.gridConfig.visibleColumns) {
      const th = trh.createEl('th', { text: key });

      // Set initial width for status and priority if not already set
      if ((key === 'status' || key === 'priority') && !this.settings.gridConfig.columnWidths[key]) {
        this.settings.gridConfig.columnWidths[key] = calculateMaxWidth(key);
        this.persistSettings?.();
      }

      setupColumnResize(th, key);
    }
    const archivedTh = trh.createEl('th', { text: 'Archived' });
    setupColumnResize(archivedTh, 'archived');

    const tbody = table.createEl('tbody');
    for (const t of this.getFilteredTasks()) {
      const tr = tbody.createEl('tr');
      // Add archived styling
      const isArchived = Boolean(t.frontmatter['archived']);
      if (isArchived) tr.addClass('kb-row-archived');
      for (const key of this.settings.gridConfig.visibleColumns) {
        const fieldDef = this.settings.templateConfig.fields.find((f: TaskFieldDefinition) => f.key === key) || { key, label: key, type: 'text' as FieldType };
        const val = t.frontmatter[key];
        const td = tr.createEl('td');
        td.addClass('kb-grid-cell');

        // Helper to show saving/ok state
        const showSaving = () => { td.addClass('kb-saving'); td.removeClass('kb-saved'); };
        const showSaved = () => { td.removeClass('kb-saving'); td.addClass('kb-saved'); setTimeout(() => td.removeClass('kb-saved'), 900); };

        const fileObj = this.app.vault.getAbstractFileByPath(t.filePath);

        const getDisplayText = () => Array.isArray(val) ? (val as any[]).join(', ') : String(val ?? '');

        // Render display mode with placeholder for empty cells
        const displayEl = td.createDiv({ cls: 'kb-cell-display' });
        const isEmpty = !t.frontmatter.hasOwnProperty(key) || t.frontmatter[key] === '' || t.frontmatter[key] === null;
        if (isEmpty) displayEl.addClass('kb-cell-empty');

        const setDisplayText = (text: string) => {
          if (!text.trim()) {
            displayEl.addClass('kb-cell-empty');
            displayEl.textContent = '—'; // em dash as placeholder
          } else {
            displayEl.removeClass('kb-cell-empty');
            if (text.includes('\n')) displayEl.innerHTML = text.replace(/\n/g, '<br>');
            else displayEl.textContent = text;
          }
        };

        setDisplayText(getDisplayText());

        // Helper function to create a re-renderable number link (CR or Task)
        const createNumberLink = (numKey: string, numVal: string, findFunc: (app: App, settings: PluginConfiguration, num: string) => Promise<TFile | null>) => {
          displayEl.empty();
          const link = displayEl.createEl('a', { text: numVal });
          link.href = '#';
          link.classList.add(numKey === 'crNumber' ? 'kb-cr-link' : 'kb-task-link');

          const openFile = async () => {
            const file = await findFunc(this.app, this.settings, numVal);
            if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
          };

          const openEditor = () => {
            if (td.querySelector('.kb-cell-editor')) return;
            displayEl.style.display = 'none';
            const startValue = String(t.frontmatter[numKey] ?? '');
            const editor = td.createDiv({ cls: 'kb-cell-editor' });
            const inp = editor.createEl('input') as HTMLInputElement;
            inp.type = 'text';
            inp.value = startValue;
            const finishEdit = async (doSave: boolean) => {
              inp.onblur = null;
              if (doSave) {
                await saveValue(inp.value);
              }
              editor.remove();
              displayEl.style.display = '';
              // Always re-render the link after finishing edit (even if value didn't change)
              const updatedValue = t.frontmatter[numKey];
              if (updatedValue) {
                createNumberLink(numKey, String(updatedValue), findFunc);
              } else {
                // If value was cleared, show the display as empty
                setDisplayText('');
              }
            };
            // Use addEventListener with capture phase like other edit handlers
            inp.addEventListener('keydown', (e: KeyboardEvent) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                finishEdit(false);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                finishEdit(true);
              }
            }, true);
            inp.onblur = () => finishEdit(true);
            inp.focus();
          };

          this.registerDomEvent(link, 'mousedown', (e: MouseEvent) => {
            e.preventDefault();
            if (e.button === 0 && (e.ctrlKey || e.metaKey)) { // Primary button + ctrl/meta
              openFile();
            } else if (e.button === 0) { // Primary button only
              openEditor();
            }
          });
        };

        // Special: CR number link behavior (always clickable, Ctrl+Click to navigate)
        if (key === 'crNumber' && val) {
          createNumberLink('crNumber', String(val), findCrFileByNumber);
        }

        // Special: Task number link behavior (always clickable, Ctrl+Click to navigate)
        if (key === 'taskNumber' && val) {
          createNumberLink('taskNumber', String(val), findTaskFileByNumber);
        }

        // Enter edit mode on single-click (or show inline control for specific types)
        const saveValue = async (newVal: any) => {
          showSaving();
          try {
            if (!(fileObj instanceof TFile)) throw new Error('File not found');
            const inFrontmatter = t.frontmatter && Object.prototype.hasOwnProperty.call(t.frontmatter, key);

            if (inFrontmatter || fieldDef.type !== 'freetext') {
              let payload: any = { [key]: newVal };
              if (fieldDef.type === 'tags' || fieldDef.type === 'people') {
                if (typeof newVal === 'string') payload[key] = newVal.split(',').map((s: string) => s.trim()).filter(Boolean);
              }

              if (key === 'status' && /in\s*progress/i.test(newVal) && !t.frontmatter['startDate']) {
                payload['startDate'] = new Date().toISOString().slice(0, 10);
              }

              await updateTaskFrontmatter(this.app, fileObj as TFile, payload);
            } else {
              // freetext in body: replace or append under heading
              const label = fieldDef.label || key;
              const content = await this.app.vault.read(fileObj as TFile);
              const lines = content.split('\n');
              const firstFm = lines.indexOf('---');
              let secondFm = -1;
              if (firstFm !== -1) {
                secondFm = lines.slice(firstFm + 1).indexOf('---');
                if (secondFm !== -1) secondFm = secondFm + firstFm + 1;
              }
              const bodyStart = secondFm !== -1 ? secondFm + 1 : 0;
              const headingIdx = lines.slice(bodyStart).findIndex(l => l.trim().startsWith('###') && l.toLowerCase().includes(label.toLowerCase()));
              let newLines = lines.slice();
              const newBlock = (typeof newVal === 'string') ? newVal.split('\n') : String(newVal).split('\n');
              if (headingIdx !== -1) {
                const globalHeading = bodyStart + headingIdx;
                let endIdx = globalHeading + 1;
                while (endIdx < newLines.length && !/^#{1,6}\s+/.test(newLines[endIdx])) endIdx++;
                newLines = [...newLines.slice(0, globalHeading + 1), ...newBlock, ...newLines.slice(endIdx)];
              } else {
                if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== '') newLines.push('');
                newLines.push('### ' + label);
                newLines.push(...newBlock);
              }
              await this.app.vault.modify(fileObj as TFile, newLines.join('\n'));
            }

            // update in-memory representation
            if (fieldDef.type === 'tags' || fieldDef.type === 'people') {
              if (typeof newVal === 'string') t.frontmatter[key] = newVal.split(',').map((s: string) => s.trim()).filter(Boolean);
              else t.frontmatter[key] = newVal;
            } else {
              t.frontmatter[key] = newVal;
            }
            if (key === 'status' && /in\s*progress/i.test(newVal) && !t.frontmatter['startDate']) {
              t.frontmatter['startDate'] = new Date().toISOString().slice(0, 10);
            }
            setDisplayText(Array.isArray(t.frontmatter[key]) ? t.frontmatter[key].join(', ') : String(t.frontmatter[key] ?? ''));
            showSaved();
          } catch (err) {
            new Notice('Failed to save: ' + (err as Error).message);
            td.removeClass('kb-saving');
          }
        };

        // Render inline controls for certain field types (status, date) and tag preview
        if (fieldDef.type === 'status') {
          // hide the plain text display and show inline select
          displayEl.style.display = 'none';
          const sel = td.createEl('select'); sel.addClass('kb-cell-inline-select');

          // Determine options based on field config
          const options = fieldDef.useValues === 'priorities'
            ? this.settings.priorities
            : this.settings.statusConfig.statuses;

          for (const s of options) {
            const o = sel.createEl('option', { text: s });
            o.value = s;
          }

          sel.value = String(t.frontmatter[key] ?? options[0] ?? '');
          sel.onchange = () => saveValue(sel.value);
        } else if (fieldDef.type === 'date') {
          // hide the plain text display and show inline date input
          displayEl.style.display = 'none';
          const inp = td.createEl('input') as HTMLInputElement; inp.type = 'date'; inp.value = String(t.frontmatter[key] ?? ''); inp.addClass('kb-cell-inline-date'); inp.onchange = () => saveValue(inp.value);
        } else if (fieldDef.type === 'people') {
          displayEl.style.display = 'none';
          this.createPeopleDropdown(td, String(t.frontmatter[key] ?? ''), (newValue) => {
            saveValue(newValue);
          });
        } else if (fieldDef.type === 'tags') {
          // render first tag and +N
          // hide display text and render preview
          displayEl.style.display = 'none';
          const tagsArr: string[] = Array.isArray(t.frontmatter[key]) ? t.frontmatter[key] : (t.frontmatter[key] ? String(t.frontmatter[key]).split(',').map((s: string) => s.trim()).filter(Boolean) : []);
          const preview = td.createDiv({ cls: 'kb-tags-preview' });
          if (tagsArr.length > 0) {
            const first = preview.createDiv({ cls: 'kb-tag kb-tag-large' }); first.setText(tagsArr[0]);
            if (tagsArr.length > 1) {
              const more = preview.createDiv({ cls: 'kb-tag kb-tag-more' }); more.setText(`+${tagsArr.length - 1}`);
            }
          } else {
            preview.createDiv({ cls: 'kb-cell-empty' }).setText('—');
          }
          // clicking opens a modal with full tag editor
          preview.onclick = (e) => {
            e.stopPropagation();
            const outer = this; // capture BoardTabsView instance
            class TagEditorModal extends Modal {
              private selected: string[] = tagsArr.slice();
              private allTags: string[] = [];
              private containerElInner!: HTMLElement;
              constructor() { super(outer.app); }
              onOpen() {
                this.containerEl.empty();
                this.containerEl.addClass('kb-tag-modal');
                this.containerEl.createEl('h3', { text: 'Edit tags' });
                this.containerElInner = this.containerEl.createDiv({ cls: 'kb-tag-modal-body' });
                const chips = this.containerElInner.createDiv({ cls: 'kb-selected-tags kb-modal-selected' });
                const input = this.containerElInner.createEl('input') as HTMLInputElement; input.placeholder = 'Add tag...'; input.addClass('kb-input');
                const sugg = this.containerElInner.createDiv({ cls: 'kb-tags-suggestions' });
                const renderChips = () => { chips.empty(); for (const tag of this.selected) { const el = chips.createDiv({ cls: 'kb-tag' }); el.setText(tag); const rem = el.createSpan({ cls: 'kb-tag-remove' }); rem.setText('×'); rem.onclick = (ev) => { ev.stopPropagation(); const i = this.selected.indexOf(tag); if (i > -1) this.selected.splice(i, 1); renderChips(); }; } };
                getAllExistingTags(outer.app, outer.settings).then(tags => { this.allTags = tags; renderSuggestions(); }).catch(() => { });
                const renderSuggestions = (q?: string) => {
                  sugg.empty(); const ql = (q ?? '').toLowerCase(); let candidates = this.allTags.filter(t => !this.selected.includes(t)); if (ql) candidates = candidates.filter(t => t.toLowerCase().includes(ql)); if (ql && !this.allTags.map(a => a.toLowerCase()).includes(ql)) { const addOpt = sugg.createDiv({ cls: 'kb-tag-suggestion' }); addOpt.setText(`Add "${ql}"`); addOpt.onclick = () => { this.selected.push(ql); renderChips(); input.value = ''; renderSuggestions(); input.focus(); }; }
                  for (const c of candidates) { const el = sugg.createDiv({ cls: 'kb-tag-suggestion' }); el.setText(c); el.onclick = () => { this.selected.push(c); renderChips(); input.value = ''; renderSuggestions(); input.focus(); }; }
                };
                input.oninput = () => { renderSuggestions(input.value); };
                input.onkeydown = (ev) => { if ((ev as KeyboardEvent).key === 'Enter') { ev.preventDefault(); const v = input.value.trim(); if (v) { this.selected.push(v); input.value = ''; renderChips(); renderSuggestions(); } } };
                renderChips();
                // actions
                const actions = this.containerEl.createDiv({ cls: 'kb-tag-modal-actions' });
                const saveBtn = actions.createEl('button', { text: 'Save' });
                const cancelBtn = actions.createEl('button', { text: 'Cancel' });
                saveBtn.onclick = async () => {
                  await saveValue(this.selected);
                  this.close();
                };
                cancelBtn.onclick = () => this.close();
              }
            }
            const m = new TagEditorModal(); m.open();
          };
        } else {
          // Fallback: open a small inline editor on single click
          displayEl.onclick = () => {
            if (td.querySelector('.kb-cell-editor')) return;
            displayEl.style.display = 'none';
            const startValueRaw = t.frontmatter.hasOwnProperty(key) ? t.frontmatter[key] : '';
            const startValue = Array.isArray(startValueRaw) ? startValueRaw.join(', ') : String(startValueRaw ?? '');
            const editor = td.createDiv({ cls: 'kb-cell-editor' });

            if (key === 'notes') {
              const inp = editor.createEl('textarea') as HTMLTextAreaElement;
              inp.value = startValue;
              const finishEdit = async (doSave: boolean) => {
                inp.onblur = null;
                if (doSave) await saveValue(inp.value);
                editor.remove();
                displayEl.style.display = '';
              };
              inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  finishEdit(true);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  finishEdit(false);
                }
              }, true);
              inp.onblur = () => finishEdit(true);
              inp.focus();
            } else {
              const inp = editor.createEl('input') as HTMLInputElement;
              inp.type = fieldDef.type === 'number' ? 'number' : 'text';
              inp.value = startValue;
              const finishEdit = async (doSave: boolean) => {
                inp.onblur = null;
                if (doSave) await saveValue(inp.value);
                editor.remove();
                displayEl.style.display = '';
              };
              inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  finishEdit(true);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  finishEdit(false);
                }
              }, true);
              inp.onblur = () => finishEdit(true);
              inp.focus();
            }
          };
        }
      }
      // Archived column
      const archivedTd = tr.createEl('td');
      archivedTd.createSpan({ text: isArchived ? 'Yes' : 'No' });
    }
  }

  private createPeopleDropdown(parentElement: HTMLElement, initialValue: string, saveCallback: (value: string) => void) {
    const peopleInputContainer = parentElement.createDiv({ cls: 'kb-people-input-container' });
    const peopleInput = peopleInputContainer.createEl('input');
    peopleInput.addClass('kb-input');
    peopleInput.placeholder = 'Type to select a person...';
    peopleInput.type = 'text';
    peopleInput.value = initialValue;

    const suggestionsContainer = peopleInputContainer.createDiv({ cls: 'kb-people-suggestions' });
    suggestionsContainer.style.display = 'none';

    let allPeople = this.settings.people || [];

    const renderSuggestions = (query?: string) => {
      suggestionsContainer.empty();
      const q = (query ?? '').trim().toLowerCase();
      let candidates = allPeople.filter(p => q ? p.toLowerCase().includes(q) : true);

      if (q && !allPeople.map(p => p.toLowerCase()).includes(q)) {
        const addOption = suggestionsContainer.createDiv({ cls: 'kb-people-suggestion' });
        addOption.setText(`Add "${query}"`);
        addOption.onclick = async () => {
          await this.plugin.addPerson(query!);
          allPeople = this.settings.people || [];
          selectPerson(query!);
        };
      }

      for (const person of candidates) {
        const option = suggestionsContainer.createDiv({ cls: 'kb-people-suggestion' });
        option.setText(person);
        option.onclick = () => selectPerson(person);
      }

      suggestionsContainer.style.display = 'block';
    };

    const selectPerson = (person: string) => {
      peopleInput.value = person;
      suggestionsContainer.style.display = 'none';
      saveCallback(person);
    };

    peopleInput.oninput = () => renderSuggestions(peopleInput.value);
    peopleInput.onfocus = () => renderSuggestions('');
    peopleInput.onkeydown = async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = peopleInput.value.trim();
        if (value) {
          if (!allPeople.includes(value)) {
            await this.plugin.addPerson(value);
            allPeople = this.settings.people || [];
          }
          selectPerson(value);
        }
      }
    };
    peopleInput.onblur = () => {
      // Save the value on blur, but with a small delay to allow for clicks on suggestions
      setTimeout(() => {
        if (suggestionsContainer.style.display === 'none') {
          saveCallback(peopleInput.value);
        }
      }, 200);
    };
    document.addEventListener('click', (e) => {
      if (!peopleInputContainer.contains(e.target as Node)) {
        suggestionsContainer.style.display = 'none';
      }
    });
  }

  // BOARD
  private renderBoard(container: HTMLElement) {
    const existing = container.querySelector('.kb-kanban');
    if (existing) existing.remove();
    const board = container.createDiv({ cls: 'kb-kanban kb-kanban-horizontal', attr: { draggable: 'false' } });

    const byStatus = new Map<string, TaskNoteMeta[]>();
    for (const status of this.settings.statusConfig.statuses) byStatus.set(status, []);
    for (const t of this.getFilteredTasks()) {
      const status = (t.frontmatter['status'] ?? this.settings.statusConfig.statuses[0]) as string;
      (byStatus.get(status) ?? byStatus.get(this.settings.statusConfig.statuses[0])!)!.push(t);
    }
    // Sort tasks in each column by explicit 'order' frontmatter if present, falling back to createdAt
    for (const [k, arr] of Array.from(byStatus.entries())) {
      arr.sort((a, b) => {
        const oa = Number(a.frontmatter['order'] ?? NaN);
        const ob = Number(b.frontmatter['order'] ?? NaN);
        if (!Number.isNaN(oa) && !Number.isNaN(ob) && oa !== ob) return oa - ob;
        const ca = a.frontmatter['createdAt'] ? new Date(String(a.frontmatter['createdAt'])).getTime() : 0;
        const cb = b.frontmatter['createdAt'] ? new Date(String(b.frontmatter['createdAt'])).getTime() : 0;
        return ca - cb;
      });
    }

    const handleColumnDrag = {
      dragIndex: -1,
      onDragStart: (idx: number, e: DragEvent) => {
        // Use a custom mime type to avoid conflicting with card drags
        e.dataTransfer?.setData('application/x-kb-col', String(idx));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        handleColumnDrag.dragIndex = idx;
      },
      onDropOnIndex: async (idx: number) => {
        const from = handleColumnDrag.dragIndex;
        const to = idx;
        if (from < 0 || to < 0 || from === to) return;
        const arr = this.settings.statusConfig.statuses;
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        await this.persistSettings?.();
        this.renderBoard(container);
      }
    };

    this.settings.statusConfig.statuses.forEach((status: string, idx: number) => {
      const col = board.createDiv({ cls: 'kb-column', attr: { 'data-col-index': String(idx) } });
      // Column acts as dropzone for both column drags (reorder) and card drags (move)
      col.ondragover = (e) => {
        const isColDrag = e.dataTransfer?.types.includes('application/x-kb-col');
        if (isColDrag) {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.add('kb-col-hover');
        } else {
          // Card drag
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          e.preventDefault();
          body.classList.add('kb-dropzone-hover');
        }
      };
      col.ondragleave = (e) => { (e.currentTarget as HTMLElement).classList.remove('kb-col-hover'); body.classList.remove('kb-dropzone-hover'); };
      col.ondrop = async (e) => {
        const isColDrag = e.dataTransfer?.types.includes('application/x-kb-col');
        if (isColDrag) {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.remove('kb-col-hover');
          await handleColumnDrag.onDropOnIndex(idx);
        } else {
          // Delegate to body drop logic so empty areas in the column accept cards
          await body.ondrop?.(e as any);
        }
      };

      const header = col.createDiv({ cls: 'kb-column-header' });
      header.draggable = true;
      header.ondragstart = (e) => handleColumnDrag.onDragStart(idx, e);
      header.createSpan({ text: status });
      header.createSpan({ text: String(byStatus.get(status)?.length ?? 0) });
      const menuBtn = header.createEl('button', { text: '⋯' });
      menuBtn.classList.add('kb-ellipsis');
      menuBtn.onclick = (ev) => {
        const menu = new Menu();
        menu.addItem((i) => i.setTitle('Rename').onClick(async () => {
          const newName = (await this.promptText('Rename column', 'Column name', status))?.trim();
          if (!newName || newName === status) return;
          // Update settings
          this.settings.statusConfig.statuses[idx] = newName;
          await this.persistSettings?.();
          // Update all tasks currently in this status
          const tasksInCol = byStatus.get(status) ?? [];
          const updates: Promise<void>[] = [];
          for (const t of tasksInCol) {
            const f = this.app.vault.getAbstractFileByPath(t.filePath);
            if (f instanceof TFile) {
              updates.push(updateTaskFrontmatter(this.app, f, { status: newName }));
            }
          }
          try {
            await Promise.all(updates);
          } catch (e) {
            new Notice('Some tasks failed to update');
          }
          await this.reload();
        }));
        menu.addItem((i) => i.setTitle('Delete').onClick(async () => {
          this.settings.statusConfig.statuses.splice(idx, 1);
          await this.persistSettings?.();
          this.renderBoard(container);
        }));
        menu.addItem((i) => i.setTitle('Move right').onClick(async () => {
          const arr = this.settings.statusConfig.statuses; if (idx >= arr.length - 1) return;[arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]]; await this.persistSettings?.(); this.renderBoard(container);
        }));
        menu.addItem((i) => i.setTitle('Move left').onClick(async () => {
          const arr = this.settings.statusConfig.statuses; if (idx === 0) return;[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; await this.persistSettings?.(); this.renderBoard(container);
        }));
        const e = ev as MouseEvent;
        menu.showAtPosition({ x: e.clientX, y: e.clientY });
      };

      const body = col.createDiv({ cls: 'kb-column-body kb-dropzone' });
      // Drop indicator element shown between cards while dragging
      const dropIndicator = document.createElement('div');
      dropIndicator.className = 'kb-drop-indicator';

      const removeIndicator = () => { if (dropIndicator.parentElement) dropIndicator.parentElement.removeChild(dropIndicator); };

      const setHighlight = (on: boolean) => { body.classList.toggle('kb-dropzone-hover', on); if (!on) removeIndicator(); };
      const allowDrop = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; };

      const updateIndicatorPosition = (e: DragEvent) => {
        // Only for card drags
        if (e.dataTransfer?.types.includes('application/x-kb-col')) return;
        allowDrop(e);
        // children are current cards (do not include indicator)
        const children = Array.from(body.querySelectorAll('.kb-card')) as HTMLElement[];
        // find insert index by comparing Y coordinate to midpoint of each card
        let insertIndex = children.length;
        const y = (e as DragEvent).clientY;
        for (let i = 0; i < children.length; i++) {
          const rect = children[i].getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (y < midY) { insertIndex = i; break; }
        }
        // place indicator before the child at insertIndex, or append if at end or empty
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
        if (!e.dataTransfer?.types.includes('application/x-kb-col')) updateIndicatorPosition(e as DragEvent);
      };
      body.ondragover = (e) => { if (!e.dataTransfer?.types.includes('application/x-kb-col')) updateIndicatorPosition(e as DragEvent); };
      body.ondragleave = (e) => {
        // If the pointer leaves the column entirely, clear indicator
        const related = (e as DragEvent).relatedTarget as Node | null;
        if (!related || !body.contains(related)) setHighlight(false);
      };
      body.ondrop = async (e) => {
        // Ignore drops from column drags
        if (e.dataTransfer?.types.includes('application/x-kb-col')) return;

        // Handle card drags (we set application/x-kb-card) or legacy text/plain payload
        const isCardDrag = e.dataTransfer?.types.includes('application/x-kb-card');
        const payloadStr = isCardDrag ? e.dataTransfer?.getData('application/x-kb-card') : e.dataTransfer?.getData('text/plain');
        if (!payloadStr) return;

        let payload: { path: string; fromStatus?: string } | null = null;
        try { payload = JSON.parse(payloadStr); } catch { payload = { path: payloadStr }; }
        if (!payload || !payload.path) return;
        const file = this.app.vault.getAbstractFileByPath(payload.path);
        if (!(file instanceof TFile)) return;

        try {
          // Build current ordered list of tasks for this column
          const tasksInCol = byStatus.get(status) ?? [];

          // Determine source column list as well
          const fromStatus = payload.fromStatus ?? String(this.app.metadataCache.getFileCache(file)?.frontmatter?.['status'] ?? '');
          const tasksInFromCol = byStatus.get(fromStatus) ?? [];

          // Compute insertion index based on drop Y position relative to children
          const children = Array.from(body.querySelectorAll('.kb-card')) as HTMLElement[];
          let insertIndex = children.length; // append by default
          const dropY = (e as DragEvent).clientY;

          if (children.length > 0) {
            // Calculate gaps between cards
            const gaps: { top: number; bottom: number; index: number }[] = [];

            // First card's top gap
            const firstRect = children[0].getBoundingClientRect();
            gaps.push({
              top: firstRect.top - 20, // Add some padding above first card
              bottom: firstRect.top + 10,
              index: 0
            });

            // Gaps between cards
            for (let i = 0; i < children.length - 1; i++) {
              const currentRect = children[i].getBoundingClientRect();
              const nextRect = children[i + 1].getBoundingClientRect();
              const gapMiddle = currentRect.bottom + (nextRect.top - currentRect.bottom) / 2;

              gaps.push({
                top: gapMiddle - 10, // 10px above middle
                bottom: gapMiddle + 10, // 10px below middle
                index: i + 1
              });
            }

            // Last card's bottom gap
            const lastRect = children[children.length - 1].getBoundingClientRect();
            gaps.push({
              top: lastRect.bottom - 10,
              bottom: lastRect.bottom + 20, // Add some padding below last card
              index: children.length
            });

            // Find which gap we're in
            let foundGap = false;
            for (const gap of gaps) {
              if (dropY >= gap.top && dropY <= gap.bottom) {
                insertIndex = gap.index;
                foundGap = true;
                break;
              }
            }

            // If not in a gap, find nearest card's position
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

          // Find task index in source list
          const draggedIndexInSource = tasksInFromCol.findIndex(t => t.filePath === payload!.path);

          // Early exit if dropping in same position in same column
          if (fromStatus === status && draggedIndexInSource !== -1) {
            const adjustedInsertIndex = draggedIndexInSource < insertIndex
              ? insertIndex - 1  // Account for removal when moving down
              : insertIndex;     // No adjustment needed when moving up

            if (draggedIndexInSource === adjustedInsertIndex) {
              setHighlight(false);
              return; // No changes needed
            }
          }

          // Preserve horizontal scroll position while we update
          const scroller = board;
          const scrollLeft = scroller.scrollLeft;

          // Remove from source list if present
          if (draggedIndexInSource !== -1) tasksInFromCol.splice(draggedIndexInSource, 1);

          // If moving within same column, adjust target index if removed from earlier position
          if (fromStatus === status && draggedIndexInSource !== -1) {
            if (draggedIndexInSource < insertIndex) insertIndex = Math.max(0, insertIndex - 1);
          }

          // Insert into target list at insertIndex
          // If the dragged task isn't already present in target list, create a placeholder entry from file metadata
          let draggedTask = tasksInCol.find(t => t.filePath === payload.path);
          if (!draggedTask) {
            const cache = this.app.metadataCache.getFileCache(file);
            draggedTask = { file, filePath: payload.path, fileName: file.name.replace(/\.md$/, ''), frontmatter: cache?.frontmatter ?? {}, subtasks: [] };
          }
          if (draggedTask) {
            tasksInCol.splice(insertIndex, 0, draggedTask);
          }

          // If status changed, we will patch status and potentially dates
          const isCompleted = /^(completed|done)$/i.test(status);
          const isInProgress = /in\s*progress/i.test(status);

          // Now write new 'order' for every task in this column and update status for dragged task
          const updates: Promise<void>[] = [];
          for (let i = 0; i < tasksInCol.length; i++) {
            const t = tasksInCol[i];
            const f = this.app.vault.getAbstractFileByPath(t.filePath);
            if (!(f instanceof TFile)) continue;
            const patch: Record<string, any> = { order: i };
            // If this is the dragged task and status changed, set status and dates
            if (t.filePath === payload.path) {
              if (String(t.frontmatter['status'] ?? '') !== status) {
                patch['status'] = status;
                if (isCompleted) patch['endDate'] = new Date().toISOString().slice(0, 10);
                if (isInProgress && !t.frontmatter['startDate']) patch['startDate'] = new Date().toISOString().slice(0, 10);
              }
            }
            updates.push(updateTaskFrontmatter(this.app, f, patch));
          }

          // Also re-write order for remaining tasks in the source column if different from target
          if (fromStatus !== status) {
            for (let i = 0; i < tasksInFromCol.length; i++) {
              const t = tasksInFromCol[i];
              const f = this.app.vault.getAbstractFileByPath(t.filePath);
              if (!(f instanceof TFile)) continue;
              const patch: Record<string, any> = { order: i };
              updates.push(updateTaskFrontmatter(this.app, f, patch));
            }
          }

          try {
            if (updates.length > 0) {
              await Promise.all(updates);
              new Notice('Moved');
              setHighlight(false);
              await this.reload();
              // Restore scroll after reload
              const newBoard = container.querySelector('.kb-kanban');
              if (newBoard) newBoard.scrollLeft = scrollLeft;
            } else {
              setHighlight(false);
            }
          } catch (err) {
            new Notice('Failed to move: ' + (err as Error).message);
          }
        } catch (err) {
          new Notice('Failed to move: ' + (err as Error).message);
        }
      };

      for (const task of byStatus.get(status) ?? []) {
        // Skip archived tasks in kanban view
        if (Boolean(task.frontmatter['archived'])) continue;
        const card = body.createDiv({ cls: 'kb-card', attr: { draggable: 'true' } });
        card.ondragstart = (e) => {
          e.stopPropagation();
          const payload = JSON.stringify({ path: task.filePath, fromStatus: status });
          // set both custom mime and a plain fallback
          e.dataTransfer?.setData('application/x-kb-card', payload);
          e.dataTransfer?.setData('text/plain', payload);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        };
        // Card header: title and menu button positioned top-right
        const cardHeader = card.createDiv({ cls: 'kb-card-header' });
        cardHeader.createDiv({ cls: 'kb-card-title', text: task.fileName });
        const menuBtn = cardHeader.createEl('button', { text: '⋯' });
        menuBtn.classList.add('kb-ellipsis', 'kb-card-menu-btn');

        const meta = card.createDiv();
        meta.createSpan({ cls: 'kb-chip', text: task.frontmatter['priority'] ?? '' });

        const subtasksContainer = card.createDiv({ cls: 'kb-subtasks' });
        if (task.subtasks && task.subtasks.length > 0) {
          const completedCount = task.subtasks.filter(st => st.completed).length;
          const totalCount = task.subtasks.length;
          const subtaskSummary = subtasksContainer.createDiv({ cls: 'kb-subtask-summary' });
          subtaskSummary.setText(`${completedCount}/${totalCount} completed`);

          for (const subtask of task.subtasks) {
            if (subtask.completed) continue;
            const subtaskEl = subtasksContainer.createDiv({ cls: 'kb-subtask' });
            const checkbox = subtaskEl.createEl('input', { type: 'checkbox' });
            checkbox.checked = subtask.completed;
            checkbox.onchange = async (e) => {
              e.stopPropagation();
              subtask.completed = checkbox.checked;
              const file = this.app.vault.getAbstractFileByPath(task.filePath);
              if (file instanceof TFile) {
                const content = await this.app.vault.read(file);
                const lines = content.split('\n');
                const lineIndex = lines.findIndex(line => {
                  const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)/);
                  return match && match[2].trim() === subtask.text;
                });
                if (lineIndex !== -1) {
                  lines[lineIndex] = ` - [${subtask.completed ? 'x' : ' '}] ${subtask.text}`;
                  await this.app.vault.modify(file, lines.join('\n'));
                  this.reload();
                }
              }
            };
            subtaskEl.createSpan({ text: subtask.text });
          }
        }

        const footer = card.createDiv({ cls: 'kb-card-footer' });
        const createdAt = (task.frontmatter['createdAt'] || '') as string;
        if (createdAt) footer.createSpan({ cls: 'kb-card-ts', text: new Date(createdAt).toLocaleString() });

        // Three dots menu: Open is first option
        menuBtn.onclick = (ev) => {
          // Prevent card click from firing when clicking the menu
          ev.stopPropagation();
          const menu = new Menu();
          menu.addItem((i) => i.setTitle('Open').onClick(async () => {
            const file = this.app.vault.getAbstractFileByPath(task.filePath);
            if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
          }));
          menu.addItem((i) => i.setTitle('Archive').onClick(async () => {
            try {
              await updateTaskFrontmatter(this.app, this.app.vault.getAbstractFileByPath(task.filePath) as TFile, { archived: true });
              new Notice('Task archived');
              await this.reload();
            } catch (e) {
              new Notice('Failed to archive task');
            }
          }));
          menu.addItem((i) => i.setTitle('Delete').onClick(async () => {
            try {
              await this.app.vault.delete(this.app.vault.getAbstractFileByPath(task.filePath) as TFile);
              new Notice('Task deleted');
              await this.reload();
            } catch (e) {
              new Notice('Failed to delete task');
            }
          }));
          const e = ev as MouseEvent;
          menu.showAtPosition({ x: e.clientX, y: e.clientY });
        };
        // Click anywhere on the card (except menu) to open edit modal
        card.onclick = async (e) => {
          // Open edit modal populated with current frontmatter values
          const file = this.app.vault.getAbstractFileByPath(task.filePath);
          if (!(file instanceof TFile)) return;
          const modal = new EditTaskModal(this.app, this.settings, task, async (patch) => {
            try {
              await updateTaskFrontmatter(this.app, file, patch);
              new Notice('Task updated');
              await this.reload();
            } catch (err) {
              new Notice('Failed to update task: ' + (err as Error).message);
            }
          });
          modal.open();
        };
      }
    });

    // Add column at far right
    const addCol = board.createDiv({ cls: 'kb-column kb-column-add' });
    const addBtn = addCol.createEl('button', { text: '+ Add column' });
    addBtn.classList.add('kb-button');
    addBtn.onclick = async () => {
      const name = (await this.promptText('New column', 'Column name'))?.trim();
      if (!name) return;
      this.settings.statusConfig.statuses.push(name);
      await this.persistSettings?.();
      this.renderBoard(container);
    };
  }
}

// Modal for editing an existing task. Reuses templateFields from settings to avoid duplication.
class EditTaskModal extends Modal {
  private settings: PluginConfiguration;
  private task: TaskNoteMeta;
  private onSubmit: (patch: Record<string, any>) => void | Promise<void>;
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | { getValue: () => any }>();

  constructor(app: App, settings: PluginConfiguration, task: TaskNoteMeta, onSubmit: (patch: Record<string, any>) => void | Promise<void>) {
    super(app);
    this.settings = settings;
    this.task = task;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kb-container');
    contentEl.createEl('h2', { text: 'Edit Task' });

    const fm = this.task.frontmatter ?? {};

    // Add status field first (always present)
    const statusRow = contentEl.createDiv({ cls: 'setting-item' });
    statusRow.createDiv({ cls: 'setting-item-name', text: 'Status' });
    const statusControl = statusRow.createDiv({ cls: 'setting-item-control' });
    const statusSelect = statusControl.createEl('select');
    for (const s of this.settings.statusConfig.statuses) {
      const opt = statusSelect.createEl('option', { text: s });
      opt.value = s;
    }
    statusSelect.value = String(fm['status'] ?? this.settings.statusConfig.statuses[0] ?? '');
    this.inputs.set('status', statusSelect);

    // CR Number
    const crRow = contentEl.createDiv({ cls: 'setting-item' });
    crRow.createDiv({ cls: 'setting-item-name', text: 'CR Number' });
    const crControl = crRow.createDiv({ cls: 'setting-item-control' });
    const crInput = crControl.createEl('input');
    crInput.addClass('kb-input');
    crInput.placeholder = 'e.g. CR-6485';
    crInput.type = 'text';
    crInput.value = String(fm['crNumber'] ?? '');
    this.inputs.set('crNumber', crInput);

    // Task Number
    const tnRow = contentEl.createDiv({ cls: 'setting-item' });
    tnRow.createDiv({ cls: 'setting-item-name', text: 'Task Number' });
    const tnControl = tnRow.createDiv({ cls: 'setting-item-control' });
    const tnInput = tnControl.createEl('input');
    tnInput.addClass('kb-input');
    tnInput.placeholder = 'e.g. T-01';
    tnInput.type = 'text';
    tnInput.value = String(fm['taskNumber'] ?? '');
    this.inputs.set('taskNumber', tnInput);

    // Service Name
    const svcRow = contentEl.createDiv({ cls: 'setting-item' });
    svcRow.createDiv({ cls: 'setting-item-name', text: 'Service Name' });
    const svcControl = svcRow.createDiv({ cls: 'setting-item-control' });
    const svcInput = svcControl.createEl('input');
    svcInput.addClass('kb-input');
    svcInput.placeholder = 'Service name';
    svcInput.type = 'text';
    svcInput.value = String(fm['service'] ?? '');
    this.inputs.set('service', svcInput);

    // Render remaining template fields
    for (const field of this.settings.templateConfig.fields.filter((f: TaskFieldDefinition) => !['status', 'crNumber', 'taskNumber', 'service'].includes(f.key))) {
      const row = contentEl.createDiv({ cls: 'setting-item' });
      row.createDiv({ cls: 'setting-item-name', text: field.label });
      const control = row.createDiv({ cls: 'setting-item-control' });

      if (field.type === 'status') {
        const select = control.createEl('select');
        select.addClass('kb-input');
        const options = field.useValues === 'priorities'
          ? this.settings.priorities
          : this.settings.statusConfig.statuses;
        for (const o of options) {
          const opt = select.createEl('option', { text: o }); opt.value = o;
        }
        select.value = String(fm[field.key] ?? options[0] ?? '');
        this.inputs.set(field.key, select);
      } else if (field.type === 'people') {
        const peopleInputContainer = control.createDiv({ cls: 'kb-people-input-container' });
        const peopleInput = peopleInputContainer.createEl('input');
        peopleInput.addClass('kb-input');
        peopleInput.placeholder = 'Type to select a person...';
        peopleInput.type = 'text';
        peopleInput.value = String(fm[field.key] ?? '');

        const suggestionsContainer = peopleInputContainer.createDiv({ cls: 'kb-people-suggestions' });
        suggestionsContainer.style.display = 'none';

        let allPeople = this.settings.people || [];

        const renderSuggestions = (query?: string) => {
          suggestionsContainer.empty();
          const q = (query ?? '').trim().toLowerCase();
          let candidates = allPeople.filter(p => q ? p.toLowerCase().includes(q) : true);

          if (q && !allPeople.map(p => p.toLowerCase()).includes(q)) {
            const addOption = suggestionsContainer.createDiv({ cls: 'kb-people-suggestion' });
            addOption.setText(`Add "${query}"`);
            addOption.onclick = async () => {
              // This is a bit tricky because we don't have access to the plugin instance here to call addPerson
              // For now, we just update the local list and the input value
              allPeople.push(query!);
              selectPerson(query!);
            };
          }

          for (const person of candidates) {
            const option = suggestionsContainer.createDiv({ cls: 'kb-people-suggestion' });
            option.setText(person);
            option.onclick = () => selectPerson(person);
          }

          suggestionsContainer.style.display = 'block';
        };

        const selectPerson = (person: string) => {
          peopleInput.value = person;
          suggestionsContainer.style.display = 'none';
        };

        peopleInput.oninput = () => renderSuggestions(peopleInput.value);
        peopleInput.onfocus = () => renderSuggestions('');
        document.addEventListener('click', (e) => {
          if (!peopleInputContainer.contains(e.target as Node)) {
            suggestionsContainer.style.display = 'none';
          }
        });

        this.inputs.set(field.key, peopleInput);
      } else if (field.type === 'tags') {
        // Reuse the same tags input UI as creation modal
        const tagsContainer = control.createDiv({ cls: 'kb-tags-input-container' });
        const tagsInput = tagsContainer.createEl('input'); tagsInput.addClass('kb-input'); tagsInput.type = 'text';
        const tagsDisplay = tagsContainer.createDiv({ cls: 'kb-selected-tags' });
        const suggestionsContainer = tagsContainer.createDiv({ cls: 'kb-tags-suggestions' }); suggestionsContainer.style.display = 'none';

        const selectedTags: string[] = Array.isArray(fm[field.key]) ? fm[field.key].slice() : [];
        const renderSelected = () => {
          tagsDisplay.empty();
          for (const tag of selectedTags) {
            const tagEl = tagsDisplay.createDiv({ cls: 'kb-tag' }); tagEl.setText(tag);
            const removeBtn = tagEl.createSpan({ cls: 'kb-tag-remove' }); removeBtn.setText('×');
            removeBtn.onclick = (e) => { e.stopPropagation(); const idx = selectedTags.indexOf(tag); if (idx > -1) selectedTags.splice(idx, 1); renderSelected(); };
          }
        };
        renderSelected();

        let allTags: string[] = [];
        const loadAllTags = async () => { allTags = await getAllExistingTags(this.app, this.settings).catch(() => []); };
        loadAllTags();

        const addTag = (tag: string) => { if (!selectedTags.includes(tag)) selectedTags.push(tag); renderSelected(); tagsInput.value = ''; suggestionsContainer.style.display = 'none'; tagsInput.focus(); };

        const renderSuggestions = (q?: string) => {
          suggestionsContainer.empty();
          const query = (q ?? '').trim().toLowerCase();
          let candidates = allTags.filter(t => !selectedTags.includes(t));
          if (query) candidates = candidates.filter(t => t.toLowerCase().includes(query));
          if (query && !allTags.map(t => t.toLowerCase()).includes(query)) {
            const addOption = suggestionsContainer.createDiv({ cls: 'kb-tag-suggestion' }); addOption.setText(`Add "${q}" as new tag`); addOption.onclick = () => addTag(q!.trim());
          }
          for (const tag of candidates) { const opt = suggestionsContainer.createDiv({ cls: 'kb-tag-suggestion' }); opt.setText(tag); opt.onclick = () => addTag(tag); }
          suggestionsContainer.style.display = candidates.length > 0 || (query && !allTags.map(t => t.toLowerCase()).includes(query)) ? 'block' : 'none';
        };

        tagsInput.oninput = () => renderSuggestions(tagsInput.value);
        tagsInput.onfocus = async () => { if (allTags.length === 0) await loadAllTags(); renderSuggestions(''); };
        document.addEventListener('click', (e) => { if (!tagsContainer.contains(e.target as Node)) suggestionsContainer.style.display = 'none'; });
        tagsInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = tagsInput.value.trim(); if (v) addTag(v); } };

        this.inputs.set(field.key, { getValue: () => selectedTags } as any);
      } else if (field.type === 'freetext') {
        row.style.display = 'block'; row.style.width = '100%'; const label = row.querySelector('.setting-item-name') as HTMLElement; if (label) label.style.display = 'block'; control.style.width = '100%'; control.style.marginTop = '8px';
        const textarea = control.createEl('textarea'); textarea.addClass('kb-input'); textarea.placeholder = field.label; textarea.rows = 4; textarea.style.resize = 'vertical'; textarea.style.minHeight = '80px'; textarea.style.width = '100%'; textarea.value = String(fm[field.key] ?? ''); this.inputs.set(field.key, textarea);
      } else {
        const input = control.createEl('input'); input.addClass('kb-input'); input.placeholder = field.label; if (field.type === 'date') input.type = 'date'; else if (field.type === 'number') input.type = 'number'; else input.type = 'text'; input.value = String(fm[field.key] ?? ''); this.inputs.set(field.key, input);
      }
    }

    const subtasksContainer = contentEl.createDiv({ cls: 'kb-subtasks-edit' });
    subtasksContainer.createEl('h3', { text: 'Subtasks' });
    const subtasksList = subtasksContainer.createDiv();

    let subtasks = this.task.subtasks ? JSON.parse(JSON.stringify(this.task.subtasks)) as Subtask[] : [];

    const renderSubtasks = () => {
      subtasksList.empty();
      subtasks.forEach((subtask, index) => {
        const subtaskEl = subtasksList.createDiv({ cls: 'kb-subtask-edit-item' });
        const checkbox = subtaskEl.createEl('input', { type: 'checkbox' });
        checkbox.checked = subtask.completed;
        checkbox.onchange = () => {
          subtask.completed = checkbox.checked;
        };
        const textInput = subtaskEl.createEl('input', { type: 'text' });
        textInput.value = subtask.text;
        textInput.onchange = () => {
          subtask.text = textInput.value;
        };
        const deleteBtn = subtaskEl.createEl('button', { text: 'Delete' });
        deleteBtn.onclick = () => {
          subtasks.splice(index, 1);
          renderSubtasks();
        };
      });
    };

    renderSubtasks();

    const addSubtaskInput = subtasksContainer.createEl('input', { type: 'text', placeholder: 'Add an item' });
    const addSubtaskBtn = subtasksContainer.createEl('button', { text: 'Add Subtask' });
    addSubtaskBtn.onclick = () => {
      const text = addSubtaskInput.value.trim();
      if (text) {
        subtasks.push({ text, completed: false });
        addSubtaskInput.value = '';
        renderSubtasks();
        addSubtaskInput.focus();
      }
    };
    addSubtaskInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSubtaskBtn.click();
      }
    };

    const footer = contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = footer.createEl('button', { text: 'Cancel' }); cancel.addClass('mod-warning'); cancel.onclick = () => this.close();
    const save = footer.createEl('button', { text: 'Save' }); save.addClass('mod-cta');
    save.onclick = async () => {
      const patch: Record<string, any> = {};
      for (const [key, input] of this.inputs.entries()) {
        const anyInput = input as any;
        if (anyInput && typeof anyInput.getValue === 'function') { patch[key] = anyInput.getValue(); continue; }
        const el = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const val = el.tagName === 'TEXTAREA' ? el.value : el.value.trim();
        if (val !== '' && val != null) patch[key] = val;
        else patch[key] = val === '' ? '' : undefined;
      }

      if (patch['status'] && /in\s*progress/i.test(patch['status']) && !this.task.frontmatter['startDate']) {
        patch['startDate'] = new Date().toISOString().slice(0, 10);
      }

      const file = this.app.vault.getAbstractFileByPath(this.task.filePath);
      if (file instanceof TFile) {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          for (const key in patch) {
            if (patch[key] === undefined) {
              delete fm[key];
            } else {
              fm[key] = patch[key];
            }
          }
        });

        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        const fmIndex = lines.findIndex(line => line === '---');
        const secondFmIndex = lines.slice(fmIndex + 1).findIndex(line => line === '---') + fmIndex + 1;
        let newLines = lines.slice(0, secondFmIndex + 1);
        const subtasksContent = subtasks.map((st: any) => ` - [${st.completed ? 'x' : ' '}] ${st.text}`).join('\n');
        if (subtasks.length > 0) {
          newLines.push('### Subtasks');
          newLines.push(subtasksContent);
        }
        await this.app.vault.modify(file, newLines.join('\n'));
      }

      this.close();
    };
  }
}