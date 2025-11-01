import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { Html5Qrcode } from 'html5-qrcode';

import { Scanner } from '../components/Scanner';
import * as helper from '../utils/helpers';
import { IScannerRef } from '../types/scanner.types';

// Mock the Html5Qrcode module and its methods
jest.mock('html5-qrcode', () => {
  let shouldSucceed = true;
  return {
    Html5Qrcode: class MockHtml5Qrcode {
      constructor() {}

      start(
        deviceId: { facingMode: string },
        successCallback: (decodedText: string) => void
      ) {
        successCallback('Mocked QR Code Data');
        return Promise.resolve(null);
      }

      stop() {}

      clear() {}

      static toggleSuccess() {
        shouldSucceed = !shouldSucceed;
      }

      isScanning = true;
    },
  };
});

describe('Scanner', () => {
  beforeEach(() => {});

  /**
   * mock prototype of Html5Qrcode and return mock function.
   */
  const mockHtml5QrcodeFn = () => {
    const mockStop = jest.fn();
    const mockClear = jest.fn();
    const mockStart = jest.fn(() => Promise.resolve(null));
    jest.spyOn(Html5Qrcode.prototype, 'stop').mockImplementation(mockStop);
    jest.spyOn(Html5Qrcode.prototype, 'clear').mockImplementation(mockClear);
    jest.spyOn(Html5Qrcode.prototype, 'start').mockImplementation(mockStart);

    return {
      mockStop,
      mockClear,
      mockStart,
    };
  };

  test('should stop camera before switch camera on mobile', async () => {
    const detectMock = jest.spyOn(helper, 'detectDevice');
    detectMock.mockImplementation(() => 'mobile');

    const { mockStop } = mockHtml5QrcodeFn();
    render(<Scanner qrCodeSuccessCallback={() => {}} />);
    const cameraSwitch = screen.getByTestId('CameraswitchRoundedIcon');
    fireEvent.click(cameraSwitch);
    fireEvent.click(cameraSwitch);

    await waitFor(() => {
      expect(mockStop).toHaveBeenCalledTimes(2);
    });
  });

  test('should stop camera when component unmount', () => {
    mockHtml5QrcodeFn();
    const { unmount } = render(<Scanner qrCodeSuccessCallback={() => {}} />);
    unmount();
    expect(Html5Qrcode.prototype.stop).toHaveBeenCalled();
  });

  test('handles successful scan', async () => {
    let result: string | null = null;
    const mockFn = jest
      .fn()
      .mockImplementation((cb) => cb('Mocked QR Code Data'));
    render(
      <Scanner
        qrCodeSuccessCallback={mockFn((cb: string) => (result = cb))}
      />
    );

    expect(result).toBe('Mocked QR Code Data');
  });

  test('handle laptop switch button', () => {
    const detectMock = jest.spyOn(helper, 'detectDevice');
    detectMock.mockImplementation(() => 'laptop');
    mockHtml5QrcodeFn();

    const { queryByTestId } = render(
      <Scanner qrCodeSuccessCallback={() => {}} />
    );
    const cameraSwitch = queryByTestId('switch-camera-button');
    expect(cameraSwitch).toBeNull();
  });

  test('handles scan failure', async () => {
    let errorResult: unknown = null;
    const mockFn = jest.fn().mockImplementation((cb) => {
      cb('Permission Denied');
    });

    render(
      <Scanner
        qrCodeErrorCallback={mockFn((cb: string) => (errorResult = cb))}
        qrCodeSuccessCallback={() => {}}
      />
    );

    expect(errorResult).toBe('Permission Denied');
  });
});
