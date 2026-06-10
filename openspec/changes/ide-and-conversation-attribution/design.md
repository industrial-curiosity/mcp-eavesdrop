## Context

Current monitoring attribution is sourced from wrapper env vars written at wrap time. This is stable for IDE identity but unstable for workspace identity because user-level MCP entries are shared across contexts. In practice this causes logs and filters to attribute calls to the installation workspace instead of the real caller context.

The requested scope is deliberately narrow: remove workspace attribution from wrapper env, preserve IDE attribution, standardize conversation attribution fallback to `"not detected"`, and update the panel to present/filter by IDE plus conversation ID.

## Goals / Non-Goals

**Goals:**
- Stop persisting workspace identity in wrapped MCP env metadata.
- Continue persisting IDE identity in wrapped MCP env metadata.
- Ensure conversation ID is always present in telemetry as a normalized string (`"not detected"` fallback).
- Replace UI/source filtering dependency on IDE/workspace with IDE and conversation ID.
- Preserve compatibility with already-wrapped entries by stripping legacy workspace env keys during wrap/unwrap/self-heal paths.

**Non-Goals:**
- Introducing per-window perfect attribution where the host does not emit caller workspace metadata.
- Adopting proposed/private IDE APIs.
- Redesigning daemon IPC transport.

## Decisions

### 1. Make workspace env metadata unsupported going forward
- Decision: Remove workspace slug from `WrapOptions` and from wrapped env metadata creation.
- Rationale: This value is stamped at configuration-edit time, not call time, so it is structurally unreliable.
- Alternative considered: Keep workspace slug but mark low-confidence. Rejected because it still pollutes filtering and display as if trustworthy.

### 2. Keep IDE env metadata as stable attribution dimension
- Decision: Continue writing and consuming IDE identity in wrapper metadata.
- Rationale: MCP config location and wrapping behavior are already IDE-scoped, and this signal remains useful for grouping.
- Alternative considered: Remove both IDE and workspace from env. Rejected because this would regress an accurate and already-available dimension.

### 3. Preserve recorded conversation metadata; normalize only in UI
- Decision: Wrapper preserves conversation metadata exactly as observed on the wire and does not synthesize fallback values; panel display/filtering maps missing values to `"not detected"`.
- Rationale: Event data should reflect source truth, while UX-specific fallback handling belongs in presentation logic.
- Alternative considered: Wrapper-level fallback normalization. Rejected because it conflates storage semantics with display semantics.

### 4. Re-key panel source/display from IDE/workspace to IDE+conversation
- Decision: Update event rendering and filter state keys to use IDE and conversation ID; add a dedicated conversation ID column.
- Rationale: Workspace is intentionally removed from attribution; conversation identity is the next most actionable discriminator when available.
- Alternative considered: Keep old IDE/workspace label and append conversation ID. Rejected because it preserves a misleading workspace field.

### 5. Treat workspace env metadata as deprecated and non-authoritative
- Decision: Wrapper runtime ignores legacy workspace env keys, enable monitoring never writes the workspace key, and disable monitoring removes the key if present.
- Rationale: This directly prevents stale workspace attribution while keeping migration behavior simple and predictable.
- Alternative considered: requiring explicit migration before correctness. Rejected because this delays correctness until manual intervention.

## Risks / Trade-offs

- [Reduced spatial context] Removing workspace from source labels may reduce quick visual context for some users -> Mitigation: keep IDE grouping and add explicit conversation column/filter.
- [Conversation ID availability differs by host/path] Some hosts may not supply conversation metadata -> Mitigation: preserve absence in event data and normalize to `"not detected"` in display/filter logic.
- [Legacy log heterogeneity] Existing log files contain workspace-based records -> Mitigation: panel tolerates historical records while new events use the updated schema semantics.

## Migration Plan

1. Update wrap/unwrap metadata contract to stop writing workspace env metadata and strip legacy keys.
2. Keep wrapper telemetry conversation fields source-faithful (present only when observed); add `"not detected"` fallback mapping in panel display/filter logic.
3. Update event typing/UI rendering and filter keys to IDE + conversation ID; add conversation column.
4. Update tests for wrap metadata expectations, telemetry payload expectations, and panel filtering behavior.
5. Deploy wrapper as usual through extension activation; legacy entries are cleaned on re-wrap/disable/self-heal paths.

Rollback strategy:
- Revert wrapper and panel changes together to avoid mixed semantics.
- Re-enable old workspace filter only if required for emergency compatibility.

## Open Questions

- Should request ID also become a visible column/filter, or remain in expanded details only?
- Should `"not detected"` be localized/display-transformed in UI while stored canonically in events?
