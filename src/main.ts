import { App, Modal, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, PluginSettings, TaskFieldDefinition } from './models';
import { KanbanSettingTab } from './settings';
import { ensureFolder, buildFrontmatterYAML, generateNextCrNumber, findCrFileByNumber, buildWikiLink, updateTaskFrontmatter} from './utils';
import { BoardTabsView, BOARD_TABS_VIEW_TYPE } from './views/boardTabsView';

export default class KanbanPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    await this.migrateSettingsIfNeeded();
    this.addSettingTab(new KanbanSettingTab(this.app, this));

    this.registerView(BOARD_TABS_VIEW_TYPE, (leaf) => new BoardTabsView(leaf, this.settings, () => this.saveSettings()));

    this.addCommand({
      id: 'open-tasks-pane',
      name: 'Open Tasks (Grid/Board Tabs)',
      callback: () => this.activateTabsView(),
    });

    this.addCommand({
      id: 'create-task',
      name: 'Create Task from Template',
      callback: () => this.createTaskFromTemplate(),
    });

    this.addCommand({
      id: 'create-cr',
      name: 'Create Change Request (CR) from Template',
      callback: () => this.createCrFromTemplate(),
    });

    this.addRibbonIcon('sheets-in-box', 'Open Tasks (Tabs)', () => this.activateTabsView());

    // Global listener: if a task's status becomes Completed/Done, set endDate automatically
    this.registerEvent(this.app.metadataCache.on('changed', async (file) => {
      if (!(file instanceof TFile)) return;
      // Only operate within task folder
      const folder = this.settings.taskFolder || 'Tasks';
      if (!file.path.startsWith(folder + '/')) return;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) return;
      const status = String(fm['status'] || '');
      const isCompleted = /^(completed|done)$/i.test(status);
      const isInProgress = /in\s*progress/i.test(status);
      const endDate = String(fm['endDate'] || '');
      const startDate = String(fm['startDate'] || '');
      if (isCompleted && !endDate) {
        try {
          await updateTaskFrontmatter(this.app, file, { endDate: new Date().toISOString().slice(0, 10) });
        } catch {/* ignore */}
      }
      if (isInProgress && !startDate) {
        try {
          await updateTaskFrontmatter(this.app, file, { startDate: new Date().toISOString().slice(0, 10) });
        } catch {/* ignore */}
      }
    }));
  }

  private async migrateSettingsIfNeeded() {
    let changed = false;
    // Remove 'due' from templateFields and add startDate/endDate if missing
    const tf = this.settings.templateFields ?? [];
    const beforeLen = tf.length;
    this.settings.templateFields = tf.filter(f => f.key !== 'due');
    if (this.settings.templateFields.length !== beforeLen) changed = true;
    const hasStart = this.settings.templateFields.some(f => f.key === 'startDate');
    const hasEnd = this.settings.templateFields.some(f => f.key === 'endDate');
    const hasNotes = this.settings.templateFields.some(f => f.key === 'notes');
    if (!hasStart) { this.settings.templateFields.splice(5, 0, { key: 'startDate', label: 'Start Date', type: 'date' }); changed = true; }
    if (!hasEnd) { this.settings.templateFields.splice(6, 0, { key: 'endDate', label: 'End Date', type: 'date' }); changed = true; }
    if (!hasNotes) { this.settings.templateFields.push({ key: 'notes', label: 'Notes', type: 'freetext' }); changed = true; }

    // Grid columns: replace 'due' with 'startDate' and 'endDate' if present, and add notes if missing
    const cols = this.settings.gridVisibleColumns ?? [];
    const dueIdx = cols.indexOf('due');
    if (dueIdx !== -1) {
      cols.splice(dueIdx, 1, 'startDate', 'endDate');
      this.settings.gridVisibleColumns = cols;
      changed = true;
    }
    if (!cols.includes('notes')) {
      this.settings.gridVisibleColumns.push('notes');
      changed = true;
    }
    if (changed) await this.saveSettings();
  }

  onunload() {
    // views auto-clean up
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async activateTabsView() {
    const leaf = this.getRightLeaf();
    await leaf.setViewState({ type: BOARD_TABS_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private getRightLeaf(): WorkspaceLeaf {
    const leaves = this.app.workspace.getLeavesOfType(BOARD_TABS_VIEW_TYPE);
    if (leaves.length > 0) return leaves[0];
    return this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
  }

  private async createTaskFromTemplate() {
    const modal = new TaskTemplateModal(this.app, this.settings.templateFields, this.settings.statuses, async (data) => {
      const folder = this.settings.taskFolder || 'Tasks';
      await ensureFolder(this.app, folder);
      // Derive title from CR title + task number + service name
      const crNumInput = String(data['crNumber'] || '').trim();
      const taskNumInput = String(data['taskNumber'] || '').trim();
      const serviceInput = String(data['service'] || '').trim();
      let crTitle = '';
      if (crNumInput) {
        const crFile = await findCrFileByNumber(this.app, this.settings, crNumInput);
        if (crFile) {
          const fm = this.app.metadataCache.getFileCache(crFile)?.frontmatter;
          crTitle = String(fm?.['title'] ?? '');
          if (!crTitle) {
            const name = crFile.name.replace(/\.md$/i, '');
            crTitle = name.replace(/^CR-\d+\s*-\s*/i, '');
          }
        }
      }
      const prefixParts = [crNumInput, taskNumInput].filter(Boolean).join(' ');
      const serviceBracket = serviceInput ? ` - [${serviceInput}]` : '';
      const coreTitle = crTitle.trim() || `Task ${new Date().toISOString().slice(0, 10)}`;
      const title = prefixParts ? `[${prefixParts}] ${coreTitle}${serviceBracket}` : `${coreTitle}${serviceBracket}`;
      const fileName = `${title}.md`;
      const path = `${folder}/${fileName}`;
      // Include all template fields with placeholders for empty values
      const clean: Record<string, any> = {};
      
      // First, add all provided values
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) { 
          if (v.length > 0) clean[k] = v; 
        }
        else if (typeof v === 'string') { 
          if (v.trim() !== '') clean[k] = v.trim(); 
        }
        else if (v !== null && v !== undefined) { 
          clean[k] = v; 
        }
      }
      
      // Then, add placeholders for any missing template fields
      for (const field of this.settings.templateFields) {
        if (!(field.key in clean)) {
          // Add placeholder based on field type. For dates, leave unset so the date picker is available in editors.
          if (field.type === 'freetext') {
            clean[field.key] = ''; // Empty string for freetext (will show as empty textarea)
          } else if (field.type === 'date') {
            // do not set a placeholder for dates; leaving the key out preserves the date picker UI
          } else if (field.type === 'number') {
            clean[field.key] = ''; // Empty string for numbers
          } else if (field.type === 'tags') {
            clean[field.key] = []; // Empty array for tags
          } else {
            clean[field.key] = ''; // Empty string for other types
          }
        }
      }
      // Title is derived; ensure it is set and not editable via template
      clean['title'] = title;
      // add createdAt timestamp
      clean['createdAt'] = new Date().toISOString();

      // Resolve CR link if a CR number was provided
      const crNum = clean['crNumber'];
      if (crNum) {
        try {
          const crFile = await findCrFileByNumber(this.app, this.settings, crNum);
          if (crFile) clean['crLink'] = buildWikiLink(crFile.path);
        } catch { /* ignore */ }
      }
      const fm = buildFrontmatterYAML(clean);
      // Start the note with just frontmatter; no auto-inserted title body
      await this.app.vault.create(path, `${fm}\n\n`);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
    });
    modal.open();
  }

  private async createCrFromTemplate() {
    const fields = this.settings.crTemplateFields ?? [
      { key: 'number', label: 'CR Number', type: 'text' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'emailSubject', label: 'Email Subject', type: 'text' },
      { key: 'solutionDesign', label: 'Solution design link', type: 'url' },
      { key: 'description', label: 'Description', type: 'text' }
    ];
    const modal = new CrTemplateModal(this.app, fields, async (data) => {
      const folder = this.settings.crFolder || 'Change Requests';
      await ensureFolder(this.app, folder);
      let crNumber = (data['number'] || '').trim();
      if (!crNumber) crNumber = await generateNextCrNumber(this.app, this.settings);
      if (!/^CR-\d+$/i.test(crNumber)) crNumber = 'CR-' + crNumber.replace(/[^0-9]/g, '');
      const title = (data['title'] || '').trim() || crNumber;
      const fileName = `${crNumber} - ${title}.md`;
      const path = `${folder}/${fileName}`;
      // Include all template fields with placeholders for empty values
      const clean: Record<string, any> = {};
      
      // First, add all provided values
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) { 
          if (v.length > 0) clean[k] = v; 
        }
        else if (typeof v === 'string') { 
          if (v.trim() !== '') clean[k] = v.trim(); 
        }
        else if (v !== null && v !== undefined) { 
          clean[k] = v; 
        }
      }
      
      // Then, add placeholders for any missing template fields
      for (const field of fields) {
        if (!(field.key in clean)) {
          // Add placeholder based on field type. For dates, leave unset so the date picker is available in editors.
          if (field.type === 'freetext') {
            clean[field.key] = ''; // Empty string for freetext (will show as empty textarea)
          } else if (field.type === 'date') {
            // do not set a placeholder for dates; leaving the key out preserves the date picker UI
          } else if (field.type === 'number') {
            clean[field.key] = ''; // Empty string for numbers
          } else if (field.type === 'tags') {
            clean[field.key] = []; // Empty array for tags
          } else {
            clean[field.key] = ''; // Empty string for other types
          }
        }
      }
      clean['number'] = crNumber;
      clean['title'] = title;
      const fm = buildFrontmatterYAML(clean);
      await this.app.vault.create(path, `${fm}\n\n`);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
    });
    modal.open();
  }
}

class TaskTemplateModal extends Modal {
  private fields: TaskFieldDefinition[];
  private statuses: string[];
  private onSubmit: (data: Record<string, any>) => void | Promise<void>;
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();

  constructor(app: App, fields: TaskFieldDefinition[], statuses: string[], onSubmit: (data: Record<string, any>) => void | Promise<void>) {
    super(app);
    this.fields = fields;
    this.statuses = statuses;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kb-container');
    contentEl.createEl('h2', { text: 'New Task' });

    // Status dropdown (always present)
    const statusRow = contentEl.createDiv({ cls: 'setting-item' });
    statusRow.createDiv({ cls: 'setting-item-name', text: 'Status' });
    const statusControl = statusRow.createDiv({ cls: 'setting-item-control' });
    const statusSelect = statusControl.createEl('select');
    for (const s of this.statuses) {
      const opt = statusSelect.createEl('option', { text: s });
      opt.value = s;
    }
    statusSelect.value = this.statuses[0] ?? '';
    this.inputs.set('status', statusSelect);

    // CR Number (required to derive the title/link)
    const crRow = contentEl.createDiv({ cls: 'setting-item' });
    crRow.createDiv({ cls: 'setting-item-name', text: 'CR Number' });
    const crControl = crRow.createDiv({ cls: 'setting-item-control' });
    const crInput = crControl.createEl('input');
    crInput.addClass('kb-input');
    crInput.placeholder = 'e.g. CR-6485';
    crInput.type = 'text';
    this.inputs.set('crNumber', crInput);

    // Task Number
    const tnRow = contentEl.createDiv({ cls: 'setting-item' });
    tnRow.createDiv({ cls: 'setting-item-name', text: 'Task Number' });
    const tnControl = tnRow.createDiv({ cls: 'setting-item-control' });
    const tnInput = tnControl.createEl('input');
    tnInput.addClass('kb-input');
    tnInput.placeholder = 'e.g. T-01';
    tnInput.type = 'text';
    this.inputs.set('taskNumber', tnInput);

    // Service Name
    const svcRow = contentEl.createDiv({ cls: 'setting-item' });
    svcRow.createDiv({ cls: 'setting-item-name', text: 'Service Name' });
    const svcControl = svcRow.createDiv({ cls: 'setting-item-control' });
    const svcInput = svcControl.createEl('input');
    svcInput.addClass('kb-input');
    svcInput.placeholder = 'Service name';
    svcInput.type = 'text';
    this.inputs.set('service', svcInput);

      for (const field of this.fields) {
        // Skip fields handled specially or deprecated for task creation
        if (field.key === 'status' || field.key === 'title' || field.key === 'due' || field.key === 'crNumber' || field.key === 'taskNumber' || field.key === 'service') continue;
        const row = contentEl.createDiv({ cls: 'setting-item' });
        row.createDiv({ cls: 'setting-item-name', text: field.label });
        const control = row.createDiv({ cls: 'setting-item-control' });
        // Render selects for true status fields or for the special 'priority' key
        if (field.type === 'status' || field.key === 'priority') {
          const select = control.createEl('select');
          select.addClass('kb-input');
          // Use different options list based on whether this is the status field or the priority field
          const options = field.key === 'status' ? this.statuses : ['Urgent', 'High', 'Medium', 'Low'];
          for (const o of options) {
            const opt = select.createEl('option', { text: o });
            opt.value = o;
          }
          // Default to first status for status field, Medium for priority
          select.value = field.key === 'status' ? (this.statuses[0] ?? '') : 'Medium';
          this.inputs.set(field.key, select);
        } else if (field.type === 'freetext') {
          // For freetext fields, use full width layout
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
          this.inputs.set(field.key, textarea);
        } else {
          const input = control.createEl('input');
          input.addClass('kb-input');
          input.placeholder = field.label;
          if (field.type === 'date') input.type = 'date';
          else if (field.type === 'number') input.type = 'number';
          else input.type = 'text';
          this.inputs.set(field.key, input);
        }
    }

    const footer = contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = footer.createEl('button', { text: 'Cancel' });
    cancel.addClass('mod-warning');
    cancel.onclick = () => this.close();
    const create = footer.createEl('button', { text: 'Create Task' });
    create.addClass('mod-cta');
    create.onclick = async () => {
      const data: Record<string, any> = {};
      for (const [key, input] of this.inputs.entries()) {
        const element = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        // Don't trim textarea values to preserve newlines
        const val = element.tagName === 'TEXTAREA' ? element.value : element.value.trim();
        data[key] = val;
      }
      if (!data['status']) data['status'] = this.statuses[0] ?? 'Backlog';
      // Always ensure we have a priority value
      data['priority'] = data['priority'] || 'Medium';
      // Title is derived from CR and inputs; no manual title
      await this.onSubmit(data);
      this.close();
    };
  }
}

class CrTemplateModal extends Modal {
  private fields: TaskFieldDefinition[];
  private onSubmit: (data: Record<string, any>) => void | Promise<void>;
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();

  constructor(app: App, fields: TaskFieldDefinition[], onSubmit: (data: Record<string, any>) => void | Promise<void>) {
    super(app);
    this.fields = fields;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kb-container');
    contentEl.createEl('h2', { text: 'New Change Request' });

    for (const field of this.fields) {
      const row = contentEl.createDiv({ cls: 'setting-item' });
      row.createDiv({ cls: 'setting-item-name', text: field.label });
      const control = row.createDiv({ cls: 'setting-item-control' });
      
      if (field.type === 'freetext') {
        // For freetext fields, use full width layout like in TaskTemplateModal
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
        this.inputs.set(field.key, textarea);
      } else if (field.type === 'status' && field.key === 'priority') {
        // Render dropdown for priority, like in TaskTemplateModal
        const select = control.createEl('select');
        select.addClass('kb-input');
        const options = ['Urgent', 'High', 'Medium', 'Low'];
        for (const o of options) {
          const opt = select.createEl('option', { text: o });
          opt.value = o;
        }
        select.value = 'Medium';
        this.inputs.set(field.key, select);
      } else {
        const input = control.createEl('input');
        input.addClass('kb-input');
        input.placeholder = field.label;
        if (field.type === 'date') input.type = 'date';
        else if (field.type === 'number') input.type = 'number';
        else if (field.type === 'url') input.type = 'url';
        else input.type = 'text';
        this.inputs.set(field.key, input);
      }
    }

    const footer = contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = footer.createEl('button', { text: 'Cancel' });
    cancel.addClass('mod-warning');
    cancel.onclick = () => this.close();
    const create = footer.createEl('button', { text: 'Create CR' });
    create.addClass('mod-cta');
    create.onclick = async () => {
      const data: Record<string, any> = {};
      for (const [key, input] of this.inputs.entries()) {
        const val = (input as HTMLInputElement | HTMLSelectElement).value.trim();
        data[key] = val;
      }
      if (!data['title']) data['title'] = 'Untitled CR';
      if (!data['priority']) data['priority'] = 'Medium';
      await this.onSubmit(data);
      this.close();
    };
  }
}

