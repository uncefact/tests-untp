/**
 * Location structure matching the UNTP core vocabulary.
 * Stored as Json in Prisma, validated at application layer.
 * All fields optional — users with only a free-text address use address.streetAddress.
 */
export interface UntpLocation {
  address?: {
    streetAddress?: string;
    postalCode?: string;
    addressLocality?: string;
    addressRegion?: string;
    addressCountry?: string; // ISO-3166 alpha-2
  };
  plusCode?: string;
  geoLocation?: { type: 'Point'; coordinates: [number, number] };
  geoBoundary?: { type: 'Polygon'; coordinates: [number, number][][] };
}
