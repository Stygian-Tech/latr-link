export {
  LATR_XRPC,
  latrXrpcPath,
  type LatrXrpcMethod,
} from "latr-packages/gateway-client";

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
