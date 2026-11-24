import * as vscode from 'vscode';

/** Thin wrapper over a LogOutputChannel ("FlagLens" in the Output panel). Never pass API keys to it. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  show(): void;
}

export function createLogger(): Logger & vscode.Disposable {
  const channel = vscode.window.createOutputChannel('FlagLens', { log: true });
  return {
    info: (m) => channel.info(m),
    warn: (m) => channel.warn(m),
    error: (m) => channel.error(m),
    show: () => channel.show(true),
    dispose: () => channel.dispose(),
  };
}
