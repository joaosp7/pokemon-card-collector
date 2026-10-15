import { handleListEditions, handleUpdateEditions } from "@/lib/liga-editions";

export const runtime = "nodejs";
export const maxDuration = 600;

export function GET() {
  return handleListEditions();
}

export function POST() {
  return handleUpdateEditions();
}
