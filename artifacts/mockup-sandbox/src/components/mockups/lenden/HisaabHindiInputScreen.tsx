import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Languages,
  Mic,
  Pencil,
  RotateCcw,
  Sparkles,
} from "lucide-react";

type ScreenState = "ready" | "typing" | "listening" | "processing" | "result" | "review";
type Language = "हिन्दी" | "Hinglish" | "English";

const TRANSCRIPTS: Record<Language, string> = {
  हिन्दी: "शर्मा जी के दो लाख बाकी हैं, सोमवार को भुगतान करेंगे।",
  Hinglish: "Sharma ji ke do lakh baaki hain, Somvaar ko payment karenge.",
  English: "Sharma ji still owes two lakh; they will pay on Monday.",
};

const LANGUAGE_HINTS: Record<Language, string> = {
  हिन्दी: "हिंदी में बोलें — जैसे आप बात करते हैं।",
  Hinglish: "Hindi, Hinglish, ya English — jis mein mann ho.",
  English: "Speak naturally in English, Hindi, or Hinglish.",
};

export function HisaabHindiInputScreen() {
  const [screen, setScreen] = useState<ScreenState>("ready");
  const [language, setLanguage] = useState<Language>("हिन्दी");
  const [typedText, setTypedText] = useState("");

  useEffect(() => {
    if (screen !== "listening") return;
    const timer = window.setTimeout(() => setScreen("processing"), 1500);
    return () => window.clearTimeout(timer);
  }, [screen]);

  useEffect(() => {
    if (screen !== "processing") return;
    const timer = window.setTimeout(() => setScreen("result"), 1250);
    return () => window.clearTimeout(timer);
  }, [screen]);

  const reset = () => {
    setTypedText("");
    setScreen("ready");
  };

  const startListening = () => {
    if (screen === "listening" || screen === "processing") return;
    setScreen("listening");
  };

  const transcript = typedText.trim() || TRANSCRIPTS[language];
  const isWorking = screen === "listening" || screen === "processing";

  return (
    <main className="min-h-[100dvh] bg-[#fbf8f0] px-5 py-6 text-[#2c312c] sm:px-8">
      <div className="mx-auto flex min-h-[840px] w-full max-w-[430px] flex-col">
        <header className="flex items-start justify-between">
          {screen === "review" ? (
            <button
              type="button"
              onClick={() => setScreen("result")}
              className="mt-1 inline-flex items-center gap-2 rounded-full px-1 py-2 text-sm font-semibold text-[#766f63] transition hover:text-[#302f29]"
              aria-label="वापस जाएँ"
            >
              <ArrowLeft size={18} strokeWidth={2.2} />
              वापस
            </button>
          ) : (
            <div>
              <p className="text-[20px] font-black tracking-[0.18em] text-[#812f28]">हिसाब</p>
              <p className="mt-1 text-[12px] font-medium tracking-wide text-[#8f887c]">
                आपका कारोबार, आपकी भाषा में
              </p>
            </div>
          )}
          <span className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#edb65b]/25 text-[#b46c28]">
            <Sparkles size={14} strokeWidth={2.3} />
          </span>
        </header>

        {screen === "typing" ? (
          <section className="flex flex-1 flex-col justify-center pb-12">
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.17em] text-[#b46c28]">
              लिखकर बताएँ
            </p>
            <h1 className="text-[38px] font-bold leading-[1.05] tracking-[-0.04em]">
              क्या हुआ?
            </h1>
            <textarea
              autoFocus
              value={typedText}
              onChange={(event) => setTypedText(event.target.value)}
              placeholder="हिंदी, Hinglish या English में लिखें..."
              className="mt-8 min-h-[170px] w-full resize-none rounded-[26px] border border-[#e5dccb] bg-[#fffdf8] p-5 text-[17px] leading-8 text-[#47443c] outline-none shadow-[0_14px_32px_rgba(90,65,31,0.07)] placeholder:text-[#b7ae9f] focus:border-[#d49b4e] focus:ring-4 focus:ring-[#f5e4c8]"
            />
            <button
              type="button"
              onClick={() => setScreen("result")}
              disabled={!typedText.trim()}
              className="mt-6 h-14 rounded-2xl bg-[#812f28] text-base font-bold text-[#fffaf1] shadow-[0_9px_20px_rgba(129,47,40,0.19)] transition hover:bg-[#6f2923] disabled:cursor-not-allowed disabled:opacity-40"
            >
              आगे देखें
            </button>
            <button
              type="button"
              onClick={reset}
              className="mt-3 flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold text-[#766f63] transition hover:bg-[#f2ede2]"
            >
              <ArrowLeft size={16} />
              वापस
            </button>
          </section>
        ) : screen === "review" ? (
          <section className="flex flex-1 flex-col justify-center pb-12">
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.17em] text-[#b46c28]">
              एक बार देख लें
            </p>
            <h1 className="text-[38px] font-bold leading-[1.05] tracking-[-0.04em]">
              हिसाब सही है?
            </h1>
            <div className="mt-8 rounded-[26px] border border-[#e5dccb] bg-[#fffdf8] p-5 shadow-[0_14px_32px_rgba(90,65,31,0.07)]">
              <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#a47d48]">
                <Languages size={15} />
                {language}
              </div>
              <p className="text-[18px] leading-8 text-[#47443c]">{transcript}</p>
              <div className="mt-5 flex items-center gap-2 border-t border-[#eee8dc] pt-4 text-sm text-[#8f887c]">
                <Check size={17} className="text-[#60805f]" />
                बाद में सेव करने के लिए तैयार
              </div>
            </div>
            <button
              type="button"
              onClick={reset}
              className="mt-6 flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#812f28] text-base font-bold text-[#fffaf1] shadow-[0_9px_20px_rgba(129,47,40,0.19)] transition hover:bg-[#6f2923]"
            >
              <RotateCcw size={18} />
              एक और नोट
            </button>
            <p className="mt-3 text-center text-xs text-[#a29a8c]">
              यह अभी एक प्रोटोटाइप है — सेव करना जल्द आ रहा है।
            </p>
          </section>
        ) : screen === "result" ? (
          <section className="flex flex-1 flex-col justify-center pb-14">
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.17em] text-[#b46c28]">
              समझ गया
            </p>
            <h1 className="text-[38px] font-bold leading-[1.05] tracking-[-0.04em]">
              मैंने यह सुना
            </h1>
            <div className="mt-8 rounded-[26px] border border-[#e5dccb] bg-[#fffdf8] p-5 shadow-[0_14px_32px_rgba(90,65,31,0.07)]">
              <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#a47d48]">
                <Languages size={15} />
                {language}
              </div>
              <p className="text-[18px] leading-8 text-[#47443c]">{transcript}</p>
            </div>
            <button
              type="button"
              onClick={() => setScreen("review")}
              className="mt-6 h-14 rounded-2xl bg-[#812f28] text-base font-bold text-[#fffaf1] shadow-[0_9px_20px_rgba(129,47,40,0.19)] transition hover:bg-[#6f2923]"
            >
              विवरण देखें
            </button>
            <button
              type="button"
              onClick={reset}
              className="mt-3 flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold text-[#766f63] transition hover:bg-[#f2ede2]"
            >
              <RotateCcw size={16} />
              फिर से बोलें
            </button>
          </section>
        ) : (
          <>
            <section className="pt-[14vh]">
              <p className="mb-3 text-sm font-bold uppercase tracking-[0.17em] text-[#b46c28]">
                एक छोटा सा नोट
              </p>
              <h1 className="text-[44px] font-bold leading-[0.98] tracking-[-0.055em]">
                क्या हुआ?
              </h1>
              <p className="mt-5 max-w-[320px] text-[16px] leading-7 text-[#766f63]">
                ग्राहक, पेमेंट या अगले कदम की बात — बस बोलकर बता दें।
              </p>
            </section>

            <section className="flex flex-1 flex-col items-center justify-center pb-5">
              <button
                type="button"
                onClick={startListening}
                disabled={isWorking}
                className={`group relative flex h-[154px] w-[154px] items-center justify-center rounded-full bg-[#812f28] text-[#fffaf1] shadow-[0_18px_38px_rgba(129,47,40,0.22)] transition ${
                  isWorking ? "scale-105" : "hover:scale-[1.03] active:scale-[0.98]"
                }`}
                aria-label={isWorking ? "सुन रहे हैं" : "बोलना शुरू करें"}
              >
                {isWorking && (
                  <>
                    <span className="absolute inset-[-12px] animate-ping rounded-full border border-[#c89465] opacity-40" />
                    <span className="absolute inset-[-25px] rounded-full border border-[#ead7ba]" />
                  </>
                )}
                {screen === "processing" ? (
                  <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#fffaf1]/30 border-t-[#fffaf1]" />
                ) : (
                  <Mic size={48} strokeWidth={1.7} />
                )}
              </button>
              <p className="mt-7 text-lg font-bold">
                {screen === "listening"
                  ? "सुन रहा हूँ..."
                  : screen === "processing"
                    ? "समझ रहा हूँ..."
                    : "बोलने के लिए दबाएँ"}
              </p>
              <p className="mt-2 text-center text-sm text-[#958d80]">{LANGUAGE_HINTS[language]}</p>

              {!isWorking && (
                <>
                  <button
                    type="button"
                    onClick={() => setScreen("typing")}
                    className="mt-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-[#8b4a3d] transition hover:bg-[#f3e9d8]"
                  >
                    <Pencil size={16} strokeWidth={2.2} />
                    लिखकर बताएँ
                  </button>
                  <div className="mt-7 flex items-center gap-1 rounded-full border border-[#e5dccb] bg-[#fffdf8] p-1">
                    {(["हिन्दी", "Hinglish", "English"] as Language[]).map((item) => (
                      <button
                        type="button"
                        key={item}
                        onClick={() => setLanguage(item)}
                        className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                          language === item
                            ? "bg-[#f1dfc0] text-[#7d3c31]"
                            : "text-[#958d80] hover:bg-[#f7f0e3]"
                        }`}
                        aria-pressed={language === item}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="rounded-[22px] border border-[#eadfca] bg-[#f5eddf] px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#aa7740]">
                ऐसे बोलकर देखें
              </p>
              <p className="mt-2 text-[15px] leading-6 text-[#665846]">{TRANSCRIPTS[language]}</p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default HisaabHindiInputScreen;