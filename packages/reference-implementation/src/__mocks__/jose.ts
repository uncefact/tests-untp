// Mock for jose library
export const decodeJwt = jest.fn();
export const SignJWT = jest.fn();
export const jwtVerify = jest.fn();
export const compactDecrypt = jest.fn();
export const CompactEncrypt = jest.fn();
export const generateKeyPair = jest.fn();
export const exportJWK = jest.fn();
export const importJWK = jest.fn();
export const createRemoteJWKSet = jest.fn();

class JOSEError extends Error {
  static code = 'ERR_JOSE_GENERIC';
  code = 'ERR_JOSE_GENERIC';
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

class JWTExpired extends JOSEError {
  static code = 'ERR_JWT_EXPIRED';
  code = 'ERR_JWT_EXPIRED';
  claim: string;
  reason: string;
  constructor(message?: string, _payload?: unknown, claim = 'unspecified', reason = 'unspecified') {
    super(message);
    this.claim = claim;
    this.reason = reason;
  }
}

class JWTClaimValidationFailed extends JOSEError {
  static code = 'ERR_JWT_CLAIM_VALIDATION_FAILED';
  code = 'ERR_JWT_CLAIM_VALIDATION_FAILED';
  claim: string;
  reason: string;
  constructor(message?: string, _payload?: unknown, claim = 'unspecified', reason = 'unspecified') {
    super(message);
    this.claim = claim;
    this.reason = reason;
  }
}

class JWSSignatureVerificationFailed extends JOSEError {
  static code = 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED';
  code = 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED';
  constructor(message = 'signature verification failed') {
    super(message);
  }
}

class JWKSNoMatchingKey extends JOSEError {
  static code = 'ERR_JWKS_NO_MATCHING_KEY';
  code = 'ERR_JWKS_NO_MATCHING_KEY';
  constructor(message = 'no applicable key found in the JSON Web Key Set') {
    super(message);
  }
}

export const errors = {
  JOSEError,
  JWTExpired,
  JWTClaimValidationFailed,
  JWSSignatureVerificationFailed,
  JWKSNoMatchingKey,
};
