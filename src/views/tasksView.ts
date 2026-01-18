import { App, TFile, Notice, MarkdownView, normalizePath } from 'obsidian';
import { PluginConfiguration, TaskNoteMeta } from '../models';
import { readAllItems, updateTaskFrontmatter, ensureFolder } from '../utils';

export class TasksView {
    private app: App;
    private settings: PluginConfiguration;
    private container: HTMLElement;
    private tasks: TaskNoteMeta[] = [];
    private reloadParent: () => Promise<void>;

    constructor(
        app: App,
        settings: PluginConfiguration,
        tasks: TaskNoteMeta[],
        reloadParent: () => Promise<void>
    ) {
        this.app = app;
        this.settings = settings;
        this.container = createDiv({ cls: 'kb-tasks-view' });
        this.tasks = tasks;
        this.reloadParent = reloadParent;
    }

    public render(container: HTMLElement) {
        container.empty();
        container.appendChild(this.container);
        this.refresh();
    }

    private async refresh() {
        this.container.empty();
        const generalTaskFile = await this.ensureGeneralTaskFile();

        // -- Active Tasks Section --
        const activeSection = this.container.createDiv({ cls: 'kb-tasks-section' });
        activeSection.createEl('h3', { text: 'Active Tasks' });

        // 1. General Tasks (Unlinked)
        await this.renderFileTasks(activeSection, generalTaskFile, 'General');

        // 2. Linked Tasks (from other files)
        for (const task of this.tasks) {
            // unnecessary to show general file again if it happens to be in the folder, 
            // but usually the Tasks folder is separate. 
            // check if it has incomplete subtasks
            const incomplete = task.subtasks.filter(t => !t.completed);
            if (incomplete.length > 0) {
                await this.renderFileTasks(activeSection, task.file, task.fileName);
            }
        }

        // -- Completed Tasks Section --
        const completedSection = this.container.createDiv({ cls: 'kb-tasks-section kb-completed-section' });
        const completedHeader = completedSection.createDiv({ cls: 'kb-section-header' });
        const collapseIcon = completedHeader.createSpan({ cls: 'kb-collapse-icon' });
        collapseIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        completedHeader.createSpan({ text: 'Completed' });

        const completedList = completedSection.createDiv({ cls: 'kb-task-list' });
        completedList.style.display = 'none'; // tailored for collapsed by default or state

        completedHeader.onclick = () => {
            if (completedList.style.display === 'none') {
                completedList.style.display = 'block';
                collapseIcon.style.transform = 'rotate(180deg)';
            } else {
                completedList.style.display = 'none';
                collapseIcon.style.transform = 'rotate(0deg)';
            }
        };

        // Render completed from General
        await this.renderCompletedTasks(completedList, generalTaskFile, 'General');

        // Render completed from others
        for (const task of this.tasks) {
            const completed = task.subtasks.filter(t => t.completed);
            if (completed.length > 0) {
                await this.renderCompletedTasks(completedList, task.file, task.fileName);
            }
        }
    }

    private async ensureGeneralTaskFile(): Promise<TFile> {
        const folderPath = 'General';
        await ensureFolder(this.app, folderPath);
        const filePath = `${folderPath}/Tasks.md`;
        let file = this.app.vault.getAbstractFileByPath(filePath);

        if (!file) {
            file = await this.app.vault.create(filePath, '# General Tasks\n\n');
        }
        return file as TFile;
    }

    private async renderFileTasks(container: HTMLElement, file: TFile, title: string) {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');

        const fileContainer = container.createDiv({ cls: 'kb-task-file-group' });
        const header = fileContainer.createDiv({ cls: 'kb-file-header' });
        header.createEl('strong', { text: title });

        // Add new task input for this file
        const inputContainer = fileContainer.createDiv({ cls: 'kb-add-task-row' });
        const input = inputContainer.createEl('input', { type: 'text', placeholder: 'Add a to-do...' });
        input.onkeydown = async (e) => {
            if (e.key === 'Enter' && input.value.trim()) {
                await this.addTaskToFile(file, input.value.trim());
                input.value = '';
                await this.reloadParent(); // Reloads data
            }
        };

        const list = fileContainer.createDiv({ cls: 'kb-file-task-list' });

        let lineIndex = 0;
        for (const line of lines) {
            const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)/);
            if (match) {
                const isCompleted = match[1].trim() !== '';
                if (!isCompleted) {
                    this.createTaskItem(list, file, lineIndex, match[2], isCompleted);
                }
            }
            lineIndex++;
        }
    }

    private async renderCompletedTasks(container: HTMLElement, file: TFile, title: string) {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');

        let hasCompleted = false;
        // Pre-check
        for (const line of lines) {
            if (/^\s*-\s*\[[xX]\]/.test(line)) {
                hasCompleted = true;
                break;
            }
        }

        if (!hasCompleted) return;

        const group = container.createDiv({ cls: 'kb-task-file-group-completed' });
        group.createEl('span', { text: title, cls: 'kb-completed-file-title' });

        let lineIndex = 0;
        for (const line of lines) {
            const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)/);
            if (match) {
                const isCompleted = match[1].trim() !== '';
                if (isCompleted) {
                    this.createTaskItem(group, file, lineIndex, match[2], isCompleted);
                }
            }
            lineIndex++;
        }
    }

    private createTaskItem(container: HTMLElement, file: TFile, lineIndex: number, text: string, completed: boolean) {
        const row = container.createDiv({ cls: 'kb-task-row' });
        const checkbox = row.createEl('input', { type: 'checkbox' });
        checkbox.checked = completed;

        checkbox.onchange = async () => {
            await this.toggleTaskStatus(file, lineIndex, !completed);
            await this.reloadParent();
        };

        const span = row.createSpan({ text: text });
        span.addClass('kb-task-text');
        if (completed) span.addClass('kb-task-done');

        span.onclick = (e) => {
            e.preventDefault();
            const input = document.createElement('input');
            input.type = 'text';
            input.value = text;
            input.className = 'kb-task-edit-input';

            span.replaceWith(input);
            input.focus();

            let saved = false;
            const save = async () => {
                if (saved) return;
                saved = true;
                const newVal = input.value;
                if (newVal !== text) {
                    await this.updateTaskText(file, lineIndex, newVal);
                    await this.reloadParent();
                } else {
                    input.replaceWith(span);
                }
            };

            input.onblur = () => save();
            input.onkeydown = (ev) => {
                if (ev.key === 'Enter') {
                    input.blur();
                }
            };
        };
    }

    private async updateTaskText(file: TFile, lineIndex: number, newText: string) {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        if (lines[lineIndex] !== undefined) {
            // Preserve indentation and checkbox status
            const match = lines[lineIndex].match(/^(\s*-\s*\[[ xX]\]\s*)(.*)/);
            if (match) {
                if (!newText.trim()) {
                    // Delete the line if empty
                    lines.splice(lineIndex, 1);
                } else {
                    lines[lineIndex] = `${match[1]}${newText}`;
                }
                await this.app.vault.modify(file, lines.join('\n'));
            }
        }
    }

    private async addTaskToFile(file: TFile, text: string) {
        const content = await this.app.vault.read(file);
        const newContent = content.endsWith('\n') ? `${content}- [ ] ${text}\n` : `${content}\n- [ ] ${text}\n`;
        await this.app.vault.modify(file, newContent);
    }

    private async toggleTaskStatus(file: TFile, lineIndex: number, newStatus: boolean) {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        if (lines[lineIndex]) {
            lines[lineIndex] = lines[lineIndex].replace(/^(\s*-\s*\[)[ xX](\])/, `$1${newStatus ? 'x' : ' '}$2`);
            await this.app.vault.modify(file, lines.join('\n'));
        }
    }
}
