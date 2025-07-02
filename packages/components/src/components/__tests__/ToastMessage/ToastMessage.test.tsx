import React from 'react';
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
    toastMessage({ status, message, linkURL });

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

  test('toast disappears after autoClose duration', async () => {
    jest.useFakeTimers();
    const message = 'Temporary toast';

    render(<ToastMessage />);
    toastMessage({ status: Status.warning, message, linkURL: '' });

    await waitFor(() => {
      expect(screen.getByText(message)).toBeInTheDocument();
    });

    jest.advanceTimersByTime(4000);

    await waitFor(() => {
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    });

    jest.useRealTimers();
  });
});
