import emailjs from "emailjs-com";
import { useState, useRef, useEffect } from "react";
import DOMPurify from "dompurify";
import API_URL from "../../config/api";
import { executeRecaptcha, RECAPTCHA_SITE_KEY } from "../../config/recaptcha";

const EMAILJS_SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
const COOLDOWN_MS         = 60_000;

// ── Validators ─────────────────────────────────────────────────────────────
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isValidPhone = (v) => /^[0-9+\-\s()]{7,15}$/.test(v);
const isEmpty      = (v) => v.trim().length === 0;
const isTooLong    = (v, max) => v.length > max;

export default function ContactForm() {
  const [loading, setLoading]           = useState(false);
  const [status, setStatus]             = useState("");

  const timerRef    = useRef(null);
  const cooldownRef = useRef(null);

  // Cleanup timers on unmount
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    clearInterval(cooldownRef.current);
  }, []);

  const startCooldownTimer = () => {
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      const sLeft = Math.ceil(
        (COOLDOWN_MS - (Date.now() - Number(localStorage.getItem("lastFormSubmit")))) / 1000,
      );
      if (sLeft <= 0) {
        clearInterval(cooldownRef.current);
        setStatus("");
      } else {
        setStatus(`Please wait ${sLeft}s before sending again.`);
      }
    }, 1000);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    setStatus("");

    // ── Honeypot ──────────────────────────────────────────────────────────
    if (e.target.honeypot.value) return;

    // ── Rate limit ────────────────────────────────────────────────────────
    const lastSent = localStorage.getItem("lastFormSubmit");
    const now      = Date.now();
    if (lastSent && now - Number(lastSent) < COOLDOWN_MS) {
      const sLeft = Math.ceil((COOLDOWN_MS - (now - Number(lastSent))) / 1000);
      setStatus(`Please wait ${sLeft}s before sending again.`);
      startCooldownTimer();
      return;
    }

    // ── Sanitize ──────────────────────────────────────────────────────────
    const name    = DOMPurify.sanitize(e.target.name.value);
    const email   = DOMPurify.sanitize(e.target.email.value);
    const phone   = DOMPurify.sanitize(e.target.phone.value);
    const subject = DOMPurify.sanitize(e.target.subject.value);
    const message = DOMPurify.sanitize(e.target.message.value);

    // ── Validate ──────────────────────────────────────────────────────────
    if (isEmpty(name) || isEmpty(subject) || isEmpty(message)) {
      setStatus("Please fill in all fields.");
      return;
    }
    if (isTooLong(message, 1000)) {
      setStatus("Message is too long (max 1,000 characters).");
      return;
    }
    if (!isValidEmail(email)) {
      setStatus("Please enter a valid email address.");
      return;
    }
    if (!isValidPhone(phone)) {
      setStatus("Please enter a valid phone number.");
      return;
    }
    if (!RECAPTCHA_SITE_KEY) {
      setStatus("CAPTCHA is not configured. Please contact us directly.");
      return;
    }

    // ── Send ──────────────────────────────────────────────────────────────
    setLoading(true);

    /*
     * Payload keys are intentionally aligned with the shared EmailJS template.
     *
     * Keys sent by ContactForm:
     *   name, email, phone, subject, message
     *
     * Keys deliberately omitted (falsy → template conditional blocks stay hidden):
     *   inquiry_type  → "" (empty string — triggers {{^inquiry_type}} "Contact" badge)
     *   funding       → absent             (hides Training block)
     *   service_interest → absent          (hides Services block)
     *
     * The template uses {{^inquiry_type}} for the Contact badge and
     * {{#funding}} / {{#service_interest}} for the two modal-specific blocks.
     */
    /*
     * ContactForm payload keys:
     *   subject         → used by EmailJS as the email subject line
     *   subject_display → shown inside the Sender Info card in the template
     *   badge_*         → drive the header badge (no {{^}} inverse blocks needed)
     *   inquiry_type is intentionally omitted → Training/Services blocks stay hidden
     */
    const payload = {
      name,
      email,
      phone,
      subject,
      subject_display:     subject,          // shown in the Sender Info card
      message,
      badge_label:         "📩 Contact Message",
      badge_color:         "rgba(255,255,255,0.15)",
      badge_text_color:    "#ffffff",
      badge_border_color:  "rgba(255,255,255,0.25)",
    };

    try {
      const captchaToken = await executeRecaptcha("contact");
      const verification = await fetch(`${API_URL}/captcha/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captchaToken, captchaAction: "contact" }),
      });
      if (!verification.ok) throw new Error("CAPTCHA verification failed.");
    } catch {
      setStatus("CAPTCHA verification failed. Please try again.");
      setLoading(false);
      return;
    }

    try {
      localStorage.setItem("lastFormSubmit", now);
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, payload, EMAILJS_PUBLIC_KEY);
      setStatus("Message sent successfully!");
      timerRef.current = setTimeout(() => setStatus(""), 3_000);
      e.target.reset();
    } catch {
      setStatus("Failed to send message. Please try again.");
      timerRef.current = setTimeout(() => setStatus(""), 5_000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={sendMessage}
      className="bg-white space-y-6 md:space-y-4 flex flex-col p-8 rounded-2xl w-full"
    >
      {/* Honeypot — invisible to real users */}
      <input
        type="text"
        name="honeypot"
        style={{ display: "none" }}
        tabIndex="-1"
        autoComplete="off"
      />

      {/* Full Name */}
      <div className="flex flex-col space-y-1">
        <div className="flex items-center space-x-1">
          <label htmlFor="name">Full Name</label>
          <span className="text-red-400">*</span>
        </div>
        <input id="name" name="name" type="text" className="contact_form_input" required />
      </div>

      {/* Email & Phone */}
      <div className="flex flex-col md:flex-row space-x-0 md:space-x-4 space-y-4 md:space-y-0">
        <div className="flex flex-col space-y-1 w-full">
          <div className="flex items-center space-x-1">
            <label htmlFor="email">Email</label>
            <span className="text-red-400">*</span>
          </div>
          <input id="email" name="email" type="email" className="contact_form_input" required />
        </div>
        <div className="flex flex-col space-y-1 w-full">
          <div className="flex items-center space-x-1">
            <label htmlFor="phone">Mobile Number</label>
            <span className="text-red-400">*</span>
          </div>
          <input id="phone" name="phone" type="tel" className="contact_form_input" required />
        </div>
      </div>

      {/* Subject */}
      <div className="flex flex-col space-y-1">
        <div className="flex items-center space-x-1">
          <label htmlFor="subject">Subject</label>
          <span className="text-red-400">*</span>
        </div>
        <input id="subject" name="subject" type="text" className="contact_form_input" required />
      </div>

      {/* Message */}
      <div className="flex flex-col space-y-1">
        <div className="flex items-center space-x-1">
          <label htmlFor="message">Message</label>
          <span className="text-red-400">*</span>
        </div>
        <textarea
          id="message"
          name="message"
          className="contact_form_input h-32 resize-none"
          required
        />
      </div>

      {RECAPTCHA_SITE_KEY ? (
        <p className="self-center text-xs text-gray-500">
          Protected by Google reCAPTCHA.
        </p>
      ) : (
        <p className="self-center text-sm text-red-500">
          CAPTCHA is not configured. Please contact us directly.
        </p>
      )}

      {/* Status message */}
      {status && (
        <p
          className={`text-center font-medium ${
            status.includes("successfully") ? "text-green-500" : "text-red-400"
          }`}
        >
          {status}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="cursor-pointer bg-[#1775EE] text-white hover:bg-[#007EE6] py-3 px-[42.5%] md:py-2 md:px-[46%] rounded-md shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Sending..." : "Send"}
      </button>
    </form>
  );
}