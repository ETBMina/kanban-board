## Kanban Board & Task Grid (Obsidian Plugin)

Create task notes from a template, manage them in a spreadsheet-like grid with filters and Excel export, and visualize progress with a modern drag-and-drop Kanban board.

### Install (Development Vault)
1. Clone into your vault's `.obsidian/plugins/kanban-board` folder.
2. Run:
```bash
npm i
npm run dev
```
3. In Obsidian, enable the plugin.

### Usage
- Commands: "Create Task from Template", "Open Task Grid", "Open Kanban Board".
- Settings:
  - Task folder: where to store task notes (default `Tasks`).
  - Statuses: list of columns for the Kanban board.
  - Grid visible columns: which frontmatter fields to display.
- New Task modal: fills frontmatter for the note using your template fields.

### Excel Export
In the Grid view, click "Export Excel" to download `tasks.xlsx`.

### Filtering
Both views include a search field to quickly filter tasks by filename or field values.

### Customization
- You can edit `templateFields` in the plugin data to add custom fields.
- Kanban card content is defined in `kanbanView.ts` and can be extended.

### Roadmap
- Rich template-field editor in Settings.
- Sortable columns, column reordering & resizing in Grid.
- Saved filters / views.


