# Initialisation Service

This directory contains the initialisation service for the Reference Implementation (RI), including Keycloak realm provisioning and database setup.

## Structure

```
initialisation/
├── Dockerfile           # Container image for initialisation service
├── package.json         # Node.js dependencies
├── tsconfig.json        # TypeScript configuration
├── config.json          # Organisations and users configuration
├── provision-env.ts     # Keycloak realm provisioning script
├── schemas.ts           # Zod validation schemas
└── scripts/             # Shell scripts
    └── init.sh         # Main initialisation script
```

## How It Works

1. **Idempotent Initialisation**: The init service checks if the Keycloak realm file already exists before generating it. This makes it safe to run `docker compose down` and `docker compose up` without re-initialising Keycloak.

2. **Keycloak Realm Provisioning**:
   - Reads configuration from `config.json`
   - Generates a Keycloak realm export file in `/keycloak-realms/`
   - Includes users with first name, last name, email, and passwords 
   - Configures OAuth2 client with appropriate redirect URIs

3. **Database Seeding** (TODO):
   - Future: Will seed the PostgreSQL database with initial application data
   - Should be idempotent (safe to run multiple times)

## Deployment Paths

The initialisation system supports two distinct deployment paths, automatically configured based on the `ENVIRONMENT` variable:

### 1. Demo & Development Path (non-production environments)

This path is designed for demonstration environments and local development where self-service access is desired:

- **Open Registration**: Users can sign up themselves via Keycloak
- **Self-Service**: Users create their own accounts and follow the onboarding flow
- **Use Cases**: Public demos, development environments, sandbox instances

Example: Set `ENVIRONMENT=local` (signups automatically enabled)

### 2. Controlled Access Path (production environments)

This path is tailored for controlled pilot programmes where participants need to share private data:

- **Closed Registration**: Signups are blocked; only pre-configured users can access the system
- **Pre-Configured Organisations**: Users and organisations are initialised during provisioning
- **Curated Access**: Ensures all participants are known and authorised
- **Controlled Membership**: Additional members can be added by organisation owners or admins (TODO) via the RI
- **Use Cases**: Pilot programmes, private supply chain collaborations, curated deployments

Example: Set `ENVIRONMENT=prod` (signups automatically disabled)

The key difference is access control: demo environments prioritise ease of access, whilst pilot environments prioritise controlled participation for sensitive data sharing scenarios.

**Automatic Configuration**: The initialisation system automatically configures Keycloak settings based on the `ENVIRONMENT` variable:
- **Realm Name**: Defaults to `ri-{ENVIRONMENT}` (e.g., `ri-local`, `ri-prod`), or can be overridden with `KEYCLOAK_REALM` environment variable
- **Allow Signups**: Automatically disabled (`false`) when `ENVIRONMENT` contains "prod" (case-insensitive), enabled (`true`) otherwise
- **SSL Required**: Automatically set to `all` for prod environments, `external` for others
- **Temporary Passwords**: Users must change passwords on first login in prod environments, but can use configured passwords directly in dev/demo environments

This automatic configuration prevents accidental misconfiguration of controlled access environments.

## Configuration Format

The `config.json` file is used for all environments and should follow this structure:

```json
{
  "organisations": [
    {
      "name": "Test Organisation",
      "primaryColor": "#3B82F6",
      "logo": null,
      "users": [
        {
          "email": "admin@example.com",
          "firstName": "Admin",
          "lastName": "User",
          "role": "owner",
          "password": "Admin123!"
        }
      ]
    }
  ]
}
```

**Note**: All Keycloak settings (`realm`, `allowSignups`, `sslRequired`) are automatically configured based on the `ENVIRONMENT` variable and optional `KEYCLOAK_REALM` environment variable. The config file only needs to define organisations and users.

### User Fields

- `email`: User's email address (also used as username)
- `firstName`: User's first name (included in token)
- `lastName`: User's last name (included in token)
- `role`: User role (`owner`, `admin`, or `user`)
  - `owner`: Organisation owner with full permissions (required: at least one per organisation)
  - `admin`: Administrator with elevated permissions
  - `user`: Standard user
  - **Note**: Roles are seeded in the RI database, not in Keycloak. Keycloak only handles authentication and provides user identity (email, firstName, lastName).
- `password`: Initial password (user must change on first login in prod)

## Docker Compose Integration

The `ri-init` service:
- Builds from this directory's Dockerfile
- Depends on `ri-db` being healthy
- Runs once and exits (`restart: "no"`)
- Keycloak depends on this service completing successfully

This ensures the proper startup order:
1. PostgreSQL (`ri-db`) starts
2. Initialisation service (`ri-init`) runs and generates realm file
3. Keycloak starts and imports the generated realm file

## Environment Variables

Required environment variables:
- `ENVIRONMENT`: Environment name (e.g., "local", "prod")
- `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PORT`: Database connection info
- `RI_APP_URL`: Application URL for OAuth callbacks
- `AUTH_KEYCLOAK_CLIENT_ID`: Identity Provider (OAuth) client ID
- `AUTH_KEYCLOAK_CLIENT_SECRET`: Identity Provider (OAuth) client secret

Optional environment variables:
- `KEYCLOAK_REALM`: Override the default realm name (defaults to `ri-{ENVIRONMENT}`)

## Re-initialising Keycloak

If you need to completely re-initialise Keycloak with a new realm configuration:

**⚠️ WARNING: This will delete all existing users, clients, and realm configuration!**

To re-initialise:
1. Stop the services: `docker compose down`
2. Remove the keycloak volume `docker volume rm tests-untp_keycloak-data`
3. Remove the generated realm file: `rm keycloak-realms/*.json`
4. Start the services: `docker compose up`

**Important Considerations:**
- **Data Loss**: All users, sessions, and Keycloak configuration will be lost
- **User Impact**: All users will need to be re-created and will lose access
- **Better Alternative**: For most changes (adding users, modifying settings), use the Keycloak Admin Console at `http://localhost:8080` instead
- **When to Re-initialise**: Only re-initialise when you need to fundamentally change the realm structure or are resetting a development environment

## Development

To modify the initialisation logic:

1. Edit `provision-env.ts` for Keycloak provisioning changes
2. Edit `schemas.ts` to modify validation rules
3. Edit `scripts/init.sh` for overall initialisation flow
4. Update `config.json` to add/modify organisations or users
5. Rebuild the container: `docker compose build ri-init`
