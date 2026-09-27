"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { CONTACT_EMAIL, SITE_URL, WHATSAPP_NUMBER } from "@/lib/config";
import { INDUSTRY_BY_ID } from "@/lib/industries";
import { useDemo } from "@/lib/store";
import { Arrow, Close, Mail, Mark, Share, WhatsApp } from "./icons";

const EASE = [0.16, 1, 0.3, 1] as const;

export function whatsappLink(text: string) {
  return WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}` : null;
}

export function Reveal() {
  const phase = useDemo((s) => s.phase);
  const set = useDemo((s) => s.set);
  const reduced = useDemo((s) => s.reducedMotion);
  const company = useDemo((s) => s.company);
  const d = reduced ? 0 : 1;
  const wa = whatsappLink(`Hi VelaBuilt — I just tried the contractor sales demo${company ? ` (${company})` : ""}. I'd like something like this for my business.`);
  return (
    <AnimatePresence>
      {phase === "reveal" && (
        <motion.section className="reveal" id="main-content" tabIndex={-1} aria-labelledby="reveal-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
          <div className="reveal__inner">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 * d, duration: 0.9, ease: EASE }} className="reveal__brand">
              <Mark size={40} />
              <span className="mono">VelaBuilt</span>
            </motion.div>
            <motion.h2 id="reveal-title" className="reveal__title" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 * d, duration: 1, ease: EASE }}>
              This is what VelaBuilt builds.
            </motion.h2>
            <motion.p className="reveal__sub" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3 * d, duration: 0.9, ease: EASE }}>
              We turn websites into interactive sales systems.
            </motion.p>
            <motion.p className="reveal__imagine" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.9 * d, duration: 0.9 }}>
              Imagine this built around your business.
            </motion.p>
            <motion.div className="reveal__ctas" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.3 * d, duration: 0.8, ease: EASE }}>
              <button
                type="button"
                className="btn btn--gold btn--lg"
                onClick={() => {
                  track("cta_clicked", { cta: "build_this", location: "reveal" });
                  set({ leadFormOpen: true });
                }}
              >
                <span>Build this for my business</span>
                <Arrow />
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--lg"
                onClick={() => {
                  track("cta_clicked", { cta: "see_how", location: "reveal" });
                  set({ howOpen: true });
                }}
              >
                <span>See how it works</span>
              </button>
            </motion.div>
            <motion.div className="reveal__links" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.7 * d, duration: 0.8 }}>
              {wa && (
                <a href={wa} target="_blank" rel="noopener" onClick={() => track("contact_started", { channel: "whatsapp", location: "reveal" })}>
                  <WhatsApp size={16} /> WhatsApp
                </a>
              )}
              <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("The contractor sales demo")}`} onClick={() => track("contact_started", { channel: "email", location: "reveal" })}>
                <Mail size={16} /> {CONTACT_EMAIL}
              </a>
              <button type="button" onClick={() => set({ shareOpen: true })}>
                <Share size={16} /> Send to a business owner
              </button>
              <button type="button" onClick={() => set({ phase: "intro", industry: null })}>
                Try another business
              </button>
            </motion.div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function Modal({ open, onClose, label, children, wide }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input, textarea, button, a")?.focus(), 60);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, textarea, select, [tabindex="0"]');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", key);
      prev?.focus?.();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <div className="modal__scrim" onClick={onClose} aria-hidden />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={`modal__card ${wide ? "modal__card--wide" : ""}`}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
              <Close />
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { Modal };

export function HowItWorks() {
  const open = useDemo((s) => s.howOpen);
  const set = useDemo((s) => s.set);
  const last = useDemo((s) => s.lastIndustry);
  const ind = last ? INDUSTRY_BY_ID[last] : null;
  const parts = [
    { t: "Interactive showroom", d: "Your products, finishes and options, on the customer's phone. No app to install.", used: ind ? `You used the ${ind.source}` : "The 3D property you explored" },
    { t: "Configurator & estimate", d: "Your price rules turn each choice into a range, before anyone picks up the phone.", used: "The sample estimate that moved as you chose" },
    { t: "Qualification", d: "The two or three questions that tell you who is ready to buy — asked for you, every time.", used: "Timeline and contact preference" },
    { t: "CRM & pipeline", d: "Every enquiry becomes a record with everything the customer chose, in stages that match how you sell.", used: "The lead card and its score" },
    { t: "Follow-up & booking", d: "WhatsApp and email go out on their own. Customers book into your real availability. Reminders stop when they reply.", used: "The message and the booked appointment" },
  ];
  return (
    <Modal open={open} onClose={() => set({ howOpen: false })} label="How it works" wide>
      <p className="mono modal__eyebrow">How it works</p>
      <h2 className="modal__title">Five parts, built around your business.</h2>
      <ol className="how">
        {parts.map((p, i) => (
          <li key={p.t}>
            <span className="how__n mono">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h3>{p.t}</h3>
              <p>{p.d}</p>
              <small className="mono">{p.used}</small>
            </div>
          </li>
        ))}
      </ol>
      <p className="how__note">
        Configured on the tools you already use, or built to fit. Every project is scoped in writing before anything is built — and a person reads every enquiry.
      </p>
      <div className="modal__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            track("cta_clicked", { cta: "build_this", location: "how" });
            set({ howOpen: false, leadFormOpen: true });
          }}
        >
          <span>Build this for my business</span>
          <Arrow />
        </button>
      </div>
    </Modal>
  );
}

export function ShareSheet() {
  const open = useDemo((s) => s.shareOpen);
  const set = useDemo((s) => s.set);
  const close = useCallback(() => set({ shareOpen: false }), [set]);
  return (
    <Modal open={open} onClose={close} label="Send this demo">
      <ShareBody onDone={close} />
    </Modal>
  );
}

const SHARE_TEXT = "See what your customers could do on your website before they ever call you — interactive demo by VelaBuilt:";

function ShareBody({ onDone }: { onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = `${SITE_URL}/?ref=share`;
  useEffect(() => {
    // Phones get the native share sheet straight away; the buttons below remain as a fallback.
    if (typeof navigator !== "undefined" && "share" in navigator && (navigator as Navigator).canShare?.({ url })) {
      track("share_clicked", { method: "native" });
      navigator
        .share({ title: "The Future of Contractor Sales", text: SHARE_TEXT, url })
        .then(onDone)
        .catch(() => {});
    }
  }, [url, onDone]);
  return (
    <>
      <p className="mono modal__eyebrow">Share</p>
      <h2 className="modal__title">Know a business owner who should see this?</h2>
      <div className="share">
        <a className="btn btn--secondary" href={`https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXT} ${url}`)}`} target="_blank" rel="noopener" onClick={() => track("share_clicked", { method: "whatsapp" })}>
          <WhatsApp size={18} />
          <span>Send on WhatsApp</span>
        </a>
        <a className="btn btn--secondary" href={`mailto:?subject=${encodeURIComponent("You need to see this")}&body=${encodeURIComponent(`${SHARE_TEXT}\n\n${url}`)}`} onClick={() => track("share_clicked", { method: "email" })}>
          <Mail size={18} />
          <span>Send by email</span>
        </a>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => {
            navigator.clipboard?.writeText(url).then(() => setCopied(true));
            track("share_clicked", { method: "copy" });
          }}
        >
          <span>{copied ? "Link copied" : "Copy link"}</span>
        </button>
      </div>
    </>
  );
}
