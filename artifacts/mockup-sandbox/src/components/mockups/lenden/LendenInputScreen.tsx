import { useEffect, useState } from "react";
import { ArrowLeft, Check, Mic, Pencil, RotateCcw } from "lucide-react";

type ScreenState =
  | "ready"
  | "typing"
  | "listening"
  | "processing"
  | "result"
  | "review";

const MOCK_TRANSCRIPT =
  "Sharma ka 2 lakh baaki hai, Monday ko payment karega.";

export function LendenInputScreen() {
  const [screen, setScreen] = useState<ScreenState>("ready");
  const [typedText, setTypedText] = useState("");

  useEffect(() => {
    if (screen !== "listening") return;

    const timer = window.setTimeout(() => setScreen("processing"), 1400);
    return () => window.clearTimeout(timer);
  }, [screen]);

  useEffect(() => {
    if (screen !== "processing") return;

    const timer = window.setTimeout(() => setScreen("result"), 1200);
    return () => window.clearTimeout(timer);
  }, [screen]);

  const startListening = () => {
    if (screen === "listening" || screen === "processing") return;
    setScreen("listening");
  };

  const reset = () => {
    setTypedText("");
    setScreen("ready");
  };

  const isWorking = screen === "listening" || screen === "processing";

  return (
    <main className="min-h-screen bg-[#f8f8f5] px-5 py-6 text-[#173b35] sm:px-8">
      <div className="mx-auto flex min-h-[840px] w-full max-w-[430px] flex-col">
        <header className="flex items-start justify-between">
          {screen === "review" ? (
            <button
              type="button"
              onClick={() => setScreen("result")}
              className="mt-1 inline-flex items-center gap-2 rounded-full px-1 py-2 text-sm font-semibold text-[#59716a] transition hover:text-[#173b35]"
              aria-label="Back to transcript"
            >
              <ArrowLeft size={18} strokeWidth={2.2} />
              Back
            </button>
          ) : (
            <div>
              <p className="text-[20px] font-black tracking-[0.22em] text-[#174f45]">
                LENDEN
              </p>
              <p className="mt-1 text-[12px] font-medium tracking-wide text-[#789089]">
                Your business remembers.
              </p>
            </div>
          )}
          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#d89a42]" />
        </header>

        {screen === "typing" ? (
          <section className="flex flex-1 flex-col justify-center pb-12">
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-[#b2762c]">
              Write it down
            </p>
            <h1 className="text-[38px] font-bold leading-[1.05] tracking-[-0.04em]">
              What happened?
            </h1>
            <textarea
              autoFocus
              value={typedText}
              onChange={(event) => setTypedText(event.target.value)}
              placeholder="Type naturally in Hindi, Hinglish, or English..."
              className="mt-8 min-h-[170px] w-full resize-none rounded-[26px] border border-[#dfe6df] bg-white p-5 text-[17px] leading-8 text-[#31564d] outline-none shadow-[0_12px_30px_rgba(36,73,63,0.07)] placeholder:text-[#a2b1ab] focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
            />
            <button
              type="button"
              onClick={() => setScreen("result")}
              disabled={!typedText.trim()}
              className="mt-6 h-14 rounded-2xl bg-[#174f45] text-base font-bold text-white shadow-[0_8px_20px_rgba(23,79,69,0.2)] transition hover:bg-[#123f38] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={reset}
              className="mt-3 flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold text-[#59716a] transition hover:bg-[#edf1eb]"
            >
              <ArrowLeft size={16} />
              Back
            </button>
          </section>
        ) : screen === "review" ? (
          <section className="flex flex-1 flex-col justify-center pb-12">
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-[#b2762c]">
              One last look
            </p>
            <h1 className="text-[38px] font-bold leading-[1.05] tracking-[-0.04em]">
              Review details
            </h1>
            <div className="mt-8 rounded-[26px] border border-[#dfe6df] bg-white p-5 shadow-[0_12px_30px_rgba(36,73,63,0.07)]">
              <p className="text-[17px] leading-8 text-[#31564d]">
                {MOCK_TRANSCRIPT}
              </p>
              <div className="mt-5 flex items-center gap-2 border-t border-[#edf0ec] pt-4 text-sm text-[#789089]">
                <Check size={17} className="text-[#2d8067]" />
                Ready to save later
              </div>
            </div>
            <button
              type="button"
              onClick={reset}
              className="mt-6 flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#174f45] text-base font-bold text-white shadow-[0_8px_20px_rgba(23,79,69,0.2)] transition hover:bg-[#123f38]"
            >
              <RotateCcw size={18} />
              Start another note
            </button>
            <p className="mt-3 text-center text-xs text-[#91a29d]">
              Saving is not connected in this prototype.
            </p>
          </section>
        ) : screen === "result" ? (
          <section className="flex flex-1 flex-col justify-center pb-14">
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-[#b2762c]">
              Got it
            </p>
            <h1 className="text-[38px] font-bold leading-[1.05] tracking-[-0.04em]">
              Here&apos;s what I heard
            </h1>
            <div className="mt-8 rounded-[26px] border border-[#dfe6df] bg-white p-5 shadow-[0_12px_30px_rgba(36,73,63,0.07)]">
              <p className="text-[17px] leading-8 text-[#31564d]">
                {MOCK_TRANSCRIPT}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScreen("review")}
              className="mt-6 h-14 rounded-2xl bg-[#174f45] text-base font-bold text-white shadow-[0_8px_20px_rgba(23,79,69,0.2)] transition hover:bg-[#123f38]"
            >
              Review details
            </button>
            <button
              type="button"
              onClick={reset}
              className="mt-3 flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold text-[#59716a] transition hover:bg-[#edf1eb]"
            >
              <RotateCcw size={16} />
              Try again
            </button>
          </section>
        ) : (
          <>
            <section className="pt-[18vh]">
              <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-[#b2762c]">
                A quick note
              </p>
              <h1 className="text-[44px] font-bold leading-[0.98] tracking-[-0.055em]">
                What happened?
              </h1>
              <p className="mt-5 max-w-[320px] text-[16px] leading-7 text-[#688079]">
                Tell Lenden about a customer, payment, or follow-up.
              </p>
            </section>

            <section className="flex flex-1 flex-col items-center justify-center pb-5">
              <button
                type="button"
                onClick={startListening}
                disabled={isWorking}
                className={`group relative flex h-[154px] w-[154px] items-center justify-center rounded-full bg-[#174f45] text-white shadow-[0_18px_38px_rgba(23,79,69,0.24)] transition ${
                  isWorking ? "scale-105" : "hover:scale-[1.03] active:scale-[0.98]"
                }`}
                aria-label={isWorking ? "Listening" : "Tap to speak"}
              >
                {isWorking && (
                  <>
                    <span className="absolute inset-[-12px] animate-ping rounded-full border border-[#9fb8ad] opacity-40" />
                    <span className="absolute inset-[-25px] rounded-full border border-[#d4e0d9]" />
                  </>
                )}
                {screen === "processing" ? (
                  <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
                ) : (
                  <Mic size={48} strokeWidth={1.7} />
                )}
              </button>
              <p className="mt-7 text-lg font-bold">
                {screen === "listening"
                  ? "Listening..."
                  : screen === "processing"
                    ? "Processing..."
                    : "Tap to speak"}
              </p>
              <p className="mt-2 text-center text-sm text-[#82938d]">
                Speak naturally in Hindi, Hinglish, or English.
              </p>

              {!isWorking && (
                <button
                  type="button"
                  onClick={() => setScreen("typing")}
                  className="mt-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-[#3c6b5e] transition hover:bg-[#e9efe8]"
                >
                  <Pencil size={16} strokeWidth={2.2} />
                  Type instead
                </button>
              )}
            </section>

            <section className="rounded-[22px] border border-[#e2e9e1] bg-[#eef3ed] px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#a3773f]">
                Try saying
              </p>
              <p className="mt-2 text-[15px] leading-6 text-[#43665c]">
                “Sharma ka 2 lakh baaki hai, Monday ko payment karega.”
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}