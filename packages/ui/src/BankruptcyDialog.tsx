/**
 * Bankruptcy / bailout dialog (GDD §2, board phase-5 task 5). The sim drives
 * the flow through advisor events with resolving cause chains (the bailout is
 * granted automatically at the insolvent close; receivership follows a second
 * red close). This surfaces the current state as a dialog the player reads —
 * the decision was the sim's, the explanation is the cause chain on the feed.
 */
import type { ReactNode } from "react";
import { formatSignedCents } from "./format";
import { type I18nKey, t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

type ReportLine = NonNullable<ReturnType<UiStore["getState"]>["report"]>["lines"][number];

function reportNet(lines: readonly ReportLine[]): number {
  return lines.reduce((sum, line) => sum + line.amountCents, 0);
}

function topExpenseLines(lines: readonly ReportLine[]): readonly ReportLine[] {
  return [...lines]
    .filter((line) => line.amountCents < 0)
    .sort((a, b) => a.amountCents - b.amountCents || a.kind - b.kind)
    .slice(0, 3);
}

export function BankruptcyDialog(props: { readonly store: UiStore }): ReactNode {
  const events = useUiStore(props.store, (s) => s.advisorEvents);
  const report = useUiStore(props.store, (s) => s.report);
  const receivership = events.some((e) => e.messageKey === "advisor.receivership");
  const bailout = events.some((e) => e.messageKey === "advisor.bailout");
  if (!receivership && !bailout) {
    return null;
  }
  // Receivership is the terminal state — it wins if both are in the feed.
  const key = receivership ? "bankruptcy.receivership" : "bankruptcy.bailout";
  const expenses = report === null ? [] : topExpenseLines(report.lines);
  const net = report === null ? 0 : reportNet(report.lines);
  return (
    <dialog
      open
      data-testid="bankruptcy-dialog"
      data-state={receivership ? "receivership" : "bailout"}
    >
      <h2>{t("bankruptcy.title")}</h2>
      <p>{t(key)}</p>
      {report !== null && (
        <section aria-label={t("bankruptcy.report")} data-testid="bankruptcy-report">
          <h3>
            {t("bankruptcy.report")} {report.month}
          </h3>
          <dl>
            <dt>{t("bankruptcy.net")}</dt>
            <dd data-testid="bankruptcy-net" data-cents={net}>
              {formatSignedCents(net)}
            </dd>
          </dl>
          {expenses.length > 0 && (
            <>
              <h4>{t("bankruptcy.topDrains")}</h4>
              <ol data-testid="bankruptcy-drivers">
                {expenses.map((line) => (
                  <li
                    key={line.kind}
                    data-testid={`bankruptcy-driver-${line.kind}`}
                    data-kind={line.kind}
                    data-cents={line.amountCents}
                  >
                    <span>{t(`report.line.${line.kind}` as I18nKey)}</span>
                    <strong>{formatSignedCents(line.amountCents)}</strong>
                    <em>
                      {t("bankruptcy.delta")} {formatSignedCents(line.deltaCents)}
                    </em>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}
    </dialog>
  );
}
