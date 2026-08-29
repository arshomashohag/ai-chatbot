import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, CssBaseline } from "@mui/material";
// Shared design system: CSS variables consumed by the MUI theme + any raw
// elements, so the portal draws from the same tokens as marketing (no drift).
import "@platform/shared/design/tokens.css";
import { theme } from "./theme.js";
import { SnackbarProvider } from "./hooks/useSnackbar.js";
import { App } from "./App.js";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider>
        <App />
      </SnackbarProvider>
    </ThemeProvider>
  </StrictMode>
);
