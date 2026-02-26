# Attribute Template Guide

This document explains how Attribute Templates are used in the editor and runtime.

## What an Attribute Template Is

An Attribute Template is a reusable definition for multiple assets.
Each template contains a list of attribute definitions.

Typical fields:
- `name`
- `valueType`
- `default`
- `unit`
- `historianEnabled`
- `historianTargetId`
- `dashboardVisible`
- `dashboardEditable`
- `nullable`
- `inputType`
- `options` / `optionsScript`

## Common Workflow

1. Create or open a template.
2. Add attribute rows.
3. Configure type/default/unit/historian fields.
4. Assign the template to asset(s).
5. Save and sync runtime.

## Dashboard Behavior

- `dashboardVisible = true`: shown on dashboard forms.
- `dashboardEditable = true`: operator can edit.
- `nullable = true`: `null` values are allowed.

## Input Options Script

`optionsScript` can return option data for select/radio/multiselect fields.
Accepted output forms are normalized to `{ label, value }[]`.

If script execution fails or returns empty data, the UI falls back to static `options` when available.

## Validation Tips

- Validate numeric ranges.
- Validate precision rules for float/decimal fields.
- Validate nullable/non-nullable constraints.
- Keep template IDs stable for long-lived assets.

## Best Practices

- Use internal API/proxy for external data sources.
- Keep template names human-readable and versioned if needed.
- Prefer explicit historian target mapping over implicit defaults.
