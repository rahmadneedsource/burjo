declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ADMIN_PASSWORD_HASH?: string;
    ADMIN_SESSION_SECRET?: string;
    MIDTRANS_SERVER_KEY?: string;
    MIDTRANS_MODE?: string;
    LOCAL_ADMIN?: string;
  }
}
