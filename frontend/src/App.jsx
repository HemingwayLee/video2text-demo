import { AppBar, Box, Toolbar, Typography } from "@mui/material";
import ThemeToggle from "./components/ThemeToggle";
import ChatPage from "./pages/ChatPage";

export default function App() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar variant="dense" sx={{ gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
            video2text-demo
          </Typography>
          <ThemeToggle />
        </Toolbar>
      </AppBar>

      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        <ChatPage />
      </Box>
    </Box>
  );
}
