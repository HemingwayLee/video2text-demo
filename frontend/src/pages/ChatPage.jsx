import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Box, MenuItem, Select, Stack, Typography } from "@mui/material";
import { api, applyEvent, streamMessage } from "../api";
import Composer from "../components/Composer";
import MessageItem from "../components/MessageItem";
import Sidebar from "../components/Sidebar";
import SplitLayout from "../layout/SplitLayout";

export default function ChatPage() {
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState(null); // assistant message being streamed
  const [error, setError] = useState(null);

  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const streaming = draft !== null;

  const refreshConversations = useCallback(async () => {
    setConversations(await api.listConversations());
  }, []);

  useEffect(() => {
    api
      .models()
      .then(({ models, default: def }) => {
        setModels(models);
        setModel(def);
      })
      .catch((e) => setError(`Cannot reach the API: ${e.message}`));
    refreshConversations().catch(() => {});
  }, [refreshConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, draft]);

  const openConversation = async (id) => {
    if (streaming) return;
    setCurrentId(id);
    try {
      const convo = await api.getConversation(id);
      setMessages(convo.messages);
      setModel(convo.model);
    } catch (e) {
      setError(e.message);
    }
  };

  const newChat = () => {
    if (streaming) return;
    setCurrentId(null);
    setMessages([]);
  };

  const deleteChat = async (id) => {
    await api.deleteConversation(id);
    if (id === currentId) newChat();
    refreshConversations();
  };

  const changeModel = async (value) => {
    setModel(value);
    if (currentId) await api.updateConversation(currentId, { model: value });
  };

  const send = async (text) => {
    setError(null);
    let id = currentId;
    try {
      if (!id) {
        id = (await api.createConversation(model)).id;
        setCurrentId(id);
      }
    } catch (e) {
      setError(e.message);
      return;
    }

    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", blocks: [{ type: "text", text }] }]);
    setDraft({ role: "assistant", blocks: [] });

    const controller = new AbortController();
    abortRef.current = controller;
    let final = { role: "assistant", blocks: [], cost_usd: null };
    try {
      await streamMessage(id, text, {
        signal: controller.signal,
        onEvent: (event) => {
          final = {
            ...final,
            blocks: applyEvent(final.blocks, event),
            cost_usd: event.type === "result" ? event.cost_usd : final.cost_usd,
          };
          setDraft(final);
        },
      });
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      abortRef.current = null;
      setMessages((prev) => [...prev, { id: `local-${Date.now()}-a`, ...final }]);
      setDraft(null);
      refreshConversations();
    }
  };

  const stop = () => abortRef.current?.abort();

  const empty = messages.length === 0 && !streaming;

  return (
    <SplitLayout
      sidebar={
        <Sidebar
          conversations={conversations}
          currentId={currentId}
          onSelect={openConversation}
          onNew={newChat}
          onDelete={deleteChat}
        />
      }
      header={
        <Select
          size="small"
          variant="standard"
          disableUnderline
          value={models.length ? model : ""}
          onChange={(e) => changeModel(e.target.value)}
          disabled={streaming}
          sx={{ fontWeight: 600 }}
        >
          {models.map((m) => (
            <MenuItem key={m.id} value={m.id}>
              {m.name}
            </MenuItem>
          ))}
        </Select>
      }
    >
      {empty ? (
        <Stack sx={{ flex: 1, justifyContent: "center", alignItems: "center", px: 2 }}>
          <Box sx={{ width: "100%", maxWidth: 768 }}>
            <Typography variant="h4" sx={{ textAlign: "center", mb: 3, fontWeight: 600 }}>
              What can Claude Code do for you?
            </Typography>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            <Composer onSend={send} onStop={stop} streaming={streaming} autoFocus />
          </Box>
        </Stack>
      ) : (
        <>
          <Box sx={{ flex: 1, overflowY: "auto", px: 2 }}>
            <Box sx={{ maxWidth: 768, mx: "auto", py: 2 }}>
              {messages.map((m) => (
                <MessageItem key={m.id} message={m} />
              ))}
              {draft && <MessageItem message={draft} streaming />}
              <div ref={bottomRef} />
            </Box>
          </Box>
          <Box sx={{ px: 2, pb: 2 }}>
            <Box sx={{ maxWidth: 768, mx: "auto" }}>
              {error && (
                <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}
              <Composer onSend={send} onStop={stop} streaming={streaming} />
            </Box>
          </Box>
        </>
      )}
    </SplitLayout>
  );
}
