import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, debounce, Modal } from 'obsidian';
import { PluginSettings, TaskNoteMeta } from '../models';
import { readAllTasks, updateTaskFrontmatter } from '../utils';

export const BOARD_TABS_VIEW_TYPE = 'kb-board-tabs-view';

type ActiveTab = 'grid' | 'board';

export class BoardTabsView extends ItemView {
  private settings: PluginSettings;
  private tasks: TaskNoteMeta[] = [];
  private filterQuery = '';
  private active: ActiveTab = 'grid';
  private persistSettings?: () => void | Promise<void>;
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

  constructor(leaf: WorkspaceLeaf, settings: PluginSettings, persistSettings?: () => void | Promise<void>) {
    super(leaf);
    this.settings = settings;
    this.persistSettings = persistSettings;
  }

  getViewType(): string { return BOARD_TABS_VIEW_TYPE; }
  getDisplayText(): string { return 'Tasks'; }
  getIcon(): string { return 'layout-grid'; }

  async onOpen() {
    this.contentEl.addClass('kb-container');
    this.registerEvent(this.app.metadataCache.on('changed', debounce(() => this.reload(), 300)));
    this.registerEvent(this.app.vault.on('modify', debounce(() => this.reload(), 300)));
    await this.reload();
  }

  async reload() {
    this.tasks = await readAllTasks(this.app, this.settings);
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
    gridBtn.onclick = () => { this.active = 'grid'; this.render(); };
    const boardBtn = tabs.createEl('button', { text: 'Board' });
    boardBtn.addClass('kb-tab');
    if (this.active === 'board') boardBtn.addClass('is-active');
    boardBtn.onclick = () => { this.active = 'board'; this.render(); };

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

    if (this.active === 'grid') this.renderGrid(c); else this.renderBoard(c);
  }

  // GRID
  private getFilteredTasks(): TaskNoteMeta[] {
    const q = this.filterQuery;
    if (!q) return this.tasks;
    return this.tasks.filter(t => {
      if (t.fileName.toLowerCase().includes(q)) return true;
      return this.settings.gridVisibleColumns.some((key) => String(t.frontmatter[key] ?? '').toLowerCase().includes(q));
    });
  }

  private renderGrid(container: HTMLElement) {
    const old = container.querySelector('.kb-grid-wrap');
    if (old) old.remove();
    const wrap = container.createDiv({ cls: 'kb-grid-wrap' });
    const table = wrap.createEl('table');
    table.addClass('kb-table');

    const thead = table.createEl('thead');
    const trh = thead.createEl('tr');
    for (const key of this.settings.gridVisibleColumns) trh.createEl('th', { text: key });
    trh.createEl('th', { text: 'Archived' });
    trh.createEl('th', { text: 'Open' });

    const tbody = table.createEl('tbody');
    for (const t of this.getFilteredTasks()) {
      const tr = tbody.createEl('tr');
      // Add archived styling
      const isArchived = Boolean(t.frontmatter['archived']);
      if (isArchived) tr.addClass('kb-row-archived');
      for (const key of this.settings.gridVisibleColumns) {
        const val = t.frontmatter[key];
        tr.createEl('td', { text: Array.isArray(val) ? val.join(', ') : String(val ?? '') });
      }
      // Archived column
      const archivedTd = tr.createEl('td');
      archivedTd.createSpan({ text: isArchived ? 'Yes' : 'No' });
      const openTd = tr.createEl('td');
      const btn = openTd.createEl('button', { text: 'Open' });
      btn.addClass('kb-card-btn');
      btn.onclick = async () => {
        const file = this.app.vault.getAbstractFileByPath(t.filePath);
        if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
      };
    }
  }

  // BOARD
  private renderBoard(container: HTMLElement) {
    const existing = container.querySelector('.kb-kanban');
    if (existing) existing.remove();
    const board = container.createDiv({ cls: 'kb-kanban kb-kanban-horizontal', attr: { draggable: 'false' } });

    const byStatus = new Map<string, TaskNoteMeta[]>();
    for (const status of this.settings.statuses) byStatus.set(status, []);
    for (const t of this.getFilteredTasks()) {
      const status = (t.frontmatter['status'] ?? this.settings.statuses[0]) as string;
      (byStatus.get(status) ?? byStatus.get(this.settings.statuses[0])!)!.push(t);
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
        const arr = this.settings.statuses;
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        await this.persistSettings?.();
        this.renderBoard(container);
      }
    };

    this.settings.statuses.forEach((status, idx) => {
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
          this.settings.statuses[idx] = newName;
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
          this.settings.statuses.splice(idx, 1);
          await this.persistSettings?.();
          this.renderBoard(container);
        }));
        menu.addItem((i) => i.setTitle('Move right').onClick(async () => {
          const arr = this.settings.statuses; if (idx >= arr.length - 1) return; [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]]; await this.persistSettings?.(); this.renderBoard(container);
        }));
        menu.addItem((i) => i.setTitle('Move left').onClick(async () => {
          const arr = this.settings.statuses; if (idx === 0) return; [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; await this.persistSettings?.(); this.renderBoard(container);
        }));
        const e = ev as MouseEvent;
        menu.showAtPosition({ x: e.clientX, y: e.clientY });
      };

      const body = col.createDiv({ cls: 'kb-column-body kb-dropzone' });
      const setHighlight = (on: boolean) => { body.classList.toggle('kb-dropzone-hover', on); };
      const allowDrop = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; };
      body.ondragenter = (e) => {
        // Only react to card drags, not column reorders
        if (!e.dataTransfer?.types.includes('application/x-kb-col')) { allowDrop(e); setHighlight(true); }
      };
      body.ondragover = (e) => { if (!e.dataTransfer?.types.includes('application/x-kb-col')) { allowDrop(e); } };
      body.ondragleave = () => { setHighlight(false); };
      body.ondrop = async (e) => {
        // Ignore drops from column drags
        if (e.dataTransfer?.types.includes('application/x-kb-col')) return;
        const path = e.dataTransfer?.getData('text/plain');
        if (!path) return;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        try {
          // If the task already has this status, do nothing (no move, no date changes)
          const cache = this.app.metadataCache.getFileCache(file);
          const currentStatus = String(cache?.frontmatter?.['status'] ?? '');
          if (currentStatus === status) {
            // clear highlight and return without updating
            setHighlight(false);
            return;
          }

          // Preserve horizontal scroll position while we update
          const scroller = board; // .kb-kanban is the horizontal scroller
          const scrollLeft = scroller.scrollLeft;
          const isCompleted = /^(completed|done)$/i.test(status);
          const isInProgress = /in\s*progress/i.test(status);
          const patch: Record<string, any> = { status };
          if (isCompleted) patch['endDate'] = new Date().toISOString().slice(0, 10);
          if (isInProgress) patch['startDate'] = new Date().toISOString().slice(0, 10);
          await updateTaskFrontmatter(this.app, file, patch);
          new Notice('Moved to ' + status);
          setHighlight(false);
          await this.reload();
          // Restore scroll after reload
          const newBoard = container.querySelector('.kb-kanban') as HTMLElement | null;
          if (newBoard) newBoard.scrollLeft = scrollLeft;
        } catch (err) {
          new Notice('Failed to move: ' + (err as Error).message);
        }
      };

      for (const task of byStatus.get(status) ?? []) {
        // Skip archived tasks in kanban view
        if (Boolean(task.frontmatter['archived'])) continue;
        const card = body.createDiv({ cls: 'kb-card', attr: { draggable: 'true' } });
        card.ondragstart = (e) => { e.stopPropagation(); e.dataTransfer?.setData('text/plain', task.filePath); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; };
        card.createDiv({ cls: 'kb-card-title', text: task.frontmatter['title'] ?? task.fileName });
        const meta = card.createDiv();
        meta.createSpan({ cls: 'kb-chip', text: task.frontmatter['priority'] ?? '' });
        const footer = card.createDiv({ cls: 'kb-card-footer' });
        const createdAt = (task.frontmatter['createdAt'] || '') as string;
        if (createdAt) footer.createSpan({ cls: 'kb-card-ts', text: new Date(createdAt).toLocaleString() });
        // Three dots menu
        const menuBtn = footer.createEl('button', { text: '⋯' });
        menuBtn.classList.add('kb-ellipsis');
        menuBtn.onclick = (ev) => {
          const menu = new Menu();
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
        const open = footer.createEl('button', { text: 'Open' });
        open.addClass('kb-card-btn');
        open.onclick = async () => {
          const file = this.app.vault.getAbstractFileByPath(task.filePath);
          if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
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
      this.settings.statuses.push(name);
      await this.persistSettings?.();
      this.renderBoard(container);
    };
  }
}


