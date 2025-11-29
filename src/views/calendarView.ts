import { App, Menu, Modal, Notice, TFile, normalizePath, setIcon } from 'obsidian';
import { PluginConfiguration, TaskNoteMeta, Subtask } from '../models';
import { Dropdown } from '../Dropdown';
import { updateTaskFrontmatter } from '../utils';

export class CalendarView {
    private app: App;
    private settings: PluginConfiguration;
    private tasks: TaskNoteMeta[] = [];
    private reloadCallback: () => Promise<void>;
    private persistSettings?: () => void | Promise<void>;
    private suppressReloads?: (duration?: number) => void;

    private container!: HTMLElement;
    private backlogEl!: HTMLElement;
    private calendarEl!: HTMLElement;
    private resizeObserver: ResizeObserver | null = null;

    private currentDate: Date = new Date();
    private viewMode: 'month' | 'week' = 'month';
    private draggingCrPath: string | null = null;

    private formatCRDisplayText(cr: TaskNoteMeta): string {
        const number = cr.frontmatter['number'];
        const title = cr.frontmatter['title'];
        if (number && title) {
            return `${number} - ${title}`;
        }
        return String(title || cr.fileName);
    }

    constructor(
        app: App,
        settings: PluginConfiguration,
        tasks: TaskNoteMeta[],
        reloadCallback: () => Promise<void>,
        persistSettings?: () => void | Promise<void>,
        suppressReloads?: (duration?: number) => void
    ) {
        this.app = app;
        this.settings = settings;
        this.tasks = tasks;
        this.reloadCallback = reloadCallback;
        this.persistSettings = persistSettings;
        this.suppressReloads = suppressReloads;
    }

    public render(container: HTMLElement) {
        this.container = container;
        this.container.empty();
        this.container.addClass('kb-calendar-view');

        // Split Layout
        const splitContainer = this.container.createDiv({ cls: 'kb-calendar-split' });

        // Left: Backlog
        this.backlogEl = splitContainer.createDiv({ cls: 'kb-calendar-backlog' });
        this.renderBacklog();

        // Right: Calendar
        this.calendarEl = splitContainer.createDiv({ cls: 'kb-calendar-main' });

        // Setup ResizeObserver to handle dynamic resizing of bars
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.resizeObserver = new ResizeObserver(() => {
            // Simple debounce could be added here if needed, but for now direct call
            // We only re-render the grid part ideally, but renderCalendar is fast enough
            if (this.calendarEl.childElementCount > 0) {
                this.renderCalendar();
            }
        });
        this.resizeObserver.observe(this.calendarEl);

        this.renderCalendar();
    }

    private getBacklogCRs(): TaskNoteMeta[] {
        const crFolder = normalizePath(this.settings.paths.crFolder);
        return this.tasks
            .filter(t => t.filePath.startsWith(crFolder + '/'))
            .filter(t => {
                const status = String(t.frontmatter['status'] || 'Backlog');
                return status === 'Backlog';
            })
            .sort((a, b) => {
                const ca = a.frontmatter['createdAt'] ? new Date(String(a.frontmatter['createdAt'])).getTime() : 0;
                const cb = b.frontmatter['createdAt'] ? new Date(String(b.frontmatter['createdAt'])).getTime() : 0;
                return cb - ca; // Descending
            });
    }

    private renderBacklog() {
        this.backlogEl.empty();
        const header = this.backlogEl.createDiv({ cls: 'kb-backlog-header' });
        header.createEl('h3', { text: 'Backlog CRs' });

        const list = this.backlogEl.createDiv({ cls: 'kb-backlog-list' });
        const crs = this.getBacklogCRs();

        crs.forEach(cr => {
            const card = list.createDiv({ cls: 'kb-backlog-card', attr: { draggable: 'true' } });

            // Drag Start
            card.ondragstart = (e) => {
                this.draggingCrPath = cr.filePath;
                e.dataTransfer?.setData('application/x-kb-cr', cr.filePath);
                e.dataTransfer?.setData('text/plain', cr.filePath);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                card.addClass('kb-dragging');
            };
            card.ondragend = () => {
                this.draggingCrPath = null;
                card.removeClass('kb-dragging');
            };

            // Header
            const cardHeader = card.createDiv({ cls: 'kb-card-header' });
            cardHeader.createDiv({ cls: 'kb-card-title', text: this.formatCRDisplayText(cr) });

            const menuBtn = cardHeader.createEl('button', { cls: 'kb-ellipsis' });
            menuBtn.setText('⋯');
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                this.showCrMenu(e, cr);
            };

            // Meta
            const meta = card.createDiv({ cls: 'kb-card-meta' });
            if (cr.frontmatter['priority']) {
                meta.createSpan({ cls: 'kb-chip', text: String(cr.frontmatter['priority']) });
            }
            if (cr.frontmatter['plannedEnd']) { // Using plannedEnd as due date
                meta.createSpan({ cls: 'kb-date', text: new Date(cr.frontmatter['plannedEnd']).toLocaleDateString() });
            }

            // Click to edit
            card.onclick = () => {
                this.openEditModal(cr);
            };
        });
    }

    private showCrMenu(e: MouseEvent, cr: TaskNoteMeta) {
        const menu = new Menu();
        menu.addItem(i => i.setTitle('Open Markdown').onClick(async () => {
            const file = this.app.vault.getAbstractFileByPath(cr.filePath);
            if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
        }));
        menu.addItem(i => i.setTitle('Delete').onClick(async () => {
            if (confirm(`Are you sure you want to delete "${cr.fileName}"?`)) {
                const file = this.app.vault.getAbstractFileByPath(cr.filePath);
                if (file instanceof TFile) await this.app.vault.delete(file);
                await this.reloadCallback();
            }
        }));
        menu.showAtPosition({ x: e.clientX, y: e.clientY });
    }

    private renderCalendar() {
        this.calendarEl.empty();

        // Toolbar
        const toolbar = this.calendarEl.createDiv({ cls: 'kb-calendar-toolbar' });

        // Left: Date Picker / Navigation
        const nav = toolbar.createDiv({ cls: 'kb-calendar-nav' });
        const prevBtn = nav.createEl('button', { text: '<' });
        prevBtn.onclick = () => this.navigateDate(-1);

        const dateDisplay = nav.createEl('span', { cls: 'kb-calendar-date-display' });
        dateDisplay.textContent = this.getDateDisplayText();

        const nextBtn = nav.createEl('button', { text: '>' });
        nextBtn.onclick = () => this.navigateDate(1);

        // Right: View Switcher
        const viewSwitcher = toolbar.createDiv({ cls: 'kb-calendar-view-switcher' });
        const monthBtn = viewSwitcher.createEl('button', { text: 'Month' });
        if (this.viewMode === 'month') monthBtn.addClass('is-active');
        monthBtn.onclick = () => { this.viewMode = 'month'; this.renderCalendar(); };

        const weekBtn = viewSwitcher.createEl('button', { text: 'Week' });
        if (this.viewMode === 'week') weekBtn.addClass('is-active');
        weekBtn.onclick = () => { this.viewMode = 'week'; this.renderCalendar(); };

        // Grid
        const grid = this.calendarEl.createDiv({ cls: `kb-calendar-grid kb-view-${this.viewMode}` });
        this.renderGrid(grid);
    }

    private getDateDisplayText(): string {
        if (this.viewMode === 'month') {
            return this.currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        } else {
            const start = this.getWeekStart(this.currentDate);
            const end = new Date(start);
            end.setDate(end.getDate() + 4); // Thu
            return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
        }
    }

    private navigateDate(dir: number) {
        if (this.viewMode === 'month') {
            this.currentDate.setMonth(this.currentDate.getMonth() + dir);
        } else {
            this.currentDate.setDate(this.currentDate.getDate() + (dir * 7));
        }
        this.renderCalendar();
    }

    private getWeekStart(date: Date): Date {
        const d = new Date(date);
        const day = d.getDay(); // 0 is Sunday
        const diff = d.getDate() - day; // adjust when day is sunday
        d.setDate(diff);
        return d;
    }

    private renderGrid(container: HTMLElement) {
        // Header Row (Sun - Thu)
        const headerRow = container.createDiv({ cls: 'kb-calendar-header-row' });
        const headers = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
        headers.forEach(h => headerRow.createDiv({ cls: 'kb-calendar-day-header', text: h }));

        // Days
        let startDate: Date;
        let endDate: Date;
        let numWeeks = 0;

        if (this.viewMode === 'month') {
            const year = this.currentDate.getFullYear();
            const month = this.currentDate.getMonth();
            const firstDayOfMonth = new Date(year, month, 1);
            startDate = this.getWeekStart(firstDayOfMonth);

            // 6 weeks to cover
            endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + (6 * 7));
            numWeeks = 6;
        } else {
            startDate = this.getWeekStart(this.currentDate);
            endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 7);
            numWeeks = 1;
        }

        // Calculate heights
        // If container height is 0 (not visible yet), assume a default large enough height to render standard bars
        const totalHeight = this.calendarEl.clientHeight || 800;
        const headerHeight = 45; // Approx header row height
        const availableTotalHeight = totalHeight - headerHeight;
        const rowHeight = availableTotalHeight / numWeeks;
        const dateHeaderHeight = 30; // Space for date number
        const availableRowHeight = rowHeight - dateHeaderHeight;

        // Process week by week
        let currentWeekStart = new Date(startDate);
        while (currentWeekStart < endDate) {
            const weekEnd = new Date(currentWeekStart);
            weekEnd.setDate(weekEnd.getDate() + 5); // 5 days (Sun-Thu)

            // Create Week Row
            const weekRow = container.createDiv({ cls: 'kb-calendar-week-row' });

            // Layer 1: Background Cells
            const bgLayer = weekRow.createDiv({ cls: 'kb-calendar-week-bg' });

            // Get CRs and assign slots
            const weekCRs = this.getCRsForWeek(currentWeekStart, weekEnd);
            const slots = this.assignSlots(weekCRs, currentWeekStart);

            // Determine max slots used in this week
            let maxSlotUsed = -1;
            for (const s of slots.values()) {
                if (s > maxSlotUsed) maxSlotUsed = s;
            }
            // Add 1 because slots are 0-indexed
            const slotsNeeded = maxSlotUsed + 1;

            // Dynamic Sizing Logic
            const MIN_BAR_HEIGHT = 18;
            const MAX_BAR_HEIGHT = 28;

            // Try to fit all needed slots
            let calculatedBarHeight = Math.floor(availableRowHeight / slotsNeeded);

            // Clamp
            if (calculatedBarHeight > MAX_BAR_HEIGHT) calculatedBarHeight = MAX_BAR_HEIGHT;

            let maxVisibleSlots = slotsNeeded;

            if (calculatedBarHeight < MIN_BAR_HEIGHT) {
                calculatedBarHeight = MIN_BAR_HEIGHT;
                // Recalculate how many we can actually fit at min height
                // Reserve space for "+N more" (approx same as bar height)
                maxVisibleSlots = Math.floor((availableRowHeight - MIN_BAR_HEIGHT) / MIN_BAR_HEIGHT);
                if (maxVisibleSlots < 1) maxVisibleSlots = 1;
            }

            for (let i = 0; i < 5; i++) {
                const dayDate = new Date(currentWeekStart);
                dayDate.setDate(dayDate.getDate() + i);
                this.renderDayCell(bgLayer, dayDate, weekCRs, maxVisibleSlots);
            }

            // Create a local copy of the week start date for closures
            const weekStartForClosure = new Date(currentWeekStart);

            // Layer 2: Events
            const eventsLayer = weekRow.createDiv({ cls: 'kb-calendar-week-events' });

            // Add drag event handlers to forward events to underlying day cells
            eventsLayer.ondragover = (e) => {
                if (e.dataTransfer?.types.includes('application/x-kb-cr') || e.dataTransfer?.types.includes('application/x-kb-resize')) {
                    e.preventDefault();
                    // Calculate which day cell the mouse is over
                    const bgLayer = weekRow.querySelector('.kb-calendar-week-bg');
                    if (bgLayer) {
                        const bgRect = bgLayer.getBoundingClientRect();
                        const mouseX = e.clientX - bgRect.left;
                        const cellWidth = bgRect.width / 5;
                        const cellIndex = Math.floor(mouseX / cellWidth);

                        if (cellIndex >= 0 && cellIndex < 5) {
                            const dayCells = bgLayer.querySelectorAll('.kb-calendar-day-cell');
                            const targetCell = dayCells[cellIndex] as HTMLElement;
                            if (targetCell) {
                                targetCell.classList.add('kb-drag-over');
                            }
                        }
                    }
                }
            };

            eventsLayer.ondragleave = () => {
                const bgLayer = weekRow.querySelector('.kb-calendar-week-bg');
                if (bgLayer) {
                    const dayCells = bgLayer.querySelectorAll('.kb-calendar-day-cell');
                    dayCells.forEach(cell => cell.classList.remove('kb-drag-over'));
                }
            };

            eventsLayer.ondrop = async (e) => {
                if (e.dataTransfer?.types.includes('application/x-kb-cr') || e.dataTransfer?.types.includes('application/x-kb-resize')) {
                    e.preventDefault();
                    const bgLayer = weekRow.querySelector('.kb-calendar-week-bg');
                    if (bgLayer) {
                        const dayCells = bgLayer.querySelectorAll('.kb-calendar-day-cell');
                        dayCells.forEach(cell => cell.classList.remove('kb-drag-over'));

                        // Calculate which day cell the mouse is over
                        const bgRect = bgLayer.getBoundingClientRect();
                        const mouseX = e.clientX - bgRect.left;
                        const cellWidth = bgRect.width / 5;
                        const cellIndex = Math.floor(mouseX / cellWidth);

                        if (cellIndex >= 0 && cellIndex < 5) {
                            const dayCells = bgLayer.querySelectorAll('.kb-calendar-day-cell');
                            const targetCell = dayCells[cellIndex] as HTMLElement;
                            if (targetCell) {
                                // Get the date from the target cell - we need to find which date this corresponds to
                                const weekStart = new Date(weekStartForClosure);
                                const targetDate = new Date(weekStart);
                                targetDate.setDate(weekStart.getDate() + cellIndex);

                                const resizeData = e.dataTransfer.getData('application/x-kb-resize');
                                if (resizeData) {
                                    const { path, type } = JSON.parse(resizeData);
                                    await this.handleResizeDrop(path, type, targetDate);
                                } else {
                                    const path = e.dataTransfer.getData('application/x-kb-cr');
                                    if (path) {
                                        await this.handleDropFromBacklog(path, targetDate);
                                    }
                                }
                            }
                        }
                    }
                }
            };

            this.renderWeekEvents(eventsLayer, weekCRs, slots, currentWeekStart, maxVisibleSlots, calculatedBarHeight);

            currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        }
    }

    private renderDayCell(container: HTMLElement, date: Date, weekCRs: TaskNoteMeta[], maxSlots: number) {
        const cell = container.createDiv({ cls: 'kb-calendar-day-cell' });

        // Date number
        const dateNum = cell.createDiv({ cls: 'kb-day-number', text: String(date.getDate()) });
        if (date.toDateString() === new Date().toDateString()) {
            dateNum.addClass('is-today');
        }
        if (this.viewMode === 'month' && date.getMonth() !== this.currentDate.getMonth()) {
            dateNum.addClass('is-other-month');
        }

        // Drop Zone
        cell.ondragover = (e) => {
            if (e.dataTransfer?.types.includes('application/x-kb-cr') || e.dataTransfer?.types.includes('application/x-kb-resize')) {
                e.preventDefault();
                cell.addClass('kb-drag-over');
            }
        };
        cell.ondragleave = () => cell.removeClass('kb-drag-over');
        cell.ondrop = async (e) => {
            e.preventDefault();
            cell.removeClass('kb-drag-over');

            const resizeData = e.dataTransfer?.getData('application/x-kb-resize');
            if (resizeData) {
                const { path, type } = JSON.parse(resizeData);
                await this.handleResizeDrop(path, type, date);
                return;
            }

            const path = e.dataTransfer?.getData('application/x-kb-cr');
            if (path) {
                await this.handleDropFromBacklog(path, date);
            }
        };

        // Overflow Indicator
        // Count CRs active on this day
        const dayCRs = this.getCRsForDate(date);
        if (dayCRs.length > maxSlots) {
            const moreCount = dayCRs.length - maxSlots;
            const moreEl = cell.createDiv({ cls: 'kb-more-indicator', text: `+${moreCount} more` });
            moreEl.onclick = (e) => {
                e.stopPropagation();
                this.showDayPopup(date, dayCRs, cell);
            };
        }
    }

    private showDayPopup(date: Date, crs: TaskNoteMeta[], cellEl: HTMLElement) {
        // Backdrop for clicking outside
        const backdrop = this.calendarEl.createDiv({ cls: 'kb-popup-backdrop' });

        // Create popup container
        const popup = this.calendarEl.createDiv({ cls: 'kb-calendar-popup' });

        // Position logic
        const cellRect = cellEl.getBoundingClientRect();
        const calendarRect = this.calendarEl.getBoundingClientRect();

        // Calculate center of the cell relative to calendar
        const cellCenterX = (cellRect.left - calendarRect.left) + (cellRect.width / 2);
        const cellCenterY = (cellRect.top - calendarRect.top) + (cellRect.height / 2);

        // Popup dimensions (estimated for centering)
        const popupWidth = 300;
        const popupHeight = 300; // Estimate

        // Calculate position relative to calendar container
        let left = cellCenterX - (popupWidth / 2);
        let top = cellCenterY - (popupHeight / 2);

        // Clamp left
        if (left < 10) left = 10;
        if (left + popupWidth > calendarRect.width - 10) left = calendarRect.width - popupWidth - 10;

        // Clamp top
        if (top < 10) top = 10;
        if (top + popupHeight > calendarRect.height - 10) top = calendarRect.height - popupHeight - 10;

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;

        // Set transform origin to the cell center relative to the popup
        const originX = cellCenterX - left;
        const originY = cellCenterY - top;
        popup.style.transformOrigin = `${originX}px ${originY}px`;

        // Header
        const header = popup.createDiv({ cls: 'kb-popup-header' });
        const closeBtn = header.createEl('button', { cls: 'kb-popup-close', text: '×' });

        const dayName = header.createDiv({ cls: 'kb-popup-day-name', text: date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase() });
        const dayNum = header.createDiv({ cls: 'kb-popup-day-num', text: String(date.getDate()) });

        // List
        const list = popup.createDiv({ cls: 'kb-popup-list' });
        crs.forEach(cr => {
            const item = list.createDiv({ cls: 'kb-popup-item' });
            item.textContent = this.formatCRDisplayText(cr);

            // Styling to match bars
            const hue = Math.abs(this.hashCode(cr.fileName)) % 360;
            item.style.backgroundColor = `hsl(${hue}, 70%, 80%)`;
            item.style.color = `hsl(${hue}, 80%, 20%)`;

            // Check for status to add specific styles if needed
            const status = String(cr.frontmatter['status'] || '');
            if (status === 'In Progress') item.addClass('status-in-progress');
            if (status === 'Completed') item.addClass('status-completed');

            item.onclick = (e) => {
                e.stopPropagation();
                this.openEditModal(cr);
                popup.remove();
                backdrop.remove();
            };
        });

        // Close handlers
        const close = () => {
            popup.removeClass('is-open');
            backdrop.removeClass('is-open');
            setTimeout(() => {
                popup.remove();
                backdrop.remove();
            }, 200); // Wait for animation
        };

        backdrop.onclick = close;
        closeBtn.onclick = close;

        // Animation: Expand
        requestAnimationFrame(() => {
            popup.addClass('is-open');
            backdrop.addClass('is-open');
        });
    }

    private renderWeekEvents(container: HTMLElement, crs: TaskNoteMeta[], slots: Map<string, number>, weekStart: Date, maxSlots: number, barHeight: number) {
        crs.forEach(cr => {
            const slot = slots.get(cr.filePath);
            if (slot === undefined || slot >= maxSlots) return;

            const start = new Date(cr.frontmatter['plannedStart']);
            const end = new Date(cr.frontmatter['plannedEnd']);
            start.setHours(0, 0, 0, 0);
            end.setHours(0, 0, 0, 0);
            const wStart = new Date(weekStart); wStart.setHours(0, 0, 0, 0);

            // Calculate columns (0-4)
            let startCol = Math.floor((start.getTime() - wStart.getTime()) / (1000 * 60 * 60 * 24));
            let endCol = Math.floor((end.getTime() - wStart.getTime()) / (1000 * 60 * 60 * 24));

            // Clamp
            const originalStartCol = startCol;
            const originalEndCol = endCol;
            startCol = Math.max(0, startCol);
            endCol = Math.min(4, endCol);

            if (startCol > 4 || endCol < 0) return;

            const bar = container.createDiv({ cls: 'kb-cr-bar' });
            bar.textContent = this.formatCRDisplayText(cr);

            // Position
            bar.style.left = `${startCol * 20}%`;
            bar.style.width = `${(endCol - startCol + 1) * 20}%`;
            bar.style.top = `${slot * barHeight}px`;
            bar.style.height = `${barHeight - 4}px`; // -4 for gap
            bar.style.lineHeight = `${barHeight - 4}px`;
            bar.style.fontSize = barHeight < 24 ? '0.75em' : '0.85em';

            // Styling
            const hue = Math.abs(this.hashCode(cr.fileName)) % 360;
            bar.style.backgroundColor = `hsl(${hue}, 70%, 80%)`;
            bar.style.color = `hsl(${hue}, 80%, 20%)`;

            const status = String(cr.frontmatter['status'] || '');
            if (status === 'In Progress') bar.addClass('status-in-progress');
            if (status === 'Completed') bar.addClass('status-completed');

            // Click to edit
            bar.onclick = (e) => {
                e.stopPropagation();
                this.openEditModal(cr);
            };

            // Allow drag events to pass through to underlying day cells
            bar.ondragover = (e) => {
                if (e.dataTransfer?.types.includes('application/x-kb-cr') || e.dataTransfer?.types.includes('application/x-kb-resize')) {
                    e.preventDefault();
                    // Forward to the events layer which will handle the positioning logic
                    const eventsLayer = container;
                    if (eventsLayer.ondragover) {
                        eventsLayer.ondragover(e);
                    }
                }
            };

            bar.ondragleave = (e) => {
                if (e.dataTransfer?.types.includes('application/x-kb-cr') || e.dataTransfer?.types.includes('application/x-kb-resize')) {
                    const eventsLayer = container;
                    if (eventsLayer.ondragleave) {
                        eventsLayer.ondragleave(e);
                    }
                }
            };

            bar.ondrop = (e) => {
                if (e.dataTransfer?.types.includes('application/x-kb-cr') || e.dataTransfer?.types.includes('application/x-kb-resize')) {
                    e.preventDefault();
                    const eventsLayer = container;
                    if (eventsLayer.ondrop) {
                        eventsLayer.ondrop(e);
                    }
                }
            };

            // Resize Handles
            // Only show left handle if it's the actual start of the task (not just start of week split)
            if (originalStartCol >= 0) {
                const handleL = bar.createDiv({ cls: 'kb-resize-handle kb-handle-l' });
                this.setupResize(handleL, cr, 'start');
            }
            // Only show right handle if it's the actual end of the task
            if (originalEndCol <= 4) {
                const handleR = bar.createDiv({ cls: 'kb-resize-handle kb-handle-r' });
                this.setupResize(handleR, cr, 'end');
            }
        });
    }

    private getCRsForWeek(start: Date, end: Date): TaskNoteMeta[] {
        const crFolder = normalizePath(this.settings.paths.crFolder);
        return this.tasks
            .filter(t => t.filePath.startsWith(crFolder + '/'))
            .filter(t => {
                const s = t.frontmatter['plannedStart'] ? new Date(t.frontmatter['plannedStart']) : null;
                const e = t.frontmatter['plannedEnd'] ? new Date(t.frontmatter['plannedEnd']) : null;
                if (!s || !e) return false;

                s.setHours(0, 0, 0, 0);
                e.setHours(0, 0, 0, 0);
                const wStart = new Date(start); wStart.setHours(0, 0, 0, 0);
                const wEnd = new Date(end); wEnd.setHours(0, 0, 0, 0);

                return s <= wEnd && e >= wStart;
            });
    }

    private assignSlots(crs: TaskNoteMeta[], weekStart: Date): Map<string, number> {
        // Sort CRs by duration (longer first), then start date
        crs.sort((a, b) => {
            const sa = new Date(a.frontmatter['plannedStart']).getTime();
            const sb = new Date(b.frontmatter['plannedStart']).getTime();
            const ea = new Date(a.frontmatter['plannedEnd']).getTime();
            const eb = new Date(b.frontmatter['plannedEnd']).getTime();

            const da = ea - sa;
            const db = eb - sb;

            if (da !== db) return db - da; // Longest duration first
            return sa - sb; // Earlier start first
        });

        const slots = new Map<string, number>();
        const occupied = new Array(20).fill(null).map(() => new Array(5).fill(false)); // 20 slots max, 5 days

        crs.forEach(cr => {
            const start = new Date(cr.frontmatter['plannedStart']);
            const end = new Date(cr.frontmatter['plannedEnd']);
            start.setHours(0, 0, 0, 0);
            end.setHours(0, 0, 0, 0);

            // Determine start and end day indices relative to week (0-4)
            const wStart = new Date(weekStart); wStart.setHours(0, 0, 0, 0);

            let startIdx = Math.floor((start.getTime() - wStart.getTime()) / (1000 * 60 * 60 * 24));
            let endIdx = Math.floor((end.getTime() - wStart.getTime()) / (1000 * 60 * 60 * 24));

            // Clamp to week boundaries
            startIdx = Math.max(0, startIdx);
            endIdx = Math.min(4, endIdx);

            if (startIdx > 4 || endIdx < 0) return;

            // Find first available slot
            let slot = 0;
            while (true) {
                let fits = true;
                for (let i = startIdx; i <= endIdx; i++) {
                    if (occupied[slot][i]) {
                        fits = false;
                        break;
                    }
                }
                if (fits) {
                    for (let i = startIdx; i <= endIdx; i++) {
                        occupied[slot][i] = true;
                    }
                    slots.set(cr.filePath, slot);
                    break;
                }
                slot++;
            }
        });
        return slots;
    }

    private getCRsForDate(date: Date): TaskNoteMeta[] {
        const crFolder = normalizePath(this.settings.paths.crFolder);
        return this.tasks
            .filter(t => t.filePath.startsWith(crFolder + '/'))
            .filter(t => {
                const start = t.frontmatter['plannedStart'];
                const end = t.frontmatter['plannedEnd'];
                if (!start || !end) return false;

                const d = new Date(date);
                d.setHours(0, 0, 0, 0);
                const s = new Date(start);
                s.setHours(0, 0, 0, 0);
                const e = new Date(end);
                e.setHours(0, 0, 0, 0);

                return d >= s && d <= e;
            });
    }

    private setupResize(handle: HTMLElement, cr: TaskNoteMeta, type: 'start' | 'end') {
        handle.draggable = true;
        handle.ondragstart = (e) => {
            e.stopPropagation();
            e.dataTransfer?.setData('application/x-kb-resize', JSON.stringify({ path: cr.filePath, type }));
            e.dataTransfer?.setDragImage(new Image(), 0, 0); // Hide ghost
        };
        // We need to handle drop on the day cells to update date
        // This is handled in renderDayCell's ondrop? No, that's for backlog items.
        // We need to handle drop on day cells for resize too.
    }

    // Helper for hash color
    private hashCode(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash |= 0;
        }
        return hash;
    }

    private async handleDropFromBacklog(path: string, date: Date) {
        const cr = this.tasks.find(t => t.filePath === path);
        if (!cr) return;

        // Format date as YYYY-MM-DD (Local Time)
        const formatDate = (d: Date) => {
            const offset = d.getTimezoneOffset();
            const local = new Date(d.getTime() - (offset * 60 * 1000));
            return local.toISOString().split('T')[0];
        };

        const dateStr = formatDate(date);

        // Suppress reloads during the update
        this.suppressReloads?.();

        // Automatically set start and end to the dropped date
        await updateTaskFrontmatter(this.app, this.app.vault.getAbstractFileByPath(path) as TFile, {
            status: 'In Progress',
            plannedStart: dateStr,
            plannedEnd: dateStr
        });

        // Update the shared tasks array
        cr.frontmatter['status'] = 'In Progress';
        cr.frontmatter['plannedStart'] = dateStr;
        cr.frontmatter['plannedEnd'] = dateStr;

        await this.reloadCallback();
    }

    private async handleResizeDrop(path: string, type: 'start' | 'end', newDate: Date) {
        const cr = this.tasks.find(t => t.filePath === path);
        if (!cr) return;

        const start = cr.frontmatter['plannedStart'] ? new Date(cr.frontmatter['plannedStart']) : null;
        const end = cr.frontmatter['plannedEnd'] ? new Date(cr.frontmatter['plannedEnd']) : null;

        if (!start || !end) return;

        // Adjust time to start of day for comparison
        newDate.setHours(0, 0, 0, 0);
        start.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);

        let newStart = start;
        let newEnd = end;

        if (type === 'start') {
            if (newDate > end) {
                new Notice('Start date cannot be after end date');
                return;
            }
            newStart = newDate;
        } else {
            if (newDate < start) {
                new Notice('End date cannot be before start date');
                return;
            }
            newEnd = newDate;
        }

        // Format dates as YYYY-MM-DD
        const formatDate = (d: Date) => {
            const offset = d.getTimezoneOffset();
            const local = new Date(d.getTime() - (offset * 60 * 1000));
            return local.toISOString().split('T')[0];
        };

        this.suppressReloads?.(1000); // Suppress reloads for smoother UX
        await updateTaskFrontmatter(this.app, this.app.vault.getAbstractFileByPath(path) as TFile, {
            plannedStart: formatDate(newStart),
            plannedEnd: formatDate(newEnd)
        });

        // Update the shared tasks array
        const sharedTask = this.tasks.find(t => t.filePath === path);
        if (sharedTask) {
            sharedTask.frontmatter['plannedStart'] = formatDate(newStart);
            sharedTask.frontmatter['plannedEnd'] = formatDate(newEnd);
        }

        await this.reloadCallback();
    }

    private openEditModal(cr: TaskNoteMeta) {
        const modal = new EditCRModal(this.app, this.settings, cr, async (result) => {
            this.suppressReloads?.();
            await updateTaskFrontmatter(this.app, this.app.vault.getAbstractFileByPath(cr.filePath) as TFile, result);

            // Update the shared tasks array
            const sharedTask = this.tasks.find(t => t.filePath === cr.filePath);
            if (sharedTask) {
                Object.assign(sharedTask.frontmatter, result);
            }

            await this.reloadCallback();
        });
        modal.open();
    }
}

class EditCRModal extends Modal {
    private settings: PluginConfiguration;
    private cr: TaskNoteMeta;
    private onSubmit: (patch: Record<string, any>) => void;
    private inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | { getValue: () => any }>();

    constructor(app: App, settings: PluginConfiguration, cr: TaskNoteMeta, onSubmit: (patch: Record<string, any>) => void) {
        super(app);
        this.settings = settings;
        this.cr = cr;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('kb-container', 'kb-modal-layout');

        // Fixed header
        const header = contentEl.createDiv({ cls: 'kb-modal-header' });
        header.createEl('h2', { text: 'Edit CR' });

        // Scrollable content area
        const scrollableContent = contentEl.createDiv({ cls: 'kb-modal-content' });

        const patch: Record<string, any> = {};
        const fields = this.settings.templateConfig.crFields;

        fields.forEach(field => {
            const row = scrollableContent.createDiv({ cls: 'setting-item' });
            row.createDiv({ cls: 'setting-item-name', text: field.label });
            const control = row.createDiv({ cls: 'setting-item-control' });

            const initialValue = this.cr.frontmatter[field.key] || '';

            if (field.type === 'freetext') {
                row.style.display = 'block';
                row.style.width = '100%';
                const label = row.querySelector('.setting-item-name') as HTMLElement;
                if (label) label.style.display = 'block';
                control.style.width = '100%';
                control.style.marginTop = '8px';

                const textarea = control.createEl('textarea');
                textarea.addClass('kb-input');
                textarea.placeholder = field.label;
                textarea.rows = 4;
                textarea.style.resize = 'vertical';
                textarea.style.minHeight = '80px';
                textarea.style.width = '100%';
                textarea.value = String(initialValue);
                this.inputs.set(field.key, textarea);
            } else if (field.type === 'status') {
                const options = field.useValues ? (this.settings.statusConfig as any)[field.useValues] || (this.settings as any)[field.useValues] || [] : [];

                const dropdown = new Dropdown(
                    control,
                    options,
                    String(initialValue || options[0] || ''),
                    (val) => { /* no-op, read on save */ }
                );
                this.inputs.set(field.key, dropdown as any);
            } else if (field.type === 'date') {
                const input = control.createEl('input');
                input.addClass('kb-input');
                input.type = 'date';
                input.value = String(initialValue);
                this.inputs.set(field.key, input);
            } else {
                const input = control.createEl('input');
                input.addClass('kb-input');
                input.type = 'text';
                input.placeholder = field.label;
                input.value = String(initialValue);
                this.inputs.set(field.key, input);
            }
        });

        // Fixed footer
        const footer = contentEl.createDiv({ cls: 'kb-modal-footer' });
        const cancel = footer.createEl('button', { text: 'Cancel' });
        cancel.addClass('mod-warning');
        cancel.onclick = () => this.close();

        const save = footer.createEl('button', { text: 'Save' });
        save.addClass('mod-cta');
        save.onclick = () => {
            for (const [key, input] of this.inputs.entries()) {
                const anyInput = input as any;
                if (anyInput && typeof anyInput.getValue === 'function') {
                    patch[key] = anyInput.getValue();
                    continue;
                }
                const el = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
                const val = el.tagName === 'TEXTAREA' ? el.value : el.value.trim();
                if (val !== '' && val != null) patch[key] = val;
                else patch[key] = val === '' ? '' : undefined;
            }
            this.onSubmit(patch);
            this.close();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}
