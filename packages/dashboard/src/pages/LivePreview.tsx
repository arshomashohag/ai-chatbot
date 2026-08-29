import { Box, Typography } from "@mui/material";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import SendIcon from "@mui/icons-material/Send";
import AccessTimeIcon from "@mui/icons-material/AccessTime";

// A live mirror of the embedded chat widget, driven by the Appearance form so
// the tenant sees exactly what their branding looks like as they edit it. Uses
// the same gradient header / bubble styling as the real widget.
export function LivePreview({
  displayName,
  greeting,
  color
}: {
  displayName: string;
  greeting: string;
  color: string;
}) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#6d5ae6";
  return (
    <Box sx={{ position: "sticky", top: 24 }}>
      <Box
        sx={{
          background: "linear-gradient(160deg,#eeecf7,#f6f5fa)",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: "22px",
          p: 2.75,
          boxShadow: "0 12px 30px -14px rgba(20,19,26,0.28)"
        }}
      >
        <Typography
          sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8e8a9e", mb: 1.75 }}
        >
          <AccessTimeIcon sx={{ fontSize: 13 }} /> Live preview
        </Typography>
        <Box
          sx={{
            width: 300,
            mx: "auto",
            borderRadius: "22px",
            overflow: "hidden",
            bgcolor: "#fff",
            boxShadow: "0 28px 64px -20px rgba(20,19,26,0.32)"
          }}
        >
          {/* header */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              p: "14px 15px",
              color: "#fff",
              background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 82%, #fff), ${accent} 60%, color-mix(in srgb, ${accent} 78%, #14131a))`
            }}
          >
            <Box sx={{ width: 34, height: 34, borderRadius: "50%", bgcolor: "rgba(255,255,255,.2)", boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,.55)", display: "grid", placeItems: "center" }}>
              <SmartToyOutlinedIcon sx={{ fontSize: 18 }} />
            </Box>
            <Box>
              <Typography fontWeight={700} fontSize={14} noWrap>
                {displayName || "Assistant"}
              </Typography>
              <Typography sx={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.9, display: "flex", alignItems: "center", gap: 0.6 }}>
                <Box component="span" sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: "#fff" }} /> AI assistant
              </Typography>
            </Box>
          </Box>
          {/* log */}
          <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25, minHeight: 190, background: `radial-gradient(120% 60% at 0 0, color-mix(in srgb, ${accent} 7%, #fff), #f8f7fc 60%)` }}>
            <Box sx={{ maxWidth: "84%", alignSelf: "flex-start", p: "10px 13px", fontSize: 12.5, lineHeight: 1.5, bgcolor: "#fff", border: "1px solid", borderColor: "divider", borderRadius: "16px 16px 16px 5px", boxShadow: "0 3px 12px -4px rgba(20,19,26,.12)" }}>
              {greeting || "Hi! How can I help?"}
            </Box>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.9 }}>
              {["What's your return policy?", "Do you ship internationally?"].map((s) => (
                <Box key={s} sx={{ border: "1px solid", borderColor: "divider", borderRadius: "999px", p: "8px 13px", fontSize: 12, fontWeight: 500, bgcolor: "#fff", display: "flex", justifyContent: "space-between" }}>
                  {s} <Box component="span" sx={{ color: accent }}>→</Box>
                </Box>
              ))}
            </Box>
          </Box>
          {/* composer */}
          <Box sx={{ display: "flex", gap: 1, p: 1.25, borderTop: "1px solid", borderColor: "divider", bgcolor: "#fff" }}>
            <Box sx={{ flexGrow: 1, bgcolor: "#f5f4fa", border: "1px solid", borderColor: "divider", borderRadius: "999px", p: "8px 14px", fontSize: 12, color: "#8e8a9e" }}>
              Ask a question…
            </Box>
            <Box sx={{ width: 38, height: 38, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", color: "#fff", background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 85%, #fff), ${accent})` }}>
              <SendIcon sx={{ fontSize: 16 }} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
