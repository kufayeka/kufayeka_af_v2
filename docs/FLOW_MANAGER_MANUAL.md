# Flow Manager Manual

This document explains how to use the Flow Manager tab.

## Overview

Flow Manager is used to define action-to-action links and execution flow.

## Core Concepts

- Action node: executable unit in flow.
- Link: directed edge from one action to another.
- Trigger: entry point that emits messages to actions.

## Basic Usage

1. Select a source action.
2. Select a target action.
3. Create a link.
4. Save the program.

## Canvas Interaction

- Use `+`, `-`, and `Reset` for zoom.
- Drag empty canvas area to pan.
- Move nodes using drag handles.

## Editing Links

- Select a link to inspect details.
- Use `Remove` to delete the selected link.

## Naming Rules

Action IDs are used as node IDs in the flow graph.
Renaming an action ID updates link references automatically.

## Recommendations

- Keep flow paths readable and modular.
- Prefer explicit branch actions over deeply nested script logic.
- Validate trigger coverage after any link changes.
