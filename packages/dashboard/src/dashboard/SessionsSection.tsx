import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Button,
  Typography,
  Box,
  CircularProgress
} from "@mui/material";
import type { SessionSummary, StoredMessage } from "@platform/shared";
import { api } from "../api.js";
import { useSnackbar } from "../hooks/useSnackbar.js";
import { Section } from "./Section.js";

export function SessionsSection({ sessions }: { sessions: SessionSummary[] }) {
  const snackbar = useSnackbar();
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [loading, setLoading] = useState(false);

  async function open(sessionId: string) {
    setOpenId(sessionId);
    setLoading(true);
    try {
      const t = await api.transcript(sessionId);
      setMessages(t.messages.filter((m) => m.role === "user" || m.role === "assistant"));
    } catch (e) {
      snackbar.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Section title="Conversations">
      {sessions.length === 0 ? (
        <Typography color="text.secondary">
          No conversations yet. Once your widget is live, chats appear here.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Origin</TableCell>
              <TableCell align="right">Messages</TableCell>
              <TableCell align="right">Started</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.sessionId} hover>
                <TableCell>
                  <Button
                    data-testid="sess-open"
                    onClick={() => open(s.sessionId)}
                    sx={{ textTransform: "none" }}
                  >
                    {s.origin || s.sessionId}
                  </Button>
                </TableCell>
                <TableCell align="right">{s.messageCount}</TableCell>
                <TableCell align="right">
                  {s.createdAt ? new Date(s.createdAt * 1000).toLocaleString() : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {openId && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Transcript
          </Typography>
          {loading ? (
            <CircularProgress size={20} />
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {messages.map((m, i) => (
                <Box
                  key={i}
                  data-testid="transcript-msg"
                  sx={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "80%",
                    px: 1.5,
                    py: 1,
                    borderRadius: 2,
                    bgcolor: m.role === "user" ? "primary.main" : "#f2f1f7",
                    color: m.role === "user" ? "#fff" : "text.primary"
                  }}
                >
                  {m.content}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Section>
  );
}
