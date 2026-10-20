import { AppBar, Box, Tab, Tabs, Toolbar, Typography } from "@mui/material";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import ThemeToggle from "./components/ThemeToggle";
import ChatPage from "./pages/ChatPage";
import ReelsPage from "./pages/ReelsPage";
import YouTubePage from "./pages/YouTubePage";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = ["reels", "youtube"].find((s) => location.pathname.startsWith(`/${s}`)) ?? "chat";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar variant="dense" sx={{ gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, display: { xs: "none", sm: "block" } }}>
            video2text-demo
          </Typography>
          <Tabs
            value={section}
            onChange={(_, v) => navigate(`/${v}`)}
            sx={{ flex: 1, minHeight: 48, "& .MuiTab-root": { minHeight: 48 } }}
          >
            <Tab value="chat" label="Chat" />
            <Tab value="reels" label="Downloaded reels" />
            <Tab value="youtube" label="YouTube" />
          </Tabs>
          <ThemeToggle />
        </Toolbar>
      </AppBar>

      {/* All pages stay mounted while hidden, so a streaming reply or a loaded folder survives switching tabs. */}
      <Box sx={{ display: section === "chat" ? "flex" : "none", flex: 1, minHeight: 0 }}>
        <ChatPage />
      </Box>
      <Box sx={{ display: section === "reels" ? "flex" : "none", flex: 1, minHeight: 0 }}>
        <ReelsPage />
      </Box>
      <Box sx={{ display: section === "youtube" ? "flex" : "none", flex: 1, minHeight: 0 }}>
        <YouTubePage />
      </Box>

      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={null} />
        <Route path="/reels" element={null} />
        <Route path="/youtube" element={null} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </Box>
  );
}
