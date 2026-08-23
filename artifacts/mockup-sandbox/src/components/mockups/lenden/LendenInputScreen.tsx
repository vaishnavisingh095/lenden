import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Mic, Pencil, RotateCcw } from "lucide-react";

type ScreenState =
  | "ready"
  | "typing"
  | "listening"
  | "paused"
  | "processing"
  | "result"
  | "review"
  | "customers"
  | "customerDetail";

export function LendenInputScreen() {
  const [screen, setScreen] = useState<ScreenState>("ready");
  const [typedText, setTypedText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
    const [customers, setCustomers] = useState<
    {
      id: number;
      customerName: string;
      balance: number;
      promiseAmount: string | null;
      promiseDate: string | null;
      notes: string | null;
      lastTransactionDate: string | null;
    }[]
  >([]);

  const [selectedCustomer, setSelectedCustomer] = useState<{
    customer: {
      id: number;
      customerName: string;
      promiseAmount: string | null;
      promiseDate: string | null;
      notes: string | null;
    };
    balance: number;
    transactions: {
      id: number;
      amount: string;
      type: "purchase" | "payment" | "adjustment";
      date: string;
      source: "voice" | "type";
      notes: string | null;
    }[];
  } | null>(null);

  const [extracted, setExtracted] = useState<{
  customer_name: string | null;
  amount: number | null;
  amount_type: "received" | "promised" | "outstanding" | null;
  promise_date: string | null;
  notes: string | null;
} | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startListening = async () => {
    if (screen === "listening" || screen === "paused" || screen === "processing") return;

    setErrorMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "";
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", () => {
  stream.getTracks().forEach((track) => track.stop());
  recorderRef.current = null;

  const audio = new Blob(chunksRef.current, {
    type: "audio/webm",
  });

  void transcribe(audio);
});
      recorder.start();
      setScreen("listening");
    } catch {
      setErrorMessage("Microphone permission is needed to record.");
      setScreen("ready");
    }
  };

  const toggleListening = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    if (recorder.state === "recording") {
      recorder.pause();
      setScreen("paused");
    } else if (recorder.state === "paused") {
      recorder.resume();
      setScreen("listening");
    }
  };

  const stopListening = () => {
  const recorder = recorderRef.current;

  if (!recorder) {
    setErrorMessage("No active recording found.");
    setScreen("ready");
    return;
  }

  if (recorder.state === "inactive") {
    recorderRef.current = null;
    setScreen("ready");
    return;
  }

  setScreen("processing");
  recorder.stop();
};

  const transcribe = async (audio: Blob) => {
    const extension = audio.type.split("/", 2)[1]?.split(";", 1)[0] || "webm";
    const form = new FormData();
    form.append("file", audio, `lenden-recording.${extension}`);

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as {
        transcript?: string;
        error?: unknown;
      };
      if (!response.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : data.error && typeof data.error === "object"
              ? JSON.stringify(data.error)
              : "Transcription failed";
        throw new Error(message);
      }
      const finalTranscript = data.transcript || "";

setTranscript(finalTranscript);

if (!finalTranscript.trim()) {
  setErrorMessage("No speech was detected.");
  setScreen("ready");
  return;
}

const extractResponse = await fetch("/api/extract", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    transcript: finalTranscript,
  }),
});

const extractData = (await extractResponse.json()) as {
  customer_name?: string | null;
  amount?: number | null;
  amount_type?: "received" | "promised" | "outstanding" | null;
  promise_date?: string | null;
  notes?: string | null;
  error?: string;
};

if (!extractResponse.ok) {
  throw new Error(
    extractData.error || "Could not understand payment details.",
  );
}

setExtracted({
  customer_name: extractData.customer_name ?? null,
  amount: extractData.amount ?? null,
  amount_type: extractData.amount_type ?? null,
  promise_date: extractData.promise_date ?? null,
  notes: extractData.notes ?? null,
});

await loadCustomers();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Transcription failed.",
      );
      setScreen("ready");
    }
  };
    const loadCustomers = async () => {
    try {
      setErrorMessage("");

      const response = await fetch("/api/customers");

      if (!response.ok) {
        throw new Error("Could not load customers.");
      }

      const data = (await response.json()) as typeof customers;
      setCustomers(data);
      setScreen("customers");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not load customers.",
      );
    }
  };

  const loadCustomer = async (customerId: number) => {
    try {
      setErrorMessage("");

      const response = await fetch(`/api/customers/${customerId}`);

      if (!response.ok) {
        throw new Error("Could not load customer history.");
      }

      const data = (await response.json()) as typeof selectedCustomer;
      setSelectedCustomer(data);
      setScreen("customerDetail");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not load customer history.",
      );
    }
  };

  const reset = () => {
  setTypedText("");
  setTranscript("");
  setExtracted(null);
  setErrorMessage("");
  setScreen("ready");
};

  const isWorking =
    screen === "listening" || screen === "paused" || screen === "processing";

  return (
    <main className="min-h-screen bg-[#f8f8f5] px-5 py-6 text-[#173b35] sm:px-8">
      <div className="mx-auto flex min-h-[840px] w-full max-w-[430px] flex-col">
        <header className="flex items-start justify-between">
  {screen === "review" ? (
    <button
      type="button"
      onClick={() => setScreen("result")}
      className="mt-1 flex items-center gap-2 text-sm font-bold text-[#59716a] hover:text-[#174f45]"
    >
      <ArrowLeft size={16} />
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
  onClick={async () => {
    const finalTranscript = typedText.trim();

    if (!finalTranscript) return;

    setErrorMessage("");
    setTranscript(finalTranscript);
    setScreen("processing");

    try {
      const extractResponse = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transcript: finalTranscript,
        }),
      });

      const extractData = (await extractResponse.json()) as {
        customer_name?: string | null;
        amount?: number | null;
        amount_type?: "received" | "promised" | "outstanding" | null;
        promise_date?: string | null;
        notes?: string | null;
        error?: string;
      };

      if (!extractResponse.ok) {
        throw new Error(
          extractData.error || "Could not understand payment details.",
        );
      }

      setExtracted({
        customer_name: extractData.customer_name ?? null,
        amount: extractData.amount ?? null,
        amount_type: extractData.amount_type ?? null,
        promise_date: extractData.promise_date ?? null,
        notes: extractData.notes ?? null,
      });

      setScreen("result");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not understand payment details.",
      );
      setScreen("ready");
    }
  }}
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
    <button
      type="button"
      onClick={() => setScreen("result")}
      className="mb-8 flex items-center gap-2 text-sm font-bold text-[#59716a] hover:text-[#174f45]"
    >
      <ArrowLeft size={16} />
      Back
    </button>

    <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-[#b2762c]">
      One last look
    </p>

    <h1 className="text-[38px] font-bold leading-[1.05] tracking-[-0.04em]">
      Review details
    </h1>

    <p className="mt-3 text-[15px] leading-6 text-[#789089]">
      Lenden understood this from your note. Check the details before saving.
    </p>

    {extracted &&
    !extracted.customer_name &&
    extracted.amount === null &&
    !extracted.amount_type &&
    !extracted.promise_date &&
    !extracted.notes ? (
      <div className="mt-8 rounded-[26px] border border-[#eadfce] bg-[#fffaf2] p-6">
        <p className="text-lg font-bold text-[#31564d]">
          Couldn't find payment details
        </p>

        <p className="mt-2 text-sm leading-6 text-[#789089]">
          I couldn't identify a customer or payment from this note.
        </p>

        <button
          type="button"
          onClick={() =>
            setExtracted({
              customer_name: "",
              amount: null,
              amount_type: null,
              promise_date: "",
              notes: "",
            })
          }
          className="mt-5 h-12 w-full rounded-2xl bg-[#174f45] text-sm font-bold text-white"
        >
          Add details manually
        </button>
      </div>
    ) : (
      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-[#59716a]">
            Customer
          </span>
          <input
            value={extracted?.customer_name ?? ""}
            onChange={(event) =>
              setExtracted((current) =>
                current
                  ? { ...current, customer_name: event.target.value }
                  : current,
              )
            }
            placeholder="Customer name"
            className="h-14 w-full rounded-2xl border border-[#dfe6df] bg-white px-4 text-[16px] text-[#31564d] outline-none focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-[#59716a]">
            Amount
          </span>
          <input
            type="number"
            value={extracted?.amount ?? ""}
            onChange={(event) =>
              setExtracted((current) =>
                current
                  ? {
                      ...current,
                      amount:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    }
                  : current,
              )
            }
            placeholder="Amount"
            className="h-14 w-full rounded-2xl border border-[#dfe6df] bg-white px-4 text-[16px] text-[#31564d] outline-none focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-[#59716a]">
            Payment status
          </span>
          <select
            value={extracted?.amount_type ?? ""}
            onChange={(event) =>
              setExtracted((current) =>
                current
                  ? {
                      ...current,
                      amount_type:
                        (event.target.value as
                          | "received"
                          | "promised"
                          | "outstanding"
                          | "") || null,
                    }
                  : current,
              )
            }
            className="h-14 w-full rounded-2xl border border-[#dfe6df] bg-white px-4 text-[16px] text-[#31564d] outline-none focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
          >
            <option value="">Not specified</option>
            <option value="received">Received</option>
            <option value="promised">Promised</option>
            <option value="outstanding">Outstanding</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-[#59716a]">
            Promise date
          </span>
          <input
            value={extracted?.promise_date ?? ""}
            onChange={(event) =>
              setExtracted((current) =>
                current
                  ? { ...current, promise_date: event.target.value }
                  : current,
              )
            }
            placeholder="e.g. Friday or next Monday"
            className="h-14 w-full rounded-2xl border border-[#dfe6df] bg-white px-4 text-[16px] text-[#31564d] outline-none focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-[#59716a]">
            Notes
          </span>
          <textarea
            value={extracted?.notes ?? ""}
            onChange={(event) =>
              setExtracted((current) =>
                current
                  ? { ...current, notes: event.target.value }
                  : current,
              )
            }
            placeholder="Anything else relevant"
            className="min-h-[110px] w-full resize-none rounded-2xl border border-[#dfe6df] bg-white p-4 text-[16px] leading-7 text-[#31564d] outline-none focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
          />
        </label>

        <button
          type="button"
          onClick={async () => {
  if (!extracted?.customer_name) {
    setErrorMessage("Customer name is required.");
    return;
  }

  try {
    setErrorMessage("");

    const response = await fetch("/api/customers/notes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer_name: extracted.customer_name,
        amount: extracted.amount,
        amount_type: extracted.amount_type,
        promise_date: extracted.promise_date,
        notes: extracted.notes,
        transcript,
      }),
    });

    const data = (await response.json()) as {
      error?: string;
    };

    if (!response.ok) {
  throw new Error(data.error || "Could not save this note.");
}

setTypedText("");
setTranscript("");
setExtracted(null);
setErrorMessage("");
setScreen("ready");
  } catch (error) {
    setErrorMessage(
      error instanceof Error
        ? error.message
        : "Could not save this note.",
    );
  }
}}
          className="mt-3 h-14 w-full rounded-2xl bg-[#174f45] text-base font-bold text-white shadow-[0_8px_20px_rgba(23,79,69,0.2)] transition hover:bg-[#123f38]"
        >
          Save this note
        </button>
      </div>
    )}
  </section>
) : screen === "customers" ? (
  <section className="flex flex-1 flex-col pb-12">
    <button
      type="button"
      onClick={() => setScreen("ready")}
      className="mb-8 flex items-center gap-2 text-sm font-bold text-[#59716a] hover:text-[#174f45]"
    >
      <ArrowLeft size={16} />
      Back
    </button>

    <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-[#b2762c]">
      Business memory
    </p>

    <h1 className="text-[38px] font-bold leading-[1.05] tracking-[-0.04em]">
      Customers
    </h1>

    <p className="mt-3 text-[15px] leading-6 text-[#789089]">
      Lenden remembers who owes you, who paid, and what they promised.
    </p>

    <div className="mt-8 space-y-3">
      {customers.length === 0 ? (
        <div className="rounded-[26px] border border-[#dfe6df] bg-white p-6 text-center">
          <p className="text-lg font-bold text-[#31564d]">
            No customers yet
          </p>
          <p className="mt-2 text-sm leading-6 text-[#789089]">
            Save your first customer note to start building your business
            memory.
          </p>
        </div>
      ) : (
        customers.map((customer) => (
          <button
            key={customer.id}
            type="button"
            onClick={() => void loadCustomer(customer.id)}
            className="w-full rounded-[24px] border border-[#dfe6df] bg-white p-5 text-left shadow-[0_8px_24px_rgba(36,73,63,0.05)] transition hover:border-[#b8cfc4] hover:shadow-[0_12px_28px_rgba(36,73,63,0.08)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-bold text-[#173b35]">
                  {customer.customerName}
                </p>

                <p className="mt-1 text-sm text-[#789089]">
                  {customer.balance > 0
                    ? `₹${customer.balance.toLocaleString("en-IN")} outstanding`
                    : customer.balance < 0
                      ? `₹${Math.abs(customer.balance).toLocaleString("en-IN")} credit`
                      : "Settled"}
                </p>
              </div>

              <span className="text-xl text-[#a2b1ab]">›</span>
            </div>

            {customer.promiseAmount && customer.promiseDate ? (
              <div className="mt-4 rounded-2xl bg-[#fffaf2] px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[#b2762c]">
                  Promise
                </p>

                <p className="mt-1 text-sm font-semibold text-[#31564d]">
                  ₹{Number(customer.promiseAmount).toLocaleString("en-IN")}
                  {" · "}
                  {new Date(customer.promiseDate).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              </div>
            ) : null}

            {customer.lastTransactionDate ? (
              <p className="mt-3 text-xs text-[#9aaba4]">
                Last transaction:{" "}
                {new Date(customer.lastTransactionDate).toLocaleDateString(
                  "en-IN",
                  {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  },
                )}
              </p>
            ) : null}
          </button>
        ))
      )}
    </div>
  </section>
) : screen === "customerDetail" ? (
  <section className="flex flex-1 flex-col pb-12">
    <button
      type="button"
      onClick={() => setScreen("customers")}
      className="mb-8 flex items-center gap-2 text-sm font-bold text-[#59716a] hover:text-[#174f45]"
    >
      <ArrowLeft size={16} />
      Customers
    </button>

    {selectedCustomer ? (
      <>
        <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-[#b2762c]">
          Business memory
        </p>

        <h1 className="text-[38px] font-bold leading-[1.05] tracking-[-0.04em]">
          {selectedCustomer.customer.customerName}
        </h1>

        <div className="mt-8 rounded-[26px] bg-[#174f45] p-6 text-white">
          <p className="text-sm font-semibold opacity-80">
            Outstanding
          </p>

          <p className="mt-2 text-[36px] font-bold tracking-[-0.04em]">
            ₹{selectedCustomer.balance.toLocaleString("en-IN")}
          </p>
        </div>

        {selectedCustomer.customer.promiseAmount &&
        selectedCustomer.customer.promiseDate ? (
          <div className="mt-4 rounded-[24px] border border-[#eadfce] bg-[#fffaf2] p-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b2762c]">
              Promise
            </p>

            <p className="mt-2 text-lg font-bold text-[#31564d]">
              ₹
              {Number(
                selectedCustomer.customer.promiseAmount,
              ).toLocaleString("en-IN")}
            </p>

            <p className="mt-1 text-sm text-[#789089]">
              by{" "}
              {new Date(
                selectedCustomer.customer.promiseDate,
              ).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        ) : null}

        <div className="mt-8">
          <p className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-[#59716a]">
            Transaction history
          </p>

          <div className="space-y-3">
            {selectedCustomer.transactions.map((transaction) => (
              <div
                key={transaction.id}
                className="flex items-center justify-between rounded-[22px] border border-[#dfe6df] bg-white p-5"
              >
                <div>
                  <p className="font-bold capitalize text-[#31564d]">
                    {transaction.type}
                  </p>

                  <p className="mt-1 text-xs text-[#9aaba4]">
                    {new Date(transaction.date).toLocaleDateString(
                      "en-IN",
                      {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      },
                    )}
                  </p>

                  {transaction.notes ? (
                    <p className="mt-1 text-xs text-[#789089]">
                      {transaction.notes}
                    </p>
                  ) : null}
                </div>

                <p
                  className={`text-lg font-bold ${
                    Number(transaction.amount) < 0
                      ? "text-[#31564d]"
                      : "text-[#b2762c]"
                  }`}
                >
                  {Number(transaction.amount) > 0 ? "+" : ""}
                  ₹
                  {Math.abs(
                    Number(transaction.amount),
                  ).toLocaleString("en-IN")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </>
    ) : null}
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
                {transcript}
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
                onClick={screen === "ready" ? startListening : toggleListening}
                disabled={screen === "processing"}
                className={`group relative flex h-[154px] w-[154px] items-center justify-center rounded-full bg-[#174f45] text-white shadow-[0_18px_38px_rgba(23,79,69,0.24)] transition ${
                  isWorking ? "scale-105" : "hover:scale-[1.03] active:scale-[0.98]"
                }`}
                aria-label={
                  screen === "paused"
                    ? "Resume recording"
                    : screen === "listening"
                      ? "Pause recording"
                      : isWorking
                        ? "Processing"
                        : "Tap to speak"
                }
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
                  : screen === "paused"
                    ? "Paused"
                  : screen === "processing"
                    ? "Processing..."
                    : "Tap to speak"}
              </p>
              {(screen === "listening" || screen === "paused") && (
                <button
                  type="button"
                  onClick={stopListening}
                  className="mt-5 rounded-full border border-[#cadbd1] px-4 py-2 text-sm font-bold text-[#59716a]"
                >
                  Stop recording
                </button>
              )}
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

               {!isWorking && (
                <button
                  type="button"
                  onClick={() => void loadCustomers()}
                  className="mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-[#3c6b5e] transition hover:bg-[#e9efe8]"
                >
                  View Business Memory
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
            {errorMessage && (
              <p className="mt-3 text-center text-sm font-semibold text-[#a55b45]">
                {errorMessage}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}