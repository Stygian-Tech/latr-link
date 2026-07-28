export default function ExtensionCallbackPage() {
  return (
    <main className="flex min-h-app items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="max-w-md space-y-3 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Completing Extension Sign-In…
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          L@tr.link should return you to the browser extension automatically.
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          If this page remains open, confirm the L@tr.link extension is installed
          and enabled, then start sign-in again from its toolbar button.
        </p>
      </div>
    </main>
  );
}
