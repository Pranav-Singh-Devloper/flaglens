// "Publish Code References to Flagsmith": uploads every flag reference in the workspace to Flagsmith's Code
// References API, in the same format as Flagsmith's own CI scanner. Flagsmith then shows, on each flag, the files and
// lines that use it (with links into the repository), counts it in the flag list, and uses it for its lifecycle stages.
// Verified on self-hosted 2.295.2: POST /projects/{id}/code-references/ accepts it and the dashboard displays it.

import { execFile } from 'node:child_process';
import { relative } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import type { App } from '../app';
import { scanWorkspace } from './flags';

const run = promisify(execFile);

/** git@github.com:owner/repo.git or https://github.com/owner/repo.git → https://github.com/owner/repo */
export function normaliseGitHubRemote(remote: string): string | undefined {
  const r = remote.trim();
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(r);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`;
  const https = /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(r);
  if (https) return `https://github.com/${https[1]}/${https[2]}`;
  return undefined;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

export interface PublishOptions {
  /** Skip the confirmation (integration tests). */
  yes?: boolean;
}

export async function publishCodeReferencesCommand(app: App, opts: PublishOptions = {}): Promise<{ references: number; flags: number } | undefined> {
  const { store } = app;
  const conn = store.connection;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!conn || !folder) {
    void vscode.commands.executeCommand('flaglens.connect');
    return undefined;
  }

  // The repository the references belong to: Flagsmith links each one to repository_url/blob/revision/path#Lline.
  let root: string;
  let revision: string;
  let repositoryUrl: string | undefined;
  try {
    root = await git(folder.uri.fsPath, 'rev-parse', '--show-toplevel');
    revision = await git(root, 'rev-parse', 'HEAD');
    repositoryUrl = normaliseGitHubRemote(await git(root, 'config', '--get', 'remote.origin.url'));
  } catch {
    void vscode.window.showWarningMessage('FlagLens: Code References need a git repository with a GitHub remote (origin).');
    return undefined;
  }
  if (!repositoryUrl) {
    void vscode.window.showWarningMessage('FlagLens: Flagsmith Code References currently support GitHub repositories; the origin remote is not on GitHub.');
    return undefined;
  }

  const { refs, files } = await scanWorkspace(app, 'FlagLens: collecting code references…');
  const known = refs.filter((r) => store.row(r.key));
  const references = known.map((r) => ({ file_path: relative(root, r.uri.fsPath).split('\\').join('/'), line_number: r.line + 1, feature_name: r.key }));
  const flags = new Set(references.map((r) => r.feature_name)).size;
  if (!references.length) {
    void vscode.window.showInformationMessage(`FlagLens: no references to flags of ${conn.project.name} in ${files} files.`);
    return { references: 0, flags: 0 };
  }

  if (!opts.yes) {
    const action = 'Publish';
    const choice = await vscode.window.showInformationMessage(
      `Publish ${references.length} code references for ${flags} flags to Flagsmith?`,
      {
        modal: true,
        detail: `Project "${conn.project.name}" on ${conn.client.baseUrl}\nRepository ${repositoryUrl} at ${revision.slice(0, 7)}\n\nFlagsmith will show these files and lines on each flag, with links into the repository.`,
      },
      action,
    );
    if (choice !== action) return undefined;
  }

  await conn.client.publishCodeReferences(conn.project.id, { repository_url: repositoryUrl, vcs_provider: 'github', revision, code_references: references });
  app.log.info(`Published ${references.length} code references for ${flags} flags (${repositoryUrl}@${revision.slice(0, 7)})`);
  await store.refresh();
  void vscode.window.showInformationMessage(`FlagLens: published ${references.length} code references for ${flags} flags. Flagsmith now shows them on each flag.`);
  return { references: references.length, flags };
}
