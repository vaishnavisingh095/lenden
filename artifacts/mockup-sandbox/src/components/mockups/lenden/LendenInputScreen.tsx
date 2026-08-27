import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Mic, Pencil, RotateCcw, Trash2 } from "lucide-react";
const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const formatCustomerName = (name: string) => {
  const trimmed = name.trim();

  // Leave Hindi/Devanagari names untouched.
  if (/[\u0900-\u097F]/.test(trimmed)) {
    return trimmed;
  }

  return trimmed
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

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
  const [customerSearch, setCustomerSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
    const [customers, setCustomers] = useState<
    {
      id: number;
      customerName: string;
      phone: string | null;
      phoneNumbers: string[];
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
      phone: string | null;
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

    contactHistory: {
      id: number;
      method: "call" | "whatsapp";
      timestamp: string;
    }[];

    paymentReliability: {
    averageDaysLate: number;
    promisesKept: number;
    promisesBroken: number;
    totalPromises: number;
    averageFollowUps: number;
  };
        followUp: {
        priority: "high" | "medium" | "low";
        recommendedAction: "call" | "whatsapp" | "none";
        reason: string;
        lastContact: {
          method: "call" | "whatsapp";
          timestamp: string;
        } | null;
      };
  } | null>(null);

  type ExtractedEvent = {
  customer_name: string | null;
  phone: string | null;
  amount: number | null;
  amount_type: "received" | "promised" | "outstanding" | null;
  promise_date: string | null;
  notes: string | null;
};

const [extractedEvents, setExtractedEvents] = useState<ExtractedEvent[]>([]);
const [customerPhones, setCustomerPhones] = useState<Record<string, string>>({});

type CustomerPhone = {
  id: number;
  customerId: number;
  phone: string;
  label: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

const [savedPhones, setSavedPhones] = useState<CustomerPhone[]>([]);
const [phoneLoading, setPhoneLoading] = useState(false);
const [phoneError, setPhoneError] = useState("");
const [newPhone, setNewPhone] = useState("");
const [newPhoneLabel, setNewPhoneLabel] = useState("");
const [editingPhoneId, setEditingPhoneId] = useState<number | null>(null);
const [showAddPhone, setShowAddPhone] = useState(false);
const [editingPhoneValue, setEditingPhoneValue] = useState("");
const [editingPhoneLabel, setEditingPhoneLabel] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);


const logContactEvent = async (
  customerId: number,
  method: "call" | "whatsapp",
) => {
  try {
await fetch(`${API_URL}/api/contact-events`, {
        method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customerId,
        method,
      }),
    });
  } catch (error) {
    console.error("Could not log contact event:", error);
  }
};


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
      const response = await fetch(`${API_URL}/api/transcribe`, {
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

      console.log("VOICE TRANSCRIPT:", finalTranscript);

      setTranscript(finalTranscript);

if (!finalTranscript.trim()) {
  setErrorMessage("No speech was detected.");
  setScreen("ready");
  return;
}

const extractResponse = await fetch(`${API_URL}/api/extract`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    transcript: finalTranscript,
  }),
});

const extractData = (await extractResponse.json()) as {
  events?: ExtractedEvent[];
  error?: string;
};

if (!extractResponse.ok) {
  throw new Error(
    extractData.error || "Could not understand payment details.",
  );
}
console.log("VOICE EXTRACTION RESPONSE:", extractData);

setExtractedEvents(
  Array.isArray(extractData.events)
    ? extractData.events.slice(0, 3)
    : [],
);

setScreen("result");
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

      const response = await fetch(`${API_URL}/api/customers`);

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
  const refreshCustomers = async () => {
    try {
      const response = await fetch(`${API_URL}/api/customers`);

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as typeof customers;
      setCustomers(data);
    } catch {
      // Customer refresh is optional; do not interrupt the main flow.
    }
  };
  useEffect(() => {
  void refreshCustomers();
}, []);
const loadCustomerPhones = async (customerId: number) => {
  try {
    setPhoneLoading(true);
    setPhoneError("");

    const response = await fetch(
      `${API_URL}/api/customers/${customerId}/phones`,
    );

    if (!response.ok) {
      throw new Error("Could not load phone numbers.");
    }

    const data = (await response.json()) as CustomerPhone[];
    setSavedPhones(data);
  } catch (error) {
    setPhoneError(
      error instanceof Error
        ? error.message
        : "Could not load phone numbers.",
    );
  } finally {
    setPhoneLoading(false);
  }
};
  const loadCustomer = async (customerId: number) => {
    try {
      setErrorMessage("");

      const response = await fetch(`${API_URL}/api/customers/${customerId}`);

      if (!response.ok) {
        throw new Error("Could not load customer history.");
      }

      const data = (await response.json()) as typeof selectedCustomer;
      setSelectedCustomer(data);
      setScreen("customerDetail");
      void loadCustomerPhones(customerId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not load customer history.",
      );
    }
  };
  const getKnownCustomerPhone = (customerName: string | null) => {
  const key = customerName?.trim().toLowerCase() ?? "";

  return (
    customerPhones[key] ??
    customers.find(
      (customer) =>
        customer.customerName.trim().toLowerCase() === key,
    )?.phone ??
    ""
  );
};
const getPrimaryPhone = () => {
  const primary = savedPhones.find((phone) => phone.isPrimary);

  return primary?.phone || selectedCustomer?.customer.phone || "";
};
    const reset = () => {
    setTypedText("");
    setTranscript("");
    setExtractedEvents([]);
    setErrorMessage("");
    setScreen("ready");
  };

  const isWorking =
    screen === "listening" || screen === "paused" || screen === "processing";

  const totalOutstanding = customers.reduce(
    (total, customer) =>
      total + Math.max(0, Number(customer.balance)),
    0,
  );
  const filteredCustomers = customers.filter((customer) => {
  const query = customerSearch.trim().toLowerCase();

  if (!query) {
    return true;
  }

  return (
    customer.customerName.toLowerCase().includes(query) ||
    (customer.phone ?? "").toLowerCase().includes(query) ||
    customer.phoneNumbers.some((phone) =>
      phone.toLowerCase().includes(query),
    )
  );
});
const whatsappMessage = selectedCustomer
  ? [
      `Hi ${formatCustomerName(selectedCustomer.customer.customerName)},`,
      "",
      `This is a quick reminder that ₹${selectedCustomer.balance.toLocaleString("en-IN")} is currently outstanding.`,
      selectedCustomer.customer.promiseAmount &&
      selectedCustomer.customer.promiseDate
        ? `You had promised ₹${Number(selectedCustomer.customer.promiseAmount).toLocaleString("en-IN")} by ${new Date(selectedCustomer.customer.promiseDate).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}.`
        : selectedCustomer.customer.promiseAmount
          ? `You had promised ₹${Number(selectedCustomer.customer.promiseAmount).toLocaleString("en-IN")}.`
          : selectedCustomer.customer.promiseDate
            ? `You had promised to make the payment by ${new Date(selectedCustomer.customer.promiseDate).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}.`
            : null,
      "",
      "Please let me know when you expect to make the payment. Thank you.",
    ]
      .filter(Boolean)
      .join("\n")
  : "";
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
      const extractResponse = await fetch(`${API_URL}/api/extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transcript: finalTranscript,
        }),
      });

      const extractData = (await extractResponse.json()) as {
  events?: ExtractedEvent[];
  error?: string;
};

      if (!extractResponse.ok) {
        throw new Error(
          extractData.error || "Could not understand payment details.",
        );
      }

      const events = Array.isArray(extractData.events)
  ? extractData.events.slice(0, 3)
  : [];

if (events.length === 0) {
  throw new Error("Could not find any payment details.");
}

setExtractedEvents(events);
setScreen("result");

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
  <section className="flex flex-1 flex-col pb-12">
    <button
      type="button"
      onClick={() => setScreen("result")}
      className="mb-8 flex items-center gap-2 text-sm font-bold text-[#59716a] hover:text-[#174f45]"
    >
      <ArrowLeft size={16} />
      Back
    </button>

    <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-[#b2762c]">
      Review details
    </p>

    <h1 className="text-[38px] font-bold leading-[1.05] tracking-[-0.04em]">
      Here&apos;s what I understood
    </h1>

    <p className="mt-3 text-[15px] leading-6 text-[#789089]">
      Check and edit anything before saving it to your business memory.
    </p>
   

    <div className="mt-8 space-y-6">
      {extractedEvents.map((event, index) => (
        <div
          key={index}
          className="rounded-[26px] border border-[#dfe6df] bg-white p-5 shadow-[0_12px_30px_rgba(36,73,63,0.07)]"
        >
          {extractedEvents.length > 1 && (
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.16em] text-[#b2762c]">
              Event {index + 1}
            </p>
          )}

          {/* Customer */}
          <label className="block">
            <span className="text-sm font-bold text-[#31564d]">
              Customer
            </span>

            <input
              type="text"
              value={event.customer_name ?? ""}
              onChange={(e) => {
                const updated = [...extractedEvents];
                updated[index] = {
                  ...updated[index],
                  customer_name: e.target.value,
                };
                setExtractedEvents(updated);
              }}
              placeholder="Customer name"
              className="mt-2 h-14 w-full rounded-2xl border border-[#dfe6df] bg-[#fbfcfa] px-4 text-base font-semibold text-[#173b35] outline-none transition focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
            />
          </label>
          

          {!extractedEvents
            .slice(0, index)
            .some(
              (previousEvent) =>
                previousEvent.customer_name?.trim().toLowerCase() ===
                event.customer_name?.trim().toLowerCase(),
            ) && (
              <label className="mt-5 block">
                <span className="text-sm font-bold text-[#31564d]">
                  Phone number
                </span>

                <input
  type="tel"
  value={getKnownCustomerPhone(event.customer_name)}
  onChange={(e) => {
    const customerKey =
      event.customer_name?.trim().toLowerCase() ?? "";

    setCustomerPhones((previous) => ({
      ...previous,
      [customerKey]: e.target.value,
    }));
  }}
  placeholder="10-digit phone number"
  className="mt-2 h-14 w-full rounded-2xl border border-[#dfe6df] bg-[#fbfcfa] px-4 text-base font-semibold text-[#173b35] outline-none transition focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
/>
              </label>
            )}

         
          {/* Amount */}
          <label className="mt-5 block">
            <span className="text-sm font-bold text-[#31564d]">
              Amount
            </span>

           <div className="flex h-14 items-center rounded-2xl border border-[#d9e3df] bg-white px-4 focus-within:border-[#7ba99e] focus-within:ring-4 focus-within:ring-[#dceae2]">
  <span className="mr-3 text-lg font-semibold text-[#173b35]">
    ₹
  </span>

  <input
    type="number"
    value={event.amount ?? ""}
    onChange={(e) => {
      const updated = [...extractedEvents];

      updated[index] = {
        ...updated[index],
        amount:
          e.target.value === "" ? null : Number(e.target.value),
      };

      setExtractedEvents(updated);
    }}
    placeholder="Amount"
    className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-[#173b35] outline-none"
  />
</div>
          </label>

          {/* Type */}
          <label className="mt-5 block">
            <span className="text-sm font-bold text-[#31564d]">
              Type
            </span>

            <select
              value={event.amount_type ?? ""}
              onChange={(e) => {
                const value = e.target.value as ExtractedEvent["amount_type"];

                const updated = [...extractedEvents];
                updated[index] = {
                  ...updated[index],
                  amount_type: value || null,
                };

                setExtractedEvents(updated);
              }}
              className="mt-2 h-14 w-full appearance-none rounded-2xl border border-[#dfe6df] bg-[#fbfcfa] px-4 text-base font-semibold text-[#173b35] outline-none transition focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
            >
              <option value="">Select type</option>
              <option value="received">Payment received</option>
              <option value="outstanding">Outstanding</option>
              <option value="promised">Promise</option>
            </select>
          </label>

          {/* Promise date */}
{(event.amount_type === "promised" || event.promise_date) && (
  <label className="mt-5 block">
    <span className="text-sm font-bold text-[#31564d]">
      Promise date
    </span>

    <input
      type="text"
      value={event.promise_date ?? ""}
      onChange={(e) => {
        const updated = [...extractedEvents];

        updated[index] = {
          ...updated[index],
          promise_date: e.target.value || null,
        };

        setExtractedEvents(updated);
      }}
      placeholder="e.g. Monday"
      className="mt-2 h-14 w-full rounded-2xl border border-[#dfe6df] bg-[#fbfcfa] px-4 text-base font-semibold text-[#173b35] outline-none transition focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
    />
  </label>
)}

          {/* Notes */}
          <label className="mt-5 block">
            <span className="text-sm font-bold text-[#31564d]">
              Notes
            </span>

            <textarea
              value={event.notes ?? ""}
              onChange={(e) => {
                const updated = [...extractedEvents];
                updated[index] = {
                  ...updated[index],
                  notes: e.target.value || null,
                };

                setExtractedEvents(updated);
              }}
              placeholder="Anything else worth remembering..."
              rows={3}
              className="mt-2 w-full resize-none rounded-2xl border border-[#dfe6df] bg-[#fbfcfa] p-4 text-base leading-6 text-[#173b35] outline-none transition focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
            />
          </label>
        </div>
      ))}
    </div>

    <button
  type="button"
  onClick={async () => {
    try {
      setErrorMessage("");

      const validEvents = extractedEvents.filter(
  (event) => Boolean(event.customer_name?.trim()),
);

  if (validEvents.length === 0) {
    throw new Error("Customer name is required.");
  }

  for (const event of validEvents) {

        const response = await fetch(`${API_URL}/api/customers/notes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            customer_name: event.customer_name!.trim(),
           phone:
  getKnownCustomerPhone(event.customer_name).trim() || null,
            amount: event.amount,
            amount_type: event.amount_type,
            promise_date: event.promise_date,
            notes: event.notes ?? "",
            transcript,
          }),
        });

        const data = (await response.json()) as {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(
            data.error || "Could not save this customer note.",
          );
        }
      }

      await loadCustomers();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not save this customer note.",
      );
    }
  }}
  className="mt-6 h-14 rounded-2xl bg-[#174f45] text-base font-bold text-white shadow-[0_8px_20px_rgba(23,79,69,0.2)] transition hover:bg-[#123f38]"
>
  Save &amp; Continue
</button>
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
  Your customers
</h1>
    <div className="mt-6 rounded-[26px] bg-[#174f45] p-6 text-white">
      <p className="text-sm font-semibold opacity-80">
        Total outstanding
      </p>

      <p className="mt-2 text-[34px] font-bold tracking-[-0.04em]">
        ₹{totalOutstanding.toLocaleString("en-IN")}
      </p>

      <p className="mt-1 text-sm opacity-75">
        Money owed by your customers
      </p>
    </div>

    <p className="mt-3 text-[15px] leading-6 text-[#789089]">
  What Lenden remembers about your customers.
</p>

<input
  type="search"
  value={customerSearch}
  onChange={(e) => setCustomerSearch(e.target.value)}
  placeholder="Search customer or phone..."
  className="mt-5 h-12 w-full rounded-2xl border border-[#dfe6df] bg-white px-4 text-sm font-semibold text-[#173b35] outline-none transition placeholder:text-[#9aa9a4] focus:border-[#79a693] focus:ring-4 focus:ring-[#dceae2]"
/>

<div className="mt-5 space-y-3">
{filteredCustomers.length === 0 ? (
  <div className="rounded-[26px] border border-[#dfe6df] bg-white p-6 text-center">
    <p className="font-bold text-[#31564d]">
      {customerSearch.trim()
        ? "No matching customers"
        : "No customers yet"}
    </p>

    <p className="mt-2 text-sm text-[#789089]">
      {customerSearch.trim()
        ? "Try a different name or phone number."
        : "Save a customer interaction to see it here."}
    </p>
  </div>
) : (
        filteredCustomers.map((customer) => (
          <button
            key={customer.id}
            type="button"
            onClick={() => void loadCustomer(customer.id)}
            className="w-full rounded-[24px] border border-[#dfe6df] bg-white p-5 text-left shadow-[0_8px_24px_rgba(36,73,63,0.05)] transition hover:border-[#b8cec3] hover:bg-[#fbfcfa]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-bold text-[#173b35]">
                  {formatCustomerName(customer.customerName)}
                </p>

                {customer.notes ? (
                  <p className="mt-1 text-sm text-[#789089]">
                    {customer.notes}
                  </p>
                ) : null}

                         </div>
              <span className="text-sm font-bold text-[#59716a]">
                View
              </span>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#789089]">
                Outstanding
              </span>

              <span className="text-lg font-bold text-[#174f45]">
                ₹{Number(customer.balance).toLocaleString("en-IN")}
              </span>
            </div>

            {customer.promiseDate ? (
              <p className="mt-2 text-xs font-semibold text-[#b2762c]">
                Promise by{" "}
                {new Date(customer.promiseDate).toLocaleDateString(
                  "en-IN",
                  {
                    day: "numeric",
                    month: "short",
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
          {formatCustomerName(selectedCustomer.customer.customerName)}
        </h1>

        <div className="mt-8 rounded-[26px] bg-[#174f45] p-6 text-white">
          <p className="text-sm font-semibold opacity-80">
            Outstanding
          </p>

          <p className="mt-2 text-[36px] font-bold tracking-[-0.04em]">
            ₹{selectedCustomer.balance.toLocaleString("en-IN")}
          </p>
        </div>
        <div className="mt-4 rounded-[24px] border border-[#dfe6df] bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#59716a]">
                Phone numbers
              </p>
              <p className="mt-1 text-sm text-[#789089]">
                Manage numbers for this customer
              </p>
            </div>
          </div>

          {phoneLoading ? (
            <p className="mt-4 text-sm text-[#789089]">
              Loading phone numbers...
            </p>
          ) : savedPhones.length > 0 ? (
            <div className="mt-4 space-y-3">
              {savedPhones.map((phone) => (
                <div
                  key={phone.id}
                  className="rounded-2xl border border-[#dfe6df] bg-[#fbfcfa] p-4"
                >
                  {editingPhoneId === phone.id ? (
                    <div>
                      <input
                        type="tel"
                        value={editingPhoneValue}
                        onChange={(e) =>
                          setEditingPhoneValue(e.target.value)
                        }
                        className="h-12 w-full rounded-xl border border-[#dfe6df] bg-white px-3 text-sm font-semibold text-[#173b35] outline-none focus:border-[#79a693]"
                      />

                      <input
                        type="text"
                        value={editingPhoneLabel}
                        onChange={(e) =>
                          setEditingPhoneLabel(e.target.value)
                        }
                        placeholder="Label (e.g. Personal, Shop)"
                        className="mt-2 h-11 w-full rounded-xl border border-[#dfe6df] bg-white px-3 text-sm text-[#173b35] outline-none focus:border-[#79a693]"
                      />

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!editingPhoneValue.trim()) return;

                            const response = await fetch(
                              `${API_URL}/api/customers/${selectedCustomer.customer.id}/phones/${phone.id}`,
                              {
                                method: "PATCH",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  phone: editingPhoneValue.trim(),
                                  label:
                                    editingPhoneLabel.trim() || null,
                                }),
                              },
                            );

                            if (response.ok) {
                              setEditingPhoneId(null);
                              await loadCustomerPhones(
                                selectedCustomer.customer.id,
                              );
                              await loadCustomer(
                                selectedCustomer.customer.id,
                              );
                            }
                          }}
                          className="h-10 rounded-xl bg-[#174f45] text-sm font-bold text-white"
                        >
                          Save
                        </button>

                        <button
                          type="button"
                          onClick={() => setEditingPhoneId(null)}
                          className="h-10 rounded-xl border border-[#dfe6df] bg-white text-sm font-bold text-[#59716a]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-base font-bold text-[#173b35]">
                            {phone.phone}
                          </p>

                          <div className="mt-1 flex items-center gap-2">
                            {phone.label ? (
                              <span className="text-xs text-[#789089]">
                                {phone.label}
                              </span>
                            ) : null}

                            {phone.isPrimary ? (
                              <span className="rounded-full bg-[#e7f1eb] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#174f45]">
                                Primary
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingPhoneId(phone.id);
                            setEditingPhoneValue(phone.phone);
                            setEditingPhoneLabel(phone.label ?? "");
                          }}
                          className="rounded-xl p-2 text-[#59716a] hover:bg-[#eef5f1]"
                          aria-label="Edit phone number"
                        >
                          <Pencil size={17} />
                        </button>
                        {phone.id !== 0 ? (
  <button
    type="button"
    onClick={async () => {
      const confirmed = window.confirm(
        `Delete ${phone.phone}? This cannot be undone.`,
      );

      if (!confirmed) {
        return;
      }

      setPhoneError("");

      const response = await fetch(
        `${API_URL}/api/customers/${selectedCustomer.customer.id}/phones/${phone.id}`,
        {
          method: "DELETE",
        },
      );

      if (response.ok) {
        await loadCustomerPhones(
          selectedCustomer.customer.id,
        );

        await loadCustomer(
          selectedCustomer.customer.id,
        );
      } else {
        setPhoneError(
          "Could not delete this phone number.",
        );
      }
    }}
    className="rounded-xl p-2 text-[#b34b3f] hover:bg-[#fff1ef]"
    aria-label="Delete phone number"
  >
    <Trash2 size={17} />
  </button>
) : null}
                      </div>

                      {!phone.isPrimary ? (
                        <button
                          type="button"
                          onClick={async () => {
                            const response = await fetch(
                              `${API_URL}/api/customers/${selectedCustomer.customer.id}/phones/${phone.id}/primary`,
                              {
                                method: "PATCH",
                              },
                            );

                            if (response.ok) {
                              await loadCustomerPhones(
                                selectedCustomer.customer.id,
                              );
                              await loadCustomer(
                                selectedCustomer.customer.id,
                              );
                            }
                          }}
                          className="mt-3 text-xs font-bold text-[#174f45]"
                        >
                          Make primary
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#789089]">
              No phone numbers saved yet.
            </p>
          )}

          <div className="mt-4 border-t border-[#edf1ed] pt-4">
  {!showAddPhone ? (
    <button
      type="button"
      onClick={() => {
        setPhoneError("");
        setShowAddPhone(true);
      }}
      className="flex w-full items-center justify-between text-left"
    >
      <span className="text-sm font-bold text-[#31564d]">
        Add another number
      </span>

      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#174f45] text-xl font-medium text-white">
        +
      </span>
    </button>
  ) : (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-[#31564d]">
          Add another number
        </p>

        <button
          type="button"
          onClick={() => {
            setShowAddPhone(false);
            setNewPhone("");
            setNewPhoneLabel("");
            setPhoneError("");
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#dfe6df] bg-white text-lg text-[#59716a]"
        >
          ×
        </button>
      </div>

      <input
        type="tel"
        value={newPhone}
        onChange={(e) => setNewPhone(e.target.value)}
        placeholder="10-digit phone number"
        className="mt-3 h-12 w-full rounded-xl border border-[#dfe6df] bg-[#fbfcfa] px-3 text-sm font-semibold text-[#173b35] outline-none focus:border-[#79a693]"
      />

      <input
        type="text"
        value={newPhoneLabel}
        onChange={(e) => setNewPhoneLabel(e.target.value)}
        placeholder="Label (e.g. Personal, Shop)"
        className="mt-2 h-11 w-full rounded-xl border border-[#dfe6df] bg-[#fbfcfa] px-3 text-sm text-[#173b35] outline-none focus:border-[#79a693]"
      />

      <button
        type="button"
        disabled={!newPhone.trim()}
        onClick={async () => {
          const response = await fetch(
            `${API_URL}/api/customers/${selectedCustomer.customer.id}/phones`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                phone: newPhone.trim(),
                label: newPhoneLabel.trim() || null,
              }),
            },
          );

          if (response.ok) {
            setNewPhone("");
            setNewPhoneLabel("");
            setShowAddPhone(false);

            await loadCustomerPhones(
              selectedCustomer.customer.id,
            );

            await loadCustomer(
              selectedCustomer.customer.id,
            );
          } else {
            setPhoneError("Could not add this phone number.");
          }
        }}
        className="mt-3 h-11 w-full rounded-xl bg-[#174f45] text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        Add number
      </button>
    </>
  )}
</div>


          {phoneError ? (
            <p className="mt-3 text-sm font-semibold text-red-600">
              {phoneError}
            </p>
          ) : null}
        </div>
       {getPrimaryPhone() ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <a
              href={`tel:${getPrimaryPhone()}`}
              onClick={() =>
  void logContactEvent(
    selectedCustomer.customer.id,
    "call",
  )
}
              className="flex h-12 items-center justify-center rounded-2xl border border-[#dfe6df] bg-white text-sm font-bold text-[#174f45] transition hover:bg-[#f4f8f5]"
            >
              Call
            </a>

            <a
href={`https://wa.me/${getPrimaryPhone().replace(/\D/g, "").replace(/^0/, "91")}?text=${encodeURIComponent(    [
      `Hi ${formatCustomerName(selectedCustomer.customer.customerName)},`,
      "",
      selectedCustomer.balance > 0
        ? `This is a quick reminder that ₹${selectedCustomer.balance.toLocaleString("en-IN")} is currently outstanding.`
        : "Just checking in regarding your account.",
      selectedCustomer.customer.promiseAmount &&
      selectedCustomer.customer.promiseDate
        ? `You had promised ₹${Number(selectedCustomer.customer.promiseAmount).toLocaleString("en-IN")} by ${new Date(selectedCustomer.customer.promiseDate).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "long",
          })}.`
        : "",
      "",
      "Please let me know when you expect to make the payment. Thank you.",
    ]
      .filter(Boolean)
      .join("\n")
  )}`}
  onClick={() =>
    void logContactEvent(
      selectedCustomer.customer.id,
      "whatsapp",
    )
  }
  target="_blank"
  rel="noreferrer"
  className="flex h-12 items-center justify-center rounded-2xl bg-[#174f45] text-sm font-bold text-white transition hover:bg-[#123f38]"
>
  WhatsApp
</a>

          </div>
        ) : null}

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
                <div className="mt-4 rounded-[24px] border border-[#eadfce] bg-[#fffaf2] p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b2762c]">
              Follow-up
            </p>

            <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#b2762c]">
              {selectedCustomer.followUp.priority} priority
            </span>
          </div>

          <p className="mt-3 text-lg font-bold text-[#31564d]">
            {selectedCustomer.followUp.reason}
          </p>

          {selectedCustomer.followUp.lastContact ? (
            <p className="mt-2 text-sm text-[#789089]">
              Last contacted via{" "}
              <span className="font-bold">
                {selectedCustomer.followUp.lastContact.method === "whatsapp"
                  ? "WhatsApp"
                  : "Call"}
              </span>{" "}
              on{" "}
              {new Date(
                selectedCustomer.followUp.lastContact.timestamp,
              ).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              })}{" "}
              at{" "}
              {new Date(
                selectedCustomer.followUp.lastContact.timestamp,
              ).toLocaleTimeString("en-IN", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          ) : (
            <p className="mt-2 text-sm text-[#789089]">
              No previous contact recorded.
            </p>
          )}

                    {selectedCustomer.followUp.recommendedAction !== "none" ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-[#789089]">
                Recommended action
              </p>

              <p className="mb-3 text-sm font-bold text-[#174f45]">
                {selectedCustomer.followUp.recommendedAction === "whatsapp"
                  ? "WhatsApp this customer"
                  : "Call this customer"}
              </p>

              {selectedCustomer.followUp.recommendedAction === "whatsapp" ? (
                <a
href={`https://wa.me/${getPrimaryPhone().replace(/\D/g, "").replace(/^0/, "91")}?text=${encodeURIComponent(                    [
                      `Hi ${formatCustomerName(selectedCustomer.customer.customerName)},`,
                      "",
                      selectedCustomer.balance > 0
                        ? `This is a quick reminder that ₹${selectedCustomer.balance.toLocaleString("en-IN")} is currently outstanding.`
                        : "Just checking in regarding your account.",
                      selectedCustomer.customer.promiseAmount &&
                      selectedCustomer.customer.promiseDate
                        ? `You had promised ₹${Number(selectedCustomer.customer.promiseAmount).toLocaleString("en-IN")} by ${new Date(selectedCustomer.customer.promiseDate).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "long",
                          })}.`
                        : "",
                      "",
                      "Please let me know when you expect to make the payment. Thank you.",
                    ]
                      .filter(Boolean)
                      .join("\n"),
                  )}`}
                  onClick={() =>
                    void logContactEvent(
                      selectedCustomer.customer.id,
                      "whatsapp",
                    )
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-11 w-full items-center justify-center rounded-2xl bg-[#174f45] text-sm font-bold text-white transition hover:bg-[#123f38]"
                >
                  WhatsApp now
                </a>
              ) : (
                <a
href={`tel:${getPrimaryPhone()}`}
                  onClick={() =>
                    void logContactEvent(
                      selectedCustomer.customer.id,
                      "call",
                    )
                  }
                  className="flex h-11 w-full items-center justify-center rounded-2xl border border-[#174f45] bg-white text-sm font-bold text-[#174f45] transition hover:bg-[#f4f8f5]"
                >
                  Call now
                </a>
              )}
            </div>
          ) : null}




        </div> 
        <div className="mt-4 rounded-[24px] border border-[#dfe6df] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#59716a]">
              Payment reliability
            </p>

            <span className="text-xs font-semibold text-[#789089]">
              Based on payment history
            </span>
          </div>

          {selectedCustomer.paymentReliability.totalPromises === 0 ? (
            <div className="mt-5 rounded-2xl bg-[#f4f8f5] p-5">
              <p className="text-lg font-bold text-[#174f45]">
                Not enough history yet
              </p>

              <p className="mt-2 text-sm leading-6 text-[#789089]">
                No completed promises to evaluate this customer's payment
                reliability.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-[#f4f8f5] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#789089]">
                    Promises kept
                  </p>

                  <p className="mt-1 text-2xl font-bold text-[#174f45]">
                    {selectedCustomer.paymentReliability.promisesKept}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#fffaf2] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#789089]">
                    Promises broken
                  </p>

                  <p className="mt-1 text-2xl font-bold text-[#b2762c]">
                    {selectedCustomer.paymentReliability.promisesBroken}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#f4f8f5] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#789089]">
                    Avg. days late
                  </p>

                  <p className="mt-1 text-2xl font-bold text-[#174f45]">
                    {selectedCustomer.paymentReliability.averageDaysLate}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#f4f8f5] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#789089]">
                    Avg. follow-ups
                  </p>

                  <p className="mt-1 text-2xl font-bold text-[#174f45]">
                    {selectedCustomer.paymentReliability.averageFollowUps}
                  </p>
                </div>
              </div>

              <p className="mt-4 text-xs leading-5 text-[#789089]">
                Follow-ups include calls and WhatsApp contacts recorded before
                payment.
              </p>
            </>
          )}
                </div>

        <div className="mt-4 rounded-[24px] border border-[#dfe6df] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#59716a]">
              Contact history
            </p>

            <span className="text-xs font-semibold text-[#789089]">
              {selectedCustomer.contactHistory.length}{" "}
              {selectedCustomer.contactHistory.length === 1
                ? "contact"
                : "contacts"}
            </span>
          </div>

          {selectedCustomer.contactHistory.length === 0 ? (
            <div className="mt-5 rounded-2xl bg-[#f4f8f5] p-5">
              <p className="text-lg font-bold text-[#174f45]">
                No contact history yet
              </p>

              <p className="mt-2 text-sm leading-6 text-[#789089]">
                Calls and WhatsApp follow-ups will appear here.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {selectedCustomer.contactHistory.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between rounded-2xl bg-[#f4f8f5] p-4"
                >
                  <div>
                    <p className="font-bold text-[#174f45]">
                      {event.method === "whatsapp"
                        ? "WhatsApp"
                        : "Call"}
                    </p>

                    <p className="mt-1 text-xs text-[#789089]">
                      {new Date(event.timestamp).toLocaleDateString(
                        "en-IN",
                        {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        },
                      )}{" "}
                      ·{" "}
                      {new Date(event.timestamp).toLocaleTimeString(
                        "en-IN",
                        {
                          hour: "numeric",
                          minute: "2-digit",
                        },
                      )}
                    </p>
                  </div>

                  <span className="text-xs font-bold uppercase tracking-[0.1em] text-[#59716a]">
                    Contacted
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

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
