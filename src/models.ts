export type FieldType = 'text' | 'number' | 'date' | 'status' | 'tags' | 'url' | 'people' | 'freetext';
export type ActiveTab = 'grid' | 'board';

export interface TaskFieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  useValues?: string; // Reference to a config key containing values (e.g., 'statuses' or 'priorities')
  default?: any;
}

export interface PathsConfig {
  taskFolder: string;
  crFolder: string;
}

export interface StatusConfig {
  statuses: string[];
  completedPattern: string;
  inProgressPattern: string;
}

export interface GridConfig {
  columnWidths: Record<string, number>;
  minColumnWidth: number;
  defaultColumnWidth: number;
  characterWidthPixels: number;
  columnPadding: number;
  visibleColumns: string[];
}

export interface FieldPatterns {
  crNumberPattern: string;
  taskNumberPattern: string;
}

export interface TemplateConfig {
  fields: TaskFieldDefinition[];
  crFields: TaskFieldDefinition[];
}

export interface PluginConfiguration {
  paths: PathsConfig;
  statusConfig: StatusConfig;
  priorities: string[];
  defaultPriority: string;
  gridConfig: GridConfig;
  fieldPatterns: FieldPatterns;
  templateConfig: TemplateConfig;
  lastActiveTab?: ActiveTab;
}

export interface Subtask {
  text: string;
  completed: boolean;
}

import { TFile } from "obsidian";

export interface TaskNoteMeta {
  file: TFile;
  filePath: string;
  fileName: string;
  frontmatter: Record<string, any>;
  subtasks: Subtask[];
}

export const DEFAULT_CONFIG: PluginConfiguration = {
  paths: {
    taskFolder: 'Tasks',
    crFolder: 'Change Requests'
  },
  statusConfig: {
    statuses: ['Backlog', 'In Progress', 'Blocked', 'Review', 'Done'],
    completedPattern: 'Done',
    inProgressPattern: 'In Progress'
  },
  priorities: ['Low', 'Medium', 'High', 'Critical'],
  defaultPriority: 'Medium',
  gridConfig: {
    columnWidths: {
      'status': 150,
      'priority': 120
    },
    minColumnWidth: 100,
    defaultColumnWidth: 150,
    characterWidthPixels: 8,
    columnPadding: 16,
    visibleColumns: ['crNumber', 'taskNumber', 'title', 'service', 'status', 'priority', 'assignee', 'startDate', 'endDate', 'tags', 'notes', 'subtasks']
  },
  fieldPatterns: {
    crNumberPattern: 'CR-\\d+',
    taskNumberPattern: 'T-\\d+'
  },
  templateConfig: {
    fields: [
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
      { key: 'notes', label: 'Notes', type: 'freetext' },
      { key: 'subtasks', label: 'Subtasks', type: 'freetext' }
    ],
    crFields: [
      { key: 'number', label: 'CR Number', type: 'text' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'emailSubject', label: 'Email Subject', type: 'text' },
      { key: 'solutionDesign', label: 'Solution design link', type: 'url' },
      { key: 'description', label: 'Description', type: 'freetext' }
    ]
  },
  lastActiveTab: 'grid'
};

