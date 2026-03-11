---
sidebar_position: 6
title: Adding an Adapter
---

# Adding an Adapter

The Reference Implementation uses an [adapter pattern](./service-architecture) to communicate with external services. If an organisation wants to integrate a service that is not yet supported, they can contribute a new adapter to the [services package](https://github.com/uncefact/tests-untp/tree/main/packages/services).

This page outlines what is involved in adding a new adapter.

## What You Need to Build

Each adapter consists of four parts:

1. **An adapter class** that implements the service interface — this is the layer that translates the Reference Implementation's operations into API calls for the specific external service
2. **A configuration schema** that defines what configuration the adapter requires (e.g., base URL, API key, version) and validates it
3. **A sensitive fields list** that specifies which configuration fields contain secrets (e.g., API keys) so they can be masked when returned through the API
4. **A factory function** that creates an instance of the adapter from a validated configuration

These four parts are bundled together as a registry entry and added to the adapter registry.

## Where Things Live

All adapter code lives in the [services package](https://github.com/uncefact/tests-untp/tree/main/packages/services) under `packages/services/src/`. Each service type has its own directory with an `adapters/` subdirectory:

```
packages/services/src/
├── verifiable-credential/
│   └── adapters/
│       └── vckit/           ← VCKit adapter
├── storage/
│   └── adapters/
│       └── uncefact/        ← UNCEFACT Storage adapter
├── identity-resolver/
│   └── adapters/
│       └── pyx/             ← Pyx IDR adapter
└── did-manager/
    └── adapters/
        └── vckit/           ← VCKit DID adapter
```

A new adapter would follow the same structure — create a new directory under the relevant `adapters/` folder.

## Steps

1. **Create the adapter directory** under the relevant service type's `adapters/` folder (e.g., `packages/services/src/storage/adapters/my-storage/`)

2. **Implement the service interface** — each service type has a defined interface that the adapter must implement:
   - Verifiable Credential: `IVerifiableCredentialService`
   - Storage: `IStorageService`
   - Identity Resolver: `IIdentityResolverService`

   Refer to the existing adapters as a reference for what each method is expected to do.

3. **Define the configuration schema** — create a Zod schema that describes the configuration your adapter requires. This schema is used to validate configuration when a tenant registers a service instance.

4. **Specify sensitive fields** — list any configuration fields that contain secrets so they are masked in API responses.

5. **Create the factory function** — a function that takes the validated configuration and returns an instance of your adapter.

6. **Register the adapter** — add a new adapter type constant and register the entry in the adapter registry (`packages/services/src/registry.ts`). Once registered, tenants can select the new adapter type when registering service instances through the API.

7. **Write tests** — add unit tests for the adapter covering configuration validation, each operation the adapter supports, and error handling.

8. **Update the documentation** — add an adapter page under the relevant service's documentation directory and update the service page's supported adapters table.

9. **Raise a pull request** — submit the adapter, tests, and documentation as a pull request to the [repository](https://github.com/uncefact/tests-untp).

## Reference

Use the existing adapters as working examples:

- [VCKit adapter](https://github.com/uncefact/tests-untp/tree/main/packages/services/src/verifiable-credential/adapters/vckit)
- [UNCEFACT Storage adapter](https://github.com/uncefact/tests-untp/tree/main/packages/services/src/storage/adapters/uncefact)
- [Pyx IDR adapter](https://github.com/uncefact/tests-untp/tree/main/packages/services/src/identity-resolver/adapters/pyx)

If you have questions or need help contributing an adapter, [open an issue](https://github.com/uncefact/tests-untp/issues).
