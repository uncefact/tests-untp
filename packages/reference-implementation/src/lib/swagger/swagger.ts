import { createSwaggerSpec } from 'next-swagger-doc';

export const getApiDocs = async (): Promise<Record<string, unknown>> => {
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
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT token from Keycloak authentication',
          },
        },
      },
      security: [{ BearerAuth: [] }],
      tags: [
        { name: 'DIDs', description: 'Decentralized Identifier management' },
        { name: 'Credentials', description: 'Verifiable Credential issuance' },
      ],
    },
  });
  return spec as Record<string, unknown>;
};
