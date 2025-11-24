import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, debounce, Modal, normalizePath } from 'obsidian';
import * as XLSX from 'xlsx';
import { PluginConfiguration, TaskNoteMeta, ActiveTab } from '../models';
import { readAllItems, buildFrontmatterYAML, sanitizeFileName, updateTaskFrontmatter } from '../utils';
import KanbanPlugin from '../main';
import { FilterPanel } from './filterModal';
import { GridView } from './gridView';
import { BoardView } from './boardView';

export const BOARD_TABS_VIEW_TYPE = 'kb-board-tabs-view';

export class BoardTabsView extends ItemView {
  private plugin: KanbanPlugin;
  private settings: PluginConfiguration;
  private tasks: TaskNoteMeta[] = [];
  private filterQuery = '';
  private active: ActiveTab;
  private persistSettings?: () => void | Promise<void>;
  private filterState: Record<string, any> = {};
  private suppressReloadUntil = 0;
  private pendingReload = false;
  private suppressTimer: number | null = null;
  private ignorePendingReload = false;

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
    this.registerEvent(this.app.metadataCache.on('changed', debounce(() => this.handleDataChange(), 300)));
    this.registerEvent(this.app.vault.on('modify', debounce(() => this.handleDataChange(), 300)));

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

  private handleDataChange() {
    if (Date.now() < this.suppressReloadUntil) {
      this.pendingReload = true;
      return;
    }
    this.pendingReload = false;
    this.ignorePendingReload = false;
    this.reload();
  }

  private suppressReloads(duration = 1000, ignorePending = false) {
    this.suppressReloadUntil = Date.now() + duration;
    if (ignorePending) this.pendingReload = false;
    this.ignorePendingReload = ignorePending;
    if (this.suppressTimer) {
      window.clearTimeout(this.suppressTimer);
    }
    this.suppressTimer = window.setTimeout(() => {
      this.suppressTimer = null;
      if (this.pendingReload && !this.ignorePendingReload) {
        this.pendingReload = false;
        this.ignorePendingReload = false;
        this.reload();
      } else {
        this.pendingReload = false;
        this.ignorePendingReload = false;
      }
    }, duration + 50);
  }

  public suppressReloadsForLocalUpdate(duration = 1200) {
    this.suppressReloads(duration, true);
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

  private async saveFilterState() {
    this.settings.filterState = this.filterState;
    await this.persistSettings?.();
  }

  // GRID
  private renderGrid(container: HTMLElement) {
    const gridView = new GridView(
      this.app,
      this.plugin,
      this.settings,
      this.tasks,
      this.filterQuery,
      this.filterState,
      this.persistSettings,
      this.suppressReloadsForLocalUpdate.bind(this)
    );
    gridView.render(container);
  }

  // BOARD
  private renderBoard(container: HTMLElement) {
    const boardView = new BoardView(
      this.app,
      this.settings,
      this.tasks,
      this.filterQuery,
      this.filterState,
      this.promptText.bind(this),
      this.reload.bind(this),
      this.persistSettings,
      this.suppressReloadsForLocalUpdate.bind(this)
    );
    boardView.render(container);
  }
}