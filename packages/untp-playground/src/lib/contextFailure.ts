import type { JsonLdFailureDescription } from '@uncefact/untp-utils/validation';

/**
 * The failure the context service (`POST /api/context`) reports when it did
 * not judge the document: `request` for a body it could not read, `service`
 * for its own internal failure. Shared by the route and the browser client,
 * which must not import the route module (it pulls the Node loader in).
 */
export interface ContextServiceFailure {
  kind: 'request' | 'service';
  detail: string;
}

/** Everything `POST /api/context` can report on a non-2xx answer. */
export type ContextFailure = JsonLdFailureDescription | ContextServiceFailure;
