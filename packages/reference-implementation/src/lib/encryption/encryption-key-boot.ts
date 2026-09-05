import { prisma } from '../prisma/prisma';
import { prismaEnvelopeStores } from '../credentials/prisma-envelope-stores';
import {
  assertNotPlaceholderEncryptionKey,
  validateEncryptionKeyAtStartup,
} from '../credentials/validate-encryption-key-startup';
import { getEncryptionService } from './encryption';

/**
 * The boot-time checks on a configured DATA_ENCRYPTION_KEY, shared by the web
 * process (which skips them when no key is set) and the worker (which refuses
 * to start without one): the placeholder value is rejected, and the key must
 * decrypt a sample of existing data (#762). Whether an unset key is
 * acceptable is the caller's decision, not this function's.
 */
export async function validateConfiguredEncryptionKey(key: string): Promise<void> {
  assertNotPlaceholderEncryptionKey(key, { deploymentEnvironment: process.env.DEPLOYMENT_ENVIRONMENT });
  await validateEncryptionKeyAtStartup(prismaEnvelopeStores(prisma), getEncryptionService());
}
