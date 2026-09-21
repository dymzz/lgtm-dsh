// Negative-control probe: a plugin that is wrong on purpose, used to prove the
// boot log actually surfaces plugin failures. If booting this one stays silent,
// a silent boot of the real plugin proves nothing.
export const name = 'lgtm-dsh-broken-probe';
export const inject = ['definitely-not-a-registered-service'];

export function apply() {
  throw new Error('probe: apply threw on purpose');
}
