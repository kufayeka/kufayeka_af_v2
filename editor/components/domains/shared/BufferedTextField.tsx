import { TextField } from "@mui/material";
import { memo, useEffect, useState } from "react";

interface BufferedTextFieldProps {
  value: string;
  onCommit: (next: string) => void;
  immediate?: boolean;
  debounceMs?: number;
  [key: string]: unknown;
}

function BufferedTextFieldComponent({
  value,
  onCommit,
  immediate = false,
  debounceMs = 300,
  ...props
}: BufferedTextFieldProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!immediate) return;
    const timer = window.setTimeout(() => {
      if (draft !== value) onCommit(draft);
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [debounceMs, draft, immediate, onCommit, value]);

  return (
    <TextField
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!immediate && draft !== value) onCommit(draft);
      }}
    />
  );
}

export default memo(BufferedTextFieldComponent);
