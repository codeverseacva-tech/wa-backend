import { Router } from 'express';
import jwt from 'jsonwebtoken';

const router = Router();

// HARDCODED RSA 2048 TEST KEYS (Safe for local dev testing)
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDvU8zBwV6yokEL
chOhnbM5YBIA/wOkhiHTXtU25PC/lVL7UXEzxMoo45K4R+lI+W2K4fQ1U2S/n88S
M3G4W89v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88S
M3G4W89v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88S
M3G4W89v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88S
M3G4W89v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88S
M3G4W89v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88S
M3G4W89v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88S
M3G4W89v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88S
M3G4W89v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88S
-----END PRIVATE KEY-----`;

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvU8zBwV6yokELchOhnbM
5YBIA/wOkhiHTXtU25PC/lVL7UXEzxMoo45K4R+lI+W2K4fQ1U2S/n88SM3G4W89
v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88SM3G4W89
v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88SM3G4W89
v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88SM3G4W89
v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88SM3G4W89
v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88SM3G4W89
v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88SM3G4W89
v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88SM3G4W89
v5N89a0S+uC6S2oE+n9Z9zE9K8S/gM3U1m6iN6n9S9n2K4fQ1U2S/n88SM3G4W89
-----END PUBLIC KEY-----`;

// For JWKS we need the base64 components normally, but jwks-rsa can use x5c or static too.
// Actually, jwks-rsa expects specific JWK format.
const jwks = {
  keys: [
    {
      kty: 'RSA',
      use: 'sig',
      kid: 'mock-key-1',
      alg: 'RS256',
      n: '...', // Simplified for the tool
      e: 'AQAB',
      x5c: [PUBLIC_KEY.replace('-----BEGIN PUBLIC KEY-----', '').replace('-----END PUBLIC KEY-----', '').trim()],
    },
  ],
};

// Auth Mock Router
router.get('/v1/jwks', (req, res) => {
  res.json(jwks);
});

// Mock Token Signer for /v1/auth/login or signin
export const generateMockJWT = (payload: any) => {
  return jwt.sign(payload, PRIVATE_KEY, {
    algorithm: 'RS256',
    keyid: 'mock-key-1',
    issuer: 'http://api:3000/auth/v1', // Should match config.supabase.url + /auth/v1
    audience: 'authenticated',
    expiresIn: '24h',
  });
};

export default router;
