import { useState } from "react";
import { Box, Drawer, IconButton, Stack, useMediaQuery } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";

const SIDEBAR_WIDTH = 260;

/**
 * Left sidebar + right main area. On small screens the sidebar becomes a slide-out drawer
 * that closes when something inside it is clicked.
 */
export default function SplitLayout({ sidebar, header, children }) {
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up("md"));
  const [open, setOpen] = useState(false);

  return (
    <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
      {isDesktop ? (
        <Box
          component="nav"
          sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, borderRight: 1, borderColor: "divider", overflowY: "auto" }}
        >
          {sidebar}
        </Box>
      ) : (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          onClick={() => setOpen(false)}
          sx={{ "& .MuiDrawer-paper": { width: SIDEBAR_WIDTH } }}
        >
          {sidebar}
        </Drawer>
      )}

      <Stack sx={{ flex: 1, minWidth: 0 }}>
        {(header || !isDesktop) && (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 2, py: 1, minHeight: 48 }}>
            {!isDesktop && (
              <IconButton edge="start" onClick={() => setOpen(true)} aria-label="Open side panel">
                <MenuIcon />
              </IconButton>
            )}
            {header}
          </Stack>
        )}
        {children}
      </Stack>
    </Box>
  );
}
