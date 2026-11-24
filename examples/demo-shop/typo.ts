// A real-world bug FlagLens catches: a typo in a flag key.
// Every Flagsmith SDK returns the default (off) for keys that don't exist, so this code would silently never run.
// FlagLens underlines it and offers a quick fix: "Replace with new_checkout" or "Create flag in Flagsmith".

/** The part of the Flagsmith SDK's Flags object this file uses. */
interface Flags {
  isFeatureEnabled(name: string): boolean;
}

export function checkoutVersion(flags: Flags): 'new' | 'classic' {
  if (flags.isFeatureEnabled('new_chekout')) {
    return 'new';
  }
  return 'classic';
}

// dark_mode has been ON everywhere since it was created: FlagLens marks it stale (see .vscode/settings.json).
export const theme = (flags: Flags) => (flags.isFeatureEnabled('dark_mode') ? 'dark' : 'light');
