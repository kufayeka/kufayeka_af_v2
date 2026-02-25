import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import type { AppProps } from "next/app";
import "rc-tree/assets/index.css";
import "github-markdown-css/github-markdown.css";
import "highlight.js/styles/github.css";

const theme = createTheme({
  typography: {
    fontFamily: "Ubuntu, 'Segoe UI', Arial, sans-serif"
  },
  palette: {
    mode: "light",
    primary: { main: "#0f766e" },
    secondary: { main: "#1d4ed8" },
    background: { default: "#f8fafc" }
  },
  shape: { borderRadius: 4 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 4
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          paddingTop: 2,
          paddingBottom: 2
        }
      }
    },
    MuiButton: {
      defaultProps: {
        size: "small"
      }
    },
    MuiTextField: {
      defaultProps: {
        size: "small"
      }
    }
  }
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Component {...pageProps} />
    </ThemeProvider>
  );
}
