// @vitest-environment jsdom
import { CommandType } from "@civitect/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type DistrictPolicyOption, DistrictPolicyPanel } from "./DistrictPolicyPanel";
import type { CommandIntent } from "./dispatch";
import { DispatchProvider } from "./dispatch";

afterEach(cleanup);

const POLICIES: readonly DistrictPolicyOption[] = [
  { bit: 1, labelKey: "district.policy.freeTransit" },
  { bit: 3, labelKey: "district.policy.highRiseBan" },
];

const ORDINANCES: readonly DistrictPolicyOption[] = [
  { bit: 5, labelKey: "district.ordinance.congestionCharge" },
  { bit: 6, labelKey: "district.ordinance.noise" },
];

function renderPanel(dispatched: CommandIntent[]): void {
  render(
    <DispatchProvider dispatch={(intent) => dispatched.push(intent)}>
      <DistrictPolicyPanel
        district={{
          id: 7,
          name: "Canal Ward",
          policyMask: 2,
          stats: { population: 1200, jobs: 450, modeSharePermille: 375 },
        }}
        cityOrdinanceMask={0}
        policies={POLICIES}
        ordinances={ORDINANCES}
      />
    </DispatchProvider>,
  );
}

describe("DistrictPolicyPanel", () => {
  it("refreshes the rename draft when the selected district changes", () => {
    const dispatched: CommandIntent[] = [];
    const { rerender } = render(
      <DispatchProvider dispatch={(intent) => dispatched.push(intent)}>
        <DistrictPolicyPanel
          district={{ id: 7, name: "Canal Ward", policyMask: 0 }}
          cityOrdinanceMask={0}
          policies={POLICIES}
          ordinances={ORDINANCES}
        />
      </DispatchProvider>,
    );

    fireEvent.change(screen.getByTestId("district-name-input"), {
      target: { value: "Draft name" },
    });
    rerender(
      <DispatchProvider dispatch={(intent) => dispatched.push(intent)}>
        <DistrictPolicyPanel
          district={{ id: 8, name: "Harbor Front", policyMask: 0 }}
          cityOrdinanceMask={0}
          policies={POLICIES}
          ordinances={ORDINANCES}
        />
      </DispatchProvider>,
    );

    expect(screen.getByTestId("district-name-input")).toHaveProperty("value", "Harbor Front");
  });

  it("dispatches nameDistrict without seq or tick", () => {
    const dispatched: CommandIntent[] = [];
    renderPanel(dispatched);

    fireEvent.change(screen.getByTestId("district-name-input"), { target: { value: "Old Town" } });
    fireEvent.submit(screen.getByTestId("district-name-form"));

    expect(dispatched.at(-1)).toEqual({
      type: CommandType.nameDistrict,
      districtId: 7,
      name: "Old Town",
    });
    expect(dispatched.at(-1)).not.toHaveProperty("seq");
    expect(dispatched.at(-1)).not.toHaveProperty("tick");
  });

  it("dispatches setPolicy when a policy checkbox changes", () => {
    const dispatched: CommandIntent[] = [];
    renderPanel(dispatched);

    fireEvent.click(screen.getByTestId("district-policy-3"));

    expect(dispatched.at(-1)).toEqual({
      type: CommandType.setPolicy,
      districtId: 7,
      policy: 3,
      on: 1,
    });
  });

  it("dispatches paintDistrict from the rectangle draft", () => {
    const dispatched: CommandIntent[] = [];
    renderPanel(dispatched);

    fireEvent.change(screen.getByTestId("district-paint-x0"), { target: { value: "10" } });
    fireEvent.change(screen.getByTestId("district-paint-y0"), { target: { value: "11" } });
    fireEvent.change(screen.getByTestId("district-paint-x1"), { target: { value: "20" } });
    fireEvent.change(screen.getByTestId("district-paint-y1"), { target: { value: "21" } });
    fireEvent.click(screen.getByRole("button", { name: "Paint district" }));

    expect(dispatched.at(-1)).toEqual({
      type: CommandType.paintDistrict,
      x0: 10,
      y0: 11,
      x1: 20,
      y1: 21,
      districtId: 7,
    });
  });

  it("disables painting when no district is selected", () => {
    const dispatched: CommandIntent[] = [];
    render(
      <DispatchProvider dispatch={(intent) => dispatched.push(intent)}>
        <DistrictPolicyPanel
          district={null}
          cityOrdinanceMask={0}
          policies={POLICIES}
          ordinances={ORDINANCES}
        />
      </DispatchProvider>,
    );

    expect(screen.getByRole("button", { name: "Paint district" })).toHaveProperty("disabled", true);
  });

  it("dispatches setOrdinance for city-wide ordinance toggles", () => {
    const dispatched: CommandIntent[] = [];
    renderPanel(dispatched);

    fireEvent.click(screen.getByTestId("district-ordinance-5"));

    expect(dispatched.at(-1)).toEqual({
      type: CommandType.setOrdinance,
      ordinance: 5,
      on: 1,
    });
  });

  it("renders only stats supplied by the view model", () => {
    const dispatched: CommandIntent[] = [];
    renderPanel(dispatched);

    expect(screen.getByTestId("district-stat-population").textContent).toBe("1,200");
    expect(screen.getByTestId("district-stat-jobs").textContent).toBe("450");
    expect(screen.getByTestId("district-stat-mode-share").textContent).toBe("38%");
    expect(screen.queryByTestId("district-stat-pollution")).toBeNull();
  });
});
