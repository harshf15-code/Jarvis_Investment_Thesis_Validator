import { NextResponse } from "next/server";
import { listRecommendations } from "@/lib/queries";

export async function GET() {
  try {
    return NextResponse.json({ recommendations: await listRecommendations() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
