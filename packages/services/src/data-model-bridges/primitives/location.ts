import type { UntpLocation, CountryInput } from '../types.js';

export type LocationInformation = {
  type: ['Location'];
  plusCode?: string;
  geoLocation?: { type: 'Point'; coordinates: [number, number] };
  geoBoundary?: { type: 'Polygon'; coordinates: [number, number][][] };
};

export type Address = {
  type: ['Address'];
  streetAddress?: string;
  postalCode?: string;
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string;
};

export function buildLocationInformation(location: UntpLocation | null | undefined): LocationInformation | undefined {
  if (!location) return undefined;

  const hasGeoFields = location.geoLocation || location.plusCode || location.geoBoundary;
  if (!hasGeoFields) return undefined;

  return {
    type: ['Location'],
    ...(location.plusCode && { plusCode: location.plusCode }),
    ...(location.geoLocation && { geoLocation: location.geoLocation }),
    ...(location.geoBoundary && { geoBoundary: location.geoBoundary }),
  };
}

/** Normalises the string-or-object `addressCountry` input to a `{code, name?}` pair. */
export function resolveCountry(addressCountry: CountryInput | undefined): { code: string; name?: string } | undefined {
  if (!addressCountry) return undefined;
  return typeof addressCountry === 'string' ? { code: addressCountry } : addressCountry;
}

export function buildAddress(address: UntpLocation['address'] | undefined): Address | undefined {
  if (!address) return undefined;

  const country = resolveCountry(address.addressCountry);

  return {
    type: ['Address'],
    ...(address.streetAddress && { streetAddress: address.streetAddress }),
    ...(address.postalCode && { postalCode: address.postalCode }),
    ...(address.addressLocality && { addressLocality: address.addressLocality }),
    ...(address.addressRegion && { addressRegion: address.addressRegion }),
    ...(country && { addressCountry: country.code }),
  };
}
