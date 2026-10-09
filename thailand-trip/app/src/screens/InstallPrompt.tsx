import type { useInstallPrompt } from "../installPrompt";

/** Chrome on Android: one tap opens the system install dialog. Other browsers see nothing. */
export function InstallPrompt({ install, dismiss }: Pick<ReturnType<typeof useInstallPrompt>, "install" | "dismiss">) {
  return (
    <section className="card push-prompt" aria-label="התקנת האפליקציה">
      <h2>להתקין את האפליקציה בטלפון?</h2>
      <p className="muted">היא תופיע במסך הבית, תיפתח במסך מלא ותעבוד גם בלי קליטה.</p>
      <div className="row">
        <button className="primary" onClick={install}>
          התקנה
        </button>
        <button onClick={dismiss}>לא עכשיו</button>
      </div>
    </section>
  );
}
