import { useEffect, useState } from "react";
import { AppBar, Box, Button, Container, Paper, Tab, Tabs, TextField, Toolbar, Typography } from "@mui/material";
import TriggerManager from "../components/managers/TriggerManager";
import ActionManager from "../components/managers/ActionManager";
import FlowManager from "../components/managers/FlowManager";
import { parseMaybeJson, removeNodeFromLinks, renameNodeInLinks, upsertById } from "../lib/programUtils";
import type { ActionDefinition, Program, TriggerDefinition } from "../types/program";

const EMPTY_PROGRAM: Program = {
  meta: { name: "Kufayeka AF Program", version: 1 },
  triggers: [],
  actions: [],
  flows: { links: [] }
};

export default function HomePage() {
  const [tab, setTab] = useState(0);
  const [program, setProgram] = useState<Program>(EMPTY_PROGRAM);
  const [selectedTriggerId, setSelectedTriggerId] = useState("");
  const [selectedActionId, setSelectedActionId] = useState("");
  const [status, setStatus] = useState("Loading...");

  useEffect(() => {
    fetch("/api/program")
      .then((res) => res.json())
      .then((data: { program?: Program }) => {
        const next = data.program ?? EMPTY_PROGRAM;
        setProgram(next);
        setSelectedTriggerId(next.triggers[0]?.id ?? "");
        setSelectedActionId(next.actions[0]?.id ?? "");
        setStatus("Program loaded");
      })
      .catch((error: Error) => {
        setStatus(`Load error: ${error.message}`);
      });
  }, []);

  const saveProgram = async () => {
    const res = await fetch("/api/program", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ program })
    });

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setStatus(`Save error: ${data.error ?? "unknown error"}`);
      return;
    }
    setStatus("Saved to programs/main.af.json");
  };

  const addTrigger = (): void => {
    const id = `trigger.tick_${Date.now()}`;
    const next: TriggerDefinition = {
      id,
      type: "interval",
      enabled: true,
      intervalMs: 1000,
      message: { payload: 0 }
    };
    setProgram((prev) => ({ ...prev, triggers: [...prev.triggers, next] }));
    setSelectedTriggerId(id);
  };

  const addAction = (): void => {
    const id = `action.script_${Date.now()}`;
    const next: ActionDefinition = {
      id,
      type: "script",
      script: "send(msg);"
    };
    setProgram((prev) => ({ ...prev, actions: [...prev.actions, next] }));
    setSelectedActionId(id);
  };

  const removeTrigger = (id: string): void => {
    setProgram((prev) => ({
      ...prev,
      triggers: prev.triggers.filter((item) => item.id !== id),
      flows: {
        ...prev.flows,
        links: removeNodeFromLinks(prev.flows.links, id)
      }
    }));
    if (selectedTriggerId === id) setSelectedTriggerId("");
  };

  const removeAction = (id: string): void => {
    setProgram((prev) => ({
      ...prev,
      actions: prev.actions.filter((item) => item.id !== id),
      flows: {
        ...prev.flows,
        links: removeNodeFromLinks(prev.flows.links, id)
      }
    }));
    if (selectedActionId === id) setSelectedActionId("");
  };

  const renameTrigger = (oldId: string, newId: string): void => {
    setSelectedTriggerId(newId);
    setProgram((prev) => ({
      ...prev,
      triggers: upsertById(prev.triggers, oldId, { id: newId }),
      flows: {
        ...prev.flows,
        links: renameNodeInLinks(prev.flows.links, oldId, newId)
      }
    }));
  };

  const renameAction = (oldId: string, newId: string): void => {
    setSelectedActionId(newId);
    setProgram((prev) => ({
      ...prev,
      actions: upsertById(prev.actions, oldId, { id: newId }),
      flows: {
        ...prev.flows,
        links: renameNodeInLinks(prev.flows.links, oldId, newId)
      }
    }));
  };

  const updateTrigger = (id: string, patch: Partial<TriggerDefinition>): void => {
    setProgram((prev) => ({
      ...prev,
      triggers: upsertById(prev.triggers, id, patch)
    }));
  };

  const updateAction = (id: string, patch: Partial<ActionDefinition>): void => {
    setProgram((prev) => ({
      ...prev,
      actions: upsertById(prev.actions, id, patch)
    }));
  };

  const updateTriggerPayload = (id: string, rawPayload: string): void => {
    const trigger = program.triggers.find((item) => item.id === id);
    if (!trigger) return;
    updateTrigger(id, {
      message: {
        ...trigger.message,
        payload: parseMaybeJson(rawPayload)
      }
    });
  };

  const addLink = (link: { from: string; to: string }): void => {
    const exists = program.flows.links.some((item) => item.from === link.from && item.to === link.to);
    if (exists) return;

    setProgram((prev) => ({
      ...prev,
      flows: { ...prev.flows, links: [...prev.flows.links, link] }
    }));
  };

  const updateLink = (index: number, patch: { from?: string; to?: string }): void => {
    setProgram((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        links: prev.flows.links.map((link, idx) =>
          idx === index ? { ...link, ...patch } : link
        )
      }
    }));
  };

  const removeLink = (index: number): void => {
    setProgram((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        links: prev.flows.links.filter((_link, idx) => idx !== index)
      }
    }));
  };

  const updateNodePosition = (nodeId: string, position: { x: number; y: number }): void => {
    setProgram((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodePositions: {
          ...(prev.flows.nodePositions || {}),
          [nodeId]: position
        }
      }
    }));
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #eef2ff 0%, #f8fafc 100%)"
      }}
    >
      <AppBar position="static" color="transparent" elevation={0}>
        <Toolbar>
          <Typography variant="h6" sx={{ fontWeight: 700, color: "#0f172a" }}>
            Kufayeka AF Editor
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Button variant="contained" onClick={saveProgram}>
            Save JSON
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth={false} sx={{ py: 2 }}>
        <Paper sx={{ p: 2, mb: 2 }}>
          <TextField
            fullWidth
            label="Program Name"
            value={program.meta.name}
            onChange={(e) =>
              setProgram((prev) => ({
                ...prev,
                meta: { ...prev.meta, name: e.target.value }
              }))
            }
          />
          <Typography variant="body2" sx={{ mt: 1, color: "#334155" }}>
            {status}
          </Typography>
        </Paper>

        <Paper sx={{ p: 0 }}>
          <Tabs value={tab} onChange={(_, value: number) => setTab(value)}>
            <Tab label="Trigger Manager" />
            <Tab label="Action Script Manager" />
            <Tab label="Flow Manager" />
          </Tabs>

          {tab === 0 && (
            <TriggerManager
              triggers={program.triggers}
              selectedTriggerId={selectedTriggerId}
              onSelectTrigger={setSelectedTriggerId}
              onAddTrigger={addTrigger}
              onRemoveTrigger={removeTrigger}
              onRenameTrigger={renameTrigger}
              onUpdateTrigger={updateTrigger}
              onUpdateTriggerPayload={updateTriggerPayload}
            />
          )}
          {tab === 1 && (
            <ActionManager
              actions={program.actions}
              selectedActionId={selectedActionId}
              onSelectAction={setSelectedActionId}
              onAddAction={addAction}
              onRemoveAction={removeAction}
              onRenameAction={renameAction}
              onUpdateAction={updateAction}
            />
          )}
          {tab === 2 && (
            <FlowManager
              triggerIds={program.triggers.map((item) => item.id)}
              actionIds={program.actions.map((item) => item.id)}
              links={program.flows.links}
              nodePositions={program.flows.nodePositions || {}}
              onAddLink={addLink}
              onUpdateLink={updateLink}
              onRemoveLink={removeLink}
              onActionNodeDoubleClick={(actionId) => {
                setSelectedActionId(actionId);
                setTab(1);
              }}
              onNodePositionChange={updateNodePosition}
            />
          )}
        </Paper>
      </Container>
    </Box>
  );
}
