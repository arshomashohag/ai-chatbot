import { createTheme } from "@mui/material/styles";

// MUI theme mapped from the platform design tokens — Material structure with the
// brand's identity (purple accent + Plus Jakarta Sans), not stock Material blue.
// Links/secondary text use the darker accent-700 so text passes WCAG AA on white.
export const theme = createTheme({
  palette: {
    primary: { main: "#6d5ae6", dark: "#4f3ec0", light: "#8e7ceb" },
    background: { default: "#f6f5fa", paper: "#ffffff" },
    text: { primary: "#14131a", secondary: "#6f6c7d" },
    error: { main: "#c0442c" },
    success: { main: "#0b5f5c" }
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
    h1: { fontWeight: 800, letterSpacing: "-0.03em" },
    h2: { fontWeight: 700, letterSpacing: "-0.02em" },
    h4: { fontWeight: 800, letterSpacing: "-0.02em" },
    h6: { fontWeight: 700, letterSpacing: "-0.01em" },
    button: { textTransform: "none", fontWeight: 600 },
    subtitle2: { fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }
  },
  components: {
    MuiButton: {
      styleOverrides: { root: { borderRadius: 999 } },
      defaultProps: { disableElevation: true }
    },
    MuiTextField: { defaultProps: { size: "small", fullWidth: true } },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          borderRadius: 18,
          border: "1px solid rgba(20,19,26,0.09)"
        }
      }
    },
    MuiCard: { defaultProps: { elevation: 0 } }
  }
});
