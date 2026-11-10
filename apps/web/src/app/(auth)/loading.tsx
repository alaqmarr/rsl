import { IosSpinner } from "@rsl/ui";

export default function AuthLoading() {
  return (
    <div className="rsl-ambient-canvas flex min-h-screen w-full items-center justify-center p-6">
      <div className="rsl-frost-surface inline-flex items-center gap-3 rounded-2xl px-5 py-3.5 text-[13px] font-semibold text-slate-900">
        <IosSpinner size="md" className="text-emerald-700" />
        <span>Opening account...</span>
      </div>
    </div>
  );
}
