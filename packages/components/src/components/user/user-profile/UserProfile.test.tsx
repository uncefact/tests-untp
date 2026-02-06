import { render, screen } from '@testing-library/react';
import { UserProfile } from './UserProfile';
import { UserRole, type User } from '@/types';

const mockUser: User = {
  name: 'John Doe',
  email: 'john@example.com',
  roles: [UserRole.User],
};

describe('UserProfile', () => {
  it('renders name and email', () => {
    render(<UserProfile user={mockUser} />);

    expect(screen.getByTestId('user-profile-name')).toHaveTextContent('John Doe');
    expect(screen.getByTestId('user-profile-email')).toHaveTextContent('john@example.com');
  });

  it('truncates long names', () => {
    render(
      <UserProfile
        user={{
          name: 'Dr. Christopher Alexander Montgomery Wellington III',
          email: 'short@example.com',
          roles: [UserRole.User],
        }}
      />,
    );

    const nameElement = screen.getByTestId('user-profile-name');
    expect(nameElement).toHaveClass('truncate');
  });

  it('truncates long emails', () => {
    render(
      <UserProfile
        user={{
          name: 'Jane Doe',
          email: 'very.long.email.address@corporate-company-domain.com',
          roles: [UserRole.User],
        }}
      />,
    );

    const emailElement = screen.getByTestId('user-profile-email');
    expect(emailElement).toHaveClass('truncate');
  });

  it('renders with custom className', () => {
    render(<UserProfile user={mockUser} className='custom-class' />);

    const profile = screen.getByTestId('user-profile');
    expect(profile).toHaveClass('custom-class');
  });
});
