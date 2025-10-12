import React, { useEffect } from 'react';
import { IScannerRef } from '../../types/scanner.types.js';
import CustomDialog from '../CustomDialog/CustomDialog.js';
import Scanner from '../Scanner/Scanner.js';

interface IScannerDialog {
  open: boolean;
  close: () => void;
  onScanQRResult: (decodedText: string) => void;
}

/**
 * DialogScanQrENVD component is used to render the dialog component to scan QR code
 */
export const ScannerDialog = ({ open, close, onScanQRResult }: IScannerDialog) => {
  const scannerRef = React.useRef<IScannerRef | null>(null);

  useEffect(() => {
    if (!open) {
      scannerRef!.current!.closeQrCodeScanner(); // Call the closeQrCodeScanner function
    }
  }, [open]);

  /**
   * handle scan barcode success
   */
  const onScanResult = (decodedText: string) => {
    onScanQRResult(decodedText);
  };

  /**
   * dialogContent is used to render the content of dialog component
   */
  const dialogContent = {
    content: (
      <>
        <Scanner
          ref={scannerRef}
          fps={10}
          disableFlip={false}
          qrCodeSuccessCallback={onScanResult}
          qrCodeErrorCallback={() => {}}
        />
      </>
    ),
  };

  /**
   * dialogStyle is used to render the style of dialog component
   */
  const dialogStyle = {
    content: {
      width: '500px',
      maxWidth: '100%',
      padding: '0px',
    },
  };

  return (
    <CustomDialog open={open} onClose={close} title='Scan QR' content={dialogContent?.content} style={dialogStyle} />
  );
};
