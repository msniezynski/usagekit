import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "@/components/ui/badge";
import "./index.css";

// Blocks land in components/usagekit through `shadcn add`; the consumer test adds and renders them.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Badge variant="outline">usagekit consumer</Badge>
  </StrictMode>,
);
