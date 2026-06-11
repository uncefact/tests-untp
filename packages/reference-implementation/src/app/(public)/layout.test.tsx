import { render, screen } from '@testing-library/react';
import PublicLayout from './layout';

// Mocked with a root test id so the absence assertion trips if the layout
// renders the Header again (the real Header has no test id on its root). See #715.
jest.mock('@/components/Header/Header', () => ({
  __esModule: true,
  default: () => <div data-testid='header' />,
}));

jest.mock('@reference-implementation/components', () => ({
  Footer: () => <div data-testid='footer' />,
}));

describe('PublicLayout', () => {
  it('renders children without the header', () => {
    render(
      <PublicLayout>
        <div data-testid='content'>Content</div>
      </PublicLayout>,
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.queryByTestId('header')).toBeNull();
  });

  it('renders the footer', () => {
    render(
      <PublicLayout>
        <div>Content</div>
      </PublicLayout>,
    );

    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });
});
