import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/workspace/Workspace";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Noesis — Ask a question, get the evidence" },
      { name: "description", content: "Enter a falsifiable research question, watch AI agents design and run experiments, and read an evidence-backed report." },
      { property: "og:title", content: "Noesis — Ask a question, get the evidence" },
      { property: "og:description", content: "Watch agents run experiments on your research question and read a clear, evidence-backed report." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Workspace,
});
