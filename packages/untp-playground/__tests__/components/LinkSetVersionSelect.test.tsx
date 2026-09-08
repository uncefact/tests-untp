import { LinkSetVersionSelect } from '@/components/LinkSetVersionSelect';
import { fireEvent, render, screen } from '@testing-library/react';

// Two synthetic options: production publishes one, and a change can only be observed with two.
jest.mock('../../constants', () => ({
  ...jest.requireActual('../../constants'),
  LINK_SET_SPEC_VERSIONS: ['0.7.0', '0.8.0'],
}));

// Radix Select relies on pointer-capture and scroll APIs jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

describe('LinkSetVersionSelect', () => {
  it('labels the selector, shows the current version and says what the selection applies to', () => {
    render(<LinkSetVersionSelect value='0.7.0' onChange={jest.fn()} />);
    expect(screen.getByLabelText('UNTP spec version for link sets')).toHaveTextContent('v0.7.0');
    expect(screen.getByTestId('linkset-version-select')).toHaveTextContent(
      'Applies to link sets you add next. To check an existing link set with another version, resolve or upload it again.',
    );
  });

  it('delivers the chosen version to onChange through the real control', () => {
    const onChange = jest.fn();
    render(<LinkSetVersionSelect value='0.7.0' onChange={onChange} />);
    const trigger = screen.getByLabelText('UNTP spec version for link sets');
    // jsdom has no pointer events, so drive the control the way a keyboard user does: ArrowDown
    // opens the list, Enter on an option selects it.
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const option = screen.getByRole('option', { name: 'v0.8.0' });
    fireEvent.keyDown(option, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('0.8.0');
  });
});
