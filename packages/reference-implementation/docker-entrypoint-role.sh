#!/bin/sh

derive_process_role() {
    case "${1-}" in
        --process-role=worker)
            echo worker
            ;;
        --process-role|--process-role=*)
            echo "Unknown process role marker: ${1-}" >&2
            return 1
            ;;
        *)
            echo web
            ;;
    esac
}

is_known_maintenance_script() {
    case "${1-}" in
        audit:encryption|backfill:decryption-keys|backfill:credential-details|backfill:credential-status-entries|\
        services:repair-config|backfill:credential-status-attribution|rotate:encryption-key|\
        batch:resolve-item|batch:inspect-item|\
        scripts/audit-encryption.ts|scripts/backfill-decryption-keys.ts|scripts/backfill-credential-details.ts|\
        scripts/backfill-credential-status-entries.ts|scripts/backfill-credential-status-attribution.ts|\
        scripts/services-repair-config.ts|scripts/rotate-encryption-key.ts|scripts/resolve-credential-batch-item.ts|\
        scripts/inspect-credential-batch-item.ts|prisma/backfills/2026-05-19-hex-to-multibase.ts)
            return 0
            ;;
    esac
    return 1
}

is_maintenance_command() {
    case "${1-}" in
        pnpm)
            if [ "${2-}" = run ]; then
                is_known_maintenance_script "${3-}"
            else
                is_known_maintenance_script "${2-}"
            fi
            ;;
        tsx|*/tsx)
            is_known_maintenance_script "${2-}"
            ;;
        npx)
            [ "${2-}" = tsx ] && is_known_maintenance_script "${3-}"
            ;;
        *)
            return 1
            ;;
    esac
}
