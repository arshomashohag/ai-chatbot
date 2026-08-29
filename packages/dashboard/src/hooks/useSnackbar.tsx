import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { Snackbar, Alert, type AlertColor } from "@mui/material";

interface Toast {
  message: string;
  severity: AlertColor;
}

interface SnackbarApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const Ctx = createContext<SnackbarApi | null>(null);

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const success = useCallback(
    (message: string) => setToast({ message, severity: "success" }),
    []
  );
  const error = useCallback(
    (message: string) => setToast({ message, severity: "error" }),
    []
  );
  // Stable identity — consumers depend on this in effects; a fresh object each
  // toast would re-fire those effects (e.g. Dashboard's data reload) on every
  // save, flashing the spinner and remounting all sections.
  const value = useMemo(() => ({ success, error }), [success, error]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Snackbar
        open={toast !== null}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {toast ? (
          <Alert
            severity={toast.severity}
            variant="filled"
            onClose={() => setToast(null)}
            data-testid={`toast-${toast.severity}`}
          >
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Ctx.Provider>
  );
}

export function useSnackbar(): SnackbarApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSnackbar must be used within SnackbarProvider");
  return ctx;
}
