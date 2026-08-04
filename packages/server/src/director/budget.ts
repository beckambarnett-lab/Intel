/**
 * Spend and failure control for the director.
 *
 * Two jobs. The obvious one is cost: an unbounded event-driven caller can fire
 * on every contact of a busy minute and quietly turn a forty-five minute run
 * into a large bill.
 *
 * The one that matters more is Q117 — the game must play correctly with the API
 * key removed entirely. That is not a graceful-degradation nicety, it is the
 * contract the whole creature stack was built to honour: tier one is tuned to
 * be frightening on its own, so losing the director costs the pack its
 * inventiveness and nothing else. This class is what makes that promise
 * mechanical rather than aspirational, by treating "no key", "rate limited",
 * "timed out" and "returned nonsense" as the same ordinary condition.
 */
export interface BudgetConfig {
  /** Hard cap on calls for one run. */
  maxCalls: number;
  /** Minimum milliseconds between calls. */
  minSpacingMs: number;
  /** Consecutive failures before this tier is switched off for the run (Q117). */
  maxConsecutiveFailures: number;
}

export class CallBudget {
  private calls = 0;
  private failures = 0;
  private lastCallAt = -Infinity;
  private inFlight = false;
  private disabledReason: string | null = null;

  constructor(private readonly config: BudgetConfig) {}

  /** Never call while one is already outstanding — orders would race. */
  get busy(): boolean {
    return this.inFlight;
  }

  get disabled(): boolean {
    return this.disabledReason !== null;
  }

  get reason(): string | null {
    return this.disabledReason;
  }

  get spent(): number {
    return this.calls;
  }

  mayCall(nowMs: number): boolean {
    if (this.disabledReason || this.inFlight) return false;
    if (this.calls >= this.config.maxCalls) {
      this.disable('call budget exhausted');
      return false;
    }
    return nowMs - this.lastCallAt >= this.config.minSpacingMs;
  }

  start(nowMs: number): void {
    this.inFlight = true;
    this.lastCallAt = nowMs;
    this.calls += 1;
  }

  succeeded(): void {
    this.inFlight = false;
    this.failures = 0;
  }

  /**
   * Three strikes and this tier is done for the run (Q117).
   *
   * Permanent rather than retried because a director that flickers in and out
   * is worse than one that is simply absent: half the run behaves one way and
   * half another, and no playtest of it means anything.
   */
  failed(reason: string): void {
    this.inFlight = false;
    this.failures += 1;
    if (this.failures >= this.config.maxConsecutiveFailures) {
      this.disable(`${this.config.maxConsecutiveFailures} consecutive failures: ${reason}`);
    }
  }

  disable(reason: string): void {
    if (this.disabledReason) return;
    this.disabledReason = reason;
    console.log(`[director] disabled for this run — ${reason}`);
  }

  reset(): void {
    this.calls = 0;
    this.failures = 0;
    this.lastCallAt = -Infinity;
    this.inFlight = false;
    this.disabledReason = null;
  }
}
