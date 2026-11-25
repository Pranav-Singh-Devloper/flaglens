import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));
const { normaliseGitHubRemote } = await import('../src/commands/codeReferences');

describe('normaliseGitHubRemote', () => {
  it.each([
    ['git@github.com:Pranav-Singh-Devloper/flaglens.git', 'https://github.com/Pranav-Singh-Devloper/flaglens'],
    ['https://github.com/Pranav-Singh-Devloper/flaglens.git', 'https://github.com/Pranav-Singh-Devloper/flaglens'],
    ['https://github.com/owner/repo', 'https://github.com/owner/repo'],
    ['https://token@github.com/owner/repo.git', 'https://github.com/owner/repo'],
  ])('%s', (remote, url) => {
    expect(normaliseGitHubRemote(remote)).toBe(url);
  });

  it('rejects non-GitHub remotes', () => {
    expect(normaliseGitHubRemote('git@gitlab.com:owner/repo.git')).toBeUndefined();
  });
});
