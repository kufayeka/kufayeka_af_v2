import dynamic from "next/dynamic";
import { memo } from "react";
import type EventDesignerManager from "../managers/EventDesignerManager";
import DomainLoading from "./DomainLoading";

type EventDomainPanelProps = React.ComponentProps<typeof EventDesignerManager>;

const EventDesignerManagerView = dynamic(() => import("../managers/EventDesignerManager"), {
  loading: () => <DomainLoading label="Loading event editor..." />
});

function EventDomainPanel(props: EventDomainPanelProps) {
  return <EventDesignerManagerView {...props} />;
}

export default memo(EventDomainPanel);
