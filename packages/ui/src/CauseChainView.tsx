/**
 * Generic cause-chain renderer (ADR-009). Warning surfaces can share this
 * instead of each panel inventing its own entity-link markup.
 */
import type { CauseChain } from "@civitect/protocol";
import type { ReactNode } from "react";
import { type I18nKey, t } from "./i18n";

const KIND_LABELS: Readonly<Record<number, I18nKey>> = {
  1: "cause.kind.tile",
  2: "cause.kind.building",
  3: "cause.kind.edge",
  4: "cause.kind.agent",
  5: "cause.kind.system",
};

export function CauseChainView(props: {
  readonly chain: CauseChain;
  readonly compact?: boolean;
}): ReactNode {
  return (
    <div data-testid="cause-chain" data-summary-key={props.chain.summaryKey}>
      {!props.compact && <em>{props.chain.summaryKey}</em>}
      <ul>
        {props.chain.links.map((link) => (
          <li
            key={`${link.subject.kind}:${link.subject.id}:${link.labelKey}`}
            data-testid="cause-link"
            data-subject-kind={entityKindName(link.subject.kind)}
            data-subject-id={link.subject.id}
          >
            <span>{link.labelKey}</span>{" "}
            <span>
              {entityKindName(link.subject.kind)}#{link.subject.id}
            </span>{" "}
            <span>({link.weightPermille}‰)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function entityKindName(kind: number): string {
  const label = KIND_LABELS[kind];
  return label === undefined ? t("cause.kind.unknown") : t(label);
}
