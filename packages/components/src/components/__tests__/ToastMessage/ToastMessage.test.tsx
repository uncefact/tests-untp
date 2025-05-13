import React from 'react';
import { render, waitFor } from '@testing-library/react';

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
});
