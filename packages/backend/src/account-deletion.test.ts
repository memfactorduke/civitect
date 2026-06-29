import { describe, expect, it } from "vitest";
import {
  type AccountDeletionPlan,
  AccountDeletionPlanError,
  assertAccountDeletionPlan,
  buildAccountDeletionPlan,
  buildUserStoragePrefix,
} from "./account-deletion";

describe("account deletion cascade plan", () => {
  it("builds a deterministic user-scoped cascade for store compliance", () => {
    expect(buildAccountDeletionPlan("user@example.test")).toEqual({
      userId: "user@example.test",
      targets: [
        {
          kind: "storage-prefix",
          id: "users/user%40example.test/",
          order: 10,
        },
        {
          kind: "sync-queue",
          id: "user@example.test",
          order: 20,
        },
        {
          kind: "city-metadata",
          id: "user@example.test",
          order: 30,
        },
        {
          kind: "auth-user",
          id: "user@example.test",
          order: 40,
        },
      ],
    });
  });

  it("encodes storage prefixes so user identifiers cannot escape their scope", () => {
    expect(buildUserStoragePrefix("team/a+b@example.test")).toBe(
      "users/team%2Fa%2Bb%40example.test/",
    );
  });

  it("accepts the generated plan as complete and ordered", () => {
    expect(() => assertAccountDeletionPlan(buildAccountDeletionPlan("user-1"))).not.toThrow();
  });

  it("rejects malformed user identifiers before planning a cascade", () => {
    expect(() => buildAccountDeletionPlan("")).toThrow(AccountDeletionPlanError);
    expect(() => buildAccountDeletionPlan(" user-1")).toThrow(AccountDeletionPlanError);
    expect(() => buildUserStoragePrefix("user-1 ")).toThrow(AccountDeletionPlanError);
  });

  it("rejects incomplete or unsafe plans before execution", () => {
    const valid = buildAccountDeletionPlan("user-1");

    expect(() => assertAccountDeletionPlan({ userId: "user-1", targets: [] })).toThrow(
      AccountDeletionPlanError,
    );
    expect(() =>
      assertAccountDeletionPlan({
        ...valid,
        targets: valid.targets.filter((target) => target.kind !== "auth-user"),
      }),
    ).toThrow(AccountDeletionPlanError);
    expect(() =>
      assertAccountDeletionPlan({
        ...valid,
        targets: [
          valid.targets[0],
          { kind: "sync-queue", id: "user-1", order: 10 },
          valid.targets[2],
          valid.targets[3],
        ],
      } as AccountDeletionPlan),
    ).toThrow(AccountDeletionPlanError);
    expect(() =>
      assertAccountDeletionPlan({
        ...valid,
        targets: [
          valid.targets[0],
          { kind: "sync-queue", id: "", order: 20 },
          valid.targets[2],
          valid.targets[3],
        ],
      } as AccountDeletionPlan),
    ).toThrow(AccountDeletionPlanError);
  });
});
