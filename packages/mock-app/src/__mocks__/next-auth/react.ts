export const useSession = jest.fn();
export const signOut = jest.fn();
export const signIn = jest.fn();
export const getCsrfToken = jest.fn();
export const getProviders = jest.fn();
export const SessionProvider = ({ children }: { children: React.ReactNode }) => children;
