import { App, normalizePath, TFile } from 'obsidian';
import { PluginSettings, TaskNoteMeta } from './models';

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

export async function readAllTasks(app: App, settings: PluginSettings): Promise<TaskNoteMeta[]> {
  const folder = normalizePath(settings.taskFolder);
  const results: TaskNoteMeta[] = [];
  const files = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + '/'));
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    results.push({ filePath: file.path, fileName: file.name.replace(/\.md$/, ''), frontmatter: fm });
  }
  return results;
}

export async function getAllExistingTags(app: App, settings: PluginSettings): Promise<string[]> {
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
  const content = await app.vault.read(file);
  const cache = app.metadataCache.getFileCache(file);
  const start = cache?.frontmatterPosition?.start?.offset ?? -1;
  const end = cache?.frontmatterPosition?.end?.offset ?? -1;
  const current = cache?.frontmatter ?? {};
  const merged = { ...current, ...patch };
  const yaml = buildFrontmatterYAML(merged);
  let next: string;
  if (start >= 0 && end > start) {
    // Replace in place without forcing extra newline; keep original spacing
    const after = content.slice(end);
    const needsNewline = after.startsWith('\n') ? '' : '\n';
    next = content.slice(0, start) + yaml + needsNewline + after;
  } else {
    // Insert FM at top; ensure a single blank line between FM and body if body exists
    const body = content;
    const sep = body.length === 0 ? '\n' : (body.startsWith('\n') ? '\n' : '\n\n');
    next = yaml + sep + body;
  }
  await app.vault.modify(file, next);
}

export function buildWikiLink(path: string): string {
  // Normalize and strip leading './'
  const p = normalizePath(path);
  return `[[${p}]]`;
}

export async function findCrFileByNumber(app: App, settings: PluginSettings, crNumber: string): Promise<TFile | null> {
  const folder = normalizePath(settings.crFolder || 'Change Requests');
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

export async function generateNextCrNumber(app: App, settings: PluginSettings): Promise<string> {
  const folder = normalizePath(settings.crFolder || 'Change Requests');
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

