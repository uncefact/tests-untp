import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { Footer } from './Footer';

describe('Footer', () => {
  test('should render Footer component', () => {
    const currentYear = new Date().getFullYear();
    const footerText = `Copyright © ${currentYear}`;

    render(<Footer />);
    expect(screen.getByText(footerText)).toBeInTheDocument();
  });
});
