import { App, Menu, Modal, Notice, TFile, normalizePath } from 'obsidian';
import { PluginConfiguration, Subtask, TaskNoteMeta } from '../models';
import { getAllExistingTags, updateTaskFrontmatter } from '../utils';
import { CopyTaskModal } from './copyTaskModal';

type ColumnRegistryEntry = {
    column: HTMLElement;
    body: HTMLElement;
    countEl: HTMLElement;
    dropIndicator: HTMLElement;
    removeIndicator: () => void;
};

/**
 * BoardView - Renders tasks in a Kanban board format with drag-and-drop
 */
export class BoardView {
    private app: App;
    private settings: PluginConfiguration;
    private tasks: TaskNoteMeta[] = [];
    private filterQuery = '';
    private filterState: Record<string, any> = {};
    private persistSettings?: () => void | Promise<void>;
    private promptText: (title: string, placeholder?: string, initial?: string) => Promise<string | undefined>;
    private reloadCallback: () => Promise<void>;
    private suppressReloads?: (duration?: number) => void;
    private columnRegistry = new Map<string, ColumnRegistryEntry>();
    private byStatus = new Map<string, TaskNoteMeta[]>();
    private boardEl?: HTMLElement;

    constructor(
        app: App,
        settings: PluginConfiguration,
        tasks: TaskNoteMeta[],
        filterQuery: string,
        filterState: Record<string, any>,
        promptText: (title: string, placeholder?: string, initial?: string) => Promise<string | undefined>,
        reloadCallback: () => Promise<void>,
        persistSettings?: () => void | Promise<void>,
        suppressReloads?: (duration?: number) => void
    ) {
        this.app = app;
        this.settings = settings;
        this.tasks = tasks;
        this.filterQuery = filterQuery;
        this.filterState = filterState;
        this.promptText = promptText;
        this.reloadCallback = reloadCallback;
        this.persistSettings = persistSettings;
        this.suppressReloads = suppressReloads;
    }

    private getFilteredTasks(): TaskNoteMeta[] {
        const taskFolder = normalizePath(this.settings.paths.taskFolder);
        let tasks = this.tasks.filter(t => t.filePath.startsWith(taskFolder + '/'));

        // Board view doesn't show archived tasks
        tasks = tasks.filter(t => !t.frontmatter.archived);

        // Sort by createdAt timestamp in descending order (newest first)
        tasks.sort((a, b) => {
            const timestampA = a.frontmatter['createdAt'] ? new Date(String(a.frontmatter['createdAt'])).getTime() : 0;
            const timestampB = b.frontmatter['createdAt'] ? new Date(String(b.frontmatter['createdAt'])).getTime() : 0;
            return timestampB - timestampA;
        });

        // Apply search filter
        const q = this.filterQuery;
        if (q) {
            tasks = tasks.filter(t => {
                if (t.fileName.toLowerCase().includes(q)) return true;
                return Object.values(t.frontmatter).some(v => String(v ?? '').toLowerCase().includes(q));
            });
        }

        // Apply advanced filters
        tasks = tasks.filter(t => this.matchesFilter(t));

        return tasks;
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
                if (fieldKey === 'startDate') {
                    if (taskValue) {
                        const taskDate = new Date(taskValue);
                        taskDate.setHours(0, 0, 0, 0);
                        const filterDate = new Date(filterValue);
                        filterDate.setHours(0, 0, 0, 0);
                        if (taskDate < filterDate || taskDate > now) {
                            return false;
                        }
                    }
                } else if (fieldKey === 'endDate') {
                    if (taskValue) {
                        const taskDate = new Date(taskValue);
                        taskDate.setHours(0, 0, 0, 0);
                        const filterDate = new Date(filterValue);
                        filterDate.setHours(0, 0, 0, 0);
                        if (taskDate > filterDate) {
                            return false;
                        }
                    }
                } else {
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
                if (!Array.isArray(filterValue) || filterValue.length === 0) continue;
                if (!Array.isArray(taskValue)) return false;
                const hasMatch = filterValue.some(tag => taskValue.includes(tag));
                if (!hasMatch) return false;
            } else if (field.type === 'people') {
                if (!Array.isArray(filterValue) || filterValue.length === 0) continue;
                if (!Array.isArray(taskValue)) return false;
                const hasMatch = filterValue.some(person => taskValue.includes(person));
                if (!hasMatch) return false;
            } else if (field.type === 'status') {
                if (String(taskValue).toLowerCase() !== String(filterValue).toLowerCase()) {
                    return false;
                }
            } else {
                const taskStr = String(taskValue || '').toLowerCase();
                const filterStr = String(filterValue || '').toLowerCase();
                if (taskStr !== filterStr) {
                    return false;
                }
            }
        }

        return true;
    }

    private buildStatusBuckets(): Map<string, TaskNoteMeta[]> {
        const buckets = new Map<string, TaskNoteMeta[]>();
        for (const status of this.settings.statusConfig.statuses) buckets.set(status, []);
        const defaultStatus = this.settings.statusConfig.statuses[0];

        for (const task of this.getFilteredTasks()) {
            const status = (task.frontmatter['status'] ?? defaultStatus) as string;
            (buckets.get(status) ?? buckets.get(defaultStatus)!)!.push(task);
        }

        for (const [, arr] of Array.from(buckets.entries())) {
            arr.sort((a, b) => {
                const oa = Number(a.frontmatter['order'] ?? NaN);
                const ob = Number(b.frontmatter['order'] ?? NaN);
                if (!Number.isNaN(oa) && !Number.isNaN(ob) && oa !== ob) return oa - ob;
                const ca = a.frontmatter['createdAt'] ? new Date(String(a.frontmatter['createdAt'])).getTime() : 0;
                const cb = b.frontmatter['createdAt'] ? new Date(String(b.frontmatter['createdAt'])).getTime() : 0;
                return ca - cb;
            });
        }

        return buckets;
    }

    private renderColumnCards(status: string) {
        const registry = this.columnRegistry.get(status);
        if (!registry) return;
        registry.removeIndicator();
        registry.body.classList.remove('kb-dropzone-hover');
        const existingCards = Array.from(registry.body.querySelectorAll('.kb-card'));
        existingCards.forEach(card => card.remove());

        const tasks = (this.byStatus.get(status) ?? []).filter(t => !Boolean(t.frontmatter['archived']));
        registry.countEl.setText(String(tasks.length));
        for (const task of tasks) {
            this.createCardElement(registry.body, task, status);
        }
    }

    private createCardElement(body: HTMLElement, task: TaskNoteMeta, status: string) {
        const card = body.createDiv({ cls: 'kb-card', attr: { draggable: 'true' } });
        card.ondragstart = (e) => {
            e.stopPropagation();
            const payload = JSON.stringify({ path: task.filePath, fromStatus: status });
            e.dataTransfer?.setData('application/x-kb-card', payload);
            e.dataTransfer?.setData('text/plain', payload);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        };
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
                            this.reloadCallback();
                        }
                    }
                };
                subtaskEl.createSpan({ text: subtask.text });
            }
        }

        const footer = card.createDiv({ cls: 'kb-card-footer' });
        const createdAt = (task.frontmatter['createdAt'] || '') as string;
        if (createdAt) footer.createSpan({ cls: 'kb-card-ts', text: new Date(createdAt).toLocaleString() });

        menuBtn.onclick = (ev) => {
            ev.stopPropagation();
            const menu = new Menu();
            menu.addItem((i) => i.setTitle('Open').onClick(async () => {
                const file = this.app.vault.getAbstractFileByPath(task.filePath);
                if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
            }));
            menu.addItem((i) => i.setTitle('Copy').onClick(async () => {
                const modal = new CopyTaskModal(this.app, this.settings, task, async () => {
                    await this.reloadCallback();
                });
                modal.open();
            }));
            menu.addItem((i) => i.setTitle('Archive').onClick(async () => {
                try {
                    await updateTaskFrontmatter(this.app, this.app.vault.getAbstractFileByPath(task.filePath) as TFile, { archived: true });
                    new Notice('Task archived');
                    await this.reloadCallback();
                } catch (e) {
                    new Notice('Failed to archive task');
                }
            }));
            menu.addItem((i) => i.setTitle('Delete').onClick(async () => {
                try {
                    await this.app.vault.delete(this.app.vault.getAbstractFileByPath(task.filePath) as TFile);
                    new Notice('Task deleted');
                    await this.reloadCallback();
                } catch (e) {
                    new Notice('Failed to delete task');
                }
            }));
            const e = ev as MouseEvent;
            menu.showAtPosition({ x: e.clientX, y: e.clientY });
        };
        card.onclick = async () => {
            const file = this.app.vault.getAbstractFileByPath(task.filePath);
            if (!(file instanceof TFile)) return;
            const modal = new EditTaskModal(this.app, this.settings, task, async (patch) => {
                try {
                    await updateTaskFrontmatter(this.app, file, patch);
                    new Notice('Task updated');
                    await this.reloadCallback();
                } catch (err) {
                    new Notice('Failed to update task: ' + (err as Error).message);
                }
            });
            modal.open();
        };
    }

    private applyLocalOrder(status: string, enforceStatus = false) {
        const tasks = this.byStatus.get(status);
        if (!tasks) return;
        for (let i = 0; i < tasks.length; i++) {
            tasks[i].frontmatter['order'] = i;
            if (enforceStatus) tasks[i].frontmatter['status'] = status;
        }
    }

    render(container: HTMLElement) {
        const existing = container.querySelector('.kb-kanban');
        if (existing) existing.remove();
        const board = container.createDiv({ cls: 'kb-kanban kb-kanban-horizontal', attr: { draggable: 'false' } });
        this.boardEl = board;
        this.columnRegistry.clear();
        this.byStatus = this.buildStatusBuckets();

        // Auto-scroll state
        let scrollSpeed = 0;
        let lastDragTime = 0;
        let scrollFrame: number | null = null;

        const cleanupScroll = () => {
            if (scrollFrame) {
                cancelAnimationFrame(scrollFrame);
                scrollFrame = null;
            }
            scrollSpeed = 0;
        };

        const scrollLoop = () => {
            // Stop if no drag event for 100ms (mouse stopped moving or left window)
            if (Date.now() - lastDragTime > 100) {
                cleanupScroll();
                return;
            }

            if (scrollSpeed !== 0) {
                board.scrollLeft += scrollSpeed;
                scrollFrame = requestAnimationFrame(scrollLoop);
            } else {
                cleanupScroll();
            }
        };

        // Auto-scroll when dragging near edges
        board.ondragover = (e) => {
            lastDragTime = Date.now();
            const rect = board.getBoundingClientRect();
            const threshold = 80;
            const maxSpeed = 15;

            if (e.clientX < rect.left + threshold) {
                const ratio = (rect.left + threshold - e.clientX) / threshold;
                scrollSpeed = -1 * maxSpeed * ratio;
            } else if (e.clientX > rect.right - threshold) {
                const ratio = (e.clientX - (rect.right - threshold)) / threshold;
                scrollSpeed = maxSpeed * ratio;
            } else {
                scrollSpeed = 0;
            }

            if (scrollSpeed !== 0 && !scrollFrame) {
                scrollFrame = requestAnimationFrame(scrollLoop);
            }
        };

        // Stop scrolling when drag leaves the board or is dropped
        board.ondragleave = (e) => {
            if (!board.contains(e.relatedTarget as Node)) {
                cleanupScroll();
            }
        };
        board.ondrop = () => cleanupScroll();

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
                this.render(container);
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
            header.createSpan({ text: status, cls: 'kb-column-title' });
            const countEl = header.createSpan({ text: String(this.byStatus.get(status)?.length ?? 0), cls: 'kb-column-count' });
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
                    const tasksInCol = this.byStatus.get(status) ?? [];
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
                    await this.reloadCallback();
                }));
                menu.addItem((i) => i.setTitle('Delete').onClick(async () => {
                    this.settings.statusConfig.statuses.splice(idx, 1);
                    await this.persistSettings?.();
                    this.render(container);
                }));
                menu.addItem((i) => i.setTitle('Move right').onClick(async () => {
                    const arr = this.settings.statusConfig.statuses; if (idx >= arr.length - 1) return;[arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]]; await this.persistSettings?.(); this.render(container);
                }));
                menu.addItem((i) => i.setTitle('Move left').onClick(async () => {
                    const arr = this.settings.statusConfig.statuses; if (idx === 0) return;[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; await this.persistSettings?.(); this.render(container);
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
                e.stopPropagation();
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
                    const tasksInCol = this.byStatus.get(status) ?? [];

                    // Determine source column list as well
                    const fromStatus = payload.fromStatus ?? String(this.app.metadataCache.getFileCache(file)?.frontmatter?.['status'] ?? '');
                    const tasksInFromCol = this.byStatus.get(fromStatus) ?? [];

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
                    const scroller = this.boardEl;
                    const scrollLeft = scroller?.scrollLeft ?? 0;

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
                    const autoStartStatuses = this.settings.statusConfig.autoSetStartDateStatuses || [];
                    const isInProgress = autoStartStatuses.some(s => s.toLowerCase() === status.toLowerCase());

                    // Now write new 'order' for every task in this column and update status for dragged task
                    const updates: Promise<void>[] = [];
                    const today = new Date().toISOString().slice(0, 10);
                    for (let i = 0; i < tasksInCol.length; i++) {
                        const t = tasksInCol[i];
                        const f = this.app.vault.getAbstractFileByPath(t.filePath);
                        if (!(f instanceof TFile)) continue;
                        const patch: Record<string, any> = { order: i };
                        // If this is the dragged task and status changed, set status and dates
                        if (t.filePath === payload.path) {
                            if (String(t.frontmatter['status'] ?? '') !== status) {
                                patch['status'] = status;
                                if (isCompleted) patch['endDate'] = today;
                                if (isInProgress && !t.frontmatter['startDate']) patch['startDate'] = today;
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
                        this.suppressReloads?.();
                        if (updates.length > 0) {
                            await Promise.all(updates);
                            if (draggedTask) {
                                draggedTask.frontmatter['status'] = status;
                                if (isCompleted) draggedTask.frontmatter['endDate'] = today;
                                if (isInProgress && !draggedTask.frontmatter['startDate']) draggedTask.frontmatter['startDate'] = today;
                            }
                            this.applyLocalOrder(status, true);
                            if (fromStatus !== status) this.applyLocalOrder(fromStatus);
                            setHighlight(false);
                            this.renderColumnCards(status);
                            if (fromStatus !== status) this.renderColumnCards(fromStatus);
                            new Notice('Moved');
                            if (scroller) scroller.scrollLeft = scrollLeft;
                        } else {
                            setHighlight(false);
                        }
                    } catch (err) {
                        new Notice('Failed to move: ' + (err as Error).message);
                        await this.reloadCallback();
                    }
                } catch (err) {
                    new Notice('Failed to move: ' + (err as Error).message);
                    await this.reloadCallback();
                }
            };

            this.columnRegistry.set(status, { column: col, body, countEl, dropIndicator, removeIndicator });
            this.renderColumnCards(status);
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
            this.render(container);
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
        contentEl.addClass('kb-container', 'kb-modal-layout');

        // Fixed header
        const header = contentEl.createDiv({ cls: 'kb-modal-header' });
        header.createEl('h2', { text: 'Edit Task' });

        // Scrollable content area
        const scrollableContent = contentEl.createDiv({ cls: 'kb-modal-content' });

        const fm = this.task.frontmatter ?? {};

        // Add status field first (always present)
        const statusRow = scrollableContent.createDiv({ cls: 'setting-item' });
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
        const crRow = scrollableContent.createDiv({ cls: 'setting-item' });
        crRow.createDiv({ cls: 'setting-item-name', text: 'CR Number' });
        const crControl = crRow.createDiv({ cls: 'setting-item-control' });
        const crInput = crControl.createEl('input');
        crInput.addClass('kb-input');
        crInput.placeholder = 'e.g. CR-6485';
        crInput.type = 'text';
        crInput.value = String(fm['crNumber'] ?? '');
        this.inputs.set('crNumber', crInput);

        // Task Number
        const tnRow = scrollableContent.createDiv({ cls: 'setting-item' });
        tnRow.createDiv({ cls: 'setting-item-name', text: 'Task Number' });
        const tnControl = tnRow.createDiv({ cls: 'setting-item-control' });
        const tnInput = tnControl.createEl('input');
        tnInput.addClass('kb-input');
        tnInput.placeholder = 'e.g. T-01';
        tnInput.type = 'text';
        tnInput.value = String(fm['taskNumber'] ?? '');
        this.inputs.set('taskNumber', tnInput);

        // Service Name
        const svcRow = scrollableContent.createDiv({ cls: 'setting-item' });
        svcRow.createDiv({ cls: 'setting-item-name', text: 'Service Name' });
        const svcControl = svcRow.createDiv({ cls: 'setting-item-control' });
        const svcInput = svcControl.createEl('input');
        svcInput.addClass('kb-input');
        svcInput.placeholder = 'Service name';
        svcInput.type = 'text';
        svcInput.value = String(fm['service'] ?? '');
        this.inputs.set('service', svcInput);

        // Render remaining template fields
        for (const field of this.settings.templateConfig.fields.filter((f: any) => !['status', 'crNumber', 'taskNumber', 'service'].includes(f.key))) {
            const row = scrollableContent.createDiv({ cls: 'setting-item' });
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

        const subtasksContainer = scrollableContent.createDiv({ cls: 'kb-subtasks-edit' });
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

        // Fixed footer
        const footer = contentEl.createDiv({ cls: 'kb-modal-footer' });
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
