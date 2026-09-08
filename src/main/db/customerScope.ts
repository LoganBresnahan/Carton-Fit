import type { CustomerScope } from '../../shared/storage'

/**
 * The customer filter as named SQL parameters (ADR-0035 §3). Every list query
 * carries the same clause — `(@all = 1 OR customer_id IS NULL OR customer_id =
 * @customer)` — so the rule "house plus the active customer, or everything"
 * is written once and read three times. `undefined` is everything; an
 * `activeId` of null is house only, since house IS the active customer then.
 */
export function customerParams(scope: CustomerScope | undefined): {
  all: 0 | 1
  customer: number | null
} {
  return scope === undefined ? { all: 1, customer: null } : { all: 0, customer: scope.activeId }
}
