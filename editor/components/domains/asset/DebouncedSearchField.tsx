import { TextField } from "@mui/material";
import { memo, useEffect, useState } from "react";

interface DebouncedSearchFieldProps {
  placeholder: string;
  delayMs?: number;
  initialValue?: string;
  fullWidth?: boolean;
  sx?: object;
  onCommit: (next: string) => void;
}

function DebouncedSearchFieldComponent({
  placeholder,
  delayMs = 300,
  initialValue = "",
  fullWidth,
  sx,
  onCommit
}: DebouncedSearchFieldProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onCommit(value);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, onCommit, value]);

  return (
    <TextField
      size="small"
      fullWidth={fullWidth}
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      sx={sx}
    />
  );
}

export default memo(DebouncedSearchFieldComponent);
