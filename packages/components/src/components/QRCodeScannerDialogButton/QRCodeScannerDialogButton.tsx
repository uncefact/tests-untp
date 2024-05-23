import React, { useState } from 'react';
import { Button } from '@mui/material';
import { publicAPI } from '@mock-app/services'
import { ScannerDialog } from './ScannerDialog.js';
import { Status, ToastMessage, toastMessage } from '../ToastMessage/ToastMessage.js';

export interface IQRCodeScannerDialogButton {
  fetchDataFromScanQR: (result: any) => Promise<void>;
  style?: React.CSSProperties;
}

export const QRCodeScannerDialogButton = ({ fetchDataFromScanQR, style}: IQRCodeScannerDialogButton) => {
  const [isOpenScanDialog, setIsOpenScanDialog] = useState(false);

  const getQRCodeDataFromUrl = async (url: string) => {    
   
  try {
    // Attempt to check url params is valid URL , if it fails, it will throw an error
    new URL(url)

    const result = await publicAPI.get(url);            
    await fetchDataFromScanQR(result);
  } catch (error) {      
    const e = error as Error;
    toastMessage({ status: Status.error, message: e.message });
  }
  };

  return (
    <main style={style}>
      {isOpenScanDialog && (
        <ScannerDialog
          open={isOpenScanDialog}
          close={() => setIsOpenScanDialog(false)}
          onScanQRResult={getQRCodeDataFromUrl}
        />
      )}

      <Button variant='outlined' onClick={() => setIsOpenScanDialog(true)} sx={{ marginRight: '1rem' }}>
        ScanQR
      </Button>

      <ToastMessage />
    </main>
  );
};
