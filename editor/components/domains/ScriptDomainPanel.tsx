import dynamic from "next/dynamic";
import { memo } from "react";
import type ActionManager from "../managers/ActionManager";
import DomainLoading from "./DomainLoading";

type ScriptDomainPanelProps = React.ComponentProps<typeof ActionManager>;

const ActionManagerView = dynamic(() => import("../managers/ActionManager"), {
  loading: () => <DomainLoading label="Loading script editor..." />
});

function ScriptDomainPanel(props: ScriptDomainPanelProps) {
  return <ActionManagerView {...props} />;
}

export default memo(ScriptDomainPanel);
