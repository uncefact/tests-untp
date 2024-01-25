import React from 'react';
import { render, screen } from '@testing-library/react';

import { Layout } from '../../..';

describe('Layout', () => {
  test('should render Layout component', () => {
    const mainLayoutText = 'Main layout';

    render(<Layout>{mainLayoutText}</Layout>);
    expect(screen.getByText(mainLayoutText)).toBeInTheDocument();
  });
});
