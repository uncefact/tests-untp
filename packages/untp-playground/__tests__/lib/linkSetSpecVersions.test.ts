import { DEFAULT_LINK_SET_SPEC_VERSION, LINK_SET_SPEC_VERSIONS } from '../../constants';

describe('link set spec versions', () => {
  it('lists versions oldest first and defaults to the latest', () => {
    // The page reads the default, not the list, so this is where the derivation is pinned.
    expect(DEFAULT_LINK_SET_SPEC_VERSION).toBe(LINK_SET_SPEC_VERSIONS[LINK_SET_SPEC_VERSIONS.length - 1]);
    expect([...LINK_SET_SPEC_VERSIONS]).toEqual([...LINK_SET_SPEC_VERSIONS].sort());
  });
});
