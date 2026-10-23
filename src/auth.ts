/**
 * Account sign-in, token refresh and licence checks live in `@exhumer/motogp-auth`, which this package
 * shares with `@exhumer/motogp-api`. They are re-exported here so existing imports keep working.
 */
export {
  activePermissions,
  hasTimingPass,
  login,
  LOGIN_CLIENT_ID,
  LOGIN_URL,
  LoginError,
  MotoGPAuth,
  NotSignedInError,
  ORIGIN_CLIENT_ID,
  PERMISSIONS_URL,
  PermissionsError,
  refreshToken,
  TIMING_PASS_LICENCE_ID,
  timingPassLicenceId,
  tokenClaims,
  tokenExpiry,
} from '@exhumer/motogp-auth';
export type {
  LicenceIdOptions,
  LoginOptions,
  MotoGPAuthOptions,
  Permission,
  PermissionsOptions,
  RefreshTokenOptions,
  TimingPassOptions,
  TokenClaims,
  TokenResponse,
} from '@exhumer/motogp-auth';
