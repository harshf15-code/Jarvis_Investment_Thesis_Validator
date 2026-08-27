import { redirect } from "next/navigation";

// Stopgap until the real Cockpit dashboard (Screen HUB-1) is built. Every
// login/nav path in the app currently targets "/" — this keeps that from
// 404ing in the interim.
export default function CockpitPage() {
  redirect("/positions");
}
