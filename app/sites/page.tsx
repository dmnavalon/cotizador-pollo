import { readRegistry } from '@/lib/sites-config';
import SitesManager from './SitesManager';

export const dynamic = 'force-dynamic';

export default async function SitesPage() {
  const reg = await readRegistry();
  return <SitesManager initial={reg} />;
}
