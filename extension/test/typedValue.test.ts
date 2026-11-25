import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));
const { typedValue, untypedValue } = await import('../src/api/client');

describe('typed feature state values (segment-override endpoints)', () => {
  it('converts both ways and keeps the type', () => {
    for (const v of ['hello', '', 500, 0, true, false, null]) expect(untypedValue(typedValue(v) as never)).toBe(v);
    expect(typedValue(500)).toEqual({ type: 'int', integer_value: 500 });
    expect(typedValue(null)).toEqual({ type: 'unicode', string_value: null });
  });

  it('reads the shape Flagsmith returns, including unused fields set to null', () => {
    expect(untypedValue({ type: 'int', string_value: null, integer_value: 50, boolean_value: null })).toBe(50);
    expect(untypedValue({ type: 'bool', string_value: null, integer_value: null, boolean_value: false })).toBe(false);
    expect(untypedValue(null)).toBe(null);
  });
});
