import { IosSpinner } from "@rsl/ui";

export default function AuthLoading() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F8F9FB] p-6">
      <div className="inline-flex items-center gap-3 rounded-2xl border border-zinc-200/90 bg-white px-5 py-3.5 text-[13px] font-semibold text-slate-900 shadow-xs">
        <IosSpinner size="md" className="text-emerald-600" />
        <span>Opening account...</span>
      </div>
    </div>
  );
}
