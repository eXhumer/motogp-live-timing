import { describe, expect, it } from 'vitest';

import * as auth from '../../src/auth.js';
import * as shared from '@exhumer/motogp-auth';

// The behaviour is tested in @exhumer/motogp-auth; here we only check that nothing was lost in the move.
describe('auth re-exports', () => {
  it('re-exports the shared auth package', () => {
    expect(auth.login).toBe(shared.login);
    expect(auth.refreshToken).toBe(shared.refreshToken);
    expect(auth.hasTimingPass).toBe(shared.hasTimingPass);
    expect(auth.MotoGPAuth).toBe(shared.MotoGPAuth);
    expect(auth.TIMING_PASS_LICENCE_ID).toBe('65028c47-0994-432b-a300-ffdcc97447c1');
  });
});
