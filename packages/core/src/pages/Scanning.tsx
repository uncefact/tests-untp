import React, { useState, useRef } from 'react';
import { Box, CircularProgress, Stack } from '@mui/material';
import { Html5QrcodeResult } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';
import { toastMessage, Status } from '@mock-app/components';
import { getDlrUrl, getDlrPassport, getGtinCode } from '@mock-app/services';
import { Scanner } from '../components/Scanner';
import { IScannerRef } from '../types/scanner.types';
import { CustomDialog } from '../components/CustomDialog';
import appConfig from '../constants/app-config.json';
import { IdentifyProviderTypeEnum } from '../types/common.types';

const Scanning = () => {
  const scannerRef = useRef<IScannerRef | null>(null);
  const [scannedCode, setScannedCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [openDialogErrorCode, setOpenDialogErrorCode] = useState<boolean>(false);
  const navigate = useNavigate();

  const goVerifyPage = async (gtinCode: string) => {
    try {
      setIsLoading(true);

      const { url: identifyProviderUrl } = appConfig.identifyProvider;
      const dlrUrl: string | null = await getDlrUrl(gtinCode, identifyProviderUrl);
      if (!dlrUrl) {
        return toastMessage({ status: Status.error, message: 'There no DLR url' });
      }

      const dlrPassport = await getDlrPassport(dlrUrl);
      if (!dlrPassport) {
        return toastMessage({ status: Status.error, message: 'There no DLR passport' });
      }

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
    scannerRef.current?.closeQrCodeScanner();
  };

  React.useEffect(() => {
    if (!scannedCode) {
      return;
    }

    goVerifyPage(scannedCode);
  }, [scannedCode]);

  const onScanError = (error: unknown) => {
    toastMessage({ status: Status.error, message: 'Failed to scanning code' });
  };

  const onScanResult = (decodedText: string, result: Html5QrcodeResult) => {
    let scannedCodeResult = '';

    const formatName = result?.result?.format?.formatName;
    if (!formatName) {
      return toastMessage({ status: Status.error, message: 'Failed to scanning code' });
    }

    const { type: providerTypeConfig } = appConfig.identifyProvider;

    const providerSupports: string[] = [...new Set(Object.values(IdentifyProviderTypeEnum))];
    if (!providerSupports.includes(providerTypeConfig)) {
      return toastMessage({ status: Status.error, message: 'The configuration identity provider doesn\'t support' });
    }

    if (providerTypeConfig === IdentifyProviderTypeEnum.gs1) {
      scannedCodeResult = getGtinCode(decodedText, formatName);
    }

    setScannedCode(scannedCodeResult);
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
      {scannedCode && (
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
    </Box>
  );
};

export default Scanning;
