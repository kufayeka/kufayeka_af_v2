import type { Program } from "../../types/program";

export type ProgramUpdater = (program: Program) => Program;

export interface HistoryState {
  past: Program[];
  present: Program;
  future: Program[];
}

export type HistoryAction =
  | { type: "INIT"; program: Program }
  | { type: "APPLY"; updater: ProgramUpdater }
  | { type: "APPLY_NO_HISTORY"; updater: ProgramUpdater }
  | { type: "PUSH_SNAPSHOT" }
  | { type: "UNDO" }
  | { type: "REDO" };

const MAX_HISTORY = 40;
const MAX_HISTORY_JSON_BYTES = 24 * 1024 * 1024;

function estimateProgramBytes(program: Program): number {
  try {
    return JSON.stringify(program).length;
  } catch {
    return 0;
  }
}

function trimHistorySnapshots(snapshots: Program[]): Program[] {
  let trimmed = snapshots.slice(Math.max(0, snapshots.length - MAX_HISTORY));
  if (trimmed.length <= 1) return trimmed;

  const sizes = trimmed.map((item) => estimateProgramBytes(item));
  let totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  while (trimmed.length > 1 && totalBytes > MAX_HISTORY_JSON_BYTES) {
    totalBytes -= sizes.shift() || 0;
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === "INIT") {
    return { past: [], present: action.program, future: [] };
  }

  if (action.type === "APPLY") {
    const next = action.updater(state.present);
    if (next === state.present) return state;
    const nextPast = trimHistorySnapshots([...state.past, state.present]);
    return {
      past: nextPast,
      present: next,
      future: []
    };
  }

  if (action.type === "APPLY_NO_HISTORY") {
    const next = action.updater(state.present);
    if (next === state.present) return state;
    return { ...state, present: next };
  }

  if (action.type === "PUSH_SNAPSHOT") {
    const nextPast = trimHistorySnapshots([...state.past, state.present]);
    return {
      ...state,
      past: nextPast,
      future: []
    };
  }

  if (action.type === "UNDO") {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1];
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future]
    };
  }

  if (action.type === "REDO") {
    if (state.future.length === 0) return state;
    const next = state.future[0];
    const nextPast = trimHistorySnapshots([...state.past, state.present]);
    return {
      past: nextPast,
      present: next,
      future: state.future.slice(1)
    };
  }

  return state;
}
