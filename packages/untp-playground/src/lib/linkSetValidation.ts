/**
 * Link set validation — module boundary only, this phase (#811, #817).
 *
 * RFC 9264 schema validation lands in a later phase; until then the pipeline carries a single
 * `Schema Validation` step that stays PENDING. The card treats an all-pending link set result as
 * settled (not mid-run), so a landed link set never looks stuck and stays removable; see
 * LinkSetTestResults. The later phase replaces this function's body with the real validation and
 * settles the step to SUCCESS or FAILURE.
 */

import type { TestStep } from '@/types';
import { TestCaseStatus, TestCaseStepId } from '../../constants';

export function linkSetValidationSteps(): TestStep[] {
  return [
    {
      id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION,
      name: 'Schema Validation',
      status: TestCaseStatus.PENDING,
    },
  ];
}
