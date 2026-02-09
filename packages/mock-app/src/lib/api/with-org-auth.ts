import { NextResponse } from 'next/server';
import { getSessionUserId, getOrganizationId } from '@/lib/api/helpers';

export interface OrgAuthContext {
  userId: string;
  organizationId: string;
  params: Promise<Record<string, string>>;
}

type RouteHandler = (req: Request, context: OrgAuthContext) => Promise<Response>;

export function withOrgAuth(handler: RouteHandler) {
  return async (req: Request, routeContext: { params: Promise<Record<string, string>> }) => {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const organizationId = await getOrganizationId(userId);
    if (!organizationId) {
      return NextResponse.json({ ok: false, error: 'No organisation found for user' }, { status: 403 });
    }

    return handler(req, {
      userId,
      organizationId,
      params: routeContext.params,
    });
  };
}
