// Flagsmith Experimentation (beta) in the editor: a report of every experiment's results, and a way to ask Flagsmith
// to recompute them. The statistics are Flagsmith's own; FlagLens only lays them out next to the code.

import * as vscode from 'vscode';
import type { App } from '../app';
import { experimentTable } from '../core/experiment';

/** Markdown report of every started experiment in the project. Returned for tests. */
export async function showExperimentsCommand(app: App, opts: { show?: boolean } = {}): Promise<string> {
  const { store } = app;
  if (!store.connected) {
    void vscode.commands.executeCommand('flaglens.connect');
    return '';
  }
  const experiments = store.allExperiments();
  if (!experiments.length) {
    void vscode.window.showInformationMessage('FlagLens: no experiments have started in this project. Create one in the Flagsmith dashboard (Experiments).');
    return '';
  }
  const lines = [
    `# Experiments: ${store.project?.name ?? ''}`,
    '',
    'Results from Flagsmith Experimentation: lift against control with a 95% credible interval, and the chance each variation beats control. A variation is called likely better at 95% or more.',
    '',
  ];
  for (const { env, featureId, summary: x } of experiments) {
    const flag = [...store.rows.values()].find((r) => r.feature.id === featureId)?.feature.name ?? `feature ${featureId}`;
    lines.push(`## ${x.name}`, '');
    lines.push(`- **Flag:** \`${flag}\` · **Environment:** ${env?.name ?? '?'} · **Status:** ${x.status}${x.final ? ' (final)' : ''}`);
    if (x.metricName) lines.push(`- **Metric:** ${x.metricName} (expected to ${x.expected?.replace('_', ' ') ?? 'change'})`);
    if (x.hypothesis) lines.push(`- **Hypothesis:** ${x.hypothesis}`);
    lines.push(`- **Exposed:** ${x.exposures}${x.asOf ? ` · results as of ${new Date(x.asOf).toLocaleString()}` : ''}`);
    lines.push('');
    if (x.exposures) lines.push(...experimentTable(x), '');
    lines.push(
      x.likelyWinner
        ? `**${x.likelyWinner.value}** is likely better than control (${Math.round(x.likelyWinner.chanceToWin! * 100)}% chance to win).`
        : x.exposures
          ? 'No variation is ahead of control with 95% confidence yet.'
          : 'Waiting for exposures.',
    );
    if (x.srmWarning) lines.push('', 'Warning: the split between variations differs from the configuration more than chance explains (sample ratio mismatch). Check how exposures are recorded before trusting the results.');
    lines.push('');
  }
  const md = lines.join('\n');
  if (opts.show !== false) {
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: md });
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('markdown.showPreview');
  }
  return md;
}

/** Asks Flagsmith to recompute exposures and results for every running experiment, then reloads them. */
export async function refreshExperimentsCommand(app: App): Promise<void> {
  const { store } = app;
  const client = store.connection?.client;
  if (!client) return void vscode.commands.executeCommand('flaglens.connect');
  const running = store.allExperiments().filter((e) => e.summary.status === 'running' && e.env);
  if (!running.length) return void vscode.window.showInformationMessage('FlagLens: no running experiments to refresh.');
  const outcomes = await Promise.all(running.map((e) => client.refreshExperimentResults(e.env!.apiKey, e.summary.id)));
  // Flagsmith computes results in the background; give it a moment, then reload.
  await new Promise((r) => setTimeout(r, 4000));
  await store.refresh();
  const recent = outcomes.filter((o) => o === 'recently-refreshed').length;
  void vscode.window.showInformationMessage(
    recent === running.length
      ? 'FlagLens: Flagsmith refreshed these results in the last few minutes; showing the latest.'
      : `FlagLens: experiment results refreshed (${running.length - recent} of ${running.length}).`,
  );
}
