export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ status: "ok", service: "rentwise", timestamp: new Date().toISOString() });
}
