import type { EventRow } from "../../../runtime/core/runtimeTypes";

export interface EventPerfFixtureOptions {
  openRowCount: number;
  machineCount?: number;
  lineCount?: number;
}

export interface EventPerfFixture {
  openRows: EventRow[];
  hotIds: string[];
  hotPaths: string[];
  hotContextFilters: Array<Record<string, unknown>>;
}

export function createEventPerfFixture(options: EventPerfFixtureOptions): EventPerfFixture {
  const openRowCount = Math.max(1, options.openRowCount);
  const machineCount = Math.max(1, options.machineCount ?? 64);
  const lineCount = Math.max(1, options.lineCount ?? 8);
  const openRows: EventRow[] = [];
  const hotIds: string[] = [];
  const hotPaths = new Set<string>();
  const hotContextFilters: Array<Record<string, unknown>> = [];

  for (let index = 0; index < openRowCount; index += 1) {
    const line = (index % lineCount) + 1;
    const machine = (index % machineCount) + 1;
    const eventPath = `Plant.Line${line}.Machine${String(machine).padStart(3, "0")}.${["Alarm", "Job", "Lifecycle"][index % 3]}`;
    const row: EventRow = {
      id: `open-${index + 1}`,
      event_path: eventPath,
      start_ts: new Date(Date.UTC(2026, 0, 1, 0, Math.floor(index / 60), index % 60)).toISOString(),
      end_ts: null,
      status: "open",
      severity: (["other", "info", "medium", "critical"] as const)[index % 4],
      context: {
        machine: `M${String(machine).padStart(3, "0")}`,
        line: `L${line}`,
        workOrder: `WO-${1000 + (index % 50)}`,
        category: ["production", "setup", "idle"][index % 3],
        shift: ["A", "B", "C"][index % 3]
      },
      is_acknowledge: index % 7 === 0,
      acknowledged_ts: index % 7 === 0 ? new Date(Date.UTC(2026, 0, 1, 1, 0, index % 60)).toISOString() : null,
      notes_on_open: null,
      notes_on_close: null,
      event_metadata: index % 5 === 0 ? { templateId: `tmpl-${index % 6}` } : null,
      captured_data_on_open: index % 4 === 0 ? { source: "fixture", index } : null,
      captured_data_on_close: null
    };
    openRows.push(row);
    if (hotIds.length < 500) hotIds.push(row.id);
    if (hotPaths.size < 250) hotPaths.add(row.event_path);
  }

  for (let index = 0; index < 12; index += 1) {
    hotContextFilters.push({
      category: ["production", "setup", "idle"][index % 3],
      shift: ["A", "B", "C"][index % 3]
    });
  }

  return {
    openRows,
    hotIds,
    hotPaths: Array.from(hotPaths),
    hotContextFilters
  };
}
