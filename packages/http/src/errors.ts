export function problem(status: number, outcome = "invalid"): Response {
  const body =
    status === 403
      ? { outcome: "forbidden" }
      : status === 400
        ? { outcome, field: "body", reason: "Invalid request schema" }
        : {
            outcome:
              status === 401 ? "unauthorized" : status === 404 ? "not_found" : "internal_error",
          };
  return Response.json(body, { status, headers: { "Content-Type": "application/problem+json" } });
}
