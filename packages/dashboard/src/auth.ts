import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  type CognitoUserSession
} from "amazon-cognito-identity-js";

const pool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_USER_POOL_ID,
  ClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID
});

export function signUp(email: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pool.signUp(
      email,
      password,
      [new CognitoUserAttribute({ Name: "email", Value: email })],
      [],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

export function confirm(email: string, code: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

export function resendCode(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((err) => (err ? reject(err) : resolve()));
  });
}

export function login(
  email: string,
  password: string
): Promise<CognitoUserSession> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  const details = new AuthenticationDetails({
    Username: email,
    Password: password
  });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: resolve,
      onFailure: reject
    });
  });
}

// The E2E harness exercises the portal + admin API without a live Cognito pool.
// Fail-closed: the bypass is only ever taken in a non-production bundle AND when
// VITE_E2E is set. A production build additionally cannot be built with VITE_E2E
// set (see vite.config.ts), so this branch is dead-code-eliminated in prod.
const E2E_BYPASS =
  import.meta.env.MODE !== "production" && Boolean(import.meta.env.VITE_E2E);

export function currentToken(): Promise<string | null> {
  if (E2E_BYPASS) {
    return Promise.resolve(localStorage.getItem("e2e_token"));
  }
  const user = pool.getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) return resolve(null);
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

export function currentEmail(): string | null {
  if (E2E_BYPASS) return "e2e@example.com";
  return pool.getCurrentUser()?.getUsername() ?? null;
}

export function logout(): void {
  pool.getCurrentUser()?.signOut();
}

// Map common Cognito errors to plain, human copy (never show raw SDK strings).
export function mapAuthError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as { message?: string })?.message ?? "Something went wrong.";
  switch (name) {
    case "UsernameExistsException":
      return "An account with this email already exists. Try logging in.";
    case "NotAuthorizedException":
      return "Incorrect email or password.";
    case "UserNotConfirmedException":
      return "Please verify your email first — check your inbox for a code.";
    case "CodeMismatchException":
      return "That verification code isn't right. Please try again.";
    case "ExpiredCodeException":
      return "That code has expired. Request a new one.";
    case "UserNotFoundException":
      return "No account found for this email.";
    case "InvalidPasswordException":
    case "InvalidParameterException":
      return "Password must be at least 8 characters with upper, lower, and a number.";
    case "LimitExceededException":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return message;
  }
}
