import { createFileRoute } from "@tanstack/react-router";
import { Workstation } from "@/components/lab/workstation";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Workstation />;
}
