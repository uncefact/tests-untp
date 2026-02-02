export async function register() {
  // Validate required environment variables at server startup
  const requiredEnvVars = [
    'RI_POSTGRES_USER',
    'RI_POSTGRES_PASSWORD',
    'RI_POSTGRES_DB',
    'RI_POSTGRES_HOST',
    'RI_POSTGRES_PORT',
    'AUTH_KEYCLOAK_ISSUER',
    'RI_APP_URL',
    'DEFAULT_HUMAN_VERIFICATION_URL',
    'DEFAULT_MACHINE_VERIFICATION_URL',
  ];

  const missingVars = requiredEnvVars.filter((key) => !process.env[key]);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}`
    );
  }

  // Construct and set the database URL
  const {
    RI_POSTGRES_USER,
    RI_POSTGRES_PASSWORD,
    RI_POSTGRES_DB,
    RI_POSTGRES_HOST,
    RI_POSTGRES_PORT,
    AUTH_KEYCLOAK_ISSUER,
    RI_APP_URL,
    DEFAULT_HUMAN_VERIFICATION_URL,
    DEFAULT_MACHINE_VERIFICATION_URL,
  } = process.env;

  process.env.RI_DATABASE_URL = `postgresql://${RI_POSTGRES_USER}:${RI_POSTGRES_PASSWORD}@${RI_POSTGRES_HOST}:${RI_POSTGRES_PORT}/${RI_POSTGRES_DB}?schema=public`;

  // Map environment variables for runtime access (previously done at build time in next.config.ts)
  process.env.NEXT_PUBLIC_AUTH_KEYCLOAK_ISSUER = AUTH_KEYCLOAK_ISSUER;
  process.env.NEXT_PUBLIC_NEXTAUTH_URL = RI_APP_URL;
  process.env.NEXT_DEFAULT_HUMAN_VERIFICATION_URL = DEFAULT_HUMAN_VERIFICATION_URL;
  process.env.NEXT_DEFAULT_MACHINE_VERIFICATION_URL = DEFAULT_MACHINE_VERIFICATION_URL;
}
