import React, { useCallback, useEffect, useState } from 'react';
import { Renderer, WebRenderingTemplate2022 } from '@vckit/renderer';
import { UnsignedCredential, VerifiableCredential } from '@vckit/core-types';
import { Box, CircularProgress } from '@mui/material';
import { convertBase64ToString } from '../../utils';

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
      const renderer = new Renderer({
        providers: {
          WebRenderingTemplate2022: new WebRenderingTemplate2022(),
        },
        defaultProvider: 'WebRenderingTemplate2022',
      });

      let { documents }: { documents: string[] } = await renderer.renderCredential({
        credential,
      });
      documents = documents.map((doc) => convertBase64ToString(doc));
      setDocuments(documents);
      setIsLoading(false);
    } catch (error) {
      console.log(error);
      setIsLoading(false);
    }
  }, [credential]);

  useEffect(() => {
    renderCredential();
  }, [renderCredential]);

  return (
    <>
      {isLoading && <CircularProgress sx={{ margin: 'auto' }} />}
      <Box
        data-testid='loading-indicator'
        sx={{
          overflowY: 'scroll',
          margin: '0 auto',
          width: '100%',
        }}
      >
        {documents.length !== 0
          ? documents.map((doc, i) => (
              <>
                <div
                  style={{
                    contain: 'content', // isolate the content
                    margin: '0 auto',
                    height: '100%',
                    minHeight: '100vh',
                    overflowY: 'scroll',
                    width: '100%',
                    textAlign: 'left',
                  }}
                  key={i}
                  dangerouslySetInnerHTML={{ __html: doc }}
                ></div>
              </>
            ))
          : ''}
      </Box>
    </>
  );
};

export default CredentialRender;
