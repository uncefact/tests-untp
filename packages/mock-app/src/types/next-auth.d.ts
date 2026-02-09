import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
    } & DefaultSession['user'];
    id_token?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id_token?: string;
  }
}
