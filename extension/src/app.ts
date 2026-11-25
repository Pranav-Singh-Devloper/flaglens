import type * as vscode from 'vscode';
import type { ApiKeyStore } from './config';
import type { Logger } from './log';
import type { DeadCodeDecorator } from './providers/deadCode';
import type { Ctx } from './present';
import type { ReferenceIndex } from './references';
import type { WriteIntent, WriteJournal } from './safety';

/** Everything the commands need, created once in activate(). */
export interface App extends Ctx {
  context: vscode.ExtensionContext;
  log: Logger;
  keys: ApiKeyStore;
  journal: WriteJournal;
  refs: ReferenceIndex;
  autoConnectRetries: number;
  /** Asks the user to confirm a write (see safety.ts). Replaceable so integration tests can run without clicking. */
  confirm: (intent: WriteIntent) => Promise<boolean>;
  /** Set in activate(); integration tests read its last ranges. */
  deadCode?: DeadCodeDecorator;
}
