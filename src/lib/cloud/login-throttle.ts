// 登录失败限流：按客户端 IP 计数，窗口内失败次数达到上限后锁定到窗口结束。
// 单进程内存实现，对单用户、单实例部署足够；进程重启会清零。

type Attempts = { count: number; windowStart: number };

export type LoginThrottleOptions = {
  maxFailures: number;
  windowMs: number;
};

export class LoginThrottle {
  private readonly attempts = new Map<string, Attempts>();

  constructor(private readonly options: LoginThrottleOptions) {}

  /** 仍需等待的毫秒数；0 表示可以尝试登录。 */
  retryAfterMs(clientId: string, nowMs: number): number {
    const entry = this.attempts.get(clientId);
    if (!entry) return 0;
    const windowEnd = entry.windowStart + this.options.windowMs;
    if (nowMs >= windowEnd) {
      this.attempts.delete(clientId);
      return 0;
    }
    return entry.count >= this.options.maxFailures ? windowEnd - nowMs : 0;
  }

  recordFailure(clientId: string, nowMs: number): void {
    const entry = this.attempts.get(clientId);
    const isExpired = !entry || nowMs >= entry.windowStart + this.options.windowMs;
    this.attempts.set(
      clientId,
      isExpired ? { count: 1, windowStart: nowMs } : { ...entry, count: entry.count + 1 },
    );
  }

  recordSuccess(clientId: string): void {
    this.attempts.delete(clientId);
  }
}
