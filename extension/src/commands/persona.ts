// "Preview as user": pick a test identity (from settings or typed in) and every FlagLens view shows what that user
// gets, evaluated locally from the environment document with Flagsmith's own rules (core/engine.ts).

import * as vscode from 'vscode';
import type { App } from '../app';
import { parseTraits, type Persona } from '../core/engine';
import { personaName, traitsText } from '../present';

const LAST_PERSONA = 'flaglens.persona';

function isPersona(x: unknown): x is Persona {
  return !!x && typeof x === 'object' && typeof (x as Persona).identifier === 'string';
}

export async function setPersona(app: App, persona: Persona | undefined): Promise<void> {
  app.store.setPersona(persona);
  await app.context.workspaceState.update(LAST_PERSONA, persona);
  app.log.info(persona ? `Previewing flags as ${personaName(persona)} (${persona.identifier})` : 'Previewing flags for everyone (no identity)');
}

/** Restores the persona chosen last time in this workspace. */
export function restorePersona(app: App): void {
  const saved = app.context.workspaceState.get<Persona>(LAST_PERSONA);
  if (isPersona(saved)) app.store.setPersona(saved);
}

/** Command: flaglens.previewAs. Integration tests pass a Persona (or null for "everyone") directly. */
export async function previewAsCommand(app: App, arg?: Persona | null): Promise<void> {
  if (arg === null) return setPersona(app, undefined);
  if (isPersona(arg)) return setPersona(app, arg);
  const { store } = app;
  if (!store.connected) return void vscode.commands.executeCommand('flaglens.connect');
  if (!store.previewSupported) {
    void vscode.window.showWarningMessage('FlagLens: this Flagsmith server did not return environment documents, so previews are unavailable. See FlagLens: Show Output.');
    return;
  }

  type Item = vscode.QuickPickItem & { persona?: Persona | null; custom?: boolean };
  const current = store.persona;
  const configured = app.settings().personas;
  const items: Item[] = [
    { label: `${current ? '' : '$(check) '}$(globe) Everyone`, description: 'No identity: environment defaults', persona: null },
    ...(configured.length ? [{ label: 'Test users (flaglens.personas)', kind: vscode.QuickPickItemKind.Separator } as Item] : []),
    ...configured.map((p) => ({
      label: `${current?.identifier === p.identifier ? '$(check) ' : ''}$(person) ${personaName(p)}`,
      description: p.name ? p.identifier : undefined,
      detail: traitsText(p) || 'no traits',
      persona: p,
    })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(add) Custom identity…', description: 'Type an identifier and traits', custom: true },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Preview flags as…',
    placeHolder: 'CodeLens, hovers and greyed-out code will show what this user gets, evaluated locally with Flagsmith’s rules',
    matchOnDetail: true,
  });
  if (!pick) return;
  if (!pick.custom) return setPersona(app, pick.persona ?? undefined);

  const identifier = await vscode.window.showInputBox({ title: 'Identity identifier', prompt: 'The identifier your app passes to Flagsmith, e.g. a user id or email', value: current?.identifier ?? '' });
  if (!identifier) return;
  const traits = await vscode.window.showInputBox({
    title: 'Traits (optional)',
    prompt: 'Comma-separated key=value pairs. Numbers and true/false keep their type.',
    placeHolder: 'plan=pro, country=IN, age=31',
    value: current ? traitsText(current) : '',
  });
  if (traits === undefined) return;
  await setPersona(app, { identifier: identifier.trim(), traits: parseTraits(traits) });
}

export async function toggleDimmingCommand(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('flaglens');
  const next = !cfg.get<boolean>('dimInactiveCode', true);
  await cfg.update('dimInactiveCode', next, vscode.ConfigurationTarget.Global);
  void vscode.window.setStatusBarMessage(`FlagLens: greying out code that won't run is ${next ? 'on' : 'off'}`, 2500);
}
