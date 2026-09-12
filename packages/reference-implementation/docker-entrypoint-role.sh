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
        audit:encryption|backfill:decryption-keys|backfill:credential-details|rotate:encryption-key|\
        scripts/audit-encryption.ts|scripts/backfill-decryption-keys.ts|scripts/backfill-credential-details.ts|\
        scripts/rotate-encryption-key.ts|prisma/backfills/2026-05-19-hex-to-multibase.ts)
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
