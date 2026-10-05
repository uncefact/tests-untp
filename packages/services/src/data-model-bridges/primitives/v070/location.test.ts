import { buildLocationInformation, buildAddress } from './location.js';
import type { UntpLocation } from '../../types.js';

describe('buildLocationInformation (v0.7.0)', () => {
  it('returns undefined when location is undefined', () => {
    expect(buildLocationInformation(undefined)).toBeUndefined();
  });

  it('returns undefined when location has no geo fields', () => {
    const location: UntpLocation = { address: { streetAddress: '123 Main St' } };
    expect(buildLocationInformation(location)).toBeUndefined();
  });

  it('converts geoLocation from GeoJSON Point to a Coordinate', () => {
    const location: UntpLocation = {
      geoLocation: { type: 'Point', coordinates: [151.2093, -33.8688] },
    };

    expect(buildLocationInformation(location)).toEqual({
      type: ['Location'],
      geoLocation: { latitude: -33.8688, longitude: 151.2093 },
    });
  });

  it('converts geoBoundary from a GeoJSON Polygon ring to a flat Coordinate array', () => {
    const location: UntpLocation = {
      geoBoundary: {
        type: 'Polygon',
        coordinates: [
          [
            [151.0, -34.0],
            [152.0, -34.0],
            [152.0, -33.0],
            [151.0, -34.0],
          ],
        ],
      },
    };

    expect(buildLocationInformation(location)).toEqual({
      type: ['Location'],
      geoBoundary: [
        { latitude: -34.0, longitude: 151.0 },
        { latitude: -34.0, longitude: 152.0 },
        { latitude: -33.0, longitude: 152.0 },
        { latitude: -34.0, longitude: 151.0 },
      ],
    });
  });

  it('keeps plusCode as-is', () => {
    const location: UntpLocation = { plusCode: '8FWC+HQ' };
    expect(buildLocationInformation(location)).toEqual({ type: ['Location'], plusCode: '8FWC+HQ' });
  });
});

describe('buildAddress (v0.7.0)', () => {
  it('returns undefined when address is undefined', () => {
    expect(buildAddress(undefined)).toBeUndefined();
  });

  it('returns undefined when any of the five required fields is missing', () => {
    const address = { streetAddress: '123 Main St', postalCode: '2000', addressLocality: 'Sydney' };
    expect(buildAddress(address)).toBeUndefined();
  });

  it('builds a Country object with only countryCode when addressCountry is a plain string', () => {
    const address = {
      streetAddress: '123 Main St',
      postalCode: '2000',
      addressLocality: 'Sydney',
      addressRegion: 'NSW',
      addressCountry: 'AU',
    };

    expect(buildAddress(address)).toEqual({
      streetAddress: '123 Main St',
      postalCode: '2000',
      addressLocality: 'Sydney',
      addressRegion: 'NSW',
      addressCountry: { countryCode: 'AU' },
    });
  });

  it('does not emit a type field (Address is additionalProperties:false with no type property)', () => {
    const address = {
      streetAddress: '123 Main St',
      postalCode: '2000',
      addressLocality: 'Sydney',
      addressRegion: 'NSW',
      addressCountry: 'AU',
    };

    expect(buildAddress(address)).not.toHaveProperty('type');
  });

  it('builds a Country object with countryName when addressCountry is a code/name pair', () => {
    const address = {
      streetAddress: '123 Main St',
      postalCode: '2000',
      addressLocality: 'Sydney',
      addressRegion: 'NSW',
      addressCountry: { code: 'AU', name: 'Australia' },
    };

    expect(buildAddress(address)).toEqual({
      streetAddress: '123 Main St',
      postalCode: '2000',
      addressLocality: 'Sydney',
      addressRegion: 'NSW',
      addressCountry: { countryCode: 'AU', countryName: 'Australia' },
    });
  });

  it('returns undefined when addressCountry is missing', () => {
    const address = {
      streetAddress: '123 Main St',
      postalCode: '2000',
      addressLocality: 'Sydney',
      addressRegion: 'NSW',
    };
    expect(buildAddress(address)).toBeUndefined();
  });
});
