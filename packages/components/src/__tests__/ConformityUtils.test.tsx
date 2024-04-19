import { getCaseInsensitive } from '../components/ConformityCredentialCheckBox/utils';

describe('getCaseInsensitive', () => {
  it('should return the value of a key in a case-insensitive way', () => {
    const obj = { key: 'value' };
    const key = 'KEY';

    expect(getCaseInsensitive(obj, key)).toBe('value');
  });
});
