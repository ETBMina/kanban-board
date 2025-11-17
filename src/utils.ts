import { App, normalizePath, TFile } from 'obsidian';
import { PluginConfiguration, TaskNoteMeta } from './models';

export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const path = normalizePath(folderPath);
  try {
    await app.vault.createFolder(path);
  } catch (e) {
    // folder exists, ignore
  }
}

export function buildFrontmatterYAML(frontmatter: Record<string, any>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        // Include empty arrays as placeholders
        lines.push(`${key}: []`);
      } else {
        const rendered = value.map(v => escapeYamlInline(v)).join(', ');
        lines.push(`${key}: [${rendered}]`);
      }
    } else if (typeof value === 'string' && value.trim() === '') {
      // Include empty strings as placeholders
      lines.push(`${key}: ""`);
    } else {
      if (typeof value === 'string' && value.includes('\n')) {
        // For multiline strings, use the literal block scalar format
        lines.push(`${key}: |`);
        const textLines = value.split('\n');
        for (const line of textLines) {
          lines.push(`  ${line}`);
        }
      } else {
        const escaped = escapeYaml(value);
        lines.push(`${key}: ${escaped}`);
      }
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function escapeYaml(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === 'string') {
    // Handle multiline text with YAML literal block scalar
    if (value.includes('\n')) {
      const lines = value.split('\n');
      return '|\n' + lines.map(line => '  ' + line).join('\n');
    }
    // Handle single line text
    if (/[:#\-]|^\s|\s$/.test(value)) return JSON.stringify(value);
    return value;
  }
  return String(value);
}

function escapeYamlInline(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\[\]:\n]/.test(s) || /^\s|\s$/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function readAllItems(app: App, settings: PluginConfiguration): Promise<TaskNoteMeta[]> {
  const taskFolder = normalizePath(settings.paths.taskFolder);
  const crFolder = settings.paths.crFolder ? normalizePath(settings.paths.crFolder) : null;
  const results: TaskNoteMeta[] = [];
  const files = app.vault.getMarkdownFiles().filter(f => {
    if (f.path.startsWith(taskFolder + '/')) return true;
    if (crFolder && f.path.startsWith(crFolder + '/')) return true;
    return false;
  });
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    const content = await app.vault.read(file);
    const subtasks = [];
    const lines = content.split('\n');
    let inSubtasks = false;
    for (const line of lines) {
      if (line.startsWith('### Subtasks')) {
        inSubtasks = true;
        continue;
      }
      if (inSubtasks) {
        const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)/);
        if (match) {
          subtasks.push({ completed: match[1].trim() !== '', text: match[2].trim() });
        }
      }
    }
    results.push({ file, filePath: file.path, fileName: file.name.replace(/\.md$/, ''), frontmatter: fm, subtasks });
  }
  return results;
}

export async function readAllTasks(app: App, settings: PluginConfiguration): Promise<TaskNoteMeta[]> {
  const folder = normalizePath(settings.paths.taskFolder);
  const results: TaskNoteMeta[] = [];
  const files = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + '/'));
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    const content = await app.vault.read(file);
    const subtasks = [];
    const lines = content.split('\n');
    let inSubtasks = false;
    for (const line of lines) {
      if (line.startsWith('### Subtasks')) {
        inSubtasks = true;
        continue;
      }
      if (inSubtasks) {
        const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)/);
        if (match) {
          subtasks.push({ completed: match[1].trim() !== '', text: match[2].trim() });
        }
      }
    }
    results.push({ file, filePath: file.path, fileName: file.name.replace(/\.md$/, ''), frontmatter: fm, subtasks });
  }
  return results;
}

export async function getAllExistingTags(app: App, settings: PluginConfiguration): Promise<string[]> {
  const tasks = await readAllTasks(app, settings);
  const tagSet = new Set<string>();
  
  for (const task of tasks) {
    const tags = task.frontmatter['tags'];
    if (Array.isArray(tags)) {
      tags.forEach(tag => tagSet.add(String(tag).trim()));
    }
  }
  
  return Array.from(tagSet).sort();
}

export async function updateTaskFrontmatter(app: App, file: TFile, patch: Record<string, any>): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const key in patch) {
      if (patch[key] === undefined) {
        delete fm[key];
      } else {
        fm[key] = patch[key];
      }
    }
  });
}

export function buildWikiLink(path: string): string {
  // Normalize and strip leading './'
  const p = normalizePath(path);
  return `[[${p}]]`;
}

export async function findCrFileByNumber(app: App, settings: PluginConfiguration, crNumber: string): Promise<TFile | null> {
  const folder = normalizePath(settings.paths.crFolder || 'Change Requests');
  const files = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + '/'));
  for (const file of files) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm && String(fm['number'] || fm['crNumber'] || '').toLowerCase() === crNumber.toLowerCase()) {
      return file;
    }
    // Fallback: match by filename prefix e.g. "CR-1234 - title.md"
    if (file.name.toLowerCase().startsWith(crNumber.toLowerCase() + ' ')) return file;
  }
  return null;
}

export async function generateNextCrNumber(app: App, settings: PluginConfiguration): Promise<string> {
  const folder = normalizePath(settings.paths.crFolder || 'Change Requests');
  const files = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + '/'));
  let max = 0;
  const rx = /^CR-(\d+)/i;
  for (const file of files) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const fromFm = String(fm?.['number'] || fm?.['crNumber'] || '');
    const m1 = rx.exec(fromFm);
    if (m1) { const n = parseInt(m1[1], 10); if (!Number.isNaN(n)) max = Math.max(max, n); }
    const m2 = rx.exec(file.name);
    if (m2) { const n = parseInt(m2[1], 10); if (!Number.isNaN(n)) max = Math.max(max, n); }
  }
  const next = max + 1;
  return `CR-${next}`;
}

export function sanitizeFileName(name: string): string {
  // 1. Remove ALL reserved/illegal characters and replace with a hyphen (-)
  // Illegal characters: < > : " / \ | ? * and control characters (0-31).
  let sanitized = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');

  // 2. Remove characters that can cause issues but aren't strictly illegal
  // (e.g., #, ^, [], which can break linking/shell scripts)
  sanitized = sanitized.replace(/[#^\[\]]/g, '');

  // 3. Remove Windows reserved device names (case-insensitive)
  const reserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
  if (reserved.test(sanitized)) {
    sanitized = `file-${sanitized}`;
  }

  // 4. Trim leading/trailing spaces and dots, and collapse consecutive hyphens
  sanitized = sanitized.trim()
                       .replace(/\.+$/g, '') // Remove trailing dots
                       .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
                       .replace(/--+/g, '-'); // Collapse multiple hyphens

  // Fallback: If after all sanitization the name is empty, provide a default
  if (sanitized === '') {
    return 'untitled';
  }

  return sanitized;
}

