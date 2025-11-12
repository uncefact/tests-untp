import React, { act } from 'react';
import { render, waitFor, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { ToastMessage, toastMessage, Status } from '../../../components/ToastMessage/ToastMessage';

describe('Toast Message', () => {
  test('renders ToastMessage component and triggers toast', async () => {
    const status = Status.success;
    const message = 'Test message';
    const linkURL = '';

    // Render the component
    render(<ToastMessage />);

    // Call the toastMessage function
    act(() => {
      toastMessage({ status, message, linkURL });
    });

    // Check that the toast message is correctly.
    await waitFor(() => {
      expect(document.body).toHaveTextContent(message);
    });
  });

  test('renders ToastMessage with a link when linkURL is provided', async () => {
    const status = Status.info;
    const message = 'Linked toast';
    const linkURL = 'https://example.com/vc/456';

    render(<ToastMessage />);

    toastMessage({ status, message, linkURL });

    await waitFor(() => {
      expect(screen.getByText(message)).toBeInTheDocument();
    });

    const link = screen.getByText('Open VC');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', linkURL);
    expect(link).toHaveAttribute('target', '_blank');
  });

  test('does not render link when linkURL is not provided', async () => {
    const status = Status.info;
    const message = 'No link toast';
  
    render(<ToastMessage />);
    toastMessage({ status, message });
  
    await waitFor(() => {
      expect(screen.getByText(message)).toBeInTheDocument();
    });
  
    // Ensure "Open VC" link is not present
    expect(screen.queryByText('Open VC')).not.toBeInTheDocument();
  });

  test('toast disappears after autoClose duration', async () => {
    const message = 'Temporary toast';
    const linkURL = 'https://example.com/vc/456';
  
    render(<ToastMessage />);
    toastMessage({ status: Status.warning, message, linkURL });
  
    // Confirm it appears
    await waitFor(() => {
      expect(screen.getByText(message)).toBeInTheDocument();
    });
  
    // Wait for disappearance (default is 4000ms + some buffer for animation)
    await waitFor(
      () => {
        expect(screen.queryByText(message)).not.toBeInTheDocument();
      },
      { timeout: 6000 } // give enough time for toast to auto-close and disappear
    );
  });
});
