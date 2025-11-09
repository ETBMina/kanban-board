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
          .setValue(this.plugin.config.paths.taskFolder)
          .onChange(async (value) => {
            this.plugin.config.paths.taskFolder = value || 'Tasks';
            await this.plugin.saveConfig();
          });
      });

    // CR folder
    new Setting(containerEl)
      .setName('Change Request folder')
      .setDesc('Folder where CR notes are stored')
      .addText((text) => {
        text.setPlaceholder('Change Requests')
          .setValue(this.plugin.config.paths.crFolder ?? '')
          .onChange(async (value) => {
            this.plugin.config.paths.crFolder = value || 'Change Requests';
            await this.plugin.saveConfig();
          });
      });

    // Statuses
    new Setting(containerEl)
      .setName('Statuses (comma-separated)')
      .setDesc('Columns shown in the Kanban view')
      .addText((text) => {
        text.setPlaceholder('Backlog, In Progress, Blocked, Review, Done')
          .setValue(this.plugin.config.statusConfig.statuses.join(', '))
          .onChange(async (value) => {
            this.plugin.config.statusConfig.statuses = value.split(',').map(s => s.trim()).filter(Boolean);
            await this.plugin.saveConfig();
          });
      });

    // Grid columns
    new Setting(containerEl)
      .setName('Grid visible columns (keys, comma-separated)')
      .setDesc('Which fields to display in the grid')
      .addText((text) => {
        text.setPlaceholder('title, status, priority, assignee, due, tags')
          .setValue(this.plugin.config.gridConfig.visibleColumns.join(', '))
          .onChange(async (value) => {
            this.plugin.config.gridConfig.visibleColumns = value.split(',').map(s => s.trim()).filter(Boolean);
            await this.plugin.saveConfig();
          });
      });

    containerEl.createEl('p', { text: 'Template fields can be edited in JSON within your configuration.json for now. A richer editor will be added.' });
  }
}

