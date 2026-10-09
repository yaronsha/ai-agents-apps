import { useEffect, useState } from "react";
import { enablePush, pushEnabled, pushSupport, settings } from "../api";
import { pushPromptMode } from "../pushPrompt";

/** Home-screen nudge to turn on push; the Settings card stays the full control. */
export function PushPrompt() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [dismissedAt, setDismissedAt] = useState(settings.pushPromptDismissedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pushEnabled().then(setEnabled, () => setEnabled(false));
  }, []);

  if (enabled === null) return null;
  const mode = pushPromptMode({
    support: pushSupport(),
    permission: "Notification" in window ? Notification.permission : null,
    enabled,
    hasServer: Boolean(settings.apiUrl()),
    dismissedAt,
    now: Date.now(),
  });
  if (!mode) return null;

  // Permission has to be asked from this tap: browsers and iOS refuse it otherwise.
  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await enablePush();
      setEnabled(await pushEnabled());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    settings.dismissPushPrompt();
    setDismissedAt(Date.now());
  };

  return (
    <section className="card push-prompt" aria-label="התראות פוש">
      <h2>{mode === "blocked" ? "ההתראות חסומות" : "רוצה לקבל התראות על עיכובי טיסות, פקקים ותדריך ערב?"}</h2>
      {mode === "enable" && (
        <>
          <p className="muted">ההתראות מגיעות גם כשהאפליקציה סגורה. שקט בלילה, חוץ מדברים דחופים.</p>
          <div className="row">
            <button className="primary" onClick={enable} disabled={busy}>
              {busy ? "מפעיל..." : "הפעלת התראות"}
            </button>
            <button onClick={dismiss}>לא עכשיו</button>
          </div>
        </>
      )}
      {mode === "install" && (
        <>
          <p>באייפון התראות עובדות רק מהאפליקציה שעל מסך הבית: לחצו על שיתוף ואז "הוסף למסך הבית", ופתחו את האפליקציה משם.</p>
          <div className="row">
            <button onClick={dismiss}>הבנתי</button>
          </div>
        </>
      )}
      {mode === "blocked" && (
        <>
          <p>הדפדפן חוסם התראות מהאתר הזה, אז לא תקבלו עדכונים על עיכובי טיסות ופקקים. אפשר לאפשר אותן מחדש בהגדרות הדפדפן או המכשיר, ואז ללחוץ "הפעלת התראות" במסך ההגדרות.</p>
          <div className="row">
            <button onClick={dismiss}>הבנתי</button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
