import React, { useState } from 'react';
import _ from 'lodash';
import { Button } from '@mui/material';
import { publicAPI } from '@mock-app/services'
import { ScannerDialog } from './ScannerDialog.js';
import { Status, toastMessage } from '../ToastMessage/ToastMessage.js';

export interface IQRCodeScannerDialogButton {
  onScanQRResult: (result: any) => void;
}

export const QRCodeScannerDialogButton = ({ onScanQRResult }: IQRCodeScannerDialogButton) => {
  const [isOpenScanDialog, setIsOpenScanDialog] = useState(false);

  const fetchUrlScanQR = async (url: string) => {
    try {
      if (!new URL(url)) {
          toastMessage({ status: Status.error, message: 'Invalid URL' });
    }

    const result = await publicAPI.get(url);    
    onScanQRResult(result);
    } catch (error) {
      const e = error as Error;
      toastMessage({ status: Status.error, message: e.message });
    }
  };

  return (
    <>
      {isOpenScanDialog && (
        <ScannerDialog
          open={isOpenScanDialog}
          close={() => setIsOpenScanDialog(false)}
          onScanQRResult={fetchUrlScanQR}
        />
      )}

      <Button variant='outlined' onClick={() => setIsOpenScanDialog(true)} sx={{ marginRight: '1rem' }}>
        ScanQR
      </Button>
    </>
  );
};
