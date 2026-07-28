/// <reference types="wxt/client-types" />

interface ImportMetaEnv {
  readonly VITE_LATR_GATEWAY_URL?: string;
  readonly VITE_LATR_APP_ENV?: string;
  readonly VITE_LATR_GATEWAY_CLIENT_ID?: string;
  readonly VITE_LATR_GATEWAY_API_KEY?: string;
  readonly VITE_ATPROTO_CLIENT_ID?: string;
  readonly VITE_ATPROTO_REDIRECT_URI?: string;
  readonly VITE_LATR_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
