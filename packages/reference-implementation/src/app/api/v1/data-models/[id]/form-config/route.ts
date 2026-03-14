import { NextResponse } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { withTenantAuth } from '@/lib/api/with-tenant-auth';
import { getDataModelById } from '@/lib/prisma/repositories';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ route: '/api/v1/data-models/[id]/form-config' });

/**
 * Entity requirements per credential type.
 * Defines which entity pickers are needed for SPA form rendering.
 */
const ENTITY_REQUIREMENTS: Record<
  string,
  Array<{ entityType: string; label: string; endpoint: string; required: boolean }>
> = {
  DigitalProductPassport: [
    { entityType: 'organisation', label: 'Organisation', endpoint: '/api/v1/organisations', required: true },
    { entityType: 'facility', label: 'Facility', endpoint: '/api/v1/facilities', required: true },
    { entityType: 'product', label: 'Product', endpoint: '/api/v1/products', required: true },
  ],
  DigitalConformityCredential: [
    { entityType: 'organisation', label: 'Organisation', endpoint: '/api/v1/organisations', required: true },
  ],
  DigitalFacilityRecord: [
    { entityType: 'organisation', label: 'Organisation', endpoint: '/api/v1/organisations', required: true },
    { entityType: 'facility', label: 'Facility', endpoint: '/api/v1/facilities', required: true },
  ],
  DigitalIdentityAnchor: [
    { entityType: 'organisation', label: 'Organisation', endpoint: '/api/v1/organisations', required: true },
  ],
  DigitalTraceabilityEvent: [
    { entityType: 'organisation', label: 'Organisation', endpoint: '/api/v1/organisations', required: true },
    { entityType: 'product', label: 'Product', endpoint: '/api/v1/products', required: true },
  ],
};

/**
 * @swagger
 * /data-models/{id}/form-config:
 *   get:
 *     summary: Get form configuration for a data model
 *     description: Returns entity picker metadata for SPA form rendering. Describes which entity types a credential type requires and where to fetch them.
 *     tags:
 *       - Data Models
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The database ID of the data model
 *     responses:
 *       200:
 *         description: Form configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 formConfig:
 *                   type: object
 *                   properties:
 *                     dataModelId:
 *                       type: string
 *                     credentialType:
 *                       type: string
 *                     version:
 *                       type: string
 *                     schemaUrl:
 *                       type: string
 *                     sections:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           entityType:
 *                             type: string
 *                           label:
 *                             type: string
 *                           endpoint:
 *                             type: string
 *                           required:
 *                             type: boolean
 *       401:
 *         description: Unauthorised - missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Data model not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const GET = withTenantAuth(async (_req, { tenantId, params }) => {
  const { id } = await params;

  logger.info({ dataModelId: id }, 'Looking up data model for form config');
  const dataModel = await getDataModelById(id, tenantId);
  if (!dataModel) {
    throw new NotFoundError('Data model not found');
  }

  const sections = ENTITY_REQUIREMENTS[dataModel.credentialType] ?? [];

  logger.info(
    { tenantId, dataModelId: id, credentialType: dataModel.credentialType, sectionCount: sections.length },
    'Form config resolved',
  );

  return NextResponse.json({
    formConfig: {
      dataModelId: dataModel.id,
      credentialType: dataModel.credentialType,
      version: dataModel.version,
      schemaUrl: dataModel.schemaUrl,
      sections,
    },
  });
});
