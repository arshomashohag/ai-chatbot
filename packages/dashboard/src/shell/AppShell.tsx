import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Box,
  Drawer,
  IconButton,
  Tooltip,
  Chip,
  Avatar,
  Typography
} from "@mui/material";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import CodeOutlinedIcon from "@mui/icons-material/CodeOutlined";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import MenuIcon from "@mui/icons-material/Menu";
import LogoutIcon from "@mui/icons-material/Logout";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import { currentEmail, logout } from "../auth.js";

const EXPANDED = 244;
const COLLAPSED = 76;
const STORAGE_KEY = "portal_sidebar_collapsed";

const NAV = [
  { to: "/overview", label: "Overview", icon: <DashboardOutlinedIcon /> },
  { to: "/appearance", label: "Appearance", icon: <PaletteOutlinedIcon /> },
  { to: "/knowledge", label: "Knowledge", icon: <MenuBookOutlinedIcon /> },
  { to: "/install", label: "Install", icon: <CodeOutlinedIcon /> },
  { to: "/conversations", label: "Conversations", icon: <ChatBubbleOutlineIcon /> }
];

export function AppShell({ onLogout }: { onLogout: () => void }) {
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEY) === "1"
  );

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const email = currentEmail() ?? "";
  const initial = (email[0] ?? "?").toUpperCase();
  const width = collapsed ? COLLAPSED : EXPANDED;

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <Drawer
        variant="permanent"
        data-testid="sidebar"
        data-collapsed={collapsed ? "1" : "0"}
        sx={{
          width,
          flexShrink: 0,
          transition: "width .18s ease",
          "& .MuiDrawer-paper": {
            width,
            border: "none",
            borderRight: "1px solid",
            borderColor: "divider",
            transition: "width .18s ease",
            overflowX: "hidden",
            boxSizing: "border-box",
            px: collapsed ? 1 : 1.75,
            py: 2.5,
            display: "flex",
            flexDirection: "column",
            gap: 0.5
          }
        }}
      >
        {/* Brand + collapse toggle */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            px: collapsed ? 0 : 1,
            pb: 2,
            justifyContent: collapsed ? "center" : "flex-start"
          }}
        >
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: "9px",
              flex: "none",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              background: "linear-gradient(135deg,#8271ec,#6d5ae6)",
              boxShadow: "0 6px 16px -6px rgba(109,90,230,.7)"
            }}
          >
            <SmartToyOutlinedIcon sx={{ fontSize: 18 }} />
          </Box>
          {!collapsed && (
            <Typography fontWeight={800} fontSize={16} sx={{ flexGrow: 1 }}>
              AI Chatbot
            </Typography>
          )}
          {!collapsed && (
            <IconButton
              size="small"
              onClick={toggle}
              aria-label="Collapse sidebar"
              data-testid="sidebar-toggle"
            >
              <MenuOpenIcon fontSize="small" />
            </IconButton>
          )}
        </Box>

        {collapsed && (
          <Box sx={{ display: "flex", justifyContent: "center", mb: 1 }}>
            <IconButton
              size="small"
              onClick={toggle}
              aria-label="Expand sidebar"
              data-testid="sidebar-toggle"
            >
              <MenuIcon fontSize="small" />
            </IconButton>
          </Box>
        )}

        {/* Nav */}
        {NAV.map((item) => (
          <NavItem key={item.to} to={item.to} collapsed={collapsed} icon={item.icon}>
            {item.label}
          </NavItem>
        ))}

        {/* Footer identity + logout */}
        <Box sx={{ mt: "auto", borderTop: "1px solid", borderColor: "divider", pt: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, px: collapsed ? 0 : 0.5, justifyContent: collapsed ? "center" : "flex-start" }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: "#e7e2fc", color: "#4f3ec0", fontSize: 13, fontWeight: 700 }}>
              {initial}
            </Avatar>
            {!collapsed && (
              <Box sx={{ overflow: "hidden", flexGrow: 1 }}>
                <Typography fontSize={12} fontWeight={700} noWrap data-testid="who">
                  {email}
                </Typography>
              </Box>
            )}
            <Tooltip title="Log out">
              <IconButton
                size="small"
                data-testid="logout"
                onClick={() => {
                  logout();
                  onLogout();
                }}
                aria-label="Log out"
                sx={{ display: collapsed ? "none" : "inline-flex" }}
              >
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          {collapsed && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 1 }}>
              <IconButton
                size="small"
                data-testid="logout"
                onClick={() => {
                  logout();
                  onLogout();
                }}
                aria-label="Log out"
              >
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, px: { xs: 2.5, md: 4.5 }, py: 3.5, maxWidth: 1160 }}>
        <Outlet />
      </Box>
    </Box>
  );
}

function NavItem({
  to,
  collapsed,
  icon,
  children
}: {
  to: string;
  collapsed: boolean;
  icon: ReactNode;
  children: string;
}) {
  const content = (
    <NavLink to={to} style={{ textDecoration: "none" }}>
      {({ isActive }) => (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: collapsed ? 0 : 1.25,
            py: 1.1,
            borderRadius: "10px",
            justifyContent: collapsed ? "center" : "flex-start",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
            color: isActive ? "#4f3ec0" : "text.secondary",
            bgcolor: isActive ? "#f4f1fe" : "transparent",
            transition: "background .12s, color .12s",
            "&:hover": { bgcolor: isActive ? "#f4f1fe" : "background.default", color: "text.primary" },
            "& svg": { fontSize: 20 }
          }}
        >
          {icon}
          {!collapsed && <span>{children}</span>}
        </Box>
      )}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip title={children} placement="right">
      <Box>{content}</Box>
    </Tooltip>
  ) : (
    content
  );
}

// Small labelled status chip reused in page headers.
export function StatusChip({ live, label }: { live: boolean; label: string }) {
  return (
    <Chip
      size="small"
      label={label}
      sx={{
        fontWeight: 700,
        fontSize: 11,
        bgcolor: live ? "#eaf7f6" : "#fdf3e3",
        color: live ? "#0b5f5c" : "#a86a00",
        "& .MuiChip-label": { px: 1.25 }
      }}
    />
  );
}
