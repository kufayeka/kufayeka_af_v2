import { Box, Button, IconButton, TableCell } from "@mui/material";
import { RefreshCcw } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

interface AttributeValueEditorCellsProps {
  assetId: string;
  attributeName: string;
  initialValue: string;
  fullPath: string;
  isRefreshing: boolean;
  historianEnabled: boolean;
  onRefresh: () => void;
  onApply: (draftValue: string) => void | Promise<void>;
  onDeleteHistorian?: () => void;
}

function AttributeValueEditorCellsComponent({
  assetId,
  attributeName,
  initialValue,
  fullPath,
  isRefreshing,
  historianEnabled,
  onRefresh,
  onApply,
  onDeleteHistorian
}: AttributeValueEditorCellsProps) {
  const editorKey = useMemo(() => `${assetId}:${attributeName}`, [assetId, attributeName]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draftValue, setDraftValue] = useState(initialValue);
  const [isDirty, setIsDirty] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    setDraftValue(initialValue);
    setIsDirty(false);
    if (inputRef.current && inputRef.current.value !== initialValue) {
      inputRef.current.value = initialValue;
    }
  }, [editorKey, initialValue]);

  const hasDraft = isDirty && draftValue !== initialValue;

  return (
    <>
      <TableCell sx={{ minWidth: 280 }}>
        <Box
          ref={inputRef}
          component="input"
          defaultValue={initialValue}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const nextValue = e.target.value;
            setDraftValue(nextValue);
            const dirty = nextValue !== initialValue;
            setIsDirty((prev) => (prev === dirty ? prev : dirty));
          }}
          sx={{
            width: "100%",
            minHeight: 36,
            border: "1px solid #cbd5e1",
            borderRadius: 1,
            px: 1.25,
            py: 0.75,
            font: "inherit",
            color: "#0f172a",
            backgroundColor: "#fff",
            outline: "none",
            "&:focus": {
              borderColor: "#0f766e",
              boxShadow: "0 0 0 3px rgba(15, 118, 110, 0.12)"
            }
          }}
        />
      </TableCell>
      <TableCell>
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
          <IconButton
            size="small"
            aria-label={`Refresh runtime value for ${fullPath}`}
            title={`Refresh runtime value for ${fullPath}`}
            disabled={isRefreshing || isApplying}
            onClick={onRefresh}
          >
            <RefreshCcw size={15} />
          </IconButton>
          <Button
            size="small"
            variant="contained"
            disabled={!hasDraft || isApplying}
            onClick={() => {
              const liveValue = inputRef.current?.value ?? draftValue;
              setDraftValue(liveValue);
              setIsApplying(true);
              Promise.resolve(onApply(liveValue)).finally(() => {
                setIsApplying(false);
                setIsDirty(false);
              });
            }}
          >
            Apply
          </Button>
          {historianEnabled ? (
            <Button
              size="small"
              color="error"
              variant="outlined"
              onClick={onDeleteHistorian}
              disabled={isApplying}
            >
              Delete Historian
            </Button>
          ) : null}
        </Box>
      </TableCell>
    </>
  );
}

export default memo(AttributeValueEditorCellsComponent);
