/**
 * RFC 9264 compliant Linkset type - https://datatracker.ietf.org/doc/rfc9264/
 * A linkset is a collection of links described using the link context object
 */
export type Linkset = LinkContextObject[];

export interface LinkContextObject {
  anchor?: string;
  [linkRelationType: string]: LinkTarget[] | string | undefined;
}

export interface LinkTarget {
  href: string;
  type?: string;
  hreflang?: string | string[];
  title?: string;
  'title*'?: Record<string, string>;
  media?: string;
}

export interface LinkRegistration {
  resolverUri: string;      // Canonical URI where this identifier can be resolved
  identifierScheme: string;
  identifier: string;
}

export interface IIdentityResolverService {
  registerLinks(
    identifierScheme: string,
    identifier: string,
    linkset: Linkset // RFC 9264 compliant
  ): Promise<LinkRegistration>
}
