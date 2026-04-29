import { AppBar, Box, Button, Divider, Tab, Tabs, TextField, Toolbar, Typography } from "@mui/material";
import { memo } from "react";

interface ProgramHeaderProps {
  programName: string;
  tab: number;
  canUndo: boolean;
  canRedo: boolean;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onProgramNameChange: (next: string) => void;
  onTabChange: (next: number) => void;
  onImportFile: (file: File) => void | Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void | Promise<void>;
  onOpenImport: () => void;
  onExport: () => void;
}

function ProgramHeaderComponent({
  programName,
  tab,
  canUndo,
  canRedo,
  importInputRef,
  onProgramNameChange,
  onTabChange,
  onImportFile,
  onUndo,
  onRedo,
  onSave,
  onOpenImport,
  onExport
}: ProgramHeaderProps) {
  return (
    <AppBar position="sticky" color="inherit" elevation={1}>
      <Toolbar variant="dense" sx={{ minHeight: "56px !important", gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
          Asset Framework Editor
        </Typography>
        <TextField
          size="small"
          label="Program Name"
          value={programName}
          onChange={(e) => onProgramNameChange(e.target.value)}
          sx={{ minWidth: 300, maxWidth: 520, flexGrow: 1 }}
        />
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.af.json,application/json"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              void onImportFile(file);
            }}
          />
          <Button disabled={!canUndo} variant="outlined" onClick={onUndo}>
            Undo
          </Button>
          <Button disabled={!canRedo} variant="outlined" onClick={onRedo}>
            Redo
          </Button>
          <Button variant="contained" onClick={() => void onSave()}>
            Save Program
          </Button>
          <Button variant="outlined" onClick={onOpenImport}>
            Import Program (JSON)
          </Button>
          <Button variant="outlined" onClick={onExport}>
            Export Program to JSON
          </Button>
        </Box>
      </Toolbar>
      <Divider />
      <Tabs value={tab} onChange={(_, value: number) => onTabChange(value)} variant="scrollable" scrollButtons="auto">
        <Tab label="Asset Manager" />
        <Tab label="Flow Manager" />
        <Tab label="Script Templates" />
        <Tab label="Event Templates" />
        <Tab label="DB Connection" />
        <Tab label="Event View" />
        <Tab label="Global Store" />
        <Tab label="Docs" />
      </Tabs>
    </AppBar>
  );
}

export default memo(ProgramHeaderComponent);
