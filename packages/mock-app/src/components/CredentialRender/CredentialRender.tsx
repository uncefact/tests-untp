import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Renderer, WebRenderingTemplate2022 } from '@vckit/renderer';
import { VerifiableCredential } from '@vckit/core-types';
import { Box, CircularProgress } from '@mui/material';
import { convertBase64ToString } from '../../utils';

/**
 * CredentialRender component is used to render the credential
 */
const CredentialRender = ({ credential }: { credential: VerifiableCredential }) => {
  const [documents, setDocuments] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const boxRef = useRef(null);

  const onIframeLoad = (event: React.SyntheticEvent<HTMLIFrameElement>) => {
    const iframe = event.target as HTMLIFrameElement;
    if (iframe.contentWindow && iframe.contentWindow.document.body) {
      const iframeHeight = iframe.contentWindow.document.body.scrollHeight;

      iframe.style.height = `${iframeHeight}px`;
      if (boxRef.current) {
        (boxRef.current as HTMLElement).style.height = `${iframeHeight}px`;
      }
    }
  };

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
        ref={boxRef}
        data-testid='loading-indicator'
        sx={{
          overflowY: 'hidden',
          margin: '0 auto',
          width: '100%',
          height: '100%',
        }}
      >
        {documents.length !== 0
          ? documents.map((doc, i) => (
              <iframe
                key={i}
                srcDoc={doc}
                style={{
                  width: `${window.innerWidth}px`,
                  border: 'none',
                  position: 'absolute',
                  left: 0,
                }}
                title={`Document ${i}`}
                scrolling='no'
                onLoad={onIframeLoad}
              />
            ))
          : ''}
      </Box>
    </>
  );
};

export default CredentialRender;
