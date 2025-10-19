import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, debounce, Modal, App } from 'obsidian';
import { PluginSettings, TaskNoteMeta } from '../models';
import { readAllTasks, updateTaskFrontmatter, getAllExistingTags } from '../utils';

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
    let tasks = [...this.tasks]; // Create a copy to sort
    
    // Sort by createdAt timestamp in descending order (newest first)
    tasks.sort((a, b) => {
      const timestampA = a.frontmatter['createdAt'] ? new Date(String(a.frontmatter['createdAt'])).getTime() : 0;
      const timestampB = b.frontmatter['createdAt'] ? new Date(String(b.frontmatter['createdAt'])).getTime() : 0;
      return timestampB - timestampA; // Descending order
    });

    // Then apply filter if exists
    const q = this.filterQuery;
    if (!q) return tasks;
    return tasks.filter(t => {
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
        const td = tr.createEl('td');
        // Special handling for CR numbers
        if (key === 'crNumber' && val) {
          const text = String(val);
          const crLink = t.frontmatter['crLink'];
          if (crLink) {
            const link = td.createEl('a', { text });
            link.href = '#';
            link.onclick = async (e) => {
              e.preventDefault();
              // Extract file path from [[path]] wiki link format
              const path = crLink.replace(/^\[\[/, '').replace(/\]\]$/, '');
              const file = this.app.vault.getAbstractFileByPath(path);
              if (file instanceof TFile) {
                await this.app.workspace.getLeaf(true).openFile(file);
              }
            };
          } else {
            td.textContent = text;
          }
        } else {
          const text = Array.isArray(val) ? val.join(', ') : String(val ?? '');
          // For multiline text, preserve line breaks
          if (text.includes('\n')) {
            td.innerHTML = text.replace(/\n/g, '<br>');
          } else {
            td.textContent = text;
          }
        }
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
            draggedTask = { filePath: payload.path, fileName: file.name.replace(/\.md$/, ''), frontmatter: cache?.frontmatter ?? {} };
          }
          tasksInCol.splice(insertIndex, 0, draggedTask);

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
                if (isInProgress) patch['startDate'] = new Date().toISOString().slice(0, 10);
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
        cardHeader.createDiv({ cls: 'kb-card-title', text: task.frontmatter['title'] ?? task.fileName });
        const menuBtn = cardHeader.createEl('button', { text: '⋯' });
        menuBtn.classList.add('kb-ellipsis', 'kb-card-menu-btn');

        const meta = card.createDiv();
        meta.createSpan({ cls: 'kb-chip', text: task.frontmatter['priority'] ?? '' });
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
      this.settings.statuses.push(name);
      await this.persistSettings?.();
      this.renderBoard(container);
    };
  }
}

// Modal for editing an existing task. Reuses templateFields from settings to avoid duplication.
class EditTaskModal extends Modal {
  private settings: PluginSettings;
  private task: TaskNoteMeta;
  private onSubmit: (patch: Record<string, any>) => void | Promise<void>;
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | { getValue: () => any }>();

  constructor(app: App, settings: PluginSettings, task: TaskNoteMeta, onSubmit: (patch: Record<string, any>) => void | Promise<void>) {
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
    for (const s of this.settings.statuses) {
      const opt = statusSelect.createEl('option', { text: s });
      opt.value = s;
    }
    statusSelect.value = String(fm['status'] ?? this.settings.statuses[0] ?? '');
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
    for (const field of this.settings.templateFields.filter(f => !['status', 'crNumber', 'taskNumber', 'service'].includes(f.key))) {
      const row = contentEl.createDiv({ cls: 'setting-item' });
      row.createDiv({ cls: 'setting-item-name', text: field.label });
      const control = row.createDiv({ cls: 'setting-item-control' });

      if (field.type === 'status' || field.key === 'priority') {
        const select = control.createEl('select');
        select.addClass('kb-input');
        const options = field.key === 'status' ? this.settings.statuses : ['Urgent', 'High', 'Medium', 'Low'];
        for (const o of options) {
          const opt = select.createEl('option', { text: o }); opt.value = o;
        }
        select.value = String(fm[field.key] ?? (field.key === 'status' ? this.settings.statuses[0] ?? '' : 'Medium'));
        this.inputs.set(field.key, select);
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
            removeBtn.onclick = (e) => { e.stopPropagation(); const idx = selectedTags.indexOf(tag); if (idx > -1) selectedTags.splice(idx,1); renderSelected(); };
          }
        };
        renderSelected();

        let allTags: string[] = [];
        const loadAllTags = async () => { allTags = await getAllExistingTags(this.app, this.settings).catch(() => []); };
        loadAllTags();

        const addTag = (tag: string) => { if (!selectedTags.includes(tag)) selectedTags.push(tag); renderSelected(); tagsInput.value=''; suggestionsContainer.style.display='none'; tagsInput.focus(); };

        const renderSuggestions = (q?: string) => {
          suggestionsContainer.empty();
          const query = (q ?? '').trim().toLowerCase();
          let candidates = allTags.filter(t => !selectedTags.includes(t));
          if (query) candidates = candidates.filter(t => t.toLowerCase().includes(query));
          if (query && !allTags.map(t=>t.toLowerCase()).includes(query)) {
            const addOption = suggestionsContainer.createDiv({ cls: 'kb-tag-suggestion' }); addOption.setText(`Add "${q}" as new tag`); addOption.onclick = () => addTag(q!.trim());
          }
          for (const tag of candidates) { const opt = suggestionsContainer.createDiv({ cls: 'kb-tag-suggestion' }); opt.setText(tag); opt.onclick = () => addTag(tag); }
          suggestionsContainer.style.display = candidates.length>0 || (query && !allTags.map(t=>t.toLowerCase()).includes(query)) ? 'block' : 'none';
        };

        tagsInput.oninput = () => renderSuggestions(tagsInput.value);
        tagsInput.onfocus = async () => { if (allTags.length === 0) await loadAllTags(); renderSuggestions(''); };
        document.addEventListener('click', (e) => { if (!tagsContainer.contains(e.target as Node)) suggestionsContainer.style.display='none'; });
        tagsInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = tagsInput.value.trim(); if (v) addTag(v); } };

        this.inputs.set(field.key, { getValue: () => selectedTags } as any);
      } else if (field.type === 'freetext') {
        row.style.display='block'; row.style.width='100%'; const label = row.querySelector('.setting-item-name') as HTMLElement; if (label) label.style.display='block'; control.style.width='100%'; control.style.marginTop='8px';
        const textarea = control.createEl('textarea'); textarea.addClass('kb-input'); textarea.placeholder = field.label; textarea.rows=4; textarea.style.resize='vertical'; textarea.style.minHeight='80px'; textarea.style.width='100%'; textarea.value = String(fm[field.key] ?? ''); this.inputs.set(field.key, textarea);
      } else {
        const input = control.createEl('input'); input.addClass('kb-input'); input.placeholder = field.label; if (field.type === 'date') input.type='date'; else if (field.type === 'number') input.type='number'; else input.type='text'; input.value = String(fm[field.key] ?? ''); this.inputs.set(field.key, input);
      }
    }

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
      await this.onSubmit(patch);
      this.close();
    };
  }
}


