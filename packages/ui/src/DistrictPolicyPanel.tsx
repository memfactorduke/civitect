/**
 * Phase 6 district-policy UI foundation.
 *
 * This panel is deliberately view-model driven: protocol already has district
 * paint/name/policy/ordinance commands, but district snapshot and inspector
 * blocks are not wired into UI yet. The app can mount this once Claude Code's
 * sim/protocol work supplies authoritative district data.
 */
import { CommandType, MAX_DISTRICTS, POLICY_BITS } from "@civitect/protocol";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useDispatch } from "./dispatch";
import { formatCount } from "./format";
import { type I18nKey, t } from "./i18n";

export interface DistrictPolicyOption {
  readonly bit: number;
  readonly labelKey: I18nKey;
}

export interface DistrictStatsViewModel {
  readonly population?: number;
  readonly jobs?: number;
  readonly landValue?: number;
  readonly pollution?: number;
  readonly modeSharePermille?: number;
}

export interface DistrictPolicyViewModel {
  readonly id: number;
  readonly name: string;
  readonly policyMask: number;
  readonly stats?: DistrictStatsViewModel;
}

export interface DistrictPolicyPanelProps {
  readonly district: DistrictPolicyViewModel | null;
  readonly cityOrdinanceMask: number;
  readonly policies: readonly DistrictPolicyOption[];
  readonly ordinances: readonly DistrictPolicyOption[];
}

interface RectDraft {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const EMPTY_RECT: RectDraft = { x0: 0, y0: 0, x1: 0, y1: 0 };

function hasBit(mask: number, bit: number): boolean {
  return Math.floor(mask / 2 ** bit) % 2 === 1;
}

function clampBit(bit: number): number {
  return Math.max(0, Math.min(POLICY_BITS - 1, bit));
}

function clampDistrictId(id: number): number {
  return Math.max(0, Math.min(MAX_DISTRICTS, id));
}

export function DistrictPolicyPanel(props: DistrictPolicyPanelProps): ReactNode {
  const dispatch = useDispatch();
  const [nameDraft, setNameDraft] = useState(props.district?.name ?? "");
  const [rect, setRect] = useState<RectDraft>(EMPTY_RECT);
  const districtId = clampDistrictId(props.district?.id ?? 0);
  const districtName = props.district?.name ?? "";
  const canPaintSelectedDistrict = props.district !== null && districtId !== 0;

  useEffect(() => {
    setNameDraft(districtId === 0 ? "" : districtName);
  }, [districtId, districtName]);

  const paintDistrict = (nextDistrictId: number) => {
    dispatch({
      type: CommandType.paintDistrict,
      x0: rect.x0,
      y0: rect.y0,
      x1: rect.x1,
      y1: rect.y1,
      districtId: clampDistrictId(nextDistrictId),
    });
  };

  return (
    <section aria-label={t("district.title")} data-testid="district-policy-panel">
      <h2>{t("district.title")}</h2>
      {props.district === null ? (
        <p data-testid="district-empty">{t("district.none")}</p>
      ) : (
        <>
          <form
            data-testid="district-name-form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              dispatch({
                type: CommandType.nameDistrict,
                districtId,
                name: nameDraft.trim(),
              });
            }}
          >
            <label>
              {t("district.name")}
              <input
                value={nameDraft}
                data-testid="district-name-input"
                onChange={(event) => setNameDraft(event.target.value)}
              />
            </label>
            <button type="submit">{t("district.rename")}</button>
          </form>
          {props.district.stats !== undefined && <DistrictStats stats={props.district.stats} />}
          <fieldset>
            <legend>{t("district.policies")}</legend>
            {props.policies.map((policy) => {
              const bit = clampBit(policy.bit);
              return (
                <label key={bit}>
                  <input
                    type="checkbox"
                    checked={hasBit(props.district?.policyMask ?? 0, bit)}
                    data-testid={`district-policy-${bit}`}
                    onChange={(event) =>
                      dispatch({
                        type: CommandType.setPolicy,
                        districtId,
                        policy: bit,
                        on: event.currentTarget.checked ? 1 : 0,
                      })
                    }
                  />
                  {t(policy.labelKey)}
                </label>
              );
            })}
          </fieldset>
        </>
      )}
      <fieldset>
        <legend>{t("district.paint")}</legend>
        {(["x0", "y0", "x1", "y1"] as const).map((key) => (
          <label key={key}>
            {t(`district.${key}`)}
            <input
              type="number"
              min={0}
              value={rect[key]}
              data-testid={`district-paint-${key}`}
              onChange={(event) =>
                setRect((prev) => ({ ...prev, [key]: Math.max(0, Number(event.target.value)) }))
              }
            />
          </label>
        ))}
        <button
          type="button"
          disabled={!canPaintSelectedDistrict}
          onClick={() => paintDistrict(districtId)}
        >
          {t("district.paint")}
        </button>
        <button type="button" onClick={() => paintDistrict(0)}>
          {t("district.clear")}
        </button>
      </fieldset>
      <fieldset>
        <legend>{t("district.ordinances")}</legend>
        {props.ordinances.map((ordinance) => {
          const bit = clampBit(ordinance.bit);
          return (
            <label key={bit}>
              <input
                type="checkbox"
                checked={hasBit(props.cityOrdinanceMask, bit)}
                data-testid={`district-ordinance-${bit}`}
                onChange={(event) =>
                  dispatch({
                    type: CommandType.setOrdinance,
                    ordinance: bit,
                    on: event.currentTarget.checked ? 1 : 0,
                  })
                }
              />
              {t(ordinance.labelKey)}
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}

function DistrictStats(props: { readonly stats: DistrictStatsViewModel }): ReactNode {
  const stats = props.stats;
  return (
    <dl data-testid="district-stats" aria-label={t("district.stats")}>
      {stats.population !== undefined && (
        <>
          <dt>{t("district.population")}</dt>
          <dd data-testid="district-stat-population">{formatCount(stats.population)}</dd>
        </>
      )}
      {stats.jobs !== undefined && (
        <>
          <dt>{t("district.jobs")}</dt>
          <dd data-testid="district-stat-jobs">{formatCount(stats.jobs)}</dd>
        </>
      )}
      {stats.landValue !== undefined && (
        <>
          <dt>{t("district.landValue")}</dt>
          <dd data-testid="district-stat-land-value">{formatCount(stats.landValue)}</dd>
        </>
      )}
      {stats.pollution !== undefined && (
        <>
          <dt>{t("district.pollution")}</dt>
          <dd data-testid="district-stat-pollution">{formatCount(stats.pollution)}</dd>
        </>
      )}
      {stats.modeSharePermille !== undefined && (
        <>
          <dt>{t("district.modeShare")}</dt>
          <dd data-testid="district-stat-mode-share">
            {(stats.modeSharePermille / 10).toFixed(0)}%
          </dd>
        </>
      )}
    </dl>
  );
}
