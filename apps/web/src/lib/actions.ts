"use server";

import {
  acceptInvitationActionImpl,
  changePasswordActionImpl,
  changePasswordJsonActionImpl,
  createNewBusinessActionImpl,
  createNewBusinessJsonActionImpl,
  forgotPasswordActionImpl,
  inviteTeamMemberActionImpl,
  loginFormStateActionImpl,
  logoutActionImpl,
  registerFormStateActionImpl,
  removeTeamMemberActionImpl,
  resendInvitationActionImpl,
  resendVerificationEmailActionImpl,
  resetPasswordActionImpl,
  revokeInvitationActionImpl,
  revokeOtherSessionsJsonActionImpl,
  revokeSessionJsonActionImpl,
  saveBusinessSettingsJsonActionImpl,
  saveUserProfileJsonActionImpl,
  sendVerificationEmailJsonActionImpl,
  setWebLocaleActionImpl,
  submitHelpFeedbackActionImpl,
  switchWorkspaceActionImpl,
  switchWorkspaceJsonActionImpl,
  beginUserTotpEnrollmentJsonActionImpl,
  confirmUserTotpEnrollmentJsonActionImpl,
  disableUserTotpMfaJsonActionImpl,
  updateBusinessProfileActionImpl,
  updateTeamMemberRoleActionImpl,
  verifyEmailCodeActionImpl,
  verifyEmailCodeJsonActionImpl,
  type WebAuthFormState,
} from "./domains/auth-team";
import {
  createOnlineRazorpayOrderActionImpl,
  createRazorpayCheckoutOrderJsonActionImpl,
  instantActivateFromWalletActionImpl,
  requestBundlePlanActionImpl,
  requestServicePlanActionImpl,
  submitActivationModalActionImpl,
  submitAdSpendRechargeRequestActionImpl,
  submitRechargeRequestActionImpl,
  verifyRazorpayPaymentJsonActionImpl,
} from "./domains/billing";
import {
  createCampaignActionImpl,
  deleteScheduledPostActionImpl,
  generateReviewDraftActionImpl,
  generateSmartAdCopyJsonActionImpl,
  publishScheduledPostActionImpl,
  recordCampaignSnapshotActionImpl,
  recordPixelEventActionImpl,
  recordReviewActionImpl,
  replyReviewActionImpl,
  schedulePostActionImpl,
  syncGoogleReviewsActionImpl,
  syncLiveAdsInsightsActionImpl,
  toggleCampaignActionImpl,
  updateCampaignBudgetActionImpl,
} from "./domains/campaigns-reviews";
import {
  connectAccountActionImpl,
  connectChannelJsonActionImpl,
  createOutboundWebhookActionImpl,
  createOutboundWebhookJsonActionImpl,
  deleteOutboundWebhookActionImpl,
  deleteOutboundWebhookJsonActionImpl,
  disconnectAccountActionImpl,
  disconnectConnectionJsonActionImpl,
  issueApiKeyActionImpl,
  issueApiKeyJsonActionImpl,
  provisionWorkspaceSslJsonActionImpl,
  refreshMetaChannelAssetsJsonActionImpl,
  revokeApiKeyActionImpl,
  revokeApiKeyJsonActionImpl,
  rotateApiKeyActionImpl,
  rotateApiKeyJsonActionImpl,
  rotateMetaVerifyTokenJsonActionImpl,
  selectGoogleAdsCustomerJsonActionImpl,
  selectGoogleBusinessLocationJsonActionImpl,
  selectGoogleSearchConsoleSiteJsonActionImpl,
  selectMetaChannelAssetJsonActionImpl,
  syncGoogleBusinessProfileJsonActionImpl,
  testOutboundWebhookActionImpl,
  testOutboundWebhookJsonActionImpl,
  updateConnectionJsonActionImpl,
  verifyConnectionHealthActionImpl,
  verifyConnectionLiveJsonActionImpl,
  connectWorkspaceCloudflareOneClickJsonActionImpl,
  updateWorkspaceCloudflareWorkloadsJsonActionImpl,
  provisionWorkspaceCloudflareResourceJsonActionImpl,
  probeWorkspaceCloudflareConnectionJsonActionImpl,
  disconnectWorkspaceCloudflareJsonActionImpl,
} from "./domains/connections-developers";
import {
  addInternalNoteActionImpl,
  addSuppressionActionImpl,
  assignConversationActionImpl,
  attachConversationLabelActionImpl,
  changeConversationStatusActionImpl,
  createContactActionImpl,
  createTemplateActionImpl,
  deleteCannedReplyActionImpl,
  deleteTemplateActionImpl,
  installStarterTemplatesActionImpl,
  launchBroadcastActionImpl,
  lintWhatsAppTemplateJsonActionImpl,
  removeConversationLabelActionImpl,
  removeSuppressionActionImpl,
  replyConversationActionImpl,
  saveCannedReplyActionImpl,
  startConversationActionImpl,
  submitTemplateToMetaActionImpl,
  syncMetaTemplatesActionImpl,
  translateWhatsAppTemplateJsonActionImpl,
  updateTemplateActionImpl,
} from "./domains/inbox-whatsapp";
import {
  createEncryptedBackupActionImpl,
  deleteWorkspaceAccountActionImpl,
  deleteWorkspaceStoredObjectActionImpl,
  disconnectGoogleDriveFromBackupsActionImpl,
  exportWorkspaceDpdpDataJsonActionImpl,
  importContactsCsvActionImpl,
  optimizeDatabaseActionImpl,
  requestCustomAdapterActionImpl,
  restoreBackupActionImpl,
  switchStorageModeActionImpl,
  syncBackupToGoogleDriveNowActionImpl,
} from "./domains/storage-privacy";
import {
  createTallyAutomationActionImpl,
  deleteReminderRuleActionImpl,
  deleteStockItemActionImpl,
  deleteTallyAutomationActionImpl,
  dismissSupplierBillDraftJsonActionImpl,
  generatePairingCodeActionImpl,
  generatePairingCodeJsonActionImpl,
  importSupplierBillDraftJsonActionImpl,
  importTallyFileActionImpl,
  importTallyInventoryFileActionImpl,
  lockConfidentialityMaskJsonActionImpl,
  markTallyBillPaidActionImpl,
  purgeConfidentialDataNowJsonActionImpl,
  recordTallyVoucherActionImpl,
  requestUnmaskOtpJsonActionImpl,
  revokeTallyDeviceJsonActionImpl,
  rotatePublicBillLinksActionImpl,
  rotateTallyTokenJsonActionImpl,
  rotateTallyWebhookTokenActionImpl,
  runDueTallyRemindersActionImpl,
  saveConfidentialityPolicyJsonActionImpl,
  saveReminderRuleActionImpl,
  saveTallyCompanyRoutingJsonActionImpl,
  sendBillWhatsAppActionImpl,
  sendTestTallyBillWebhookActionImpl,
  simulateSampleTallyBillJsonActionImpl,
  syncCaGoogleSheetJsonActionImpl,
  syncLocalTallyInventoryActionImpl,
  syncLocalTallyPort9000JsonActionImpl,
  testTallyEndpointHandshakeJsonActionImpl,
  toggleTallyAutomationActionImpl,
  toggleTallyWebhookJsonActionImpl,
  upsertStockItemActionImpl,
  upsertWorkspacePartyLedgerActionImpl,
  verifyUnmaskOtpJsonActionImpl,
} from "./domains/tally-inventory";

export type { WebAuthFormState };

// Auth, Profile, Team & Business Settings
export async function registerFormStateAction(prevState: WebAuthFormState, formData: FormData) {
  return registerFormStateActionImpl(prevState, formData);
}
export async function loginFormStateAction(prevState: WebAuthFormState, formData: FormData) {
  return loginFormStateActionImpl(prevState, formData);
}
export async function logoutAction() {
  return logoutActionImpl();
}
export async function forgotPasswordAction(formData: FormData) {
  return forgotPasswordActionImpl(formData);
}
export async function resetPasswordAction(formData: FormData) {
  return resetPasswordActionImpl(formData);
}
export async function verifyEmailCodeAction(formData: FormData) {
  return verifyEmailCodeActionImpl(formData);
}
export async function resendVerificationEmailAction(formData?: FormData) {
  return resendVerificationEmailActionImpl(formData);
}
export async function setWebLocaleAction(formData: FormData) {
  return setWebLocaleActionImpl(formData);
}
export async function switchWorkspaceAction(formData: FormData) {
  return switchWorkspaceActionImpl(formData);
}
export async function createNewBusinessAction(formData: FormData) {
  return createNewBusinessActionImpl(formData);
}
export async function updateBusinessProfileAction(formData: FormData) {
  return updateBusinessProfileActionImpl(formData);
}
export async function inviteTeamMemberAction(formData: FormData) {
  return inviteTeamMemberActionImpl(formData);
}
export async function resendInvitationAction(formData: FormData) {
  return resendInvitationActionImpl(formData);
}
export async function acceptInvitationAction(formData: FormData) {
  return acceptInvitationActionImpl(formData);
}
export async function updateTeamMemberRoleAction(formData: FormData) {
  return updateTeamMemberRoleActionImpl(formData);
}
export async function removeTeamMemberAction(formData: FormData) {
  return removeTeamMemberActionImpl(formData);
}
export async function revokeInvitationAction(formData: FormData) {
  return revokeInvitationActionImpl(formData);
}
export async function changePasswordAction(formData: FormData) {
  return changePasswordActionImpl(formData);
}
export async function submitHelpFeedbackAction(formData: FormData) {
  return submitHelpFeedbackActionImpl(formData);
}
export async function saveUserProfileJsonAction(formData: FormData) {
  return saveUserProfileJsonActionImpl(formData);
}
export async function changePasswordJsonAction(formData: FormData) {
  return changePasswordJsonActionImpl(formData);
}
export async function sendVerificationEmailJsonAction() {
  return sendVerificationEmailJsonActionImpl();
}
export async function verifyEmailCodeJsonAction(formData: FormData) {
  return verifyEmailCodeJsonActionImpl(formData);
}
export async function revokeSessionJsonAction(formData: FormData) {
  return revokeSessionJsonActionImpl(formData);
}
export async function revokeOtherSessionsJsonAction() {
  return revokeOtherSessionsJsonActionImpl();
}
export async function saveBusinessSettingsJsonAction(formData: FormData) {
  return saveBusinessSettingsJsonActionImpl(formData);
}
export async function createNewBusinessJsonAction(formData: FormData) {
  return createNewBusinessJsonActionImpl(formData);
}
export async function switchWorkspaceJsonAction(formData: FormData) {
  return switchWorkspaceJsonActionImpl(formData);
}
export async function beginUserTotpEnrollmentJsonAction() {
  return beginUserTotpEnrollmentJsonActionImpl();
}
export async function confirmUserTotpEnrollmentJsonAction(formData: FormData) {
  return confirmUserTotpEnrollmentJsonActionImpl(formData);
}
export async function disableUserTotpMfaJsonAction(formData: FormData) {
  return disableUserTotpMfaJsonActionImpl(formData);
}

// Billing, Prepaid Wallet & Razorpay
export async function submitRechargeRequestAction(formData: FormData) {
  return submitRechargeRequestActionImpl(formData);
}
export async function submitAdSpendRechargeRequestAction(formData: FormData) {
  return submitAdSpendRechargeRequestActionImpl(formData);
}
export async function createOnlineRazorpayOrderAction(formData: FormData) {
  return createOnlineRazorpayOrderActionImpl(formData);
}
export async function createRazorpayCheckoutOrderJsonAction(input: {
  amountRupees: number;
  amountPaise?: number;
  purpose?: "wallet_topup" | "ad_spend_topup";
}) {
  return createRazorpayCheckoutOrderJsonActionImpl(input);
}
export async function verifyRazorpayPaymentJsonAction(input: {
  orderId: string;
  paymentId: string;
  signatureHex: string;
}) {
  return verifyRazorpayPaymentJsonActionImpl(input);
}
export async function requestServicePlanAction(formData: FormData) {
  return requestServicePlanActionImpl(formData);
}
export async function requestBundlePlanAction(formData: FormData) {
  return requestBundlePlanActionImpl(formData);
}
export async function submitActivationModalAction(formData: FormData) {
  return submitActivationModalActionImpl(formData);
}
export async function instantActivateFromWalletAction(formData: FormData) {
  return instantActivateFromWalletActionImpl(formData);
}

// Shared Inbox & WhatsApp Templates / Broadcasts
export async function createContactAction(formData: FormData) {
  return createContactActionImpl(formData);
}
export async function startConversationAction(formData: FormData) {
  return startConversationActionImpl(formData);
}
export async function replyConversationAction(formData: FormData) {
  return replyConversationActionImpl(formData);
}
export async function changeConversationStatusAction(formData: FormData) {
  return changeConversationStatusActionImpl(formData);
}
export async function addInternalNoteAction(formData: FormData) {
  return addInternalNoteActionImpl(formData);
}
export async function saveCannedReplyAction(formData: FormData) {
  return saveCannedReplyActionImpl(formData);
}
export async function deleteCannedReplyAction(formData: FormData) {
  return deleteCannedReplyActionImpl(formData);
}
export async function assignConversationAction(formData: FormData) {
  return assignConversationActionImpl(formData);
}
export async function attachConversationLabelAction(formData: FormData) {
  return attachConversationLabelActionImpl(formData);
}
export async function removeConversationLabelAction(formData: FormData) {
  return removeConversationLabelActionImpl(formData);
}
export async function createTemplateAction(formData: FormData) {
  return createTemplateActionImpl(formData);
}
export async function submitTemplateToMetaAction(formData: FormData) {
  return submitTemplateToMetaActionImpl(formData);
}
export async function updateTemplateAction(formData: FormData) {
  return updateTemplateActionImpl(formData);
}
export async function deleteTemplateAction(formData: FormData) {
  return deleteTemplateActionImpl(formData);
}
export async function installStarterTemplatesAction() {
  return installStarterTemplatesActionImpl();
}
export async function syncMetaTemplatesAction() {
  return syncMetaTemplatesActionImpl();
}
export async function launchBroadcastAction(formData: FormData) {
  return launchBroadcastActionImpl(formData);
}
export async function addSuppressionAction(formData: FormData) {
  return addSuppressionActionImpl(formData);
}
export async function removeSuppressionAction(formData: FormData) {
  return removeSuppressionActionImpl(formData);
}
export async function lintWhatsAppTemplateJsonAction(formData: FormData) {
  return lintWhatsAppTemplateJsonActionImpl(formData);
}
export async function translateWhatsAppTemplateJsonAction(formData: FormData) {
  return translateWhatsAppTemplateJsonActionImpl(formData);
}

// Tally Prime Sync, Vouchers, Ledgers & Inventory
export async function generatePairingCodeAction() {
  return generatePairingCodeActionImpl();
}
export async function rotateTallyWebhookTokenAction() {
  return rotateTallyWebhookTokenActionImpl();
}
export async function rotatePublicBillLinksAction(formData?: FormData) {
  return rotatePublicBillLinksActionImpl(formData);
}
export async function createTallyAutomationAction(formData: FormData) {
  return createTallyAutomationActionImpl(formData);
}
export async function toggleTallyAutomationAction(formData: FormData) {
  return toggleTallyAutomationActionImpl(formData);
}
export async function deleteTallyAutomationAction(formData: FormData) {
  return deleteTallyAutomationActionImpl(formData);
}
export async function sendTestTallyBillWebhookAction(formData: FormData) {
  return sendTestTallyBillWebhookActionImpl(formData);
}
export async function recordTallyVoucherAction(formData: FormData) {
  return recordTallyVoucherActionImpl(formData);
}
export async function upsertWorkspacePartyLedgerAction(formData: FormData) {
  return upsertWorkspacePartyLedgerActionImpl(formData);
}
export async function markTallyBillPaidAction(formData: FormData) {
  return markTallyBillPaidActionImpl(formData);
}
export async function importTallyFileAction(formData: FormData) {
  return importTallyFileActionImpl(formData);
}
export async function upsertStockItemAction(formData: FormData) {
  return upsertStockItemActionImpl(formData);
}
export async function deleteStockItemAction(formData: FormData) {
  return deleteStockItemActionImpl(formData);
}
export async function importTallyInventoryFileAction(formData: FormData) {
  return importTallyInventoryFileActionImpl(formData);
}
export async function syncLocalTallyInventoryAction(formData: FormData) {
  return syncLocalTallyInventoryActionImpl(formData);
}
export async function sendBillWhatsAppAction(formData: FormData) {
  return sendBillWhatsAppActionImpl(formData);
}
export async function saveReminderRuleAction(formData: FormData) {
  return saveReminderRuleActionImpl(formData);
}
export async function deleteReminderRuleAction(formData: FormData) {
  return deleteReminderRuleActionImpl(formData);
}
export async function runDueTallyRemindersAction(formData: FormData) {
  return runDueTallyRemindersActionImpl(formData);
}
export async function rotateTallyTokenJsonAction() {
  return rotateTallyTokenJsonActionImpl();
}
export async function testTallyEndpointHandshakeJsonAction() {
  return testTallyEndpointHandshakeJsonActionImpl();
}
export async function toggleTallyWebhookJsonAction(formData: FormData) {
  return toggleTallyWebhookJsonActionImpl(formData);
}
export async function generatePairingCodeJsonAction() {
  return generatePairingCodeJsonActionImpl();
}
export async function revokeTallyDeviceJsonAction(formData: FormData) {
  return revokeTallyDeviceJsonActionImpl(formData);
}
export async function simulateSampleTallyBillJsonAction(formData: FormData) {
  return simulateSampleTallyBillJsonActionImpl(formData);
}
export async function syncLocalTallyPort9000JsonAction(port = 9000) {
  return syncLocalTallyPort9000JsonActionImpl(port);
}
export async function saveTallyCompanyRoutingJsonAction(formData: FormData) {
  return saveTallyCompanyRoutingJsonActionImpl(formData);
}
export async function syncCaGoogleSheetJsonAction() {
  return syncCaGoogleSheetJsonActionImpl();
}
export async function importSupplierBillDraftJsonAction(formData: FormData) {
  return importSupplierBillDraftJsonActionImpl(formData);
}
export async function dismissSupplierBillDraftJsonAction(formData: FormData) {
  return dismissSupplierBillDraftJsonActionImpl(formData);
}

// Campaigns, Social Posts, Pixel & Google Reviews
export async function createCampaignAction(formData: FormData) {
  return createCampaignActionImpl(formData);
}
export async function toggleCampaignAction(formData: FormData) {
  return toggleCampaignActionImpl(formData);
}
export async function updateCampaignBudgetAction(formData: FormData) {
  return updateCampaignBudgetActionImpl(formData);
}
export async function syncLiveAdsInsightsAction() {
  return syncLiveAdsInsightsActionImpl();
}
export async function recordCampaignSnapshotAction(formData: FormData) {
  return recordCampaignSnapshotActionImpl(formData);
}
export async function schedulePostAction(formData: FormData) {
  return schedulePostActionImpl(formData);
}
export async function publishScheduledPostAction(formData: FormData) {
  return publishScheduledPostActionImpl(formData);
}
export async function deleteScheduledPostAction(formData: FormData) {
  return deleteScheduledPostActionImpl(formData);
}
export async function recordPixelEventAction(formData: FormData) {
  return recordPixelEventActionImpl(formData);
}
export async function recordReviewAction(formData: FormData) {
  return recordReviewActionImpl(formData);
}
export async function replyReviewAction(formData: FormData) {
  return replyReviewActionImpl(formData);
}
export async function syncGoogleReviewsAction(formData: FormData) {
  return syncGoogleReviewsActionImpl(formData);
}
export async function generateReviewDraftAction(formData: FormData) {
  return generateReviewDraftActionImpl(formData);
}
export async function generateSmartAdCopyJsonAction(formData: FormData) {
  return generateSmartAdCopyJsonActionImpl(formData);
}

// Connected Channels, SSL & Developer API Keys / Webhooks
export async function connectAccountAction(formData: FormData) {
  return connectAccountActionImpl(formData);
}
export async function disconnectAccountAction(formData: FormData) {
  return disconnectAccountActionImpl(formData);
}
export async function verifyConnectionHealthAction(formData: FormData) {
  return verifyConnectionHealthActionImpl(formData);
}
export async function issueApiKeyAction(formData: FormData) {
  return issueApiKeyActionImpl(formData);
}
export async function revokeApiKeyAction(formData: FormData) {
  return revokeApiKeyActionImpl(formData);
}
export async function rotateApiKeyAction(formData: FormData) {
  return rotateApiKeyActionImpl(formData);
}
export async function createOutboundWebhookAction(formData: FormData) {
  return createOutboundWebhookActionImpl(formData);
}
export async function deleteOutboundWebhookAction(formData: FormData) {
  return deleteOutboundWebhookActionImpl(formData);
}
export async function testOutboundWebhookAction(formData: FormData) {
  return testOutboundWebhookActionImpl(formData);
}
export async function connectChannelJsonAction(formData: FormData) {
  return connectChannelJsonActionImpl(formData);
}
export async function updateConnectionJsonAction(formData: FormData) {
  return updateConnectionJsonActionImpl(formData);
}
export async function verifyConnectionLiveJsonAction(formData: FormData) {
  return verifyConnectionLiveJsonActionImpl(formData);
}
export async function syncGoogleBusinessProfileJsonAction(formData: FormData) {
  return syncGoogleBusinessProfileJsonActionImpl(formData);
}
export async function selectGoogleBusinessLocationJsonAction(formData: FormData) {
  return selectGoogleBusinessLocationJsonActionImpl(formData);
}
export async function selectGoogleAdsCustomerJsonAction(formData: FormData) {
  return selectGoogleAdsCustomerJsonActionImpl(formData);
}
export async function selectGoogleSearchConsoleSiteJsonAction(formData: FormData) {
  return selectGoogleSearchConsoleSiteJsonActionImpl(formData);
}
export async function selectMetaChannelAssetJsonAction(formData: FormData) {
  return selectMetaChannelAssetJsonActionImpl(formData);
}
export async function refreshMetaChannelAssetsJsonAction(formData: FormData) {
  return refreshMetaChannelAssetsJsonActionImpl(formData);
}
export async function disconnectConnectionJsonAction(formData: FormData) {
  return disconnectConnectionJsonActionImpl(formData);
}
export async function rotateMetaVerifyTokenJsonAction() {
  return rotateMetaVerifyTokenJsonActionImpl();
}
export async function issueApiKeyJsonAction(formData: FormData) {
  return issueApiKeyJsonActionImpl(formData);
}
export async function rotateApiKeyJsonAction(formData: FormData) {
  return rotateApiKeyJsonActionImpl(formData);
}
export async function revokeApiKeyJsonAction(formData: FormData) {
  return revokeApiKeyJsonActionImpl(formData);
}
export async function createOutboundWebhookJsonAction(formData: FormData) {
  return createOutboundWebhookJsonActionImpl(formData);
}
export async function testOutboundWebhookJsonAction(formData: FormData) {
  return testOutboundWebhookJsonActionImpl(formData);
}
export async function deleteOutboundWebhookJsonAction(formData: FormData) {
  return deleteOutboundWebhookJsonActionImpl(formData);
}
export async function provisionWorkspaceSslJsonAction() {
  return provisionWorkspaceSslJsonActionImpl();
}
export async function connectWorkspaceCloudflareOneClickJsonAction(formData: FormData) {
  return connectWorkspaceCloudflareOneClickJsonActionImpl(formData);
}
export async function updateWorkspaceCloudflareWorkloadsJsonAction(formData: FormData) {
  return updateWorkspaceCloudflareWorkloadsJsonActionImpl(formData);
}
export async function provisionWorkspaceCloudflareResourceJsonAction(formData: FormData) {
  return provisionWorkspaceCloudflareResourceJsonActionImpl(formData);
}
export async function probeWorkspaceCloudflareConnectionJsonAction() {
  return probeWorkspaceCloudflareConnectionJsonActionImpl();
}
export async function disconnectWorkspaceCloudflareJsonAction() {
  return disconnectWorkspaceCloudflareJsonActionImpl();
}

// Storage, Backups, CSV Import & DPDP Portability / Erasure
export async function switchStorageModeAction(formData: FormData) {
  return switchStorageModeActionImpl(formData);
}
export async function deleteWorkspaceStoredObjectAction(formData: FormData) {
  return deleteWorkspaceStoredObjectActionImpl(formData);
}
export async function optimizeDatabaseAction() {
  return optimizeDatabaseActionImpl();
}
export async function createEncryptedBackupAction(formData: FormData) {
  return createEncryptedBackupActionImpl(formData);
}
export async function syncBackupToGoogleDriveNowAction() {
  return syncBackupToGoogleDriveNowActionImpl();
}
export async function disconnectGoogleDriveFromBackupsAction(formData: FormData) {
  return disconnectGoogleDriveFromBackupsActionImpl(formData);
}
export async function restoreBackupAction(formData: FormData) {
  return restoreBackupActionImpl(formData);
}
export async function importContactsCsvAction(formData: FormData) {
  return importContactsCsvActionImpl(formData);
}
export async function requestCustomAdapterAction(formData: FormData) {
  return requestCustomAdapterActionImpl(formData);
}
export async function exportWorkspaceDpdpDataJsonAction() {
  return exportWorkspaceDpdpDataJsonActionImpl();
}
export async function deleteWorkspaceAccountAction(formData: FormData) {
  return deleteWorkspaceAccountActionImpl(formData);
}
export async function saveConfidentialityPolicyJsonAction(formData: FormData) {
  return saveConfidentialityPolicyJsonActionImpl(formData);
}
export async function requestUnmaskOtpJsonAction() {
  return requestUnmaskOtpJsonActionImpl();
}
export async function verifyUnmaskOtpJsonAction(formData: FormData) {
  return verifyUnmaskOtpJsonActionImpl(formData);
}
export async function lockConfidentialityMaskJsonAction() {
  return lockConfidentialityMaskJsonActionImpl();
}
export async function purgeConfidentialDataNowJsonAction() {
  return purgeConfidentialDataNowJsonActionImpl();
}
