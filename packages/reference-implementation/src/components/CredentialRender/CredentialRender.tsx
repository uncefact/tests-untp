'use client';

import { useCallback, useEffect, useState } from 'react';
import { Renderer, WebRenderingTemplate2022, RenderTemplate2024 } from '@uncefact/vckit-renderer';
import { IRenderDocument, UnsignedCredential, VerifiableCredential } from '@uncefact/vckit-core-types';
import { Box, CircularProgress } from '@mui/material';
import { convertBase64ToString, computeDigestMultibase } from '../../utils';

// ---------------------------------------------------------------------------
// TODO: Move to @uncefact/vckit-renderer upstream
//
// Everything below (IRI aliases, findValue, LenientRenderTemplate2024) works
// around limitations in vckit-renderer that should be fixed at source:
//
// 1. IRI alias handling — the renderer only checks the
//    https://w3id.org/vc/render-method# namespace for template/url/mediaType,
//    but the W3C v2 credentials context and UNTP contexts expand these fields
//    to different IRIs. The renderer should check all known aliases.
//
// 2. Browser-native digestMultibase verification — the renderer delegates hash
//    verification to context.agent.computeHash (a VCKit agent pattern) which
//    doesn't exist when using the renderer standalone in the browser. The
//    renderer should use Web Crypto internally as a fallback.
//
// Once vckit-renderer handles these, this entire block can be removed and the
// component can use RenderTemplate2024 directly.
// ---------------------------------------------------------------------------

const TEMPLATE_IRI_ALIASES = [
  'https://w3id.org/vc/render-method#template',
  'https://www.w3.org/ns/credentials/issuer-dependent#template',
  'https://www.w3.org/2018/credentials#renderMethod#template',
];

const URL_IRI_ALIASES = [
  'https://w3id.org/vc/render-method#url',
  'https://www.w3.org/ns/credentials/issuer-dependent#url',
  'https://www.w3.org/2018/credentials#renderMethod#url',
];

const MEDIA_TYPE_IRI_ALIASES = [
  'https://schema.org/encodingFormat',
  'https://www.w3.org/ns/credentials/issuer-dependent#mediaType',
];

function findValue(data: any, iris: string[]): string | undefined {
  for (const iri of iris) {
    if (data[iri]?.[0]?.['@value']) {
      return data[iri][0]['@value'];
    }
  }
  return undefined;
}

class LenientRenderTemplate2024 extends RenderTemplate2024 {
  extractData(data: any) {
    const result = super.extractData(data);

    if (!result.template) {
      result.template = findValue(data, TEMPLATE_IRI_ALIASES);
    }
    if (!result.url) {
      result.url = findValue(data, URL_IRI_ALIASES);
    }
    if (!result.mediaType) {
      result.mediaType = findValue(data, MEDIA_TYPE_IRI_ALIASES) ?? 'text/html';
    }

    return result;
  }

  async renderCredential(args: { data: any; document: any; context?: any }) {
    const context = {
      ...args.context,
      agent: {
        ...args.context?.agent,
        computeHash: computeDigestMultibase,
      },
    };
    return super.renderCredential({ ...args, context });
  }
}

// ---------------------------------------------------------------------------
// End of vckit-renderer workarounds
// ---------------------------------------------------------------------------

/**
 * Rewrites global CSS selectors (body, html) in template <style> tags to
 * target a scoped class, preventing the template CSS from leaking into the
 * host page layout.
 */
const SCOPE_CLASS = 'credential-template-scope';

function scopeGlobalSelectors(html: string): string {
  return html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_match, attrs, css) => {
    const scoped = css.replace(/\b(body|html)\b(?=[^{]*\{)/g, `.${SCOPE_CLASS}`);
    return `<style${attrs}>${scoped}</style>`;
  });
}

/**
 * CredentialRender component is used to render the credential
 */
const CredentialRender = ({ credential }: { credential: VerifiableCredential | UnsignedCredential }) => {
  const [documents, setDocuments] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  /**
   * handle render credential
   */
  const renderCredential = useCallback(async () => {
    setIsLoading(true);

    try {
      const rt2024 = new LenientRenderTemplate2024();
      const renderer = new Renderer({
        providers: {
          WebRenderingTemplate2022: new WebRenderingTemplate2022(),
          RenderTemplate2024: rt2024,
          // UNTP contexts expand RenderTemplate2024 to a path-based IRI (not fragment-based),
          // so the renderer's type extraction returns the full IRI instead of just the local name.
          'https://test.uncefact.org/vocabulary/untp/core/0/RenderTemplate2024': rt2024,
        },
        defaultProvider: 'RenderTemplate2024',
      });

      const { documents }: { documents: IRenderDocument[] } = await renderer.renderCredential({
        credential,
      });

      const renderedTemplate: string[] = documents.map(({ renderedTemplate }) =>
        convertBase64ToString(renderedTemplate),
      );
      setDocuments(renderedTemplate);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to render credential template:', error);
      setIsLoading(false);
    }
  }, [credential]);

  useEffect(() => {
    renderCredential();
  }, [renderCredential]);

  return (
    <>
      {isLoading && <CircularProgress sx={{ margin: 'auto' }} data-testid='loading-indicator' />}
      <Box
        data-testid='rendered-template-container'
        sx={{
          overflowY: 'scroll',
          margin: '0 auto',
          width: '100%',
        }}
      >
        {documents.length !== 0
          ? documents.map((doc, i) => (
              <div
                className={SCOPE_CLASS}
                style={{
                  contain: 'content',
                  margin: '0 auto',
                  height: '100%',
                  minHeight: '100vh',
                  overflowY: 'scroll',
                  width: '100%',
                  textAlign: 'left',
                }}
                key={i}
                dangerouslySetInnerHTML={{ __html: scopeGlobalSelectors(doc) }}
                data-testid={'rendered-template'}
              />
            ))
          : ''}
      </Box>
    </>
  );
};

export default CredentialRender;
