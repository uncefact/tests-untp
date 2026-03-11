---
sidebar_position: 2
title: Tenant Modes
---

# Tenant Modes

The Reference Implementation operates in one of two tenant modes — **open** or **closed** — which determines how tenants are created and how identities are associated with them. The mode is set at the instance level.

Both modes support two types of identity:

- **Users** — people who interact with the Reference Implementation through a browser, authenticating via the IDP's sign-in flow.
- **Service accounts** — systems that consume the REST API programmatically, authenticating via Bearer tokens obtained from the IDP using the OAuth2 client credentials flow.

How each identity type is mapped to a tenant depends on the mode.

## Open Mode

Open mode is designed for self-service environments where the tenant creation process is fully automatic. This is the default mode. Identities do not need access to the IDP to create their own tenant, and instance administrators do not need to manually provision tenants — the process is automatic and self-contained within the Reference Implementation.

**When to use open mode:**
- Demo instances where users self-register to explore UNTP capabilities
- Development and testing environments

### Users

When a user signs in for the first time, the Reference Implementation automatically creates a new tenant for them. The tenant is named after the user and the user is linked to that tenant. All subsequent requests from that user are scoped to their tenant. There is no manual provisioning step — the user registers with the IDP, logs into the Reference Implementation, and a tenant is created on first access.

### Service Accounts

Each service account gets its own tenant, derived from its `sub` claim — the same as a regular user.

### How tenant identity is resolved

- The Reference Implementation reads the `sub` (subject) claim from the IDP token to identify the user or service account
- On first access, a new tenant is created and the identity is linked to it
- On subsequent access, the existing tenant is retrieved

:::note
Team management — the ability for a tenant owner to invite other users into their tenant so they can collaborate — is planned but not yet implemented. When available, this will allow multiple users to work within a single tenant in open mode, with the invitation process managed entirely within the Reference Implementation (not the IDP).
:::

## Closed Mode

Closed mode disables self-service tenant creation, giving the instance operator full control over who has access to their instance of the Reference Implementation. Identities are managed at the IDP level — an administrator or system integration adds users and service accounts to the IDP and associates each with a group. That group identifier is what maps the identity to a tenant within the Reference Implementation.

**When to use closed mode:**
- Pilot programmes where a facilitator manages participants through the IDP
- Managed deployments where tenant membership is controlled centrally
- Any scenario where the IDP is the source of truth for which tenant an identity belongs to

### Users

When a user signs in, the Reference Implementation extracts a group claim from the IDP token and uses it to resolve the tenant. If the tenant does not yet exist, it is created automatically from the group claim. The user is then linked to that tenant.

### Service Accounts

Service accounts are also resolved via the group claim. This gives integrators flexibility — a service account can have its own dedicated tenant (with its own group ID), or it can act on behalf of an existing tenant by including that tenant's group ID in the service account token.

### How tenant identity is resolved

- The Reference Implementation extracts a group claim from the IDP token (the claim name is configurable)
- The group value is used to look up or create the corresponding tenant
- The identity is linked to that tenant

**Single group constraint:** An identity can only belong to one tenant at a time. If the IDP token contains multiple groups, the Reference Implementation uses the first group and logs a warning. If an identity's group changes in the IDP, the Reference Implementation re-links them to the new tenant on their next authentication.

## Configuration

Tenant mode is configured via environment variables on the Reference Implementation:

| Variable | Description | Default |
|----------|-------------|---------|
| `TENANT_MODE` | `open` or `closed` | `open` |
| `TENANT_CLAIM_NAME` | The IDP token claim containing the group identifier (closed mode only) | `groups` |
| `TENANT_CLAIM_FORMAT` | How to extract the group value: `array_first` or `string` (closed mode only) | `array_first` |

The `array_first` format is for IDPs that deliver groups as a JSON array (e.g., `["/my-org"]`), taking the first element. The `string` format is for IDPs that deliver the group as a plain string value.

See [IDP Requirements](./idp-requirements) for the specific token claims and IDP configuration required for each mode.
