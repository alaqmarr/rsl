export const TALLY_TEMPLATE_VARIABLE_FIELDS = [
  { key: "partyName", label: "Customer / Party Name", sample: "Shree Ganesh Traders" },
  { key: "voucherNumber", label: "Bill / Receipt Number", sample: "GST/26-27/0108" },
  { key: "amountFormatted", label: "Bill / Receipt Amount (₹)", sample: "₹18,450" },
  { key: "balanceFormatted", label: "Pending Balance Due (₹)", sample: "₹18,450" },
  { key: "dueDateFormatted", label: "Payment Due Date", sample: "15 Nov 2026" },
  { key: "voucherDateFormatted", label: "Bill / Receipt Date", sample: "01 Nov 2026" },
  { key: "companyName", label: "Your Business Name", sample: "RSL Management" },
  {
    key: "paymentLink",
    label: "Direct 0%-Fee UPI QR Payment Link",
    sample: "https://app.rapidshiftlabs.in/pay/bill/sample",
  },
] as const;
