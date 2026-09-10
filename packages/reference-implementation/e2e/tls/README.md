These certificates and private keys are test-only and hold no secret.

Run `./make-certs.sh` from this directory to regenerate the CA and leaf
certificate used by the e2e Compose stack. The leaf certificate has the
`vckit.e2e.internal` DNS name and is valid for 3650 days.
