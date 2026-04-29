import dynamic from "next/dynamic";
import { memo } from "react";
import type FlowManager from "../managers/FlowManager";
import DomainLoading from "./DomainLoading";

type FlowDomainPanelProps = React.ComponentProps<typeof FlowManager>;

const FlowManagerView = dynamic(() => import("../managers/FlowManager"), {
  loading: () => <DomainLoading label="Loading flow editor..." />
});

function FlowDomainPanel(props: FlowDomainPanelProps) {
  return <FlowManagerView {...props} />;
}

export default memo(FlowDomainPanel);
