import { Box, Typography } from "@mui/material";
import { memo } from "react";

interface DomainLoadingProps {
  label: string;
}

function DomainLoadingComponent({ label }: DomainLoadingProps) {
  return (
    <Box
      sx={{
        minHeight: "42vh",
        display: "grid",
        placeItems: "center"
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

export default memo(DomainLoadingComponent);
