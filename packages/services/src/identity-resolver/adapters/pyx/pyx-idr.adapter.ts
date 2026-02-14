import type { AdapterRegistryEntry } from '../../../registry/types.js';
import type { LoggerService } from '../../../logging/types.js';
import { createLogger } from '../../../logging/factory.js';
import { pyxIdrConfigSchema, type PyxIdrConfig } from './pyx-idr.schema.js';
import type {
  IIdentityResolverService,
  Link,
  LinkRegistration,
  PublishLinksOptions,
  ResolverDescription,
  LinkType,
} from '../../../interfaces/identityResolverService.js';

export { IDR_SERVICE_TYPE } from '../../types.js';

/** Adapter type identifier for Pyx IDR provider. */
export const PYX_IDR_ADAPTER_TYPE = 'PYX_IDR' as const;

type DefaultFlagsConfig = {
  defaultLinkType: boolean;
  defaultMimeType: boolean;
  defaultIanaLanguage: boolean;
  defaultContext: boolean;
  fwqs: boolean;
};

/**
 * Pyx Identity Resolver adapter implementation.
 * Registers and manages links with a Pyx IDR instance to make them
 * discoverable via identifiers.
 *
 * @see https://github.com/pyx-industries/pyx-identity-resolver
 * @see https://pyx-industries.github.io/pyx-identity-resolver/
 */
export class PyxIdentityResolverAdapter implements IIdentityResolverService {
  private readonly baseURL: string;
  private readonly headers: Record<string, string>;
  private readonly defaultFlags: DefaultFlagsConfig;
  private readonly defaultContext: string;
  private readonly logger: LoggerService;
  private readonly apiVersion: string;

  constructor(config: PyxIdrConfig, logger?: LoggerService) {
    this.baseURL = config.baseUrl;
    this.headers = {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    };
    this.defaultContext = config.defaultContext ?? 'au';
    this.defaultFlags = {
      defaultLinkType: config.defaultFlags?.defaultLinkType ?? false,
      defaultMimeType: config.defaultFlags?.defaultMimeType ?? false,
      defaultIanaLanguage: config.defaultFlags?.defaultIanaLanguage ?? false,
      defaultContext: config.defaultFlags?.defaultContext ?? false,
      fwqs: config.defaultFlags?.fwqs ?? false,
    };
    this.apiVersion = config.apiVersion;
    this.logger = (logger || createLogger()).child({ service: 'PyxIdrAdapter', apiVersion: config.apiVersion });
  }

  private get apiBasePath(): string {
    return `${this.baseURL}/api/${this.apiVersion}`;
  }

  async publishLinks(
    identifierScheme: string,
    identifier: string,
    links: Link[],
    qualifierPath?: string,
    options?: PublishLinksOptions,
  ): Promise<LinkRegistration> {
    const namespace = options?.namespace ?? this.defaultContext;
    const payload = {
      namespace,
      identificationKeyType: identifierScheme,
      identificationKey: identifier,
      itemDescription: options?.itemDescription ?? '',
      qualifierPath: qualifierPath ?? '/',
      active: true,
      responses: links.map((link) => ({
        linkType: link.rel,
        ianaLanguage: 'en',
        context: this.defaultContext,
        mimeType: link.type,
        linkTitle: link.title,
        targetUrl: link.href,
        defaultLinkType: link.default ?? this.defaultFlags.defaultLinkType,
        defaultMimeType: this.defaultFlags.defaultMimeType,
        defaultIanaLanguage: this.defaultFlags.defaultIanaLanguage,
        defaultContext: this.defaultFlags.defaultContext,
        fwqs: this.defaultFlags.fwqs,
      })),
    };

    this.logger.info(`Publishing ${links.length} link(s) for ${identifierScheme}/${identifier}`);

    const response = await fetch(`${this.apiBasePath}/resolver`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to publish links: HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    // Extract link IDs from Pyx response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registeredLinks = (result.linkResponses ?? result.responses ?? []).map((r: any, index: number) => ({
      idrLinkId: String(r.id ?? r.linkId ?? index),
      link: links[index],
    }));

    return {
      resolverUri: result.resolverUri ?? `${this.baseURL}/${namespace}/${identifierScheme}/${identifier}`,
      identifierScheme,
      identifier,
      links: registeredLinks,
    };
  }

  async getLinkById(linkId: string): Promise<Link> {
    this.logger.info(`Getting link ${linkId}`);
    const response = await fetch(`${this.apiBasePath}/resolver/links/${linkId}`, {
      headers: this.headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to get link: HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    return {
      href: result.targetUrl,
      rel: result.linkType,
      type: result.mimeType,
      title: result.linkTitle ?? '',
      hreflang: result.ianaLanguage ? [result.ianaLanguage] : undefined,
    };
  }

  async updateLink(linkId: string, link: Partial<Link>): Promise<Link> {
    this.logger.info(`Updating link ${linkId}`);
    const payload: Record<string, unknown> = {};
    if (link.href !== undefined) payload.targetUrl = link.href;
    if (link.rel !== undefined) payload.linkType = link.rel;
    if (link.type !== undefined) payload.mimeType = link.type;
    if (link.title !== undefined) payload.linkTitle = link.title;

    const response = await fetch(`${this.apiBasePath}/resolver/links/${linkId}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to update link: HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    return {
      href: result.targetUrl,
      rel: result.linkType,
      type: result.mimeType,
      title: result.linkTitle ?? '',
      hreflang: result.ianaLanguage ? [result.ianaLanguage] : undefined,
    };
  }

  async deleteLink(linkId: string): Promise<void> {
    this.logger.info(`Deleting link ${linkId}`);
    const response = await fetch(`${this.apiBasePath}/resolver/links/${linkId}`, {
      method: 'DELETE',
      headers: this.headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to delete link: HTTP ${response.status}: ${errorText}`);
    }
  }

  async getResolverDescription(): Promise<ResolverDescription> {
    this.logger.info('Fetching resolver description');
    const response = await fetch(`${this.baseURL}/.well-known/resolver`, {
      headers: this.headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to get resolver description: HTTP ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  async getLinkTypes(): Promise<LinkType[]> {
    this.logger.info('Fetching link types');
    const response = await fetch(`${this.apiBasePath}/voc?show=linktypes`, {
      headers: this.headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to get link types: HTTP ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /** Pyx-specific: Register identifier schemes with the IDR */
  async registerSchemes(
    schemes: Array<{
      namespace: string;
      applicationIdentifiers: Array<{
        title: string;
        label: string;
        shortcode: string;
        ai: string;
        type: 'I' | 'Q' | 'D';
        regex: string;
        qualifiers?: string[];
      }>;
    }>,
  ): Promise<void> {
    this.logger.info(`Registering ${schemes.length} scheme(s)`);
    for (const scheme of schemes) {
      const response = await fetch(`${this.apiBasePath}/identifiers`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(scheme),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        this.logger.warn(`Failed to register scheme ${scheme.namespace}: HTTP ${response.status}: ${errorText}`);
      }
    }
  }
}

/** Registry entry for the Pyx IDR adapter. */
export const pyxIdrRegistryEntry = {
  configSchema: pyxIdrConfigSchema,
  factory: (config: PyxIdrConfig, logger: LoggerService): IIdentityResolverService =>
    new PyxIdentityResolverAdapter(config, logger),
} satisfies AdapterRegistryEntry<PyxIdrConfig, IIdentityResolverService>;
