import dynamic from "next/dynamic";
import DomainLoading from "../components/domains/DomainLoading";

const EditorWorkspacePage = dynamic(
  () => import("../features/editor/EditorWorkspace"),
  {
    ssr: false,
    loading: () => <DomainLoading label="Loading editor workspace..." />
  }
);

export default function EditorPage() {
  return <EditorWorkspacePage />;
}
