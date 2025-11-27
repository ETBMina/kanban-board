import { App, Menu, Modal, Notice, TFile, normalizePath } from 'obsidian';
import { Dropdown } from '../Dropdown';
import { FieldType, PluginConfiguration, TaskFieldDefinition, TaskNoteMeta } from '../models';
import { findCrFileByNumber, findTaskFileByNumber, getAllExistingTags, updateTaskFrontmatter } from '../utils';
import KanbanPlugin from '../main';

/**
 * GridView - Renders tasks in a table/grid format with editable cells
 */
export class GridView {
    private app: App;
    private plugin: KanbanPlugin;
    private settings: PluginConfiguration;
    private tasks: TaskNoteMeta[] = [];
    private filterQuery = '';
    private filterState: Record<string, any> = {};
    private persistSettings?: () => void | Promise<void>;
    private suppressReloads?: (duration?: number) => void;

    constructor(
        app: App,
        plugin: KanbanPlugin,
        settings: PluginConfiguration,
        tasks: TaskNoteMeta[],
        filterQuery: string,
        filterState: Record<string, any>,
        persistSettings?: () => void | Promise<void>,
        suppressReloads?: (duration?: number) => void
    ) {
        this.app = app;
        this.plugin = plugin;
        this.settings = settings;
        this.tasks = tasks;
        this.filterQuery = filterQuery;
        this.filterState = filterState;
        this.persistSettings = persistSettings;
        this.suppressReloads = suppressReloads;
    }

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
                    // Logic: Show tasks whose end date is empty (in progress) OR end date >= selected date
                    const endDateVal = fm['endDate'];
                    if (endDateVal) {
                        const taskEndDate = new Date(endDateVal);
                        taskEndDate.setHours(0, 0, 0, 0);
                        const filterDate = new Date(filterValue);
                        filterDate.setHours(0, 0, 0, 0);
                        if (taskEndDate < filterDate) {
                            return false;
                        }
                    }
                    // Empty endDate is allowed
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

    render(container: HTMLElement) {
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
            // Add unique file path as data attribute for reliable file opening
            tr.setAttribute('data-file-path', t.filePath);
            // Add archived styling
            const isArchived = Boolean(t.frontmatter['archived']);
            if (isArchived) tr.addClass('kb-row-archived');

            // Add row click handler for Ctrl+click to open file
            tr.addEventListener('mousedown', async (e: MouseEvent) => {
                if (e.button === 0 && (e.ctrlKey || e.metaKey)) { // Ctrl/Cmd + click
                    e.preventDefault();
                    e.stopPropagation();
                    const filePath = tr.getAttribute('data-file-path');
                    if (filePath) {
                        const file = this.app.vault.getAbstractFileByPath(filePath);
                        if (file instanceof TFile) {
                            await this.app.workspace.getLeaf(true).openFile(file);
                        }
                    }
                }
            });
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
                        // For CR numbers, find the CR file. For task numbers, use the row's file path
                        if (numKey === 'crNumber') {
                            const file = await findFunc(this.app, this.settings, numVal);
                            if (file instanceof TFile) {
                                await this.app.workspace.getLeaf(true).openFile(file);
                            }
                        } else {
                            // For task numbers, use the file path from the row data attribute
                            const row = link.closest('tr');
                            const filePath = row?.getAttribute('data-file-path');
                            if (filePath) {
                                const file = this.app.vault.getAbstractFileByPath(filePath);
                                if (file instanceof TFile) {
                                    await this.app.workspace.getLeaf(true).openFile(file);
                                }
                            }
                        }
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

                    // Use registerDomEvent equivalent or direct binding
                    link.addEventListener('mousedown', (e: MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation(); // Prevent row click handler from also firing
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
                    this.suppressReloads?.();
                    try {
                        if (!(fileObj instanceof TFile)) throw new Error('File not found');
                        const inFrontmatter = t.frontmatter && Object.prototype.hasOwnProperty.call(t.frontmatter, key);

                        if (inFrontmatter || fieldDef.type !== 'freetext') {
                            let payload: any = { [key]: newVal };
                            if (fieldDef.type === 'tags' || fieldDef.type === 'people') {
                                if (typeof newVal === 'string') payload[key] = newVal.split(',').map((s: string) => s.trim()).filter(Boolean);
                            }

                            const autoStartStatuses = this.settings.statusConfig.autoSetStartDateStatuses || [];
                            const isInProgress = autoStartStatuses.some(s => s.toLowerCase() === String(newVal).toLowerCase());

                            if (key === 'status' && isInProgress && !t.frontmatter['startDate']) {
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
                        const autoStartStatuses = this.settings.statusConfig.autoSetStartDateStatuses || [];
                        const isInProgress = autoStartStatuses.some(s => s.toLowerCase() === String(newVal).toLowerCase());

                        if (key === 'status' && isInProgress && !t.frontmatter['startDate']) {
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

                    const options = fieldDef.useValues === 'priorities'
                        ? this.settings.priorities
                        : this.settings.statusConfig.statuses;

                    new Dropdown(
                        td,
                        options,
                        String(t.frontmatter[key] ?? options[0] ?? ''),
                        (val) => saveValue(val),
                        'kb-grid-dropdown'
                    );
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
                        const outer = this; // capture GridView instance
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
}
