import { Html5QrcodeResult } from 'html5-qrcode';

export interface IScannerRef {
  closeQrCodeScanner: () => void;
}

export interface IHtml5QrcodePluginProps {
  fps?: number;
  qrbox?: { width: number; height: number };
  aspectRatio?: number;
  disableFlip?: boolean;
  qrCodeSuccessCallback: (decodedText: string, result: Html5QrcodeResult) => void;
  qrCodeErrorCallback?: (error: unknown) => void;
}

export enum FacingCameraEnum {
  Font = 'user',
  Back = 'environment',
}

export enum DeviceTypeEnum {
  Mobile = 'mobile',
  Laptop = 'laptop',
  Unknown = 'unknown',
}

export const enum ErrorText {
  required = 'is a required property',
}

export enum Status {
  success = 'success',
  error = 'error',
}

export interface IScannerRef {
  closeQrCodeScanner: () => void;
}
