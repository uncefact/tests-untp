import { SourceCaption } from '@/components/SourceCaption';
import { render, screen } from '@testing-library/react';

describe('SourceCaption', () => {
  it('shows a filename, a URL as a link, and the link set a credential was verified from (#814)', () => {
    const { rerender } = render(<SourceCaption source={{ kind: 'file', filename: 'dpp.json' }} />);
    expect(screen.getByText('Source: dpp.json')).toBeInTheDocument();
    expect(screen.queryByTestId('source-link-set')).not.toBeInTheDocument();

    rerender(<SourceCaption source={{ kind: 'url', url: 'https://c.example.org/dpp.json' }} />);
    expect(screen.getByRole('link', { name: 'https://c.example.org/dpp.json' })).toHaveAttribute(
      'href',
      'https://c.example.org/dpp.json',
    );
    expect(screen.queryByTestId('source-link-set')).not.toBeInTheDocument();

    rerender(
      <SourceCaption
        source={{
          kind: 'url',
          url: 'https://c.example.org/dpp.json',
          via: 'link-set',
          linkSet: 'https://r.example.org/01/1?linkType=all',
        }}
      />,
    );
    expect(screen.getByTestId('source-link-set')).toHaveTextContent(
      'from link set https://r.example.org/01/1?linkType=all',
    );

    rerender(<SourceCaption source={{ kind: 'file', filename: 'enc.json', via: 'link-set', linkSet: 'links.json' }} />);
    expect(screen.getByText(/Source: enc\.json/)).toBeInTheDocument();
    expect(screen.getByTestId('source-link-set')).toHaveTextContent('from link set links.json');
  });
});
