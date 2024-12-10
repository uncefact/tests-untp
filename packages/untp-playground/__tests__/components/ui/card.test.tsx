// packages/untp-playground/src/components/ui/card.test.tsx
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

describe('Card component', () => {
  it('renders the Card component with default styles', () => {
    render(<Card>Card Content</Card>);
    const cardElement = screen.getByText(/card content/i);
    expect(cardElement).toBeInTheDocument();
    expect(cardElement).toHaveClass('rounded-lg border bg-card text-card-foreground shadow-sm');
  });

  it('renders the CardHeader component with default styles', () => {
    render(<CardHeader>Header Content</CardHeader>);
    const headerElement = screen.getByText(/header content/i);
    expect(headerElement).toBeInTheDocument();
    expect(headerElement).toHaveClass('flex flex-col space-y-1.5 p-6');
  });

  it('renders the CardTitle component with default styles', () => {
    render(<CardTitle>Title Content</CardTitle>);
    const titleElement = screen.getByText(/title content/i);
    expect(titleElement).toBeInTheDocument();
    expect(titleElement).toHaveClass('text-2xl font-semibold leading-none tracking-tight');
  });

  it('renders the CardDescription component with default styles', () => {
    render(<CardDescription>Description Content</CardDescription>);
    const descriptionElement = screen.getByText(/description content/i);
    expect(descriptionElement).toBeInTheDocument();
    expect(descriptionElement).toHaveClass('text-sm text-muted-foreground');
  });

  it('renders the CardContent component with default styles', () => {
    render(<CardContent>Content</CardContent>);
    const contentElement = screen.getByText(/content/i);
    expect(contentElement).toBeInTheDocument();
    expect(contentElement).toHaveClass('p-6 pt-0');
  });

  it('renders the CardFooter component with default styles', () => {
    render(<CardFooter>Footer Content</CardFooter>);
    const footerElement = screen.getByText(/footer content/i);
    expect(footerElement).toBeInTheDocument();
    expect(footerElement).toHaveClass('flex items-center p-6 pt-0');
  });

  it('forwards ref to the Card component', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Card ref={ref}>Ref Card</Card>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
