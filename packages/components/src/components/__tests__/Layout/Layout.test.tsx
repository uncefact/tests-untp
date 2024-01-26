import React from 'react';
import { render, screen } from '@testing-library/react';

import { FallbackErrorContent, Layout, LayoutStatus, MessageText } from '../../..';

describe('Layout', () => {
  test('should render Layout component with children', () => {
    const mainLayoutText = 'Main layout';

    // Render the Layout component with the specified children
    render(<Layout>{mainLayoutText}</Layout>);

    // Expect that the specified text is present in the rendered content
    expect(screen.getByText(mainLayoutText)).toBeInTheDocument();
  });

  test('should render FallbackErrorContent component', () => {
    const errorMessage = 'Error message';

    // Render the FallbackErrorContent component with the specified error message
    render(<FallbackErrorContent errorMessage={errorMessage} />);

    // Expect that the specified error message is present in the rendered content
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  test('should render MessageText component with success status', () => {
    const successMessage = 'Operation successful';

    // Render the MessageText component with success status and specified text
    render(<MessageText status={LayoutStatus.success} text={successMessage} />);

    // Expect that the specified success message is present in the rendered content
    expect(screen.getByText(successMessage)).toBeInTheDocument();
  });

  test('should render MessageText component with error status', () => {
    const errorMessage = 'Error occurred';

    // Render the MessageText component with error status and specified text
    render(<MessageText status={LayoutStatus.error} text={errorMessage} />);

    // Expect that the specified error message is present in the rendered content
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  test('should render FallbackErrorContent inside ErrorBoundary for error scenario', () => {
    // Mock console.error to prevent error messages from being printed during the test
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Mock an error scenario by throwing an error inside ErrorBoundary
    const ErrorThrowingComponent = () => {
      throw new Error('Simulated error');
    };

    // Render the Layout component with an error-throwing child
    render(
      <Layout>
        <ErrorThrowingComponent />
      </Layout>
    );

    // Expect that the FallbackErrorContent component is rendered for error scenario
    expect(screen.getByText('Something went wrong! Please retry again')).toBeInTheDocument();

    // Restore the original console.error function
    consoleErrorSpy.mockRestore();
  });
});
