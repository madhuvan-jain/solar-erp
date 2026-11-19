// Tests read what device mode saved straight from its record store.
import { getList } from '../lib/store/recordStore';
import type { Rec } from '../lib/schema';

export async function stored(entity: string, prefix = 'ss1:'): Promise<Rec[]> {
  return (await getList(prefix + 'data:' + entity)) || [];
}
