import { createSwaggerSpec } from 'next-swagger-doc';
import { generateOpenAPISchemas } from './schemas';
import {
  attachErrorExamples,
  attachPayloadTooLargeResponses,
  PAYLOAD_TOO_LARGE_EXAMPLES,
  TENANT_FORBIDDEN_EXAMPLES,
  UNAUTHORISED_EXAMPLES,
} from './error-examples';

export const getApiDocs = async (): Promise<Record<string, unknown>> => {
  // Generate schemas from Zod definitions
  const generatedSchemas = generateOpenAPISchemas();

  const spec = createSwaggerSpec({
    apiFolder: 'src/app/api',
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'UNTP Reference Implementation API',
        version: '0.2.0',
        description: 'API for the UNTP Reference Implementation',
      },
      servers: [
        {
          url: '/api/v1',
          description: 'API v1',
        },
      ],
      components: {
        // Shared responses. Auth 401/403 are referenced from each JSDoc
        // block. 413 is declared here and attached to every operation that
        // accepts a request body (see attachPayloadTooLargeResponses).
        responses: {
          UnauthorisedResponse: {
            description: 'Unauthorised - missing or invalid authentication',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                // Operations reference this component rather than declaring
                // their own 401, and a Reference Object cannot carry sibling
                // properties in OpenAPI 3.0, so the examples for all of them
                // live here.
                examples: UNAUTHORISED_EXAMPLES,
              },
            },
          },
          TenantAssignmentForbiddenResponse: {
            description: 'Forbidden - authenticated principal has no resolvable tenant assignment',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                examples: TENANT_FORBIDDEN_EXAMPLES,
              },
            },
          },
          PayloadTooLargeResponse: {
            description:
              'The request body is larger than the configured maximum. The message names the limit in bytes.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                examples: PAYLOAD_TOO_LARGE_EXAMPLES,
              },
            },
          },
        },
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT token from Keycloak authentication',
          },
        },
        schemas: generatedSchemas,
      },
      security: [{ BearerAuth: [] }],
      tags: [
        { name: 'DIDs', description: 'Decentralised Identifier management' },
        { name: 'Credentials', description: 'Verifiable Credential issuance' },
        { name: 'Library', description: 'Credential library: records of issued and registered credentials' },
        { name: 'Registrars', description: 'Identifier registrar management' },
        { name: 'Schemes', description: 'Identifier scheme management' },
        { name: 'Identifiers', description: 'Identifier instance management' },
        { name: 'Links', description: 'IDR link management' },
        {
          name: 'Conformity Vocabulary Catalogue',
          description:
            'Browse the conformity schemes, profiles, and criteria registered in this reference implementation',
        },
        { name: 'Data Models', description: 'UNTP data model template management' },
        { name: 'Facilities', description: 'Facility entity management' },
        { name: 'Organisations', description: 'Organisation entity management' },
        { name: 'Products', description: 'Product entity management' },
        { name: 'Render Templates', description: 'Credential render template management' },
        { name: 'Services', description: 'Service instance management' },
      ],
    },
  });

  // 413 is attached to every operation that declares a request body, then
  // examples are filled in on the remaining inline error responses.
  attachPayloadTooLargeResponses(spec as Record<string, unknown>);
  attachErrorExamples(spec as Record<string, unknown>);

  return spec as Record<string, unknown>;
};
