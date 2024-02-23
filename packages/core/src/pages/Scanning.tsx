import React, { useState, useRef } from 'react';
import { Box, CircularProgress, Stack } from '@mui/material';
import { VerifiableCredential } from '@vckit/core-types';
import { Html5QrcodeResult } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';
import { toastMessage, Status, ToastMessage } from '@mock-app/components';
import { getDlrPassport, Provider, getProviderByType } from '@mock-app/services';
import { Scanner } from '../components/Scanner';
import { IScannerRef } from '../types/scanner.types';
import appConfig from '../constants/app-config.json';
import { CustomDialog } from '../components/CustomDialog';

const Scanning = () => {
  const scannerRef = useRef<IScannerRef | null>(null);
  const [identityProvider, setIdentityProvider] = useState<Provider | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [openDialogErrorCode, setOpenDialogErrorCode] = useState<boolean>(false);
  const navigate = useNavigate();

  const goVerifyPage = async (identityProvider: Provider) => {
    try {
      setIsLoading(true);

      const dlrUrl = await identityProvider.getDlrUrl();
      if (!dlrUrl) {
        return toastMessage({ status: Status.error, message: 'There no DLR url' });
      }

      const dlrPassport = await getDlrPassport<VerifiableCredential>(dlrUrl);
      if (!dlrPassport) {
        return toastMessage({ status: Status.error, message: 'There no DLR passport' });
      }

      scannerRef.current?.closeQrCodeScanner();
      redirectToVerifyPage(dlrPassport.href);
    } catch (error) {
      console.log(error);
      toastMessage({ status: Status.error, message: 'Failed to verify code' });
    } finally {
      setIsLoading(false);
    }
  };

  const redirectToVerifyPage = (verifyDlrPassportUri: string) => {
    const queryPayload = JSON.stringify({ payload: { uri: verifyDlrPassportUri } });
    const queryString = `q=${encodeURIComponent(queryPayload)}`;

    navigate(`/verify?${queryString}`);
  };

  React.useEffect(() => {
    if (!identityProvider) {
      return;
    }

    goVerifyPage(identityProvider);
  }, [identityProvider]);

  const onScanError = (error: unknown) => {
    setIdentityProvider(null);
  };

  const onScanResult = (decodedText: string, result: Html5QrcodeResult) => {
    const formatName = result?.result?.format?.formatName;
    if (!formatName) {
      return toastMessage({ status: Status.error, message: 'Failed to scanning code' });
    }

    const { type: providerType, url: providerUrl } = appConfig.identifyProvider;
    const providerInstance = getProviderByType(providerType, providerUrl);
    const provider = new Provider(providerInstance);
    if (!provider.isProviderSupported()) {
      return toastMessage({ status: Status.error, message: 'The configuration identity provider doesn\'t support' });
    }

    const scannedCodeResult = providerInstance.getCode(decodedText, formatName);
    providerInstance.setCode(scannedCodeResult);
    setIdentityProvider(provider);
  };

  // Handle close dialog when code not found
  const handleCloseDialogErrorFetchProductData = () => {
    setOpenDialogErrorCode(false);
  };

  return (
    <Box
      sx={{
        maxHeight: '500px',
        maxWidth: '500px',
        margin: 'auto',
        textAlign: 'center',
      }}
    >
      <Scanner
        ref={scannerRef}
        fps={10}
        qrbox={{ width: 250, height: 150 }}
        disableFlip={false}
        qrCodeSuccessCallback={onScanResult}
        qrCodeErrorCallback={onScanError}
      />
      {identityProvider && (
        <>
          {isLoading && (
            <Stack>
              <CircularProgress sx={{ margin: 'auto', marginTop: '20px' }} size={24} />
            </Stack>
          )}
        </>
      )}

      {openDialogErrorCode && (
        <CustomDialog
          title='Something went wrong. Please try again.'
          open={openDialogErrorCode}
          onClose={handleCloseDialogErrorFetchProductData}
        />
      )}
      <ToastMessage />
    </Box>
  );
};

export default Scanning;
