import { buildLocationInformation, buildAddress } from './location.js';
import type { UntpLocation } from '../types.js';

describe('buildLocationInformation', () => {
  it('returns undefined when location is undefined', () => {
    const result = buildLocationInformation(undefined);

    expect(result).toBeUndefined();
  });

  it('returns undefined when location has no geo fields', () => {
    const location: UntpLocation = {
      address: { streetAddress: '123 Main St' },
    };

    const result = buildLocationInformation(location);

    expect(result).toBeUndefined();
  });

  it('returns Location object with plusCode when present', () => {
    const location: UntpLocation = {
      plusCode: '8FWC+HQ',
    };

    const result = buildLocationInformation(location);

    expect(result).toEqual({
      type: ['Location'],
      plusCode: '8FWC+HQ',
    });
  });

  it('returns Location object with geoLocation when present', () => {
    const location: UntpLocation = {
      geoLocation: { type: 'Point', coordinates: [151.2093, -33.8688] },
    };

    const result = buildLocationInformation(location);

    expect(result).toEqual({
      type: ['Location'],
      geoLocation: { type: 'Point', coordinates: [151.2093, -33.8688] },
    });
  });

  it('returns Location object with geoBoundary when present', () => {
    const location: UntpLocation = {
      geoBoundary: {
        type: 'Polygon',
        coordinates: [
          [
            [151.0, -34.0],
            [152.0, -34.0],
            [152.0, -33.0],
            [151.0, -33.0],
            [151.0, -34.0],
          ],
        ],
      },
    };

    const result = buildLocationInformation(location);

    expect(result).toEqual({
      type: ['Location'],
      geoBoundary: location.geoBoundary,
    });
  });

  it('returns Location with all geo fields when all present', () => {
    const location: UntpLocation = {
      plusCode: '8FWC+HQ',
      geoLocation: { type: 'Point', coordinates: [151.2093, -33.8688] },
      geoBoundary: {
        type: 'Polygon',
        coordinates: [
          [
            [151.0, -34.0],
            [152.0, -33.0],
            [151.0, -34.0],
          ],
        ],
      },
    };

    const result = buildLocationInformation(location);

    expect(result).toEqual({
      type: ['Location'],
      plusCode: '8FWC+HQ',
      geoLocation: location.geoLocation,
      geoBoundary: location.geoBoundary,
    });
  });
});

describe('buildAddress', () => {
  it('returns undefined when address is undefined', () => {
    const result = buildAddress(undefined);

    expect(result).toBeUndefined();
  });

  it('returns Address object with only present fields', () => {
    const address = {
      streetAddress: '123 Main St',
      postalCode: '2000',
    };

    const result = buildAddress(address);

    expect(result).toEqual({
      type: ['Address'],
      streetAddress: '123 Main St',
      postalCode: '2000',
    });
  });

  it('returns Address with all fields when all are present', () => {
    const address = {
      streetAddress: '123 Main St',
      postalCode: '2000',
      addressLocality: 'Sydney',
      addressRegion: 'NSW',
      addressCountry: 'AU',
    };

    const result = buildAddress(address);

    expect(result).toEqual({
      type: ['Address'],
      streetAddress: '123 Main St',
      postalCode: '2000',
      addressLocality: 'Sydney',
      addressRegion: 'NSW',
      addressCountry: 'AU',
    });
  });

  it('omits fields that are empty strings', () => {
    const address = {
      streetAddress: '123 Main St',
      postalCode: '',
      addressLocality: 'Sydney',
    };

    const result = buildAddress(address);

    expect(result).toEqual({
      type: ['Address'],
      streetAddress: '123 Main St',
      addressLocality: 'Sydney',
    });
    expect(result?.postalCode).toBeUndefined();
  });
});
