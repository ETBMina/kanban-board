import { App } from 'obsidian';
import { Dropdown } from '../Dropdown';
import { PluginConfiguration } from '../models';
import { getAllExistingTags } from '../utils';

export class FilterPanel {
  private app: App;
  private settings: PluginConfiguration;
  private filterState: Record<string, any>;
  private onApply: (filterState: Record<string, any>) => void | Promise<void>;
  private inputs: Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | { getValue: () => any }> = new Map();
  private panelEl: HTMLElement | null = null;
  private backdropEl: HTMLElement | null = null;
  private isOpen = false;

  constructor(app: App, settings: PluginConfiguration, filterState: Record<string, any>, onApply: (filterState: Record<string, any>) => void | Promise<void>) {
    this.app = app;
    this.settings = settings;
    this.filterState = JSON.parse(JSON.stringify(filterState)); // Deep copy
    this.onApply = onApply;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;

    // Create backdrop
    this.backdropEl = document.createElement('div');
    this.backdropEl.addClass('kb-filter-backdrop');
    this.backdropEl.onclick = () => this.close();
    document.body.appendChild(this.backdropEl);

    // Create panel
    this.panelEl = document.createElement('div');
    this.panelEl.addClass('kb-filter-panel');

    const contentEl = document.createElement('div');
    contentEl.addClass('kb-filter-panel-content');
    this.panelEl.appendChild(contentEl);

    // Trigger animation by adding open class after a brief delay
    requestAnimationFrame(() => {
      this.panelEl?.classList.add('kb-filter-panel-open');
      this.backdropEl?.classList.add('kb-filter-backdrop-visible');
    });

    document.body.appendChild(this.panelEl);
    this.renderContent(contentEl);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;

    if (this.panelEl) {
      this.panelEl.classList.remove('kb-filter-panel-open');
    }
    if (this.backdropEl) {
      this.backdropEl.classList.remove('kb-filter-backdrop-visible');
    }

    // Remove elements after animation completes
    setTimeout(() => {
      this.panelEl?.remove();
      this.backdropEl?.remove();
      this.panelEl = null;
      this.backdropEl = null;
    }, 350); // Match animation timing
  }

  private renderContent(contentEl: HTMLElement) {
    contentEl.empty();
    contentEl.addClass('kb-filter-modal');

    // Header with Clear button
    const header = contentEl.createDiv({ cls: 'kb-filter-header' });
    header.createEl('h2', { text: 'Filter' });
    const clearBtn = header.createEl('button', { text: 'Clear' });
    clearBtn.addClass('kb-filter-clear-btn');
    clearBtn.onclick = () => {
      // Reset local state and UI controls; do NOT persist until Apply is clicked
      this.filterState = {};
      this.inputs.forEach(input => {
        const anyInput = input as any;
        if (anyInput instanceof Dropdown) {
          anyInput.setValue('');
        } else if (typeof anyInput.setValue === 'function') {
          anyInput.setValue([]);
        } else if (typeof anyInput.getValue === 'function') {
          // best-effort: try to clear if possible
          try { anyInput.setValue && anyInput.setValue([]); } catch { }
        } else {
          const el = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
          if (el) {
            if (el.tagName === 'SELECT') el.value = '';
            else el.value = '';
          }
        }
      });
    };

    // Filter fields
    const fieldsContainer = contentEl.createDiv({ cls: 'kb-filter-fields' });
    // Build ordered fields: use config.filterFields if present, otherwise gridConfig.visibleColumns
    const orderKeys: string[] = (this.settings as any).filterFields ?? this.settings.gridConfig.visibleColumns ?? [];
    const orderedFields: any[] = [];
    for (const k of orderKeys) {
      const f = this.settings.templateConfig.fields.find((x: any) => x.key === k);
      if (f) orderedFields.push(f);
    }
    // append any remaining fields not in the orderKeys
    for (const f of this.settings.templateConfig.fields) {
      if (!orderKeys.includes(f.key)) orderedFields.push(f);
    }

    for (const field of orderedFields) {
      const row = fieldsContainer.createDiv({ cls: 'kb-filter-field' });
      row.createDiv({ cls: 'kb-filter-label', text: field.label });
      const control = row.createDiv({ cls: 'kb-filter-control' });

      if (field.type === 'date') {
        const input = control.createEl('input', { type: 'date' });
        input.addClass('kb-input');
        input.value = this.filterState[field.key] ?? '';
        this.inputs.set(field.key, input);
      } else if (field.type === 'status') {
        const options = field.useValues === 'priorities'
          ? this.settings.priorities
          : this.settings.statusConfig.statuses;

        const dropdownOptions = [{ label: 'Any', value: '' }, ...options.map(o => ({ label: o, value: o }))];

        const dropdown = new Dropdown(
          control,
          dropdownOptions,
          this.filterState[field.key] ?? '',
          (val) => { /* no-op */ }
        );
        this.inputs.set(field.key, dropdown as any);
      } else if (field.type === 'tags') {
        const container = control.createDiv({ cls: 'kb-filter-tags-container' });
        const input = container.createEl('input', { type: 'text', placeholder: 'Type to filter / press Enter to add' });
        input.addClass('kb-input');
        const selectedTags: string[] = Array.isArray(this.filterState[field.key]) ? this.filterState[field.key] : [];
        const tagsDisplay = container.createDiv({ cls: 'kb-filter-selected-tags' });
        const suggestBox = container.createDiv({ cls: 'kb-filter-suggestions' });

        const renderTags = () => {
          tagsDisplay.empty();
          for (const tag of selectedTags) {
            const tagEl = tagsDisplay.createEl('span', { text: tag, cls: 'kb-filter-tag' });
            tagEl.createEl('span', { text: '×', cls: 'kb-filter-tag-remove' }).onclick = () => {
              selectedTags.splice(selectedTags.indexOf(tag), 1);
              renderTags();
            };
          }
        };
        renderTags();

        const updateSuggestions = async (q: string) => {
          suggestBox.empty();
          const all = await getAllExistingTags(this.app, this.settings);
          const filtered = all.filter(t => t.toLowerCase().includes(q.toLowerCase()) && !selectedTags.includes(t));
          for (const s of filtered.slice(0, 30)) {
            const el = suggestBox.createEl('div', { text: s, cls: 'kb-filter-suggestion' });
            el.onclick = () => {
              selectedTags.push(s);
              input.value = '';
              renderTags();
              suggestBox.empty();
            };
          }
        };

        input.oninput = (e) => {
          updateSuggestions((e.target as HTMLInputElement).value);
        };

        input.onkeydown = (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            const val = input.value.trim();
            if (val && !selectedTags.includes(val)) {
              selectedTags.push(val);
              input.value = '';
              renderTags();
              suggestBox.empty();
            }
            e.preventDefault();
          }
        };

        this.inputs.set(field.key, {
          getValue: () => selectedTags,
          setValue: (arr: string[]) => {
            selectedTags.splice(0, selectedTags.length, ...(Array.isArray(arr) ? arr : []));
            renderTags();
            suggestBox.empty();
          }
        } as any);
      } else if (field.type === 'people') {
        const container = control.createDiv({ cls: 'kb-filter-people-container' });
        const input = container.createEl('input', { type: 'text', placeholder: 'Type or select, press Enter to add' });
        input.addClass('kb-input');
        const selectedPeople: string[] = Array.isArray(this.filterState[field.key]) ? this.filterState[field.key] : [];
        const peopleDisplay = container.createDiv({ cls: 'kb-filter-selected-people' });
        const suggestBox = container.createDiv({ cls: 'kb-filter-suggestions' });

        const renderPeople = () => {
          peopleDisplay.empty();
          for (const person of selectedPeople) {
            const personEl = peopleDisplay.createEl('span', { text: person, cls: 'kb-filter-person' });
            personEl.createEl('span', { text: '×', cls: 'kb-filter-person-remove' }).onclick = () => {
              selectedPeople.splice(selectedPeople.indexOf(person), 1);
              renderPeople();
            };
          }
        };
        renderPeople();

        const peopleSuggestions = (this.settings.people ?? []).filter(Boolean) as string[];
        const updatePeopleSuggestions = (q: string) => {
          suggestBox.empty();
          const filtered = peopleSuggestions.filter(p => p.toLowerCase().includes(q.toLowerCase()) && !selectedPeople.includes(p));
          for (const s of filtered.slice(0, 30)) {
            const el = suggestBox.createEl('div', { text: s, cls: 'kb-filter-suggestion' });
            el.onclick = () => {
              selectedPeople.push(s);
              input.value = '';
              renderPeople();
              suggestBox.empty();
            };
          }
        };

        input.oninput = (e) => {
          updatePeopleSuggestions((e.target as HTMLInputElement).value);
        };

        input.onkeydown = (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            const val = input.value.trim();
            if (val && !selectedPeople.includes(val)) {
              selectedPeople.push(val);
              input.value = '';
              renderPeople();
              suggestBox.empty();
            }
            e.preventDefault();
          }
        };

        this.inputs.set(field.key, {
          getValue: () => selectedPeople,
          setValue: (arr: string[]) => {
            selectedPeople.splice(0, selectedPeople.length, ...(Array.isArray(arr) ? arr : []));
            renderPeople();
            suggestBox.empty();
          }
        } as any);
      } else {
        const input = control.createEl('input', { type: 'text' });
        input.addClass('kb-input');
        input.placeholder = field.label;
        input.value = this.filterState[field.key] ?? '';
        this.inputs.set(field.key, input);
      }
    }

    // Footer with Apply and Close buttons
    const footer = contentEl.createDiv({ cls: 'kb-filter-footer' });
    const applyBtn = footer.createEl('button', { text: 'Apply' });
    applyBtn.addClass('kb-filter-apply-btn');
    applyBtn.onclick = () => {
      // Gather all filter values
      const newFilterState: Record<string, any> = {};
      for (const [key, input] of this.inputs) {
        if (typeof (input as any).getValue === 'function') {
          const val = (input as any).getValue();
          if (val && (Array.isArray(val) ? val.length > 0 : val !== '')) {
            newFilterState[key] = val;
          }
        } else {
          const el = input as HTMLInputElement | HTMLSelectElement;
          const val = el.value.trim();
          if (val) {
            newFilterState[key] = val;
          }
        }
      }
      this.filterState = newFilterState;
      this.onApply(this.filterState);
      this.close();
    };

    const closeBtn = footer.createEl('button', { text: 'Close' });
    closeBtn.addClass('kb-filter-close-btn');
    closeBtn.onclick = () => this.close();
  }
}
