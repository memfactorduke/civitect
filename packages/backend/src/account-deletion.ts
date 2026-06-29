/**
 * Account deletion cascade plan (ADR-011, TDD 10).
 *
 * The future Supabase edge function should execute this provider-neutral plan:
 * remove user-scoped storage first, then metadata rows, then auth. Keeping this
 * pure makes the compliance-critical order easy to test before wiring secrets
 * or dashboard resources.
 */

export type AccountDeletionTargetKind =
  | "storage-prefix"
  | "city-metadata"
  | "sync-queue"
  | "auth-user";

export interface AccountDeletionTarget {
  readonly kind: AccountDeletionTargetKind;
  readonly id: string;
  readonly order: number;
}

export interface AccountDeletionPlan {
  readonly userId: string;
  readonly targets: readonly AccountDeletionTarget[];
}

export class AccountDeletionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionPlanError";
  }
}

function assertTrimmedId(label: string, value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new AccountDeletionPlanError(`${label} must be a non-empty trimmed string`);
  }
}

function storageSegment(value: string): string {
  return encodeURIComponent(value);
}

function target(kind: AccountDeletionTargetKind, id: string, order: number): AccountDeletionTarget {
  return { kind, id, order };
}

export function buildUserStoragePrefix(userId: string): string {
  assertTrimmedId("userId", userId);
  return `users/${storageSegment(userId)}/`;
}

export function buildAccountDeletionPlan(userId: string): AccountDeletionPlan {
  assertTrimmedId("userId", userId);

  return {
    userId,
    targets: [
      target("storage-prefix", buildUserStoragePrefix(userId), 10),
      target("sync-queue", userId, 20),
      target("city-metadata", userId, 30),
      target("auth-user", userId, 40),
    ],
  };
}

export function assertAccountDeletionPlan(plan: AccountDeletionPlan): void {
  assertTrimmedId("plan.userId", plan.userId);
  if (plan.targets.length === 0) {
    throw new AccountDeletionPlanError("plan.targets must not be empty");
  }

  let previousOrder = -1;
  const seenKinds = new Set<AccountDeletionTargetKind>();
  for (const deletionTarget of plan.targets) {
    assertTrimmedId("target.id", deletionTarget.id);
    if (!Number.isSafeInteger(deletionTarget.order) || deletionTarget.order <= previousOrder) {
      throw new AccountDeletionPlanError("target.order values must be strictly increasing");
    }
    previousOrder = deletionTarget.order;
    seenKinds.add(deletionTarget.kind);
  }

  for (const requiredKind of [
    "storage-prefix",
    "sync-queue",
    "city-metadata",
    "auth-user",
  ] as const) {
    if (!seenKinds.has(requiredKind)) {
      throw new AccountDeletionPlanError(`plan is missing ${requiredKind}`);
    }
  }
}
