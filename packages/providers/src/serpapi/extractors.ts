import type { Extractors, ReceiptDraft } from "../types.js";
import { listEstimate } from "../prices.js";
import { pointer } from "../pointer.js";
import { requestsMeasured } from "../receipts.js";

const zero = { units: 0n, currency: "USD" as const };
const units = (value: bigint) => ({ value, scale: 0, unit: "units" });

export const extractors: Extractors = {
  estimate: listEstimate,
  options: () => ({}),
  /**
   * The provider reports no cost per call. A search settles as one estimated plan unit with zero
   * marginal money (the plan fee is not a per-call charge); reconciliation compares
   * this_month_usage deltas. Errored searches consume no search. Free endpoints cost nothing.
   */
  extract: (operation, _request, response, body): ReceiptDraft => {
    const id = extractors.requestId(body);
    const failed = response.status >= 400 || typeof pointer(body, "/error") === "string";
    const common = { ...(id ? { providerRequestId: id } : {}), cached: false, failed };
    if (!operation.billable)
      return {
        measurements: [requestsMeasured()],
        cost: { certainty: "measured", money: zero },
        ...common,
      };
    return failed
      ? {
          measurements: [
            { unit: "units", quantity: units(0n), certainty: "measured" },
            requestsMeasured(),
          ],
          cost: { certainty: "measured", money: zero },
          ...common,
        }
      : {
          measurements: [
            { unit: "units", quantity: units(1n), certainty: "estimated" },
            requestsMeasured(),
          ],
          cost: { certainty: "estimated", money: zero },
          ...common,
        };
  },
  requestId: (body) => {
    const id = pointer(body, "/search_metadata/id");
    return typeof id === "string" && id ? id : undefined;
  },
};
