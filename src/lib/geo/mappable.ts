import type { Entity } from '../schema';

/** Records that point at something with an address, in the order they are tried. */
export const LINKS: [string, string][] = [['customerId', 'customers'], ['projectId', 'projects'], ['leadId', 'leads'], ['vendorId', 'vendors'], ['invoiceId', 'invoices']];
const OWN_KEYS = ['lat', 'siteLat', 'pincode', 'city', 'state', 'placeOfSupply', 'gstin'];

/** True when records of this type can be placed on the map (own address fields or a link to one). */
export function isMappableEntity(entity: Entity): boolean {
  return entity.fields.some((f) => OWN_KEYS.includes(f.key) || (f.type === 'ref' && LINKS.some(([k]) => k === f.key)));
}

