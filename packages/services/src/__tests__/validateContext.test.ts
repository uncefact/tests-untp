import { validateContextObjectEvent } from '../epcisEvents/validateContext';

describe('validateContext', () => {
  it('should return error when context is empty', () => {
    const context = {
      vckit: {},
      dpp: {},
      dlr: {},
      storage: {},
      identifierKeyPaths: [],
    };
    const result = validateContextObjectEvent(context as any);
    expect(result.ok).toBe(false);
  });
});
