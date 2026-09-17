import type { UntpLocation } from '../../types.js';
import { resolveCountry } from '../location.js';

export type Coordinate = { latitude: number; longitude: number };

export type LocationInformation = {
  type: ['Location'];
  plusCode?: string;
  geoLocation?: Coordinate;
  geoBoundary?: Coordinate[];
};

// No `type` field: v0.7.0's Address is additionalProperties:false and doesn't declare one.
export type Address = {
  streetAddress: string;
  postalCode: string;
  addressLocality: string;
  addressRegion: string;
  addressCountry: { countryCode: string; countryName?: string };
};

function toCoordinate([longitude, latitude]: [number, number]): Coordinate {
  return { latitude, longitude };
}

export function buildLocationInformation(location: UntpLocation | null | undefined): LocationInformation | undefined {
  if (!location) return undefined;

  const hasGeoFields = location.geoLocation || location.plusCode || location.geoBoundary;
  if (!hasGeoFields) return undefined;

  return {
    type: ['Location'],
    ...(location.plusCode && { plusCode: location.plusCode }),
    ...(location.geoLocation && { geoLocation: toCoordinate(location.geoLocation.coordinates) }),
    ...(location.geoBoundary && { geoBoundary: location.geoBoundary.coordinates[0]?.map(toCoordinate) }),
  };
}

export function buildAddress(address: UntpLocation['address'] | undefined): Address | undefined {
  if (!address) return undefined;

  const country = resolveCountry(address.addressCountry);
  if (!address.streetAddress || !address.postalCode || !address.addressLocality || !address.addressRegion || !country) {
    return undefined;
  }

  return {
    streetAddress: address.streetAddress,
    postalCode: address.postalCode,
    addressLocality: address.addressLocality,
    addressRegion: address.addressRegion,
    addressCountry: { countryCode: country.code, ...(country.name && { countryName: country.name }) },
  };
}
