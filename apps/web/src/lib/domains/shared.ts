import { redirect } from "next/navigation";
import { requireEntitlement } from "@rsl/billing";
import { RslError } from "@rsl/core";
import { setSignedWebFlashToast } from "../session";

export function friendlyMessage(err: unknown): string {
  if (err instanceof RslError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Could not complete that action. Please try again.";
}

export function elapsedMs(startedAtMs: number): number {
  return Math.max(1, Date.now() - startedAtMs);
}

export async function setWebFlashToastCookie(
  type: "success" | "error" | "info" | "warning",
  message: string
): Promise<void> {
  await setSignedWebFlashToast(type, message);
}

export async function goWithNotice(basePath: string, notice: string): Promise<never> {
  await setSignedWebFlashToast("success", notice);
  redirect(basePath);
}

export async function goWithError(basePath: string, error: string): Promise<never> {
  await setSignedWebFlashToast("error", error);
  redirect(basePath);
}

export async function enforceFeaturePaidEntitlement(
  workspaceId: string,
  serviceKey: string,
  returnPath: string
): Promise<void> {
  try {
    requireEntitlement(workspaceId, serviceKey);
  } catch (err) {
    return goWithError(returnPath, friendlyMessage(err));
  }
}
