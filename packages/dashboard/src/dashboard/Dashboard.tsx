import { useEffect, useRef, useState } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Container,
  Stack,
  CircularProgress,
  Box
} from "@mui/material";
import { api } from "../api.js";
import { currentEmail, logout } from "../auth.js";
import type { AdminConfig, KbEntry, SessionSummary } from "@platform/shared";
import { BasicsForm } from "./BasicsForm.js";
import { AppearanceForm } from "./AppearanceForm.js";
import { KnowledgeSection } from "./KnowledgeSection.js";
import { KeySection } from "./KeySection.js";
import { SessionsSection } from "./SessionsSection.js";
import { useSnackbar } from "../hooks/useSnackbar.js";

export function Dashboard({ onLogout }: { onLogout: () => void }) {
  const snackbar = useSnackbar();
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [kb, setKb] = useState<KbEntry[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  async function reloadKb() {
    setKb(await api.listKb());
  }

  // Load once on mount. `snackbar` is read via a ref so this effect never
  // re-fires on toast/context changes (which would flash the spinner and
  // remount every section, wiping unsaved input in sibling forms).
  const snackbarRef = useRef(snackbar);
  snackbarRef.current = snackbar;
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [c, k] = await Promise.all([api.getConfig(), api.listKb()]);
        const s = await api.listSessions().catch(() => [] as SessionSummary[]);
        if (!active) return;
        setCfg(c);
        setKb(k);
        setSessions(s);
      } catch {
        snackbarRef.current.error("Couldn't load your settings. Please refresh.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
        <Toolbar>
          <Typography variant="h6" fontWeight={800} sx={{ flexGrow: 1 }}>
            AI Chatbot
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 2 }} data-testid="who">
            {currentEmail()}
          </Typography>
          <Button
            data-testid="logout"
            onClick={() => {
              logout();
              onLogout();
            }}
          >
            Log out
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h4" fontWeight={800} gutterBottom>
          Setup
        </Typography>
        {loading || !cfg ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={3}>
            <BasicsForm initial={cfg.basics} />
            <AppearanceForm initial={cfg.appearance} />
            <KnowledgeSection
              initialProfile={cfg.businessProfile}
              kb={kb}
              onKbChanged={reloadKb}
            />
            <KeySection />
            <SessionsSection sessions={sessions} />
          </Stack>
        )}
      </Container>
    </>
  );
}
