import { GET as apiExportGET } from '@/app/api/export/route'

export const dynamic = 'force-dynamic'

/**
 * Alias route so the Recourse bridge convention works:
 *   GET /export/{entity}?format=json|csv   (Recourse prometheusBridge fetchExport)
 * maps onto the canonical handler:
 *   GET /api/export?type={entity}&format=...
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const { entity } = await params
  const url = new URL(request.url)
  if (!url.searchParams.has('type')) url.searchParams.set('type', entity)
  return apiExportGET(new Request(url, request))
}