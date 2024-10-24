import React, { useState } from 'react';
import { Button } from '@mui/material';
import { CredentialPayload } from '@vckit/core-types';
import { publicAPI } from '@mock-app/services';
import { ScannerDialog } from './ScannerDialog.js';
import { Status, ToastMessage, toastMessage } from '../ToastMessage/ToastMessage.js';
import { ImportDataType } from '../../types/common.types.js';
import { processVerifiableCredentialData } from '../../utils/importDataHelpers.js';

export interface IQRCodeScannerDialogButton {
  onChange: (data: { [k: string]: CredentialPayload }) => void;
  style?: React.CSSProperties;
  type?: ImportDataType;
  vcOptions?: {
    credentialPath: string;
  };
}

export const QRCodeScannerDialogButton = ({
  onChange,
  style,
  type = ImportDataType.VerifiableCredential,
  vcOptions,
}: IQRCodeScannerDialogButton) => {
  const [isOpenScanDialog, setIsOpenScanDialog] = useState(false);

  const getQRCodeDataFromUrl = async (url: string) => {
    try {
      // Attempt to check url params is valid URL , if it fails, it will throw an error
      new URL(url);

      const credential = await publicAPI.get(url);
      if (type === ImportDataType.VerifiableCredential) {
        const processedData = await processVerifiableCredentialData(credential, vcOptions?.credentialPath);
        onChange({ [url]: processedData });
      } else {
        onChange({ [url]: credential });
      }
    } catch (error) {
      const e = error as Error;
      toastMessage({ status: Status.error, message: e.message });
    } finally {
      setIsOpenScanDialog(false);
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
