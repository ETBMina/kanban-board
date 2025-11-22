import { App, Modal, Notice, TFile } from 'obsidian';
import { PluginConfiguration, TaskNoteMeta, Subtask } from '../models';
import { buildFrontmatterYAML, ensureFolder, sanitizeFileName } from '../utils';

export class CopyTaskModal extends Modal {
    private settings: PluginConfiguration;
    private originalTask: TaskNoteMeta;
    private onSubmit: () => void | Promise<void>;

    // Inputs
    private serviceNameInput!: HTMLInputElement;
    private statusSelect!: HTMLSelectElement;
    private prioritySelect!: HTMLSelectElement;

    // Checkboxes
    private copyPeopleCheckbox!: HTMLInputElement;
    private copyDatesCheckbox!: HTMLInputElement;
    private copyTagsCheckbox!: HTMLInputElement;
    private copyNotesCheckbox!: HTMLInputElement;
    private copySubtasksCheckbox!: HTMLInputElement;

    constructor(app: App, settings: PluginConfiguration, originalTask: TaskNoteMeta, onSubmit: () => void | Promise<void>) {
        super(app);
        this.settings = settings;
        this.originalTask = originalTask;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('kb-container');
        contentEl.createEl('h2', { text: 'Copy Task' });

        // Service Name
        const svcRow = contentEl.createDiv({ cls: 'setting-item' });
        svcRow.createDiv({ cls: 'setting-item-name', text: 'New Service Name' });
        const svcControl = svcRow.createDiv({ cls: 'setting-item-control' });
        this.serviceNameInput = svcControl.createEl('input');
        this.serviceNameInput.addClass('kb-input');
        this.serviceNameInput.placeholder = 'Service name';
        this.serviceNameInput.type = 'text';
        this.serviceNameInput.value = ''; // Blank by default

        // Status
        const statusRow = contentEl.createDiv({ cls: 'setting-item' });
        statusRow.createDiv({ cls: 'setting-item-name', text: 'Status' });
        const statusControl = statusRow.createDiv({ cls: 'setting-item-control' });
        this.statusSelect = statusControl.createEl('select');
        this.statusSelect.addClass('kb-input');
        for (const s of this.settings.statusConfig.statuses) {
            const opt = this.statusSelect.createEl('option', { text: s });
            opt.value = s;
        }
        // Default to 'Backlog' if it exists, otherwise first status
        const backlog = this.settings.statusConfig.statuses.find(s => s.toLowerCase() === 'backlog');
        this.statusSelect.value = backlog || this.settings.statusConfig.statuses[0] || '';

        // Priority
        const priorityRow = contentEl.createDiv({ cls: 'setting-item' });
        priorityRow.createDiv({ cls: 'setting-item-name', text: 'Priority' });
        const priorityControl = priorityRow.createDiv({ cls: 'setting-item-control' });
        this.prioritySelect = priorityControl.createEl('select');
        this.prioritySelect.addClass('kb-input');
        for (const p of this.settings.priorities) {
            const opt = this.prioritySelect.createEl('option', { text: p });
            opt.value = p;
        }
        // Default to original task priority
        const originalPriority = this.originalTask.frontmatter['priority'];
        this.prioritySelect.value = originalPriority && this.settings.priorities.includes(originalPriority)
            ? originalPriority
            : (this.settings.defaultPriority || 'Medium');

        contentEl.createEl('h3', { text: 'Copy Options' });

        // Checkboxes helper
        const createCheckbox = (label: string, defaultChecked: boolean = false): HTMLInputElement => {
            const row = contentEl.createDiv({ cls: 'setting-item' });
            row.createDiv({ cls: 'setting-item-name', text: label });
            const control = row.createDiv({ cls: 'setting-item-control' });
            const cb = control.createEl('input', { type: 'checkbox' });
            cb.checked = defaultChecked;
            return cb;
        };

        this.copyPeopleCheckbox = createCheckbox('Copy People (Designer, Developer)', false);
        this.copyDatesCheckbox = createCheckbox('Copy Dates (Start/End)', false);
        this.copyTagsCheckbox = createCheckbox('Copy Tags', false);
        this.copyNotesCheckbox = createCheckbox('Copy Notes', false);
        this.copySubtasksCheckbox = createCheckbox('Copy Subtasks', false);

        // Actions
        const footer = contentEl.createDiv({ cls: 'modal-button-container' });
        const cancel = footer.createEl('button', { text: 'Cancel' });
        cancel.addClass('mod-warning');
        cancel.onclick = () => this.close();

        const copy = footer.createEl('button', { text: 'Copy Task' });
        copy.addClass('mod-cta');
        copy.onclick = () => this.handleCopy();
    }

    async handleCopy() {
        const serviceName = this.serviceNameInput.value.trim();
        const status = this.statusSelect.value;
        const priority = this.prioritySelect.value;

        if (!serviceName) {
            new Notice('Please enter a Service Name');
            return;
        }

        // Prepare new frontmatter
        const newFm: Record<string, any> = Object.assign({}, this.originalTask.frontmatter);

        // Overwrite/Set specific fields
        newFm['service'] = serviceName;
        newFm['status'] = status;
        newFm['priority'] = priority;
        newFm['createdAt'] = new Date().toISOString();

        // Explicitly handle fields based on checkboxes

        // People
        if (!this.copyPeopleCheckbox.checked) {
            // Identify people fields from template config
            const peopleFields = this.settings.templateConfig.fields
                .filter(f => f.type === 'people')
                .map(f => f.key);

            // Also assume standard keys if not in template config? 
            // User mentioned "Designer" and "Developer". Let's try to clear those if they exist.
            // And any field defined as 'people' type.
            for (const key of peopleFields) {
                delete newFm[key];
            }
            // Also specifically clear 'Designer' and 'Developer' if they are not in peopleFields but exist
            if (newFm['Designer']) delete newFm['Designer'];
            if (newFm['Developer']) delete newFm['Developer'];
        }

        // Dates
        if (!this.copyDatesCheckbox.checked) {
            delete newFm['startDate'];
            delete newFm['endDate'];
            // Also clear 'due' if it exists
            delete newFm['due'];
        }

        // Tags
        if (!this.copyTagsCheckbox.checked) {
            delete newFm['tags'];
        }

        // Notes
        if (!this.copyNotesCheckbox.checked) {
            delete newFm['notes'];
        }

        // Subtasks
        let newSubtasks: Subtask[] = [];
        if (this.copySubtasksCheckbox.checked && this.originalTask.subtasks) {
            newSubtasks = JSON.parse(JSON.stringify(this.originalTask.subtasks));
            // Reset completion status for copied subtasks? User didn't specify, but usually copy implies copying structure.
            // "whether to copy Subtasks" -> implies copying them as is or resetting?
            // Usually copying a task for a new service implies starting fresh.
            // I'll keep them as is for now, or maybe reset completion?
            // User said "create a new task with same fields as the original one".
            // I'll assume exact copy of subtasks state unless specified otherwise.
        }

        // Generate Filename
        const folder = this.settings.paths.taskFolder || 'Tasks';
        await ensureFolder(this.app, folder);

        const format = this.settings.taskFilenameFormat || '{{crNumber}} {{taskNumber}} - {{service}}.md';
        const crNumber = newFm['crNumber'] || '';
        const taskNumber = newFm['taskNumber'] || '';
        const title = newFm['title'] || '';

        let fileName = format
            .replace('{{crNumber}}', crNumber)
            .replace('{{taskNumber}}', taskNumber)
            .replace('{{title}}', title)
            .replace('{{service}}', serviceName);

        fileName = sanitizeFileName(fileName);
        const path = `${folder}/${fileName}`;

        // Check if file exists
        let finalPath = path;
        if (await this.app.vault.adapter.exists(finalPath)) {
            // Append timestamp or counter to avoid overwrite
            const name = fileName.replace(/\.md$/, '');
            finalPath = `${folder}/${name} ${Date.now()}.md`;
        }

        // Build Content
        const fmString = buildFrontmatterYAML(newFm);
        let content = `${fmString}\n\n`;

        // If notes were not in frontmatter but in body, we might miss them if we only look at frontmatter.
        // But 'notes' usually refers to a field.
        // If 'notes' is a freetext field, it might be in the body.
        // The `TaskNoteMeta` has `frontmatter` and `subtasks`. It doesn't explicitly store body content except subtasks.
        // If 'notes' is a field of type 'freetext', it might be stored in frontmatter OR body depending on implementation.
        // In `EditTaskModal`, freetext is read from frontmatter `fm[field.key]`.
        // So assuming it's in frontmatter is safe for now based on `EditTaskModal`.

        if (newSubtasks.length > 0) {
            content += '### Subtasks\n';
            content += newSubtasks.map(st => ` - [${st.completed ? 'x' : ' '}] ${st.text}`).join('\n');
        }

        try {
            await this.app.vault.create(finalPath, content);
            new Notice(`Task copied to ${finalPath}`);
            this.close();
            if (this.onSubmit) await this.onSubmit();
        } catch (error) {
            new Notice('Failed to create copied task: ' + (error as Error).message);
        }
    }
}
