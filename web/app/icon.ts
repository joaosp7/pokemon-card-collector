import { readFile } from "node:fs/promises";
import path from "node:path";

export const contentType = "image/png";

export default async function Icon() {
  const file = await readFile(
    path.join(process.cwd(), "public", "master_ball.png"),
  );
  return new Response(file, {
    headers: { "Content-Type": "image/png" },
  });
}
