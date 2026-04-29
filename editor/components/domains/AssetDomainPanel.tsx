import dynamic from "next/dynamic";
import { memo } from "react";
import type AssetManager from "../managers/AssetManager";
import DomainLoading from "./DomainLoading";

type AssetDomainPanelProps = React.ComponentProps<typeof AssetManager>;

const AssetManagerView = dynamic(() => import("../managers/AssetManager"), {
  loading: () => <DomainLoading label="Loading asset editor..." />
});

function AssetDomainPanel(props: AssetDomainPanelProps) {
  return <AssetManagerView {...props} />;
}

export default memo(AssetDomainPanel);
