import { useCallback, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import { currentToken } from "./auth.js";
import { api } from "./api.js";
import type { AdminConfig } from "@platform/shared";
import { AuthFlow } from "./auth/AuthFlow.js";
import { AppShell } from "./shell/AppShell.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { AppearancePage } from "./pages/AppearancePage.js";
import { KnowledgePage } from "./pages/KnowledgePage.js";
import { InstallPage } from "./pages/InstallPage.js";
import { ConversationsPage } from "./pages/ConversationsPage.js";
import { useSnackbar } from "./hooks/useSnackbar.js";

function Loader() {
  return (
    <Box sx={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <CircularProgress />
    </Box>
  );
}

export function App() {
  const [state, setState] = useState<"loading" | "in" | "out">("loading");

  const refresh = useCallback(async () => {
    const token = await currentToken();
    setState(token ? "in" : "out");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === "loading") return <Loader />;
  if (state === "out") return <AuthFlow onAuthenticated={refresh} />;
  return <Portal onLogout={refresh} />;
}

function Portal({ onLogout }: { onLogout: () => void }) {
  const snackbar = useSnackbar();
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getConfig()
      .then((c) => {
        if (active) setConfig(c);
      })
      .catch(() => snackbar.error("Couldn't load your settings. Please refresh."))
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [snackbar]);

  return (
    <Routes>
      <Route element={<AppShell onLogout={onLogout} />}>
        <Route path="/overview" element={<OverviewPage config={config} />} />
        <Route path="/appearance" element={loaded ? <AppearancePage config={config} /> : <Loader />} />
        <Route path="/knowledge" element={loaded ? <KnowledgePage config={config} /> : <Loader />} />
        <Route path="/install" element={<InstallPage />} />
        <Route path="/conversations" element={<ConversationsPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
  );
}
