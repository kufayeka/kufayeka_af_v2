import dynamic from "next/dynamic";
import { memo } from "react";
import type FlowNodeInspectorDrawer from "../managers/FlowNodeInspectorDrawer";

type FlowInspectorPanelProps = React.ComponentProps<typeof FlowNodeInspectorDrawer>;

const FlowNodeInspectorDrawerView = dynamic(() => import("../managers/FlowNodeInspectorDrawer"));

function FlowInspectorPanel(props: FlowInspectorPanelProps) {
  return <FlowNodeInspectorDrawerView {...props} />;
}

export default memo(FlowInspectorPanel);
