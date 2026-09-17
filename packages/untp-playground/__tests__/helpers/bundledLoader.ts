import { findBundledArtefact } from '@uncefact/untp-utils/bundled-artefacts';
import type { LoadedRemoteDocument } from '@uncefact/untp-utils/loaders';

export async function bundledLoader(url: string): Promise<LoadedRemoteDocument> {
  const document = await findBundledArtefact(url);
  if (!document) throw new Error(`Fixture does not contain context ${url}`);
  return { documentUrl: url, document };
}
