import { handleAddCollection } from "@/lib/download-collection";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: Request) {
  return handleAddCollection(request);
}
