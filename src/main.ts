import { App, Modal, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { PluginConfiguration, TaskFieldDefinition } from './models';
import { KanbanSettingTab } from './settings';
import { ensureFolder, buildFrontmatterYAML, generateNextCrNumber, findCrFileByNumber, buildWikiLink, updateTaskFrontmatter, getAllExistingTags} from './utils';
import { BoardTabsView, BOARD_TABS_VIEW_TYPE } from './views/boardTabsView';

export default class KanbanPlugin extends Plugin {
  config!: PluginConfiguration;

  async saveConfig() {
    await this.app.vault.adapter.write(
      `${this.manifest.dir}/configuration.json`,
      JSON.stringify(this.config, null, 2)
    );
  }

  private async validateAndPromptForSettings() {
    // Create a modal to prompt for missing settings
    const modal = new Modal(this.app);
    modal.titleEl.setText('Configure Kanban Board');
    const { contentEl } = modal;

    const requiredSettings: Array<[string, string[]]> = [
      ['Task Folder', ['paths', 'taskFolder']],
      ['Change Request Folder', ['paths', 'crFolder']],
      ['Statuses', ['statusConfig', 'statuses']],
      ['Priorities', ['priorities']],
    ];

    const missing: Array<[string, string[]]> = []; // [label, path]

    for (const [label, path] of requiredSettings) {
      let current: any = this.config;
      let isMissing = false;
      
      for (const key of path) {
        if (!current || !current[key]) {
          isMissing = true;
          break;
        }
        current = current[key];
      }

      if (isMissing || (Array.isArray(current) && current.length === 0)) {
        missing.push([label, path]);
      }
    }

    if (missing.length === 0) return true;

    return new Promise<boolean>((resolve) => {
      contentEl.empty();
      contentEl.createEl('p', { text: 'Please provide the following required settings:' });

      const inputs = new Map<string, HTMLInputElement>();

      for (const [label, path] of missing) {
        const setting = contentEl.createDiv();
        setting.createEl('label', { text: label });
        const input = setting.createEl('input');
        input.type = 'text';
        input.value = '';
        input.placeholder = `Enter ${label.toLowerCase()}`;
        inputs.set(label, input);
      }

      const buttonDiv = contentEl.createDiv({ cls: 'modal-button-container' });
      buttonDiv.style.marginTop = '20px';
      buttonDiv.style.display = 'flex';
      buttonDiv.style.justifyContent = 'flex-end';
      buttonDiv.style.gap = '10px';
      
      const cancelButton = buttonDiv.createEl('button', { text: 'Cancel' });
      const saveButton = buttonDiv.createEl('button', { text: 'Save', cls: 'mod-cta' });
      
      cancelButton.onclick = () => {
        modal.close();
        resolve(false);
      };
      
      saveButton.onclick = async () => {
        for (const [label, path] of missing) {
          const value = inputs.get(label)?.value.trim();
          if (!value) {
            new Notice(`${label} is required`);
            return;
          }

          // Update config at path
          let current = this.config as any;
          for (let i = 0; i < path.length - 1; i++) {
            if (!current[path[i]]) current[path[i]] = {};
            current = current[path[i]];
          }
          
          const lastKey = path[path.length - 1];
          if (label === 'Statuses' || label === 'Priorities') {
            current[lastKey] = value.split(',').map(s => s.trim()).filter(Boolean);
          } else {
            current[lastKey] = value;
          }
        }

        await this.saveConfig();
        modal.close();
        resolve(true);
      };

      modal.open();
    });
  }

  private async loadConfiguration() {
    try {
      const rawData = await this.app.vault.adapter.read(`${this.manifest.dir}/configuration.json`).catch(() => '{}');
      this.config = JSON.parse(rawData) || {};
      
      // Ensure basic structure exists
      if (!this.config.paths) this.config.paths = { taskFolder: '', crFolder: '' };
      if (!this.config.statusConfig) this.config.statusConfig = { statuses: [], completedPattern: '^(completed|done)$', inProgressPattern: 'in\\s*progress' };
      if (!this.config.priorities) this.config.priorities = [];
      if (!this.config.gridConfig) this.config.gridConfig = {
        columnWidths: {},
        minColumnWidth: 50,
        defaultColumnWidth: 120,
        characterWidthPixels: 8,
        columnPadding: 40,
        visibleColumns: []
      };
      if (!this.config.fieldPatterns) this.config.fieldPatterns = { crNumberPattern: '^CR-\\d+$', taskNumberPattern: '^T-\\d+$' };
      if (!this.config.templateConfig) this.config.templateConfig = { fields: [], crFields: [] };

      // Validate and prompt for required settings
      if (!(await this.validateAndPromptForSettings())) {
        throw new Error('Required settings not configured');
      }
    } catch (err) {
      console.error('Failed to load configuration:', err);
      throw err;
    }
  }



  async onload() {
    try {
      await this.loadConfiguration();
    } catch (err) {
      console.error('Failed to load configuration:', err);
      new Notice('Failed to load configuration. Please check settings or recreate configuration.json. Error: ' + (err as Error).message);
      
      // Still add settings tab so user can configure plugin
      this.addSettingTab(new KanbanSettingTab(this.app, this));
      return;
    }
    this.addSettingTab(new KanbanSettingTab(this.app, this));

    this.registerView(
      BOARD_TABS_VIEW_TYPE,
      (leaf) => new BoardTabsView(leaf, this.config, () => this.saveConfig())
    );

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

    this.addCommand({
      id: 'import-csv',
      name: 'Import from CSV',
      callback: () => this.app.workspace.getLeavesOfType(BOARD_TABS_VIEW_TYPE).forEach(leaf => {
        if (leaf.view instanceof BoardTabsView) {
          leaf.view.importFromCsv();
        }
      }),
    });

    // Global listener: if a task's status becomes Completed/Done, set endDate automatically
    this.registerEvent(this.app.metadataCache.on('changed', async (file) => {
      if (!(file instanceof TFile)) return;
      // Only operate within task folder
      const folder = this.config.paths.taskFolder || 'Tasks';
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
    const tf = this.config.templateConfig.fields ?? [];
    const beforeLen = tf.length;
    this.config.templateConfig.fields = tf.filter((f: TaskFieldDefinition) => f.key !== 'due');
    if (this.config.templateConfig.fields.length !== beforeLen) changed = true;
    const hasStart = this.config.templateConfig.fields.some((f: TaskFieldDefinition) => f.key === 'startDate');
    const hasEnd = this.config.templateConfig.fields.some((f: TaskFieldDefinition) => f.key === 'endDate');
    const hasNotes = this.config.templateConfig.fields.some((f: TaskFieldDefinition) => f.key === 'notes');
    if (!hasStart) { this.config.templateConfig.fields.splice(5, 0, { key: 'startDate', label: 'Start Date', type: 'date' }); changed = true; }
    if (!hasEnd) { this.config.templateConfig.fields.splice(6, 0, { key: 'endDate', label: 'End Date', type: 'date' }); changed = true; }
    if (!hasNotes) { this.config.templateConfig.fields.push({ key: 'notes', label: 'Notes', type: 'freetext' }); changed = true; }

    // Grid columns: replace 'due' with 'startDate' and 'endDate' if present, and add notes if missing
    const cols = this.config.gridConfig.visibleColumns ?? [];
    const dueIdx = cols.indexOf('due');
    if (dueIdx !== -1) {
      cols.splice(dueIdx, 1, 'startDate', 'endDate');
      this.config.gridConfig.visibleColumns = cols;
      changed = true;
    }
    if (!cols.includes('notes')) {
      this.config.gridConfig.visibleColumns.push('notes');
      changed = true;
    }
    if (changed) await this.saveConfig();
  }

  onunload() {
    // views auto-clean up
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
    const modal = new TaskTemplateModal(this.app, this.config, async (data: Record<string, any>) => {
      const folder = this.config.paths.taskFolder || 'Tasks';
      await ensureFolder(this.app, folder);
      // Derive title from CR title + task number + service name
      const crNumInput = String(data['crNumber'] || '').trim();
      const taskNumInput = String(data['taskNumber'] || '').trim();
      const serviceInput = String(data['service'] || '').trim();
      let crTitle = '';
      if (crNumInput) {
        const crFile = await findCrFileByNumber(this.app, this.config, crNumInput);
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
        if (k === 'subtasks') continue;
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
      for (const field of this.config.templateConfig.fields) {
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
          const crFile = await findCrFileByNumber(this.app, this.config, crNum);
          if (crFile) clean['crLink'] = buildWikiLink(crFile.path);
        } catch { /* ignore */ }
      }
      const fm = buildFrontmatterYAML(clean);
      let content = `${fm}\n\n`;
      if (data.subtasks && data.subtasks.length > 0) {
        content += '### Subtasks\n';
        content += data.subtasks.map((st: any) => ` - [${st.completed ? 'x' : ' '}] ${st.text}`).join('\n');
      }
      await this.app.vault.create(path, content);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
    });
    modal.open();
  }

  private async createCrFromTemplate() {
    const fields = this.config.templateConfig.crFields ?? [
      { key: 'number', label: 'CR Number', type: 'text' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'emailSubject', label: 'Email Subject', type: 'text' },
      { key: 'solutionDesign', label: 'Solution design link', type: 'url' },
      { key: 'description', label: 'Description', type: 'text' }
    ];
    const modal = new CrTemplateModal(this.app, fields, async (data) => {
      const folder = this.config.paths.crFolder || 'Change Requests';
      await ensureFolder(this.app, folder);
      let crNumber = (data['number'] || '').trim();
      if (!crNumber) crNumber = await generateNextCrNumber(this.app, this.config);
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
  private config: PluginConfiguration;
  private onSubmit: (data: Record<string, any>) => void | Promise<void>;
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | { getValue: () => any }>();

  constructor(app: App, config: PluginConfiguration, onSubmit: (data: Record<string, any>) => void | Promise<void>) {
    super(app);
    this.fields = config.templateConfig.fields;
    this.config = config;
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
    for (const s of this.config.statusConfig.statuses) {
      const opt = statusSelect.createEl('option', { text: s });
      opt.value = s;
    }
    statusSelect.value = this.config.statusConfig.statuses[0] ?? '';
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
        if (field.type === 'status') {
          const select = control.createEl('select');
          select.addClass('kb-input');
          const options = field.useValues === 'priorities' 
            ? this.config.priorities 
            : this.config.statusConfig.statuses;
          for (const o of options) {
            const opt = select.createEl('option', { text: o });
            opt.value = o;
          }
          select.value = options[0] ?? '';
          if (field.useValues === 'priorities') {
            select.value = this.config.defaultPriority;
          }
          this.inputs.set(field.key, select);
        } else if (field.type === 'tags') {
          // Create container for tags input and suggestions
          const tagsContainer = control.createDiv({ cls: 'kb-tags-input-container' });
          const tagsInput = tagsContainer.createEl('input');
          tagsInput.addClass('kb-input');
          tagsInput.placeholder = 'Type to add or select tags...';
          tagsInput.type = 'text';

          // Create tags display area
          const tagsDisplay = tagsContainer.createDiv({ cls: 'kb-selected-tags' });
          const selectedTags: string[] = [];

          // Create suggestions dropdown
          const suggestionsContainer = tagsContainer.createDiv({ cls: 'kb-tags-suggestions' });
          suggestionsContainer.style.display = 'none';
          
          // Load existing tags and render suggestions
          let allTags: string[] = [];
          const loadAllTags = async () => {
            try {
              allTags = await getAllExistingTags(this.app, this.config);
            } catch {
              allTags = [];
            }
          };
          // Kick off load immediately (non-blocking)
          loadAllTags();

          const renderSuggestions = (query?: string) => {
            suggestionsContainer.empty();
            const q = (query ?? '').trim().toLowerCase();
            // Build list of candidates excluding already selected tags
            let candidates = allTags.filter(t => !selectedTags.includes(t));
            if (q) candidates = candidates.filter(t => t.toLowerCase().includes(q));

            // If there's a typed query that's not an exact existing tag, offer to add it
            if (q && !allTags.map(t => t.toLowerCase()).includes(q)) {
              const addOption = suggestionsContainer.createDiv({ cls: 'kb-tag-suggestion' });
              addOption.setText(`Add "${query}" as new tag`);
              addOption.onclick = () => addTag(query!.trim());
            }

            // Add existing matches
            for (const tag of candidates) {
              const option = suggestionsContainer.createDiv({ cls: 'kb-tag-suggestion' });
              option.setText(tag);
              option.onclick = () => addTag(tag);
            }

            suggestionsContainer.style.display = candidates.length > 0 || (q && !allTags.map(t => t.toLowerCase()).includes(q)) ? 'block' : 'none';
          };

          // Handle input changes
          tagsInput.oninput = () => renderSuggestions(tagsInput.value);

          // Handle focus: ensure tags are loaded then show full suggestion list
          tagsInput.onfocus = async () => {
            if (allTags.length === 0) await loadAllTags();
            renderSuggestions('');
          };

          // Close suggestions when clicking outside
          document.addEventListener('click', (e) => {
            if (!tagsContainer.contains(e.target as Node)) {
              suggestionsContainer.style.display = 'none';
            }
          });

          // Function to add a tag
          const addTag = (tag: string) => {
            if (!selectedTags.includes(tag)) {
              selectedTags.push(tag);
              const tagEl = tagsDisplay.createDiv({ cls: 'kb-tag' });
              tagEl.setText(tag);
              const removeBtn = tagEl.createSpan({ cls: 'kb-tag-remove' });
              removeBtn.setText('×');
              removeBtn.onclick = (e) => {
                e.stopPropagation();
                const index = selectedTags.indexOf(tag);
                if (index > -1) {
                  selectedTags.splice(index, 1);
                  tagEl.remove();
                }
              };
            }
            tagsInput.value = '';
            suggestionsContainer.style.display = 'none';
            tagsInput.focus();
          };

          // Handle enter key to add current input as tag
          tagsInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const value = tagsInput.value.trim();
              if (value) {
                addTag(value);
              }
            }
          };

          // Create a hidden input to store the actual tags array
          const hiddenInput = control.createEl('input');
          hiddenInput.type = 'hidden';
          hiddenInput.value = '[]';
          this.inputs.set(field.key, {
            value: '',
            getValue: () => selectedTags
          } as any);
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

    const subtasksContainer = contentEl.createDiv({ cls: 'kb-subtasks-edit' });
    subtasksContainer.createEl('h3', { text: 'Subtasks' });
    const subtasksList = subtasksContainer.createDiv();

    let subtasks: { text: string, completed: boolean }[] = [];

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
    const cancel = footer.createEl('button', { text: 'Cancel' });
    cancel.addClass('mod-warning');
    cancel.onclick = () => this.close();
    const create = footer.createEl('button', { text: 'Create Task' });
    create.addClass('mod-cta');
    create.onclick = async () => {
      const data: Record<string, any> = {};
      for (const [key, input] of this.inputs.entries()) {
        // If input is a custom object with getValue(), use that
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyInput = input as any;
        if (anyInput && typeof anyInput.getValue === 'function') {
          data[key] = anyInput.getValue();
          continue;
        }
        const element = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        // Don't trim textarea values to preserve newlines
        const val = element.tagName === 'TEXTAREA' ? element.value : element.value.trim();
        data[key] = val;
      }
      data['subtasks'] = subtasks;
      if (!data['status']) data['status'] = this.config.statusConfig.statuses[0] ?? 'Backlog';
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

