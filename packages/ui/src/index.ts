/**
 * @civitect/ui — React panels/HUD above the Pixi canvas (TDD §9, ADR-009).
 *
 * Boundaries (TDD §9): talks to sim only via protocol commands (dispatch
 * emits intents; the app shell stamps seq/tick); advisor events will render
 * through the generic CauseChain inspector — events without cause chains
 * fail typecheck (ADR-009); all strings through i18n keys.
 */

export { ActionPriorityPanel } from "./ActionPriorityPanel";
export { AdvisorFeed } from "./AdvisorFeed";
export { BankruptcyDialog } from "./BankruptcyDialog";
export { BudgetPanel } from "./BudgetPanel";
export { BuildingInspector } from "./BuildingInspector";
export { DemandPanel } from "./DemandPanel";
export { type CommandIntent, type DispatchFn, DispatchProvider, useDispatch } from "./dispatch";
export { formatCount, formatFundsCents, formatSignedCents } from "./format";
export { Hud } from "./Hud";
export { type I18nKey, t } from "./i18n";
export { MilestoneToast } from "./MilestoneToast";
export { Overlay } from "./Overlay";
export { OverlayPicker } from "./OverlayPicker";
export { ReportPanel } from "./ReportPanel";
export { RoadInspector } from "./RoadInspector";
export { SpeedControls } from "./SpeedControls";
export { createUiStore, type UiState, type UiStore, useUiStore } from "./store";
export { TaxLoanPanel } from "./TaxLoanPanel";
