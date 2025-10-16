import { App, PluginSettingTab, Setting } from 'obsidian';
import type KanbanPlugin from './main';

export class KanbanSettingTab extends PluginSettingTab {
  plugin: KanbanPlugin;
  constructor(app: App, plugin: KanbanPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Kanban Board & Task Grid' });

    // Task folder
    new Setting(containerEl)
      .setName('Task folder')
      .setDesc('Folder where task notes are stored')
      .addText((text) => {
        text.setPlaceholder('Tasks')
          .setValue(this.plugin.settings.taskFolder)
          .onChange(async (value) => {
            this.plugin.settings.taskFolder = value || 'Tasks';
            await this.plugin.saveSettings();
          });
      });

    // Statuses
    new Setting(containerEl)
      .setName('Statuses (comma-separated)')
      .setDesc('Columns shown in the Kanban view')
      .addText((text) => {
        text.setPlaceholder('Backlog, In Progress, Blocked, Review, Done')
          .setValue(this.plugin.settings.statuses.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.statuses = value.split(',').map(s => s.trim()).filter(Boolean);
            await this.plugin.saveSettings();
          });
      });

    // Grid columns
    new Setting(containerEl)
      .setName('Grid visible columns (keys, comma-separated)')
      .setDesc('Which fields to display in the grid')
      .addText((text) => {
        text.setPlaceholder('title, status, priority, assignee, due, tags')
          .setValue(this.plugin.settings.gridVisibleColumns.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.gridVisibleColumns = value.split(',').map(s => s.trim()).filter(Boolean);
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl('p', { text: 'Template fields can be edited in JSON within your data.json for now. A richer editor will be added.' });
  }
}

