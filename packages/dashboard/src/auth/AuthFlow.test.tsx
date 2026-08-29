// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material";
import { theme } from "../theme.js";

// Stub the Cognito wrappers so no network/pool is needed.
vi.mock("../auth.js", () => ({
  login: vi.fn().mockResolvedValue({}),
  signUp: vi.fn().mockResolvedValue(undefined),
  confirm: vi.fn().mockResolvedValue(undefined),
  resendCode: vi.fn().mockResolvedValue(undefined),
  mapAuthError: (e: unknown) => (e as Error).message
}));

import { AuthFlow } from "./AuthFlow.js";
import { login, resendCode } from "../auth.js";

function renderFlow() {
  return render(
    <ThemeProvider theme={theme}>
      <AuthFlow onAuthenticated={() => {}} />
    </ThemeProvider>
  );
}

describe("AuthFlow (4.1, 2.9 — stepped auth + client validation)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("keeps the login button disabled while the EMAIL is invalid", async () => {
    renderFlow();
    const button = screen.getByTestId("login") as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    await userEvent.type(screen.getByTestId("login-email"), "not-an-email");
    await userEvent.type(screen.getByTestId("login-pass"), "whatever");
    // Bad email → still disabled, no POST.
    expect(button.disabled).toBe(true);
    expect(login).not.toHaveBeenCalled();
  });

  it("ENABLES login with a valid email and any non-empty password (server verifies)", async () => {
    // Login must NOT re-enforce signup password complexity — a wrong/simple
    // password should reach Cognito and surface "Incorrect email or password",
    // not be blocked client-side with a policy hint.
    renderFlow();
    await userEvent.type(screen.getByTestId("login-email"), "a@b.com");
    await userEvent.type(screen.getByTestId("login-pass"), "weak"); // no upper/digit
    const button = screen.getByTestId("login") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    expect(login).toHaveBeenCalledWith("a@b.com", "weak");
  });

  it("enables and submits with valid credentials", async () => {
    renderFlow();
    await userEvent.type(screen.getByTestId("login-email"), "a@b.com");
    await userEvent.type(screen.getByTestId("login-pass"), "Password1");
    const button = screen.getByTestId("login") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    expect(login).toHaveBeenCalledWith("a@b.com", "Password1");
  });

  it("routes an unverified login to the verify step (email carried, code resent)", async () => {
    // Cognito rejects an unconfirmed user with UserNotConfirmedException.
    vi.mocked(login).mockRejectedValueOnce(
      Object.assign(new Error("not confirmed"), {
        name: "UserNotConfirmedException"
      })
    );
    renderFlow();
    await userEvent.type(screen.getByTestId("login-email"), "new@user.com");
    await userEvent.type(screen.getByTestId("login-pass"), "Password1");
    await userEvent.click(screen.getByTestId("login"));

    // Advanced to the verify step (code field appears) and a fresh code sent.
    expect(await screen.findByTestId("cf-code")).toBeTruthy();
    expect(screen.getByTestId("confirm")).toBeTruthy();
    expect(resendCode).toHaveBeenCalledWith("new@user.com");
  });

  it("switches to the signup form (single-purpose steps, not all-at-once)", async () => {
    renderFlow();
    // Only the login form is shown initially — no verify/signup fields.
    expect(screen.queryByTestId("cf-code")).toBeNull();
    await userEvent.click(screen.getByTestId("go-signup"));
    expect(screen.getByTestId("signup")).toBeTruthy();
  });
});
