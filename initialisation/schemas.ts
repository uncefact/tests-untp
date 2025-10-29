import { z } from 'zod'

// SSL requirement options
export const SslRequiredSchema = z.enum(['none', 'external', 'all'])

// User configuration
export const UserSchema = z.object({
  email: z.string().email('Invalid email format'),
  firstName: z.string().min(1, 'First name cannot be empty'),
  lastName: z.string().min(1, 'Last name cannot be empty'),
  role: z.enum(['owner', 'admin', 'user']),
  password: z.string().min(6, 'Password must be at least 6 characters')
})

// Organisation configuration
export const OrganisationSchema = z.object({
  name: z.string().min(1, 'Organisation name cannot be empty'),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Primary color must be a valid hex color'),
  logo: z.string().nullable().optional(),
  users: z.array(UserSchema).min(1, 'Organisation must have at least one user')
}).refine(
  (org) => org.users.some(u => u.role === 'owner'),
  { message: 'Organisation must have at least one owner user' }
)

// Complete provision configuration
export const ProvisionConfigSchema = z.object({
  organisations: z.array(OrganisationSchema).optional()
})

// Keycloak user representation
export const KeycloakUserSchema = z.object({
  username: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  enabled: z.boolean(),
  emailVerified: z.boolean(),
  credentials: z.array(z.object({
    type: z.string(),
    value: z.string(),
    temporary: z.boolean()
  })),
  requiredActions: z.array(z.string())
})

// Keycloak client configuration
export const KeycloakClientSchema = z.object({
  clientId: z.string(),
  enabled: z.boolean(),
  protocol: z.literal('openid-connect'),
  publicClient: z.boolean(),
  secret: z.string().optional(),
  redirectUris: z.array(z.string().url()),
  webOrigins: z.array(z.string()),
  attributes: z.record(z.string(), z.string()).optional(),
  standardFlowEnabled: z.boolean(),
  directAccessGrantsEnabled: z.boolean(),
  serviceAccountsEnabled: z.boolean(),
  authorizationServicesEnabled: z.boolean(),
  consentRequired: z.boolean().optional(),
  fullScopeAllowed: z.boolean().optional(),
  alwaysDisplayInConsole: z.boolean().optional(),
  frontchannelLogout: z.boolean().optional(),
  defaultClientScopes: z.array(z.string()).optional()
})

// Keycloak realm representation

export const KeycloakRealmSchema = z.object({
  realm: z.string(),
  enabled: z.boolean(),
  sslRequired: SslRequiredSchema,
  registrationAllowed: z.boolean(),
  verifyEmail: z.boolean(),
  loginWithEmailAllowed: z.boolean(),
  duplicateEmailsAllowed: z.boolean(),
  resetPasswordAllowed: z.boolean(),
  users: z.array(KeycloakUserSchema),
  clients: z.array(KeycloakClientSchema)
})

// Type inference from Zod schemas
export type ProvisionConfig = z.infer<typeof ProvisionConfigSchema>
export type KeycloakRealmRepresentation = z.infer<typeof KeycloakRealmSchema>
