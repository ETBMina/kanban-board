# Kanban Board Plugin Development Guide

## Architecture Overview

This Obsidian plugin implements a kanban board and task grid with these key components:

```
src/
  main.ts              # Plugin setup, commands, settings migrations
  models.ts           # Core types and default settings
  utils.ts           # File/YAML handling utilities
  settings.ts        # Settings UI/persistence
  views/
    boardTabsView.ts # Main UI with grid/kanban views
```

### Core Concepts

1. **Data Model**
- Tasks are markdown files with YAML frontmatter in a configured folder
- Fields defined in `templateFields` setting (see `models.ts`)
- Default task properties: title, status, priority, dates, etc.
- Change Requests (CRs) use separate template fields

2. **UI Components**
- Grid view: Spreadsheet-like table of all tasks
- Kanban view: Drag-drop board with columns per status
- Both share filtering and task opening capabilities

## Development Workflows

### Build Commands
```bash
npm run dev    # Watch mode with source maps
npm run build  # Production build
npm run check  # TypeScript validation
```

### Key Files to Modify
- Adding fields: Update `DEFAULT_SETTINGS.templateFields` in `models.ts`
- UI changes: `boardTabsView.ts` handles both grid/kanban views
- New commands: Add to `onload()` in `main.ts`

## Project Patterns

### Field Types
Custom field types in `FieldType` (`models.ts`):
- `text`: Basic input
- `status`: Dropdown from configured statuses
- `date`: Native date picker
- `tags`: Multi-select tags
- `freetext`: Larger text area
- `url`: Link input
- `people`: People selector

### Task Creation
1. Modal collects data (`TaskTemplateModal`)
2. Generates title from CR/task numbers
3. Creates markdown with frontmatter
4. Opens new file in editor

### State Management
- Settings persisted in `data.json`
- Task updates use `updateTaskFrontmatter()` utility
- Live updates via Obsidian file watchers

### UI Conventions
- Use `kb-` CSS class prefix
- CSS variables for theming (`--interactive-accent`, etc)
- Modal forms use `setting-item` structure
- Grid/Kanban share task display code

## Integration Points

### Obsidian API Usage
- `TFile` for file operations
- `MetadataCache` for frontmatter
- `Vault` for file system
- `Modal` for dialogs
- `ItemView` for views

### Events & Updates
- File changes trigger view updates
- Status changes can update dates automatically
- Settings changes persist immediately

### Testing Strategy
- TypeScript compilation validates types
- Manual testing in dev vault
- No automated tests currently

## Agent Response Guidelines

When working in this codebase, follow these critical practices:

### Requirements Gathering
1. **Always verify task clarity**
   - File paths if editing/creating files
   - Expected behavior for UI changes
   - User interaction flows
   - Error handling expectations

2. **Validate assumptions about**:
   - Field types when adding/modifying template fields
   - Status workflow implications
   - UI component behavior (grid vs kanban)
   - File naming/path conventions

3. **Request specifics for**:
   - Default values for new fields
   - UI styling and theming
   - Error messages and user notifications
   - Migration needs for existing data

### Implementation Guidelines
1. **Before starting**:
   - Check if changes affect both grid and kanban views
   - Verify if settings migration is needed
   - Consider file watcher implications
   - Check for existing patterns in similar features

2. **During development**:
   - Run TypeScript checks frequently
   - Test with empty vaults and existing data
   - Verify file watcher updates work
   - Check mobile/desktop compatibility

3. **After changes**:
   - Verify settings persistence
   - Test task/CR creation flows
   - Check drag-drop behavior if relevant
   - Validate frontmatter updates

Remember: It's better to ask for clarification than to make incorrect assumptions about user requirements or expected behavior.