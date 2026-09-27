"use client";

import { useEffect, useState, type FormEvent } from "react";
import { track } from "@/lib/analytics";
import { CONTACT_EMAIL } from "@/lib/config";
import { INDUSTRIES } from "@/lib/industries";
import { topIndustry, useDemo } from "@/lib/store";
import { Arrow, Check, Mail, WhatsApp } from "./icons";
import { Modal, whatsappLink } from "./Reveal";

const WANTS = ["See options in 3D", "Get an instant estimate", "Book an appointment", "Upload plans or photos", "Get followed up automatically"];

type Status = "idle" | "sending" | "sent" | "handoff" | "error";

interface Form {
  name: string;
  company: string;
  industry: string;
  website: string;
  contact: string;
  wants: string;
  hp: string;
}

function summary(f: Form) {
  return [
    `Name: ${f.name}`,
    `Company: ${f.company}`,
    `Industry: ${f.industry}`,
    f.website ? `Website: ${f.website}` : null,
    `Reply to: ${f.contact}`,
    "",
    "What I'd like customers to be able to do:",
    f.wants || "(not specified)",
    "",
    "— sent from the VelaBuilt contractor sales demo",
  ]
    .filter((x) => x !== null)
    .join("\n");
}

export function LeadForm() {
  const open = useDemo((s) => s.leadFormOpen);
  const set = useDemo((s) => s.set);
  return (
    <Modal open={open} onClose={() => set({ leadFormOpen: false })} label="Build this for my business">
      <LeadFormBody onDone={() => set({ leadFormOpen: false })} />
    </Modal>
  );
}

/** Mounted each time the modal opens, so it starts from what the visitor explored. */
function LeadFormBody({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [f, setF] = useState<Form>(() => {
    const s = useDemo.getState();
    const top = topIndustry(s);
    return { name: "", company: s.company || "", industry: top ? INDUSTRIES.find((i) => i.id === top)!.name : "", website: "", contact: "", wants: "", hp: "" };
  });

  useEffect(() => {
    const top = topIndustry(useDemo.getState());
    track("contact_started", { channel: "form", industry: top ?? "none" });
  }, []);

  const up = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const contactOk = /\S+@\S+\.\S+/.test(f.contact) || f.contact.replace(/\D/g, "").length >= 8;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !f.company.trim() || !contactOk) {
      setError(!contactOk ? "Add an email address or a WhatsApp number so we can reply." : "Add your name and company.");
      return;
    }
    setError("");
    setStatus("sending");
    const s = useDemo.getState();
    const engaged = Object.entries(s.engagement)
      .filter(([, v]) => v && (v.actions > 0 || v.ms > 5000))
      .map(([k]) => k);
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, explored: engaged, ref: s.ref }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; delivered?: boolean; error?: string };
      track("lead_submitted", { industry: f.industry.slice(0, 32), delivered: !!data.delivered });
      if (res.ok && data.delivered) setStatus("sent");
      else if (res.ok) setStatus("handoff");
      else {
        setError(data.error || "That didn't go through.");
        setStatus("error");
      }
    } catch {
      setStatus("error");
      setError("You seem to be offline.");
    }
  };

  const mail = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Build this for ${f.company || "my business"}`)}&body=${encodeURIComponent(summary(f))}`;
  const wa = whatsappLink(summary(f));

  return (
    <>
      {status === "sent" ? (
        <div className="sent">
          <span className="sent__icon">
            <Check size={22} />
          </span>
          <h2 className="modal__title">Thanks{f.name ? `, ${f.name.split(" ")[0]}` : ""}. It&apos;s with us.</h2>
          <p className="muted">A person at VelaBuilt reads every enquiry and replies with an honest assessment — including when we&apos;re not the right fit.</p>
          <button type="button" className="btn btn--secondary" onClick={onDone}>
            <span>Back to the demo</span>
          </button>
        </div>
      ) : status === "handoff" || status === "error" ? (
        <div className="sent">
          <h2 className="modal__title">Send it straight to us</h2>
          <p className="muted">
            {status === "error" ? `${error} ` : ""}Your enquiry is written out below — send it by {wa ? "WhatsApp or " : ""}email and it reaches the same person.
          </p>
          <pre className="handoff">{summary(f)}</pre>
          <div className="share">
            {wa && (
              <a className="btn btn--primary" href={wa} target="_blank" rel="noopener" onClick={() => track("contact_started", { channel: "whatsapp", location: "form" })}>
                <WhatsApp size={18} />
                <span>Send on WhatsApp</span>
              </a>
            )}
            <a className={`btn ${wa ? "btn--secondary" : "btn--primary"}`} href={mail} onClick={() => track("contact_started", { channel: "email", location: "form" })}>
              <Mail size={18} />
              <span>Send by email</span>
            </a>
          </div>
        </div>
      ) : (
        <form className="lead" onSubmit={submit} noValidate>
          <p className="mono modal__eyebrow">Build this for my business</p>
          <h2 className="modal__title">Tell us about your business.</h2>
          <p className="muted small">Six fields. No mailing list. A person replies.</p>
          <div className="lead__grid">
            <label className="field">
              <span>Your name</span>
              <input required autoComplete="name" value={f.name} onChange={up("name")} />
            </label>
            <label className="field">
              <span>Company</span>
              <input required autoComplete="organization" value={f.company} onChange={up("company")} />
            </label>
            <label className="field">
              <span>Industry</span>
              <input list="industries" value={f.industry} onChange={up("industry")} placeholder="e.g. Roofing" />
              <datalist id="industries">
                {INDUSTRIES.map((i) => (
                  <option key={i.id} value={i.name} />
                ))}
                <option value="Electrical" />
                <option value="Plumbing" />
                <option value="Manufacturing" />
                <option value="Engineering" />
              </datalist>
            </label>
            <label className="field">
              <span>
                Website <em>optional</em>
              </span>
              <input inputMode="url" autoComplete="url" value={f.website} onChange={up("website")} placeholder="yourcompany.com" />
            </label>
            <label className="field field--wide">
              <span>Email or WhatsApp number</span>
              <input required autoComplete="email" value={f.contact} onChange={up("contact")} placeholder="you@company.com or +263 77 …" aria-invalid={!!error && !contactOk} />
            </label>
            <label className="field field--wide">
              <span>What would you like customers to be able to do?</span>
              <textarea rows={3} value={f.wants} onChange={up("wants")} maxLength={1200} />
            </label>
            <div className="wants field--wide" aria-label="Suggestions">
              {WANTS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className="chip chip--small"
                  onClick={() => setF((x) => ({ ...x, wants: x.wants.includes(w) ? x.wants : `${x.wants ? `${x.wants.trim()}\n` : ""}${w}` }))}
                >
                  + {w}
                </button>
              ))}
            </div>
            <label className="hp" aria-hidden>
              Leave empty
              <input tabIndex={-1} autoComplete="off" value={f.hp} onChange={up("hp")} />
            </label>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn--primary btn--block" disabled={status === "sending"}>
            <span>{status === "sending" ? "Sending…" : "Send enquiry"}</span>
            <Arrow />
          </button>
          <p className="muted small center">
            Prefer email? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </form>
      )}
    </>
  );
}
