export class PromiseLimiter {
  private n: number;
  private release?: () => void;

  constructor(n: number) {
    this.n = n;
  }

  public run<T>(asyncFunc: () => Promise<T>): Promise<{promise: Promise<T>}> {
    if (this.n === 0) {
      return new Promise((resolve) => {
        this.release = () => {
          this.n--;
          const promise = asyncFunc();
          promise.finally(() => this.doRelease());
          resolve({promise});
        };
      });
    } else {
      this.n--;
      const promise = asyncFunc();
      promise.finally(() => this.doRelease());
      return Promise.resolve({promise});
    }
  }

  private doRelease(): void {
    this.n++;
    if (this.release !== undefined) {
      this.release();
      delete this.release;
    }
  }
}
