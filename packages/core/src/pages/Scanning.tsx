import React, { useState, useRef } from 'react';
import { Box, CircularProgress, Stack } from '@mui/material';
import { Html5QrcodeResult } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';
import { toastMessage, Status } from '@mock-app/components';
import { Scanner } from '../components/Scanner';
import { IScannerRef } from '../types/scanner.types';
import { CustomDialog } from '../components/CustomDialog';
import { publicAPI } from '../utils';
import appConfig from '../constants/app-config.json';
import { MimeTypeEnum } from '../types/common.types';

const Scanning = () => {
  const scannerRef = useRef<IScannerRef | null>(null);
  const [scannedCode, setScannedCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [openDialogErrorCode, setOpenDialogErrorCode] = useState<boolean>(false);
  const navigate = useNavigate();

  const goVerifyPage = async (gtinCode: string) => {
    try {
      setIsLoading(true);

      const productList = await fetchProductList(gtinCode);
      if (!productList) {
        return toastMessage({ status: Status.error, message: 'There no product info' });
      }

      const { services } = appConfig.scanningApp;
      const [firstProduct] = productList;
      const serviceInfoUrl = firstProduct?.linkset?.[services.serviceInfo]?.[0]?.href;
      if (!serviceInfoUrl) {
        return toastMessage({ status: Status.error, message: 'There no service info url' });
      }

      const dlrUrl = `${serviceInfoUrl}/gtin/${gtinCode}?linkType=all`;
      const dlrData = await fetchDlrData(dlrUrl);
      if (!dlrData) {
        return toastMessage({ status: Status.error, message: 'There no DLR data' });
      }

      const dlrPassport = getDlrPassport(dlrData);
      if (!dlrPassport) {
        return toastMessage({ status: Status.error, message: 'There no DLR passport' });
      }

      const verifyDlrPassportUri = dlrPassport.href;
      redirectToVerifyPage(verifyDlrPassportUri);
    } catch (error) {
      console.log(error);
      toastMessage({ status: Status.error, message: 'Failed to verify code' });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProductList = async (code: string): Promise<any[] | null> => {
    const { providerVerifyUrl } = appConfig.scanningApp;
    const params = { keys: [code] };

    const products: any[] = await publicAPI.post(providerVerifyUrl, params);
    if (!products || !products.length) {
      return null;
    }

    return products;
  };

  /**
   * Fetching DRL data function
   * @param dlrUrl this url api to get DRL data
   */
  const fetchDlrData = async (dlrUrl: string): Promise<any | null> => {
    const dlrData = await publicAPI.get(dlrUrl);
    if (!dlrData) {
      return null;
    }

    return dlrData;
  };

  const getDlrPassport = (dlr: any): any | null => {
    const { services } = appConfig.scanningApp;

    const certificatePassports = dlr?.linkset?.find((linkSetItem: any) => linkSetItem[services.certificationInfo]);
    if (!certificatePassports) {
      return null;
    }

    const passportInfos = certificatePassports[services.certificationInfo];
    if (!passportInfos) {
      return null;
    }

    const dlrPassport = passportInfos.find((passportInfo: any) => passportInfo?.type === MimeTypeEnum.applicationJson);
    if (!dlrPassport) {
      return null;
    }

    return dlrPassport;
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
    const scannedCodeResult = getScannedCode(decodedText, result);
    setScannedCode(scannedCodeResult);
  };

  // This function is used for gs1 code
  const getScannedCode = (decodedText: string, result: Html5QrcodeResult) => {
    const formatName = result?.result?.format?.formatName;
    if (formatName === 'DATA_MATRIX') {
      return decodedText.slice(2, 16);
    }

    if (decodedText.length < 14) {
      return `0${decodedText}`;
    }

    return decodedText;
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
