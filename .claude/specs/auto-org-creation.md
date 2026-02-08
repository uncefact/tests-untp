# Auto-Create Organisation for New Users

## Problem

When a user logs in via Keycloak for the first time, NextAuth creates a `User` record with `organizationId = null`. All `/api/v1/*` routes return 403 until someone manually links the user to an organisation.

## Design Decisions

- **Field name**: `authProviderId` — stores the Keycloak `sub` claim. Unique, nullable (existing users get backfilled).
- **Trigger**: NextAuth `signIn` callback — org is ready before the user hits any API route.
- **Org naming**: Derived from user's name (e.g. "Ashley's Organisation"). Falls back to email or "My Organisation" if name unavailable.
- **No role model yet**: User is simply linked to the org. No owner/admin distinction.

## Implementation

### 1. Schema Change

Add to User model:
```prisma
authProviderId String? @unique
```

Migration to add the column.

### 2. Auth Callback — signIn

In `auth.config.ts`, add a `signIn` callback (or use NextAuth events):
- On sign-in, look up the User by their Account link
- If `authProviderId` is null, set it to the provider's `sub` claim (`account.providerAccountId`)
- If `organizationId` is null:
  - Create a new Organisation (name from user profile)
  - Clone system defaults into it (default DID record, service instances)
  - Link user to the new org
  - All in a single Prisma transaction

### 3. Clone System Defaults

When creating a new org, copy from the "system" org:
- The default DID record (with `isDefault: true`, `type: DEFAULT`)
- All service instance records
- Adjust `organizationId` on the copies to point to the new org

### 4. Session Callback

No changes needed. `token.sub` is already set to `User.id` (the cuid PK) by NextAuth when using a database adapter. The `session.user.id = token.sub` line correctly passes the cuid, and `getOrganizationId` correctly queries by cuid PK.

## Testing

- Auth callback: signIn creates org + defaults when user has no org
- Auth callback: signIn is idempotent (second login doesn't create duplicate org)
- Auth callback: authProviderId is set from account.providerAccountId
- Clone defaults: DID and service instances are correctly copied
- Integration: withOrgAuth works after auto-creation (no more 403)
