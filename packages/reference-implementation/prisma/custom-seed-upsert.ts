import type { CustomSeedManifest } from './custom-seed-schema.js';

export interface RegistrarUpsert {
  id: string;
  tenantId: string;
  name: string;
  namespace: string;
  url?: string | null;
  idrServiceInstanceId?: string | null;
}

export interface IdentifierSchemeUpsert {
  id: string;
  tenantId: string;
  registrarId: string;
  name: string;
  primaryKey: string;
  validationPattern: string;
  linkTemplate: string;
}

export interface QualifierUpsert {
  id: string;
  schemeId: string;
  key: string;
  description: string;
  validationPattern: string;
  order: number;
}

export interface DataModelUpsert {
  id: string;
  tenantId: string;
  name: string;
  credentialType: string;
  version: string;
  isExtension: true;
  parentConfigId: string;
  schemaUrl: string;
  contextUrl: string;
  websiteUrl?: string | null;
}

export interface RenderTemplateUpsert {
  id: string;
  tenantId: string;
  name: string;
  file: string;
  dataModelId: string;
  isDefault: boolean;
  renderMethodType: string;
  inline?: boolean | null;
  mediaType?: string | null;
  mediaQuery?: string | null;
}

export interface CvcCatalogueUpsert {
  id: string;
  name: string;
  version: string;
  endpointUrl: string;
}

export interface UpsertOperations {
  registrars: RegistrarUpsert[];
  identifierSchemes: IdentifierSchemeUpsert[];
  qualifiers: QualifierUpsert[];
  dataModels: DataModelUpsert[];
  renderTemplates: RenderTemplateUpsert[];
  cvcCatalogues: CvcCatalogueUpsert[];
}

/**
 * Pure function that transforms a validated {@link CustomSeedManifest} into flat
 * upsert operation arrays ready for a database transaction.
 *
 * No side effects — no DB calls, no file I/O.
 */
export function buildUpsertOperations(manifest: CustomSeedManifest, systemTenantId: string): UpsertOperations {
  const registrars: RegistrarUpsert[] = [];
  const identifierSchemes: IdentifierSchemeUpsert[] = [];
  const qualifiers: QualifierUpsert[] = [];

  for (const registrar of manifest.registrars) {
    registrars.push({
      id: registrar.id,
      tenantId: systemTenantId,
      name: registrar.name,
      namespace: registrar.namespace,
      url: registrar.url ?? null,
      idrServiceInstanceId: registrar.idrServiceInstanceId ?? null,
    });

    for (const scheme of registrar.identifierSchemes) {
      identifierSchemes.push({
        id: scheme.id,
        tenantId: systemTenantId,
        registrarId: registrar.id,
        name: scheme.name,
        primaryKey: scheme.primaryKey,
        validationPattern: scheme.validationPattern,
        linkTemplate: scheme.linkTemplate,
      });

      for (const qualifier of scheme.qualifiers) {
        qualifiers.push({
          id: qualifier.id,
          schemeId: scheme.id,
          key: qualifier.key,
          description: qualifier.description,
          validationPattern: qualifier.validationPattern,
          order: qualifier.order,
        });
      }
    }
  }

  const dataModels: DataModelUpsert[] = manifest.dataModels.map((dm) => ({
    id: dm.id,
    tenantId: systemTenantId,
    name: dm.name,
    credentialType: dm.credentialType,
    version: dm.version,
    isExtension: true,
    parentConfigId: dm.parentConfigId,
    schemaUrl: dm.schemaUrl,
    contextUrl: dm.contextUrl,
    websiteUrl: dm.websiteUrl ?? null,
  }));

  const renderTemplates: RenderTemplateUpsert[] = manifest.renderTemplates.map((rt) => ({
    id: rt.id,
    tenantId: systemTenantId,
    name: rt.name,
    file: rt.file,
    dataModelId: rt.dataModelId,
    isDefault: rt.isDefault,
    renderMethodType: rt.renderMethodType,
    inline: rt.inline ?? null,
    mediaType: rt.mediaType ?? null,
    mediaQuery: rt.mediaQuery ?? null,
  }));

  const cvcCatalogues: CvcCatalogueUpsert[] = manifest.cvcCatalogues.map((cc) => ({
    id: cc.id,
    name: cc.name,
    version: cc.version,
    endpointUrl: cc.endpointUrl,
  }));

  return {
    registrars,
    identifierSchemes,
    qualifiers,
    dataModels,
    renderTemplates,
    cvcCatalogues,
  };
}
