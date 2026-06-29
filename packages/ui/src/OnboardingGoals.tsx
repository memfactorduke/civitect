/**
 * First-city goal track (GDD §15 onboarding): compact, snapshot-derived, and
 * command-free. It names the next city objective without adding any sim state.
 */
import type { ReactNode } from "react";
import { formatCount } from "./format";
import { type I18nKey, t } from "./i18n";
import { type UiState, type UiStore, useUiStore } from "./store";

type GoalStatus = "done" | "current" | "next";
type GoalSource = Pick<
  UiState,
  "fundsCents" | "milestone" | "population" | "report" | "roadCount" | "zonedTileCount"
>;

interface Goal {
  readonly key: I18nKey;
  readonly complete: boolean;
  readonly value: string;
}

interface GoalView extends Goal {
  readonly status: GoalStatus;
}

function goalsFor(state: GoalSource): readonly Goal[] {
  return [
    {
      key: "onboarding.goal.roads",
      complete: state.roadCount > 0,
      value: formatCount(state.roadCount),
    },
    {
      key: "onboarding.goal.zones",
      complete: state.zonedTileCount > 0,
      value: formatCount(state.zonedTileCount),
    },
    {
      key: "onboarding.goal.residents",
      complete: state.population > 0,
      value: formatCount(state.population),
    },
    {
      key: "onboarding.goal.milestone",
      complete: state.milestone !== null && state.milestone.index > 0,
      value:
        state.milestone === null || state.milestone.populationTarget === 0
          ? formatCount(state.population)
          : `${formatCount(state.population)} / ${formatCount(state.milestone.populationTarget)}`,
    },
    {
      key: "onboarding.goal.month",
      complete: state.report !== null,
      value: state.report === null ? t("onboarding.value.pending") : String(state.report.month),
    },
    {
      key: "onboarding.goal.solvent",
      complete: state.fundsCents >= 0,
      value: state.fundsCents < 0 ? t("onboarding.value.deficit") : t("onboarding.value.ok"),
    },
  ];
}

function viewGoals(goals: readonly Goal[]): readonly GoalView[] {
  const activeIndex = goals.findIndex((goal) => !goal.complete);
  return goals.map((goal, index) => ({
    ...goal,
    status: goal.complete ? "done" : index === activeIndex ? "current" : "next",
  }));
}

export function OnboardingGoals(props: { readonly store: UiStore }): ReactNode {
  const roadCount = useUiStore(props.store, (s) => s.roadCount);
  const zonedTileCount = useUiStore(props.store, (s) => s.zonedTileCount);
  const population = useUiStore(props.store, (s) => s.population);
  const milestone = useUiStore(props.store, (s) => s.milestone);
  const report = useUiStore(props.store, (s) => s.report);
  const fundsCents = useUiStore(props.store, (s) => s.fundsCents);
  const state = { fundsCents, milestone, population, report, roadCount, zonedTileCount };
  const goals = viewGoals(goalsFor(state));
  const completed = goals.filter((goal) => goal.complete).length;

  return (
    <section aria-label={t("onboarding.title")} data-testid="onboarding-goals">
      <h2>{t("onboarding.title")}</h2>
      <progress
        aria-label={t("onboarding.progress")}
        data-testid="onboarding-progress"
        max={goals.length}
        value={completed}
      />
      <ol>
        {goals.map((goal) => (
          <li
            key={goal.key}
            data-status={goal.status}
            data-testid={`onboarding-${goal.status}-${goal.key}`}
          >
            <span>{t(goal.key)}</span>
            <output>{goal.value}</output>
            <small>{t(`onboarding.status.${goal.status}` as I18nKey)}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
