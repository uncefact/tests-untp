import { NextResponse } from "next/server";
import { NotFoundError, errorMessage } from "@/lib/api/errors";
import { isNonEmptyString } from "@/lib/api/validation";
import { withOrgAuth } from "@/lib/api/with-org-auth";
import { getDidById, updateDid } from "@/lib/prisma/repositories";

export const GET = withOrgAuth(async (_req, { organizationId, params }) => {
  const { id } = await params;

  try {
    const did = await getDidById(id, organizationId);
    if (!did) {
      throw new NotFoundError("DID not found");
    }
    return NextResponse.json({ ok: true, did });
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});

export const PUT = withOrgAuth(async (req, { organizationId, params }) => {
  const { id } = await params;

  let body: { name?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const hasName = isNonEmptyString(body.name);
  const hasDescription = isNonEmptyString(body.description);

  if (!hasName && !hasDescription) {
    return NextResponse.json(
      { ok: false, error: "At least one of name or description is required" },
      { status: 400 },
    );
  }

  try {
    const updated = await updateDid(id, organizationId, {
      ...(hasName && { name: body.name }),
      ...(hasDescription && { description: body.description }),
    });
    return NextResponse.json({ ok: true, did: updated });
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
});
