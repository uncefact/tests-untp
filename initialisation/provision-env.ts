import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import {
  ProvisionConfigSchema,
  KeycloakRealmSchema,
  type ProvisionConfig,
  type KeycloakRealmRepresentation
} from './schemas.js'

function validateAndPrintConfig(config: ProvisionConfig) {
  console.log('🔍 Validating configuration...')

  if (!config.organisations || config.organisations.length === 0) {
    console.log('⚠️  No organisations defined - realm will be created without users')
    return
  }

  for (const org of config.organisations) {
    const ownerCount = org.users.filter(u => u.role === 'owner').length
    const adminCount = org.users.filter(u => u.role === 'admin').length
    console.log(`  ✓ ${org.name}: ${org.users.length} users (${ownerCount} owner${ownerCount !== 1 ? 's' : ''}, ${adminCount} admin${adminCount !== 1 ? 's' : ''})`)
  }

  console.log('✅ Configuration valid\n')
}

function generateKeycloakRealm(config: ProvisionConfig): KeycloakRealmRepresentation {
  console.log('🏗️  Generating Keycloak realm configuration...')

  // Derive realm name from ENVIRONMENT variable with KEYCLOAK_REALM override
  const environment = process.env.ENVIRONMENT || 'local'
  const realm = process.env.KEYCLOAK_REALM || `ri-${environment}`

  // Derive allowSignups based on environment (false for prod, true otherwise)
  const isProd = environment.toLowerCase().includes('prod')
  const allowSignups = !isProd

  // Derive sslRequired based on environment (all for prod, external otherwise)
  const sslRequired = isProd ? 'all' : 'external'

  // Derive password temporary flag (true for prod, false for dev/demo)
  const temporaryPasswords = isProd

  console.log(`  ✓ Environment: ${environment}`)
  console.log(`  ✓ Realm: ${realm}`)
  console.log(`  ✓ Self-signup: ${allowSignups ? 'enabled' : 'disabled'} (auto-configured)`)
  console.log(`  ✓ SSL Required: ${sslRequired} (auto-configured)`)
  console.log(`  ✓ Temporary passwords: ${temporaryPasswords ? 'yes' : 'no'} (auto-configured)`)

  // Collect all users from all organisations
  const allUsers = config.organisations?.flatMap(org =>
    org.users.map(user => ({
      username: user.email,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      enabled: true,
      emailVerified: true,
      credentials: [
        {
          type: "password",
          value: user.password,
          temporary: temporaryPasswords
        }
      ],
      requiredActions: temporaryPasswords ? ["UPDATE_PASSWORD"] : []
    }))
  ) || []

  console.log(`  ✓ Generated ${allUsers.length} user(s)`)

  const realmConfig: KeycloakRealmRepresentation = {
    realm,
    enabled: true,
    sslRequired: sslRequired as 'external' | 'all',
    registrationAllowed: allowSignups,
    verifyEmail: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: true,
    users: allUsers,
    clients: [
      {
        clientId: process.env.IDP_CLIENT_ID!,
        enabled: true,
        protocol: "openid-connect" as const,
        publicClient: false,
        secret: process.env.IDP_CLIENT_SECRET,
        redirectUris: [
          `${process.env.RI_APP_URL!}/api/auth/callback/keycloak`
        ],
        attributes: {
          "post.logout.redirect.uris": `${process.env.RI_APP_URL!}/signin`
        },
        webOrigins: [
          process.env.RI_APP_URL!
        ],
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: false,
        authorizationServicesEnabled: false,
        consentRequired: false,
        defaultClientScopes: ["profile", "email", "roles"],
      }
    ]
  }

  console.log(`  ✓ Client: ${process.env.IDP_CLIENT_ID}`)

  return realmConfig
}

async function main() {
  const configPath = process.argv[2]

  if (!configPath) {
    console.error('❌ Usage: tsx provision-env.ts <config-path>')
    console.error('   Example: tsx provision-env.ts ./config/local.json')
    process.exit(1)
  }

  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config file not found: ${configPath}`)
    process.exit(1)
  }

  // Validate required environment variables
  const requiredEnvVars = ['IDP_CLIENT_ID', 'IDP_CLIENT_SECRET', 'RI_APP_URL']
  const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName])

  if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:')
    missingEnvVars.forEach(varName => console.error(`  • ${varName}`))
    process.exit(1)
  }

  console.log('📝 Keycloak Realm Provisioning')
  console.log('═══════════════════════════════\n')
  console.log(`📖 Loading config: ${configPath}`)

  // Parse and validate config with Zod
  let config: ProvisionConfig
  try {
    const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    config = ProvisionConfigSchema.parse(rawConfig)
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Configuration validation failed:\n')
      error.issues.forEach((err) => {
        console.error(`  • ${err.path.join('.')}: ${err.message}`)
      })
    } else {
      console.error('❌ Failed to parse config file:', error instanceof Error ? error.message : error)
    }
    process.exit(1)
  }

  // Print config summary
  validateAndPrintConfig(config)

  // Derive realm name
  const environment = process.env.ENVIRONMENT || 'local'
  const realm = process.env.KEYCLOAK_REALM || `ri-${environment}`

  // Check if realm file already exists
  const realmDir = '/keycloak-realms'
  const realmPath = path.join(realmDir, `${realm}.json`)

  if (fs.existsSync(realmPath)) {
    console.log(`✅ Realm file '${realmPath}' already exists - skipping initialisation`)
    console.log('   Safe to docker compose down/up without re-initialisation\n')
    process.exit(0)
  }

  console.log(`  ✓ Realm file does not exist - proceeding with initialisation\n`)

  // Generate Keycloak realm export
  const realmExport = generateKeycloakRealm(config)

  // Validate the generated realm with Zod
  try {
    KeycloakRealmSchema.parse(realmExport)
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Generated realm validation failed:\n')
      error.issues.forEach((err) => {
        console.error(`  • ${err.path.join('.')}: ${err.message}`)
      })
    }
    process.exit(1)
  }

  // Ensure directory exists
  if (!fs.existsSync(realmDir)) {
    fs.mkdirSync(realmDir, { recursive: true })
    console.log(`📁 Created directory: ${realmDir}`)
  }

  // Write realm file
  fs.writeFileSync(realmPath, JSON.stringify(realmExport, null, 2))
  console.log(`✅ Realm export created: ${realmPath}\n`)

  console.log('✨ Provisioning complete!')
  console.log('   Keycloak will import realm on startup')
}

main().catch(err => {
  console.error('❌ Provisioning failed:', err)
  process.exit(1)
})
