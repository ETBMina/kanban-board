export type FieldType = 'text' | 'number' | 'date' | 'status' | 'tags' | 'url' | 'people' | 'freetext';
export type ActiveTab = 'grid' | 'board' | 'calendar' | 'tasks';

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
  crStatuses?: string[];
  completedPattern: string;
  autoSetStartDateStatuses: string[];
}

export interface GridConfig {
  columnWidths: Record<string, number>;
  minColumnWidth: number;
  defaultColumnWidth: number;
  characterWidthPixels: number;
  columnPadding: number;
  visibleColumns: string[];
  showArchived?: boolean;
}

export interface FieldPatterns {
  crNumberPattern: string;
  taskNumberPattern: string;
}

export interface TemplateConfig {
  fields: TaskFieldDefinition[];
  crFields: TaskFieldDefinition[];
}

export interface FilterState {
  [fieldKey: string]: any; // fieldKey -> filter value (varies by field type)
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
  people?: string[];
  taskFilenameFormat?: string;
  crFilenameFormat?: string;
  filterState?: FilterState;
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
  frontmatter: {
    cr?: {
      title: string;
    };
    [key: string]: any;
  };
  subtasks: Subtask[];
}



