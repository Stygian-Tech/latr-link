export const LATR_XRPC = {
  listItems: "link.latr.saved.listItems",
  getItem: "link.latr.saved.getItem",
  saveUrl: "link.latr.saved.saveUrl",
  saveSubject: "link.latr.saved.saveSubject",
  setState: "link.latr.saved.setState",
  deleteItem: "link.latr.saved.deleteItem",
  migrateLegacy: "link.latr.saved.migrateLegacy",
  getOpenGraph: "link.latr.preview.getOpenGraph",
  resolveUrl: "link.latr.discovery.resolveUrl",
  authProbe: "link.latr.auth.probe",
  listDeveloperClients: "link.latr.developer.listClients",
  createDeveloperClient: "link.latr.developer.createClient",
  deleteDeveloperClient: "link.latr.developer.deleteClient",
  listDeveloperKeys: "link.latr.developer.listKeys",
  createDeveloperKey: "link.latr.developer.createKey",
  revokeDeveloperKey: "link.latr.developer.revokeKey",
  getDeveloperUsage: "link.latr.developer.getUsage",
} as const;

export type LatrXrpcMethod = (typeof LATR_XRPC)[keyof typeof LATR_XRPC];

export function latrXrpcPath(method: LatrXrpcMethod): string {
  return `/xrpc/${method}`;
}

export type LatrGatewayRepoRecord<T> = {
  uri: string;
  cid: string;
  value: T;
};

export type LatrListItemsResponse<T = Record<string, unknown>> = {
  records: LatrGatewayRepoRecord<T>[];
  cursor?: string;
};

export type LatrLexiconMigrationResponse = {
  ok: true;
  externalCopied: number;
  itemsCopied: number;
  externalDeleted: number;
  itemsDeleted: number;
};
