import { withRetry } from "../infra/retry";
import { runCreateRound } from "./phases/createRound";
import { runCloseBetting } from "./phases/closeBetting";
import { runDelegateRound } from "./phases/delegateRound";
import { runGameLoop } from "./phases/gameLoop";
import { runSettle } from "./phases/settle";
import { runCleanup } from "./phases/cleanup";
import { fetchConfig } from "../chain/methods";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RoundOrchestrator {
  private running = false;

  constructor(private readonly ctx: any) {}

  async recover() {
    const config = await fetchConfig(this.ctx.l1.program);
    const nextRound = BigInt(config.roundId.toString());
    this.ctx.log.info(
      {
        nextRound: nextRound.toString(),
        lifecycle:
          "create_round -> betting_open -> close_betting -> delegate_round -> game_loop -> settle_and_undelegate -> cleanup",
      },
      "recovery snapshot loaded"
    );
    this.transitionTo("READY");
  }

  async start() {
    this.running = true;
    await this.recover();

    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        this.ctx.store.bumpRetry();
        this.ctx.log.error(
          { err, phase: this.ctx.store.get().phase },
          "orchestrator tick failed"
        );
        await sleep(1000);
      }
    }
  }

  stop() {
    this.running = false;
  }

  async tick() {
    const state = this.ctx.store.get();

    switch (state.phase) {
      case "READY": {
        this.transitionTo("CREATE_ROUND");
        return;
      }
      case "CREATE_ROUND": {
        await withRetry(() => runCreateRound(this.ctx), {
          attempts: this.ctx.env.MAX_STEP_RETRIES,
          baseDelayMs: 500,
          maxDelayMs: 5000,
        });
        this.ctx.store.markRoundCreated();
        const deadline =
          Date.now() + this.ctx.env.ROUND_DURATION_SECONDS * 1000;
        this.ctx.store.setBettingDeadline(deadline);
        this.transitionTo("BETTING_OPEN");
        return;
      }
      case "BETTING_OPEN": {
        const deadline = this.ctx.store.get().bettingDeadlineMs;
        if (!deadline || Date.now() < deadline) {
          await sleep(500);
          return;
        }
        this.transitionTo("CLOSE_BETTING");
        return;
      }
      case "CLOSE_BETTING": {
        await withRetry(() => runCloseBetting(this.ctx), {
          attempts: this.ctx.env.MAX_STEP_RETRIES,
          baseDelayMs: 500,
          maxDelayMs: 5000,
        });
        this.ctx.store.markBettingClosed();
        this.transitionTo("DELEGATE_ROUND");
        return;
      }
      case "DELEGATE_ROUND": {
        await withRetry(() => runDelegateRound(this.ctx), {
          attempts: this.ctx.env.MAX_STEP_RETRIES,
          baseDelayMs: 500,
          maxDelayMs: 5000,
        });
        this.transitionTo("GAME_LOOP");
        return;
      }
      case "GAME_LOOP": {
        this.ctx.store.markGameStarted();
        await withRetry(() => runGameLoop(this.ctx), {
          attempts: this.ctx.env.MAX_MOVE_RETRIES,
          baseDelayMs: 200,
          maxDelayMs: 2000,
        });
        this.ctx.store.markGameEnded();
        this.transitionTo("SETTLE");
        return;
      }
      case "SETTLE": {
        await withRetry(() => runSettle(this.ctx), {
          attempts: this.ctx.env.MAX_STEP_RETRIES,
          baseDelayMs: 500,
          maxDelayMs: 5000,
        });
        this.ctx.store.markSettled();
        this.transitionTo("CLEANUP");
        return;
      }
      case "CLEANUP": {
        await withRetry(() => runCleanup(this.ctx), {
          attempts: this.ctx.env.MAX_STEP_RETRIES,
          baseDelayMs: 500,
          maxDelayMs: 5000,
        });
        this.ctx.store.setBettingDeadline(null);
        this.ctx.store.resetRoundMarkers();
        this.transitionTo("READY");
        return;
      }
      default:
        this.transitionTo("READY");
    }
  }

  getStatus() {
    return this.ctx.store.get();
  }

  private transitionTo(next: string) {
    const previous = this.ctx.store.get();
    if (previous.phase === next) return;
    this.ctx.store.setPhase(next);
    const roundId = this.ctx.store.get().currentRoundId;
    if (!roundId || !this.ctx.gateway) return;
    this.ctx.gateway.publishRoundTransition({
      type: "round_transition_v1",
      ts: Date.now(),
      roundId: roundId.toString(),
      from: previous.phase,
      to: next,
    });
  }
}
