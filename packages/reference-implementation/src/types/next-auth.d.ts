import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
    } & DefaultSession['user'];
    id_token?: string;
    group_claim?: string | null;
    error?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    group_claim?: string | null;
    error?: string;
  }
}
