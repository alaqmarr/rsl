import { describe, expect, it } from "vitest";
import { buildGoogleOAuthAuthorizeUrl } from "@rsl/connections";
import { canStaffAccessAdminRoute } from "@rsl/rbac";
import {
  clearPlatformCredentialOverride,
  getPlatformGoogleOAuthConfig,
  getPlatformManagedR2Config,
  getPlatformMetaAppConfig,
  getPlatformRazorpayConfig,
  getPlatformSmtpConfig,
  getPublicGoogleOAuthStatus,
  getSafePlatformCredentialsAdminSnapshot,
  parseGoogleOAuthClientJson,
  savePlatformGoogleOAuthConfig,
  savePlatformManagedR2Config,
  savePlatformMetaAppConfig,
  savePlatformRazorpayConfig,
  savePlatformSmtpConfig,
} from "@rsl/tenancy";

describe("Phase 18 — Database-Controlled Platform Credentials & 1-Click Google OAuth", () => {
  it("blocks Google Service Account JSONs and auto-parses Web Application OAuth client JSONs", () => {
    const serviceAccountJson = JSON.stringify({
      type: "service_account",
      project_id: "wrong-project",
      private_key_id: "abc",
      private_key: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n",
      client_email: "backup-bot@wrong-project.iam.gserviceaccount.com",
    });

    expect(() => parseGoogleOAuthClientJson(serviceAccountJson)).toThrow(/Service Account/i);

    const desktopAppJson = JSON.stringify({
      installed: {
        client_id: "123.apps.googleusercontent.com",
        client_secret: "GOCSPX-desktop",
      },
    });
    expect(() => parseGoogleOAuthClientJson(desktopAppJson)).toThrow(/Desktop app/i);

    const validWebJson = JSON.stringify({
      web: {
        client_id: "998877665544-rslweb.apps.googleusercontent.com",
        project_id: "rapidshift-labs-prod",
        client_secret: "GOCSPX-SuperSecretValue1234",
        redirect_uris: ["https://app.rapidshiftlabs.in/api/oauth/google/callback"],
      },
    });

    const parsed = parseGoogleOAuthClientJson(validWebJson);
    expect(parsed.clientId).toBe("998877665544-rslweb.apps.googleusercontent.com");
    expect(parsed.clientSecret).toBe("GOCSPX-SuperSecretValue1234");
    expect(parsed.projectId).toBe("rapidshift-labs-prod");
  });

  it("encrypts Google OAuth, SMTP, R2, Meta, and Razorpay credentials in control.db and builds official Google Consent URLs", () => {
    const staffId = "stf_test_superadmin";

    // 1. Save Google OAuth via client_secret JSON
    const savedGoogle = savePlatformGoogleOAuthConfig({
      enabled: true,
      oauthJsonRaw: JSON.stringify({
        web: {
          client_id: "112233445566-rsloauth.apps.googleusercontent.com",
          project_id: "rapidshift-labs",
          client_secret: "GOCSPX-EncryptedVaultSecret99",
        },
      }),
      consentAppName: "RapidShift Labs",
      publishingStatus: "production",
      defaultDriveFolderName: "RapidShift Labs Backups",
      enableDriveOAuth: true,
      enableGbpOAuth: true,
      staffId,
    });

    expect(savedGoogle.source).toBe("database");
    expect(savedGoogle.isReady).toBe(true);
    expect(savedGoogle.clientSecret).toBe("GOCSPX-EncryptedVaultSecret99");

    const publicStatus = getPublicGoogleOAuthStatus();
    expect(publicStatus.enableDriveOAuth).toBe(true);
    expect(publicStatus.defaultDriveFolderName).toBe("RapidShift Labs Backups");

    const authUrl = buildGoogleOAuthAuthorizeUrl({
      redirectUri: "https://app.rapidshiftlabs.in/api/oauth/google/callback",
      state: "state_token_xyz",
      purpose: "google_drive",
    });
    const parsedUrl = new URL(authUrl);
    expect(parsedUrl.origin).toBe("https://accounts.google.com");
    expect(parsedUrl.searchParams.get("client_id")).toBe(
      "112233445566-rsloauth.apps.googleusercontent.com"
    );
    expect(parsedUrl.searchParams.get("redirect_uri")).toBe(
      "https://app.rapidshiftlabs.in/api/oauth/google/callback"
    );
    expect(parsedUrl.searchParams.get("access_type")).toBe("offline");
    expect(parsedUrl.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/drive.file"
    );

    // 2. Save SMTP, R2, Meta, and Razorpay in control.db
    savePlatformSmtpConfig({
      enabled: true,
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      from: "RapidShift Labs <alerts@rapidshiftlabs.in>",
      user: "alerts@rapidshiftlabs.in",
      password: "abcd efgh ijkl mnop",
      staffId,
    });

    savePlatformManagedR2Config({
      enabled: true,
      accountId: "8f92a1b4c00011122233344455566677",
      accessKeyId: "R2ACCESSKEY123456",
      secretAccessKey: "R2SECRETACCESSKEY9876543210",
      bucketPrivate: "rsl-private",
      bucketPublic: "rsl",
      publicBaseUrl: "https://storage.rapidshiftlabs.in",
      staffId,
    });

    savePlatformMetaAppConfig({
      enabled: true,
      appId: "827364519283746",
      appSecret: "meta_app_secret_hex_1234567890",
      webhookVerifyToken: "rsl_global_verify_token",
      staffId,
    });

    savePlatformRazorpayConfig({
      enabled: true,
      keyId: "rzp_live_TestKey123",
      keySecret: "rzp_secret_9988776655",
      webhookSecret: "whsec_rzp_112233",
      staffId,
    });

    expect(getPlatformSmtpConfig().isReady).toBe(true);
    expect(getPlatformManagedR2Config().isReady).toBe(true);
    expect(getPlatformMetaAppConfig().isReady).toBe(true);
    expect(getPlatformRazorpayConfig().isReady).toBe(true);

    // Safe admin snapshot must NEVER expose raw plaintext secrets
    const snap = getSafePlatformCredentialsAdminSnapshot();
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("GOCSPX-EncryptedVaultSecret99");
    expect(serialized).not.toContain("R2SECRETACCESSKEY9876543210");
    expect(serialized).not.toContain("meta_app_secret_hex_1234567890");
    expect(serialized).not.toContain("rzp_secret_9988776655");
    expect(snap.google.maskedClientSecret).toContain("••••");

    // Clean up overrides so subsequent tests see clean defaults
    clearPlatformCredentialOverride("google_oauth");
    clearPlatformCredentialOverride("smtp_email");
    clearPlatformCredentialOverride("cloudflare_r2");
    clearPlatformCredentialOverride("meta_app");
    clearPlatformCredentialOverride("razorpay");

    expect(getPlatformGoogleOAuthConfig().source).not.toBe("database");
  });

  it("restricts /credentials route strictly to super_admin staff role", () => {
    expect(canStaffAccessAdminRoute("super_admin", "/credentials")).toBe(true);
    expect(canStaffAccessAdminRoute("finance", "/credentials")).toBe(false);
    expect(canStaffAccessAdminRoute("support", "/credentials")).toBe(false);
  });
});
