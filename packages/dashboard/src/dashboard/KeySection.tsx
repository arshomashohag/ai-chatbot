import { useState } from "react";
import {
  Stack,
  Button,
  Typography,
  Paper,
  IconButton,
  Box
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { api } from "../api.js";
import { useSnackbar } from "../hooks/useSnackbar.js";
import { Section } from "./Section.js";

export function KeySection() {
  const snackbar = useSnackbar();
  const [issued, setIssued] = useState<{ siteKey: string; snippet: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  async function issue() {
    setBusy(true);
    try {
      const r = await api.issueKey();
      setIssued(r);
    } catch (e) {
      snackbar.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      snackbar.success(`${label} copied to clipboard.`);
    } catch {
      snackbar.error("Couldn't copy — please select and copy manually.");
    }
  }

  return (
    <Section title="4. Get your key">
      <Stack spacing={2}>
        <Button
          variant="contained"
          data-testid="issue-key"
          onClick={issue}
          disabled={busy}
          sx={{ alignSelf: "flex-start" }}
        >
          {issued ? "Regenerate key" : "Get my key"}
        </Button>
        {issued && (
          <>
            <Typography variant="body2" color="text.secondary">
              Copy your key now. You can regenerate it any time — the old one stops
              working when you do.
            </Typography>
            <CopyBlock
              label="Site key"
              value={issued.siteKey}
              testid="site-key"
              onCopy={() => copy(issued.siteKey, "Site key")}
            />
            <CopyBlock
              label="Embed snippet"
              value={issued.snippet}
              testid="snippet"
              onCopy={() => copy(issued.snippet, "Snippet")}
            />
          </>
        )}
      </Stack>
    </Section>
  );
}

function CopyBlock({
  label,
  value,
  testid,
  onCopy
}: {
  label: string;
  value: string;
  testid: string;
  onCopy: () => void;
}) {
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>
        <IconButton size="small" aria-label={`Copy ${label}`} onClick={onCopy}>
          <ContentCopyIcon fontSize="inherit" />
        </IconButton>
      </Stack>
      <Paper
        variant="outlined"
        sx={{ p: 1.5, bgcolor: "#f2f1f7", fontFamily: "monospace", fontSize: 13, overflowX: "auto", wordBreak: "break-all" }}
      >
        <span data-testid={testid}>{value}</span>
      </Paper>
    </Box>
  );
}
