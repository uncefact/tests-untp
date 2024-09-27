import React, { forwardRef, useImperativeHandle, useState, useCallback, useEffect, useMemo, memo, ForwardedRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import CameraswitchRoundedIcon from '@mui/icons-material/CameraswitchRounded';
import { Box } from '@mui/material';
import { detectDevice } from '../../utils';
import { DeviceTypeEnum, FacingCameraEnum, IHtml5QrcodePluginProps, IScannerRef } from '../../types/scanner.types';

/**
 * Scanner component is used scanner barcode.
 */
const Scanner = forwardRef((props: IHtml5QrcodePluginProps, ref: ForwardedRef<IScannerRef>) => {
  const [html5QrcodeScanner, setHtml5QrcodeScanner] = useState<Html5Qrcode | null>(null);
  const [configEnvCamera, setConfigEnvCamera] = useState<string>('');

  /**
   * Define config with props passed and default property.
   */
  const config = useMemo(() => ({
    fps: props.fps || 10,
    qrbox: props.qrbox || { width: 250, height: 150 },
    disableFlip: props.disableFlip || false,
    useBarCodeDetectorIfSupported: props.useBarCodeDetectorIfSupported || true,
    focusMode: props.focusMode || 'continuous'
  }), [props.fps, props.qrbox, props.disableFlip]);

  /**
   * create method with hook to use in parent with ref.
   */
  useImperativeHandle(ref, () => ({
    async closeQrCodeScanner() {
      await html5QrcodeScanner!.stop();
      html5QrcodeScanner!.clear();
    },
  }));

  /**
   * render scanner ui to scan barcode.
   */
  const startHtml5QrcodeScanner = useCallback(
    async (html5QrcodeScanner: Html5Qrcode, facingMode: string) => {
      html5QrcodeScanner.start({ facingMode }, config, props.qrCodeSuccessCallback, props.qrCodeErrorCallback);
    },
    [config, props.qrCodeSuccessCallback, props.qrCodeErrorCallback],
  );

  /**
   * get device type with user agent when render app.
   */
  const userAgentString = navigator.userAgent;
  const deviceType = detectDevice(userAgentString);

  useEffect(() => {
    // Create component scan
    const html5QrcodeScanner = new Html5Qrcode('barcodeReader');
    setHtml5QrcodeScanner(html5QrcodeScanner);

    let facingModeType = FacingCameraEnum.Back; // using back camera
    if (deviceType === DeviceTypeEnum.Laptop) {
      facingModeType = FacingCameraEnum.Font; // using front camera
    }

    setConfigEnvCamera(facingModeType);
    startHtml5QrcodeScanner(html5QrcodeScanner, facingModeType);

    const handleStop = async () => {
      if (html5QrcodeScanner.isScanning) {
        await html5QrcodeScanner.stop();
      }
    };

    return () => {
      handleStop();
    };
  }, []);

  // Handle switch camera.
  const handleSwitchCamera = async () => {
    if (html5QrcodeScanner) {
      await html5QrcodeScanner!.stop();
      html5QrcodeScanner!.clear();

      let facingModeType = configEnvCamera;
      if (facingModeType === FacingCameraEnum.Back) {
        facingModeType = FacingCameraEnum.Font;
      } else {
        facingModeType = FacingCameraEnum.Back;
      }

      setConfigEnvCamera(facingModeType);
      startHtml5QrcodeScanner(html5QrcodeScanner, facingModeType);
    }
  };

  return (
    <Box sx={{ position: 'relative' }}>
      <div id='barcodeReader' style={{ minWidth: '100%' }} />
      {deviceType === 'mobile' && (
        <CameraswitchRoundedIcon
          sx={{
            marginTop: '20px',
            display: 'block',
            fontSize: '2rem',
            position: 'absolute',
            top: '75%',
            color: 'white',
            left: '3%',
          }}
          onClick={handleSwitchCamera}
        />
      )}
    </Box>
  );
});

export default memo(Scanner);
