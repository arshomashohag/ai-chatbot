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

export function currentToken(): Promise<string | null> {
  // E2E harness bypass: exercise the portal + admin API without a live Cognito
  // pool. Never enabled in production builds (VITE_E2E is unset there).
  if (import.meta.env.VITE_E2E) {
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

export function logout(): void {
  pool.getCurrentUser()?.signOut();
}
