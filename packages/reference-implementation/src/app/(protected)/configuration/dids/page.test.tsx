import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

function MockTabs({ children, defaultValue }: { children: React.ReactNode; defaultValue?: string }) {
  const [activeTab, setActiveTab] = useState(defaultValue ?? '');
  return (
    <div data-testid='tabs' data-active-tab={activeTab}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(
            child as React.ReactElement<{ activeTab: string; setActiveTab: (v: string) => void }>,
            { activeTab, setActiveTab },
          );
        }
        return child;
      })}
    </div>
  );
}

function MockTabsList({
  children,
  activeTab,
  setActiveTab,
  ...rest
}: {
  children: React.ReactNode;
  activeTab?: string;
  setActiveTab?: (v: string) => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div role='tablist' {...rest}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(
            child as React.ReactElement<{ activeTab: string; setActiveTab: (v: string) => void }>,
            { activeTab, setActiveTab },
          );
        }
        return child;
      })}
    </div>
  );
}

function MockTabsTrigger({
  children,
  value,
  activeTab,
  setActiveTab,
  ...rest
}: { children: React.ReactNode; value: string; activeTab?: string; setActiveTab?: (v: string) => void } & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'value'
>) {
  return (
    <button
      role='tab'
      data-state={activeTab === value ? 'active' : 'inactive'}
      onClick={() => setActiveTab?.(value)}
      {...rest}
    >
      {children}
    </button>
  );
}

function MockTabsContent({
  children,
  value,
  activeTab,
  ...rest
}: { children: React.ReactNode; value: string; activeTab?: string } & React.HTMLAttributes<HTMLDivElement>) {
  if (activeTab !== value) return null;
  return <div {...rest}>{children}</div>;
}

jest.mock('@reference-implementation/components', () => ({
  Tabs: MockTabs,
  TabsList: MockTabsList,
  TabsTrigger: MockTabsTrigger,
  TabsContent: MockTabsContent,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: DidsPage } = require('./page');

describe('DidsPage', () => {
  it('renders the page title', () => {
    render(<DidsPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('DIDs (Decentralised Identifiers)');
  });

  it('renders both tab triggers', () => {
    render(<DidsPage />);

    expect(screen.getByRole('tab', { name: 'Managed' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Self hosted' })).toBeInTheDocument();
  });

  it('has the Managed tab active by default', () => {
    render(<DidsPage />);

    expect(screen.getByRole('tab', { name: 'Managed' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: 'Self hosted' })).toHaveAttribute('data-state', 'inactive');
  });

  it('switches active tab when clicking Self hosted', async () => {
    const user = userEvent.setup();
    render(<DidsPage />);

    await user.click(screen.getByRole('tab', { name: 'Self hosted' }));

    expect(screen.getByRole('tab', { name: 'Self hosted' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: 'Managed' })).toHaveAttribute('data-state', 'inactive');
  });

  it('renders managed tab content panel by default', () => {
    render(<DidsPage />);

    expect(screen.getByTestId('managed-tab-content')).toBeInTheDocument();
  });

  it('renders self-hosted tab content panel and hides managed panel when selected', async () => {
    const user = userEvent.setup();
    render(<DidsPage />);

    await user.click(screen.getByRole('tab', { name: 'Self hosted' }));

    expect(screen.getByTestId('self-hosted-tab-content')).toBeInTheDocument();
    expect(screen.queryByTestId('managed-tab-content')).not.toBeInTheDocument();
  });
});
