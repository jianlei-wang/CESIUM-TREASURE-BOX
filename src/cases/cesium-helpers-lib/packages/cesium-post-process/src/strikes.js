// the strikes of a storm are few and short-lived: at most this many at once, each one over after this
// many seconds
export const MAX_STRIKES = 4;
export const STRIKE_LIFE = 1;

/**
 * Drops the strikes that are over and, at random, starts a new one: a Poisson process of the given
 * rate, whatever the time between the frames.
 * @template {{start: number}} T
 * @param {T[]} strikes
 * @param {number} now seconds
 * @param {number} dt seconds since the last call
 * @param {number} rate strikes per second
 * @param {() => number} random in [0, 1)
 * @param {(now: number) => T | undefined} create
 */
export function advanceStrikes(strikes, now, dt, rate, random, create) {
  for (let i = strikes.length - 1; i >= 0; i--) {
    if (now - strikes[i].start > STRIKE_LIFE) {
      strikes.splice(i, 1);
    }
  }
  if (strikes.length < MAX_STRIKES && random() < 1 - Math.exp(-rate * dt)) {
    // the create function declines a strike where it does not strike
    const strike = create(now);
    if (strike) {
      strikes.push(strike);
    }
  }
}
