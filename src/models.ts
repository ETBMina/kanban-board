export type FieldType = 'text' | 'number' | 'date' | 'status' | 'tags' | 'url' | 'people' | 'freetext';

export interface TaskFieldDefinition {
  key: string; // frontmatter key
  label: string;
  type: FieldType;
}

export interface PluginSettings {
  taskFolder: string;
  statuses: string[];
  templateFields: TaskFieldDefinition[];
  gridVisibleColumns: string[]; // keys to display
  crFolder?: string;
  crTemplateFields?: TaskFieldDefinition[];
}

export interface TaskNoteMeta {
  filePath: string;
  fileName: string;
  frontmatter: Record<string, any>;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  taskFolder: 'Tasks',
  statuses: ['Backlog', 'In Progress', 'Blocked', 'Review', 'Done'],
  templateFields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'priority', label: 'Priority', type: 'status' },
    { key: 'assignee', label: 'Assignee', type: 'people' },
    { key: 'startDate', label: 'Start Date', type: 'date' },
    { key: 'endDate', label: 'End Date', type: 'date' },
    { key: 'tags', label: 'Tags', type: 'tags' },
    { key: 'crNumber', label: 'CR Number', type: 'text' },
    { key: 'taskNumber', label: 'Task Number', type: 'text' },
    { key: 'service', label: 'Service', type: 'text' },
    { key: 'plannedStart', label: 'Planned start date', type: 'date' },
    { key: 'plannedEnd', label: 'Planned end date', type: 'date' },
    { key: 'actualStart', label: 'Actual start date', type: 'date' },
    { key: 'actualEnd', label: 'Actual end date', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'freetext' }
  ],
  gridVisibleColumns: ['crNumber', 'taskNumber', 'title', 'service', 'status', 'priority', 'assignee', 'startDate', 'endDate', 'tags', 'notes'],
  crFolder: 'Change Requests',
  crTemplateFields: [
    { key: 'number', label: 'CR Number', type: 'text' },
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'emailSubject', label: 'Email Subject', type: 'text' },
    { key: 'solutionDesign', label: 'Solution design link', type: 'url' },
    { key: 'description', label: 'Description', type: 'freetext' }
  ]
};

