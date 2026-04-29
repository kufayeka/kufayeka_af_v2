import { Box } from "@mui/material";
import AssetDomainPanel from "../../components/domains/AssetDomainPanel";
import EventDomainPanel from "../../components/domains/EventDomainPanel";
import FlowDomainPanel from "../../components/domains/FlowDomainPanel";
import {
  DbConnectionDomainPanel,
  DocsDomainPanel,
  EventViewDomainPanel,
  GlobalStoreDomainPanel
} from "../../components/domains/RuntimeDomainPanels";
import ScriptDomainPanel from "../../components/domains/ScriptDomainPanel";
import type { EditorWorkspaceState } from "./useEditorWorkspaceState";

interface EditorWorkspaceContentProps {
  state: EditorWorkspaceState;
}

export default function EditorWorkspaceContent({ state }: EditorWorkspaceContentProps) {
  const {
    activeFlow,
    activeFlowVariableNames,
    addAction,
    addEventAction,
    addEventActionFromTemplate,
    addEventTemplate,
    addFlowDefinition,
    deleteNodesFromFlow,
    derivedActions,
    derivedEventActions,
    duplicateAction,
    duplicateEventAction,
    duplicateEventTemplate,
    duplicateFlowDefinition,
    duplicateNodesInFlow,
    flowActionIds,
    flowEventNodeIds,
    flowNodeLabels,
    flowNodeOutputs,
    flowNodeSubtitles,
    flowTriggerIds,
    flowZoom,
    handleActionNodeDoubleClick,
    handleConnectNodes,
    handleDropPaletteItem,
    handleEventNodeDoubleClick,
    handleNodePositionDragStart,
    handleTriggerNodeDoubleClick,
    program,
    removeAction,
    removeEventAction,
    removeEventTemplate,
    removeFlowDefinition,
    removeLink,
    removeNodeFromFlow,
    removeScriptTemplate,
    renameAction,
    renameEventAction,
    selectedActionId,
    selectedEventActionId,
    selectedEventTemplateId,
    selectedFlowId,
    selectedScriptTemplateId,
    setFlowZoom,
    setSelectedActionId,
    setSelectedEventActionId,
    setSelectedEventTemplateId,
    setSelectedScriptTemplateId,
    setStatus,
    switchActiveFlow,
    tab,
    updateAction,
    updateAssets,
    updateEventAction,
    updateEventTemplate,
    updateFlowDefinition,
    updateLink,
    updateNodePosition,
    updateScriptTemplate
  } = state;

  return (
    <Box sx={{ px: 1, py: 1 }}>
      {tab === 0 && <AssetDomainPanel assets={program.assets} onChange={updateAssets} />}
      {tab === 1 && (
        <FlowDomainPanel
          flows={program.flowDefinitions || []}
          selectedFlowId={program.activeFlowId || selectedFlowId}
          activeFlowVariables={activeFlow.variables || []}
          triggerIds={flowTriggerIds}
          triggerTemplates={program.triggerTemplates || []}
          actionIds={flowActionIds}
          eventNodeIds={flowEventNodeIds}
          scriptTemplates={program.scriptTemplates}
          eventTemplates={program.eventTemplates || []}
          nodeLabels={flowNodeLabels}
          nodeSubtitles={flowNodeSubtitles}
          nodeOutputs={flowNodeOutputs}
          links={program.flows.links}
          nodePositions={program.flows.nodePositions || {}}
          zoom={flowZoom}
          onZoomChange={setFlowZoom}
          onAddLink={state.addLink}
          onUpdateLink={updateLink}
          onRemoveLink={removeLink}
          onRemoveNodeFromFlow={removeNodeFromFlow}
          onDeleteNodes={deleteNodesFromFlow}
          onDuplicateNodes={duplicateNodesInFlow}
          onTriggerNodeDoubleClick={handleTriggerNodeDoubleClick}
          onActionNodeDoubleClick={handleActionNodeDoubleClick}
          onEventNodeDoubleClick={handleEventNodeDoubleClick}
          onNodePositionDragStart={handleNodePositionDragStart}
          onNodePositionChange={updateNodePosition}
          onConnectNodes={handleConnectNodes}
          onDropPaletteItem={handleDropPaletteItem}
          onSelectFlow={switchActiveFlow}
          onAddFlow={addFlowDefinition}
          onDuplicateFlow={duplicateFlowDefinition}
          onRemoveFlow={removeFlowDefinition}
          onUpdateFlow={updateFlowDefinition}
        />
      )}
      {tab === 2 && (
        <ScriptDomainPanel
          actions={derivedActions}
          scriptTemplates={program.scriptTemplates}
          assets={program.assets}
          flowVariableNames={activeFlowVariableNames}
          selectedActionId={selectedActionId}
          selectedScriptTemplateId={selectedScriptTemplateId}
          onSelectAction={setSelectedActionId}
          onSelectScriptTemplate={setSelectedScriptTemplateId}
          onAddAction={addAction}
          onDuplicateAction={duplicateAction}
          onRemoveAction={removeAction}
          onRenameAction={renameAction}
          onUpdateAction={updateAction}
          onAddScriptTemplate={state.addScriptTemplate}
          onRemoveScriptTemplate={removeScriptTemplate}
          onUpdateScriptTemplate={updateScriptTemplate}
          templateOnly
        />
      )}
      {tab === 3 && (
        <EventDomainPanel
          eventActions={derivedEventActions}
          eventTemplates={program.eventTemplates || []}
          assets={program.assets}
          flowVariableNames={activeFlowVariableNames}
          selectedEventActionId={selectedEventActionId}
          selectedEventTemplateId={selectedEventTemplateId}
          onSelectEventAction={setSelectedEventActionId}
          onSelectEventTemplate={setSelectedEventTemplateId}
          onAddEventAction={addEventAction}
          onAddEventActionFromTemplate={addEventActionFromTemplate}
          onDuplicateEventAction={duplicateEventAction}
          onUpdateEventAction={updateEventAction}
          onRenameEventAction={renameEventAction}
          onRemoveEventAction={removeEventAction}
          onAddEventTemplate={addEventTemplate}
          onDuplicateEventTemplate={duplicateEventTemplate}
          onRemoveEventTemplate={removeEventTemplate}
          onUpdateEventTemplate={updateEventTemplate}
          templateOnly
        />
      )}
      {tab === 4 && <DbConnectionDomainPanel />}
      {tab === 5 && <EventViewDomainPanel />}
      {tab === 6 && <GlobalStoreDomainPanel onStatus={setStatus} />}
      {tab === 7 && <DocsDomainPanel />}
    </Box>
  );
}
