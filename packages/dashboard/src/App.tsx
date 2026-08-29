import { useCallback, useEffect, useState } from "react";
import { Box, CircularProgress } from "@mui/material";
import { currentToken } from "./auth.js";
import { AuthFlow } from "./auth/AuthFlow.js";
import { Dashboard } from "./dashboard/Dashboard.js";

export function App() {
  const [state, setState] = useState<"loading" | "in" | "out">("loading");

  const refresh = useCallback(async () => {
    const token = await currentToken();
    setState(token ? "in" : "out");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === "loading") {
    return (
      <Box sx={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (state === "out") return <AuthFlow onAuthenticated={refresh} />;
  return <Dashboard onLogout={refresh} />;
}
