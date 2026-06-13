/**
 * Bankruptcy / bailout dialog (GDD §2, board phase-5 task 5). The sim drives
 * the flow through advisor events with resolving cause chains (the bailout is
 * granted automatically at the insolvent close; receivership follows a second
 * red close). This surfaces the current state as a dialog the player reads —
 * the decision was the sim's, the explanation is the cause chain on the feed.
 */
import type { ReactNode } from "react";
import { t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

export function BankruptcyDialog(props: { readonly store: UiStore }): ReactNode {
  const events = useUiStore(props.store, (s) => s.advisorEvents);
  const receivership = events.some((e) => e.messageKey === "advisor.receivership");
  const bailout = events.some((e) => e.messageKey === "advisor.bailout");
  if (!receivership && !bailout) {
    return null;
  }
  // Receivership is the terminal state — it wins if both are in the feed.
  const key = receivership ? "bankruptcy.receivership" : "bankruptcy.bailout";
  return (
    <dialog
      open
      data-testid="bankruptcy-dialog"
      data-state={receivership ? "receivership" : "bailout"}
    >
      <h2>{t("bankruptcy.title")}</h2>
      <p>{t(key)}</p>
    </dialog>
  );
}
