import dynamic from "next/dynamic";
import { memo } from "react";
import DomainLoading from "./DomainLoading";

interface GlobalStoreDomainPanelProps {
  onStatus: (message: string) => void;
}

const DbConnectionManagerView = dynamic(() => import("../managers/DbConnectionManager"), {
  loading: () => <DomainLoading label="Loading DB tools..." />
});

const EventManagerView = dynamic(() => import("../managers/EventManager"), {
  loading: () => <DomainLoading label="Loading event view..." />
});

const GlobalStoreManagerView = dynamic(() => import("../managers/GlobalStoreManager"), {
  loading: () => <DomainLoading label="Loading global store..." />
});

const DocsManagerView = dynamic(() => import("../managers/DocsManager"), {
  loading: () => <DomainLoading label="Loading docs..." />
});

export const DbConnectionDomainPanel = memo(function DbConnectionDomainPanel() {
  return <DbConnectionManagerView />;
});

export const EventViewDomainPanel = memo(function EventViewDomainPanel() {
  return <EventManagerView />;
});

export const GlobalStoreDomainPanel = memo(function GlobalStoreDomainPanel(props: GlobalStoreDomainPanelProps) {
  return <GlobalStoreManagerView onStatus={props.onStatus} />;
});

export const DocsDomainPanel = memo(function DocsDomainPanel() {
  return <DocsManagerView />;
});
