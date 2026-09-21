export const findUser = (id: string) => ({ id, tenant: 't1' });
export const loadUser = (id: string) => ({ id, tenant: 't1' });
export const mapUser = (u: { id: string; tenant: string }) => ({ ...u, label: `${u.tenant}/${u.id}` });
