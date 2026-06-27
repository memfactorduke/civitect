/**
 * Monthly report panel (GDD §12/§13, board phase-5 task 5): income/expense
 * lines with month-over-month deltas — the report explains itself (pillar 2).
 * The displayed NET is the sum of the displayed lines, exactly (the
 * demand-panel property pattern): what the player sees adds up.
 *
 * Per-line CauseChain why-links need cause refs on the wire (the ReportLine
 * struct carries only kind/amount/delta today); until that protocol addition,
 * the line KIND is its "why" and the advisor feed carries the resolvable
 * cause chains [scoped].
 */
import type { ReactNode } from "react";
import { formatSignedCents } from "./format";
import { type I18nKey, t } from "./i18n";
import { type UiStore, useUiStore } from "./store";

interface ReportLedger {
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
  readonly netDeltaCents: number;
}

function summarizeReport(
  lines: readonly { readonly amountCents: number; readonly deltaCents: number }[],
): ReportLedger {
  let incomeCents = 0;
  let expenseCents = 0;
  let netDeltaCents = 0;
  for (const line of lines) {
    if (line.amountCents > 0) {
      incomeCents += line.amountCents;
    } else {
      expenseCents += line.amountCents;
    }
    netDeltaCents += line.deltaCents;
  }
  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents + expenseCents,
    netDeltaCents,
  };
}

export function ReportPanel(props: { readonly store: UiStore }): ReactNode {
  const report = useUiStore(props.store, (s) => s.report);
  if (report === null) {
    return null;
  }
  const ledger = summarizeReport(report.lines);
  return (
    <section aria-label={t("report.title")} data-testid="report-panel">
      <h2>
        {t("report.title")} — {t("report.month")} {report.month}
      </h2>
      <dl data-testid="report-ledger">
        <div>
          <dt>{t("report.income")}</dt>
          <dd data-testid="report-income-total" data-cents={ledger.incomeCents}>
            {formatSignedCents(ledger.incomeCents)}
          </dd>
        </div>
        <div>
          <dt>{t("report.expenses")}</dt>
          <dd data-testid="report-expense-total" data-cents={ledger.expenseCents}>
            {formatSignedCents(ledger.expenseCents)}
          </dd>
        </div>
        <div>
          <dt>{t("report.change")}</dt>
          <dd data-testid="report-net-delta" data-cents={ledger.netDeltaCents}>
            {formatSignedCents(ledger.netDeltaCents)}
          </dd>
        </div>
      </dl>
      <ul data-testid="report-lines">
        {report.lines.map((line) => (
          <li key={line.kind} data-testid={`report-line-${line.kind}`}>
            <span>{t(`report.line.${line.kind}` as I18nKey)}</span>
            <span data-testid={`report-amount-${line.kind}`} data-cents={line.amountCents}>
              {formatSignedCents(line.amountCents)}
            </span>
            <em data-testid={`report-delta-${line.kind}`} data-cents={line.deltaCents}>
              ({formatSignedCents(line.deltaCents)})
            </em>
          </li>
        ))}
      </ul>
      <strong data-testid="report-net" data-cents={ledger.netCents}>
        {t("report.net")} {formatSignedCents(ledger.netCents)}
      </strong>
    </section>
  );
}
