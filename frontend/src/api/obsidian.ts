import api from './client';

export interface ObsidianImportResult {
  files: number;
  notes_created: number;
  notes_updated: number;
  edges_created: number;
  unresolved_links: number;
  skipped_files: number;
}

export interface MarkdownExportResult {
  exported_notes: number;
  exported_knowledge: number;
  target_dir: string;
}

export const obsidianApi = {
  importVault: (vaultPath: string) =>
    api.post<ObsidianImportResult>('/api/v1/import/obsidian', { vault_path: vaultPath }),
  exportMarkdown: (targetDir: string) =>
    api.post<MarkdownExportResult>('/api/v1/export/markdown', { target_dir: targetDir }),
};
