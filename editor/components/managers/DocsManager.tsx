import { useEffect, useMemo, useState } from "react";
import {
  Box,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Typography
} from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

type DocItem = {
  id: string;
  name: string;
  relativePath: string;
  content: string;
  size: number;
  updatedAt: string;
};

type DocsApiResponse =
  | { docs: DocItem[]; root: string }
  | { error: string };

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocsManager() {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading docs...");
  const [rootPath, setRootPath] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/docs")
      .then((res) => res.json())
      .then((data: DocsApiResponse) => {
        if (!active) return;
        if ("error" in data) {
          setStatus(`Load error: ${data.error}`);
          return;
        }
        setDocs(data.docs);
        setRootPath(data.root);
        setSelectedDocId((prev) => prev || data.docs[0]?.id || "");
        setStatus(`${data.docs.length} docs loaded`);
      })
      .catch((error: Error) => {
        if (!active) return;
        setStatus(`Load error: ${error.message}`);
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredDocs = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return docs;
    return docs.filter((doc) =>
      `${doc.name} ${doc.relativePath}`.toLowerCase().includes(keyword)
    );
  }, [docs, search]);

  const selectedDoc = useMemo(
    () =>
      filteredDocs.find((doc) => doc.id === selectedDocId) ||
      docs.find((doc) => doc.id === selectedDocId) ||
      filteredDocs[0] ||
      null,
    [docs, filteredDocs, selectedDocId]
  );

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 1 }}>
        <Typography variant="h6">Docs</Typography>
        <Box sx={{ display: "grid", gap: 0.5 }}>
          <TextField
            size="small"
            label="Search docs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Typography variant="caption" color="text.secondary">
            {status}
          </Typography>
        </Box>
        <Paper variant="outlined" sx={{ overflow: "auto", maxHeight: "calc(100vh - 260px)" }}>
          <List dense disablePadding>
            {filteredDocs.map((doc) => (
              <ListItemButton
                key={doc.id}
                selected={selectedDoc?.id === doc.id}
                onClick={() => setSelectedDocId(doc.id)}
                sx={{ alignItems: "flex-start", py: 1 }}
              >
                <ListItemText
                  primary={doc.name}
                  secondary={
                    <>
                      <Typography variant="caption" component="div" color="text.secondary">
                        {doc.relativePath}
                      </Typography>
                      <Typography variant="caption" component="div" color="text.secondary">
                        {formatFileSize(doc.size)} - {new Date(doc.updatedAt).toLocaleString()}
                      </Typography>
                    </>
                  }
                />
              </ListItemButton>
            ))}
            {filteredDocs.length === 0 && (
              <Box sx={{ px: 1.5, py: 1.25 }}>
                <Typography variant="caption" color="text.secondary">
                  No markdown docs found.
                </Typography>
              </Box>
            )}
          </List>
        </Paper>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.25, minHeight: "calc(100vh - 220px)", display: "grid", gap: 1 }}>
        {!selectedDoc && (
          <Typography variant="body2" color="text.secondary">
            Pilih dokumen di panel kiri.
          </Typography>
        )}
        {selectedDoc && (
          <>
            <Box>
              <Typography variant="h6">{selectedDoc.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {selectedDoc.relativePath}
              </Typography>
              {!!rootPath && (
                <Typography variant="caption" component="div" color="text.secondary">
                  Root: {rootPath}
                </Typography>
              )}
            </Box>
            <Paper variant="outlined" sx={{ p: 1.25, bgcolor: "#f8fafc", overflow: "auto", maxHeight: "calc(100vh - 320px)" }}>
              <Box
                className="markdown-body"
                sx={{
                  backgroundColor: "#f8fafc",
                  color: "#0f172a",
                  fontSize: 14,
                  "&.markdown-body": {
                    maxWidth: "100%",
                    p: 0,
                    bgcolor: "transparent"
                  },
                  "& table": {
                    display: "block",
                    width: "100%",
                    overflowX: "auto"
                  },
                  "& pre": {
                    overflowX: "auto"
                  }
                }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    a: ({ ...props }) => (
                      <a {...props} target="_blank" rel="noreferrer noopener" />
                    )
                  }}
                >
                  {selectedDoc.content}
                </ReactMarkdown>
              </Box>
            </Paper>
          </>
        )}
      </Paper>
    </Box>
  );
}
