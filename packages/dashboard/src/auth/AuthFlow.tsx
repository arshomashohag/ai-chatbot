import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Box,
  Paper,
  Stack,
  TextField,
  Button,
  Typography,
  Link,
  Alert
} from "@mui/material";
import { signUp, confirm, login, resendCode, mapAuthError } from "../auth.js";

type Mode = "login" | "signup" | "verify";

const credentials = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[0-9]/, "Include a number")
});
type Credentials = z.infer<typeof credentials>;

const verifySchema = z.object({
  code: z.string().min(1, "Enter the code from your email")
});
type VerifyInput = z.infer<typeof verifySchema>;

export function AuthFlow({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(
    null
  );

  return (
    <Box sx={{ display: "grid", placeItems: "center", minHeight: "100vh", p: 2 }}>
      <Paper elevation={0} sx={{ p: 4, width: "100%", maxWidth: 420, border: "1px solid", borderColor: "divider" }}>
        <Typography variant="h5" fontWeight={800} gutterBottom>
          AI Chatbot
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {mode === "login" && "Log in to your portal."}
          {mode === "signup" && "Create your account."}
          {mode === "verify" && "Enter the code we emailed you."}
        </Typography>

        {notice && (
          <Alert severity={notice.kind} sx={{ mb: 2 }}>
            {notice.text}
          </Alert>
        )}

        {mode === "login" && (
          <CredentialsForm
            submitLabel="Log in"
            testid="login"
            onSubmit={async (v) => {
              try {
                await login(v.email, v.password);
                onAuthenticated();
              } catch (e) {
                setNotice({ kind: "error", text: mapAuthError(e) });
              }
            }}
          />
        )}
        {mode === "signup" && (
          <CredentialsForm
            submitLabel="Create account"
            testid="signup"
            onSubmit={async (v) => {
              try {
                await signUp(v.email, v.password);
                setEmail(v.email);
                setMode("verify");
                setNotice({ kind: "info", text: "Check your email for a verification code." });
              } catch (e) {
                setNotice({ kind: "error", text: mapAuthError(e) });
              }
            }}
          />
        )}
        {mode === "verify" && (
          <VerifyForm
            email={email}
            onSubmit={async (v) => {
              try {
                await confirm(email, v.code);
                setMode("login");
                setNotice({ kind: "info", text: "Verified — you can log in now." });
              } catch (e) {
                setNotice({ kind: "error", text: mapAuthError(e) });
              }
            }}
            onResend={async () => {
              try {
                await resendCode(email);
                setNotice({ kind: "info", text: "A new code is on its way." });
              } catch (e) {
                setNotice({ kind: "error", text: mapAuthError(e) });
              }
            }}
          />
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 3 }} justifyContent="center">
          {mode !== "login" && (
            <Link component="button" type="button" onClick={() => { setMode("login"); setNotice(null); }}>
              Back to log in
            </Link>
          )}
          {mode === "login" && (
            <Typography variant="body2" color="text.secondary">
              New here?{" "}
              <Link component="button" type="button" data-testid="go-signup" onClick={() => { setMode("signup"); setNotice(null); }}>
                Create an account
              </Link>
            </Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}

function CredentialsForm({
  submitLabel,
  testid,
  onSubmit
}: {
  submitLabel: string;
  testid: string;
  onSubmit: (v: Credentials) => Promise<void>;
}) {
  const { register, handleSubmit, formState } = useForm<Credentials>({
    resolver: zodResolver(credentials),
    mode: "onChange"
  });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Stack spacing={2}>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputProps={{ "data-testid": `${testid}-email` }}
          error={Boolean(formState.errors.email)}
          helperText={formState.errors.email?.message}
          {...register("email")}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete={testid === "signup" ? "new-password" : "current-password"}
          inputProps={{ "data-testid": `${testid}-pass` }}
          error={Boolean(formState.errors.password)}
          helperText={formState.errors.password?.message}
          {...register("password")}
        />
        <Button
          type="submit"
          variant="contained"
          data-testid={testid}
          disabled={!formState.isValid || formState.isSubmitting}
        >
          {submitLabel}
        </Button>
      </Stack>
    </form>
  );
}

function VerifyForm({
  email,
  onSubmit,
  onResend
}: {
  email: string;
  onSubmit: (v: VerifyInput) => Promise<void>;
  onResend: () => Promise<void>;
}) {
  const { register, handleSubmit, formState } = useForm<VerifyInput>({
    resolver: zodResolver(verifySchema),
    mode: "onChange"
  });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Stack spacing={2}>
        <TextField label="Email" value={email} disabled />
        <TextField
          label="Verification code"
          autoComplete="one-time-code"
          inputProps={{ inputMode: "numeric", "data-testid": "cf-code" }}
          autoFocus
          error={Boolean(formState.errors.code)}
          helperText={formState.errors.code?.message}
          {...register("code")}
        />
        <Button
          type="submit"
          variant="contained"
          data-testid="confirm"
          disabled={!formState.isValid || formState.isSubmitting}
        >
          Verify
        </Button>
        <Link component="button" type="button" onClick={onResend}>
          Resend code
        </Link>
      </Stack>
    </form>
  );
}
