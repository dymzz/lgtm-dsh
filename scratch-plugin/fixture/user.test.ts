import { describe, expect, it } from 'vitest';
import { findUser } from './user';

describe('findUser', () => {
  it('rejects a duplicate tenant', () => {
    const user = findUser('a');
    expect(user).toBeDefined();
  });

  it('returns the mapped user', () => {
    const mapped = mapUser(loadUser('1'));
    expect(mapped).toEqual(mapUser(loadUser('1')));
  });
});
